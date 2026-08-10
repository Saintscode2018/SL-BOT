import {
  Prisma,
  type Club,
  type ClubMembership,
  type LeagueTransaction,
  type LeagueUser,
  type Offer,
  type PrismaClient,
} from '@prisma/client';

import {
  ConflictError,
  DomainError,
  EntityNotFoundError,
  InvalidStateTransitionError,
  MemberAlreadySignedError,
  OfferExpiredError,
  SquadFullError,
  UnauthorizedOfferAcceptanceError,
} from '../domain/errors.js';
import type { MemberRoleMutationPlan, MutationPlans } from '../domain/roster-mutation.js';
import type { DatabaseClient } from '../domain/types.js';
import { discordSnowflakeSchema } from '../domain/validation.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { OfferRepository } from '../repositories/offer-repository.js';
import { LeagueTransactionRepository } from '../repositories/transaction-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { RoleSynchronizedMutationService } from './role-synchronized-mutation-service.js';

import type { AcceptedOfferPresentationData } from './offer-delivery-service.js';
import { offerExpiredAuditEventType } from './offer-decline-service.js';

export const offerAcceptedAuditEventType = 'offer.accepted';

export interface AcceptOfferInput {
  offerId: string;
  acceptingDiscordUserId: string;
  acceptedAt?: Date;
}

export interface OfferAcceptanceResult extends MutationPlans {
  offer: Offer;
  player: LeagueUser;
  destinationClub: Club;
  sourceClub: Club | null;
  newMembership: ClubMembership;
  transaction: LeagueTransaction;
  transactionType: 'SIGNING';
  announcementDelivered?: boolean | null;
  auditAnnouncementDelivered?: boolean | null;
  acceptedPresentation?: AcceptedOfferPresentationData;
}

export interface OfferAcceptanceRepositories {
  offers: Pick<OfferRepository, 'getById' | 'transition' | 'expirePendingAtOrBefore'>;
  users: Pick<UserRepository, 'getById'>;
  clubs: Pick<ClubRepository, 'getById'>;
  guilds: Pick<GuildRepository, 'getSettings'>;
  memberships: Pick<
    MembershipRepository,
    | 'listActiveMembershipsForUserInGuild'
    | 'getActiveStaffAppointment'
    | 'countActiveUniqueMembers'
    | 'end'
    | 'createActive'
  >;
  transactions: Pick<LeagueTransactionRepository, 'create'>;
  auditEvents: Pick<AuditEventRepository, 'create'>;
}

export type OfferAcceptanceRepositoryFactory = (
  database: DatabaseClient,
) => OfferAcceptanceRepositories;

export function createOfferAcceptanceRepositories(
  database: DatabaseClient,
): OfferAcceptanceRepositories {
  return {
    offers: new OfferRepository(database),
    users: new UserRepository(database),
    clubs: new ClubRepository(database),
    guilds: new GuildRepository(database),
    memberships: new MembershipRepository(database),
    transactions: new LeagueTransactionRepository(database),
    auditEvents: new AuditEventRepository(database),
  };
}

type AcceptanceTransactionOutcome =
  | { kind: 'accepted'; result: OfferAcceptanceResult }
  | { kind: 'expired' };

type AcceptancePreparation =
  | { kind: 'ready'; rolePlan: MemberRoleMutationPlan }
  | { kind: 'expired' };

export class OfferAcceptanceService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly repositoryFactory: OfferAcceptanceRepositoryFactory = createOfferAcceptanceRepositories,
    private readonly synchronization?: Pick<RoleSynchronizedMutationService, 'execute'>,
  ) {}

  public async acceptOffer(input: AcceptOfferInput): Promise<OfferAcceptanceResult> {
    const acceptedAt = input.acceptedAt ?? new Date();
    const acceptanceInput = { ...input, acceptedAt };
    if (this.synchronization !== undefined) {
      const preparation = await this.prepareAcceptance(acceptanceInput);
      if (preparation.kind === 'expired') {
        throw new OfferExpiredError(`offer ${input.offerId} expired before acceptance`);
      }
      return this.synchronization.execute(preparation.rolePlan, () =>
        this.acceptPersisted(acceptanceInput),
      );
    }
    return this.acceptPersisted(acceptanceInput);
  }

  private async acceptPersisted(input: AcceptOfferInput): Promise<OfferAcceptanceResult> {
    const acceptedAt = input.acceptedAt ?? new Date();
    const acceptingDiscordUserId = discordSnowflakeSchema.parse(input.acceptingDiscordUserId);
    let outcome: AcceptanceTransactionOutcome;
    try {
      outcome = await this.database.$transaction((transactionClient) => {
        return this.acceptInsideTransaction(
          transactionClient,
          input.offerId,
          acceptingDiscordUserId,
          acceptedAt,
        );
      });
    } catch (error: unknown) {
      if (error instanceof DomainError) throw error;
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2028', 'P2034'].includes(error.code)) ||
        (error instanceof Prisma.PrismaClientUnknownRequestError &&
          /database is locked|transaction/i.test(error.message))
      ) {
        throw new ConflictError(`offer ${input.offerId} acceptance conflicted`, { cause: error });
      }
      throw error;
    }
    if (outcome.kind === 'expired') {
      throw new OfferExpiredError(`offer ${input.offerId} expired before acceptance`);
    }
    return outcome.result;
  }

  private async prepareAcceptance(input: AcceptOfferInput): Promise<AcceptancePreparation> {
    const acceptedAt = input.acceptedAt ?? new Date();
    const acceptingDiscordUserId = discordSnowflakeSchema.parse(input.acceptingDiscordUserId);
    return this.database.$transaction(async (transactionClient) => {
      const repositories = this.repositoryFactory(transactionClient);
      const offer = await repositories.offers.getById(input.offerId);
      if (offer === null) throw new EntityNotFoundError('offer was not found');
      if (offer.status !== 'PENDING') {
        throw new InvalidStateTransitionError('offer has already been handled');
      }
      const player = await repositories.users.getById(offer.playerUserId);
      if (player === null) throw new EntityNotFoundError('player was not found');
      if (player.discordUserId !== acceptingDiscordUserId) {
        throw new UnauthorizedOfferAcceptanceError('only the offered player may accept');
      }
      if (offer.expiresAt.getTime() <= acceptedAt.getTime()) {
        await this.expirePendingOffer(repositories, offer, acceptedAt);
        return { kind: 'expired' };
      }
      const club = await repositories.clubs.getById(offer.clubId);
      if (club === null) throw new EntityNotFoundError('team was not found');
      if (!club.active) throw new InvalidStateTransitionError('team is inactive');
      if (
        (
          await repositories.memberships.listActiveMembershipsForUserInGuild(
            offer.guildId,
            player.id,
          )
        ).length > 0
      ) {
        throw new MemberAlreadySignedError();
      }
      const settings = await repositories.guilds.getSettings(offer.guildId);
      if (
        (await repositories.memberships.countActiveUniqueMembers(club.id)) >=
        getEffectiveSquadLimit(club, settings)
      ) {
        throw new SquadFullError('team has reached its squad limit');
      }
      const guild = await new GuildRepository(transactionClient).requireById(offer.guildId);
      return {
        kind: 'ready',
        rolePlan: {
          discordGuildId: guild.discordGuildId,
          discordUserId: player.discordUserId,
          addRoles: [{ id: club.discordRoleId, purpose: 'TEAM' }],
          removeRoles: [],
        },
      };
    });
  }

  private async acceptInsideTransaction(
    transactionClient: Prisma.TransactionClient,
    offerId: string,
    acceptingDiscordUserId: string,
    acceptedAt: Date,
  ): Promise<AcceptanceTransactionOutcome> {
    const repositories = this.repositoryFactory(transactionClient);
    const pendingOffer = await repositories.offers.getById(offerId);
    if (pendingOffer === null) {
      throw new EntityNotFoundError(`offer ${offerId} was not found`);
    }
    if (pendingOffer.status !== 'PENDING') {
      throw new InvalidStateTransitionError(
        `offer ${offerId} cannot be accepted from ${pendingOffer.status}`,
      );
    }

    const player = await repositories.users.getById(pendingOffer.playerUserId);
    if (player === null) {
      throw new EntityNotFoundError(`player ${pendingOffer.playerUserId} was not found`);
    }
    if (player.discordUserId !== acceptingDiscordUserId) {
      throw new UnauthorizedOfferAcceptanceError(
        `discord user ${acceptingDiscordUserId} cannot accept offer ${offerId}`,
      );
    }

    if (pendingOffer.expiresAt.getTime() <= acceptedAt.getTime()) {
      await this.expirePendingOffer(repositories, pendingOffer, acceptedAt);
      return { kind: 'expired' };
    }

    const destinationClub = await repositories.clubs.getById(pendingOffer.clubId);
    if (destinationClub === null) {
      throw new EntityNotFoundError(`club ${pendingOffer.clubId} was not found`);
    }
    if (!destinationClub.active) {
      throw new InvalidStateTransitionError(`club ${destinationClub.id} is inactive`);
    }

    const previousMemberships = await repositories.memberships.listActiveMembershipsForUserInGuild(
      pendingOffer.guildId,
      player.id,
    );
    if (previousMemberships.length > 0) throw new MemberAlreadySignedError();
    const activePlayerCount = await repositories.memberships.countActiveUniqueMembers(
      destinationClub.id,
    );
    const settings = await repositories.guilds.getSettings(pendingOffer.guildId);
    const effectiveLimit = getEffectiveSquadLimit(destinationClub, settings);
    if (activePlayerCount >= effectiveLimit) {
      throw new SquadFullError(`club ${destinationClub.id} has reached its squad limit`);
    }

    const acceptedOffer = await repositories.offers.transition(offerId, 'ACCEPTED', acceptedAt);
    const sourceClub = null;
    const newMembership = await repositories.memberships.createActive({
      guildId: pendingOffer.guildId,
      clubId: destinationClub.id,
      userId: player.id,
      membershipType: 'PLAYER',
      joinedAt: acceptedAt,
      createdByUserId: pendingOffer.offeredByUserId,
    });
    const transactionType = 'SIGNING' as const;
    const transaction = await repositories.transactions.create({
      guildId: pendingOffer.guildId,
      userId: player.id,
      transactionType,
      sourceClubId: null,
      destinationClubId: destinationClub.id,
      performedByUserId: pendingOffer.offeredByUserId,
      offerId: acceptedOffer.id,
    });
    await repositories.auditEvents.create({
      guildId: pendingOffer.guildId,
      actorUserId: player.id,
      eventType: offerAcceptedAuditEventType,
      entityType: 'offer',
      entityId: acceptedOffer.id,
      beforeState: {
        offerStatus: 'PENDING',
        sourceMembership: null,
      },
      afterState: {
        offerStatus: 'ACCEPTED',
        membership: {
          id: newMembership.id,
          clubId: newMembership.clubId,
          status: newMembership.status,
        },
      },
      metadata: {
        acceptingPlayerUserId: player.id,
        offeredByUserId: pendingOffer.offeredByUserId,
        sourceClubId: null,
        destinationClubId: destinationClub.id,
        transactionId: transaction.id,
        transactionType,
      },
    });

    const offeredByUser = await repositories.users.getById(pendingOffer.offeredByUserId);
    const guild = await new GuildRepository(transactionClient).requireById(pendingOffer.guildId);
    const teamManagerMembership = await repositories.memberships.getActiveStaffAppointment(
      destinationClub.id,
      'TEAM_MANAGER',
    );
    const teamManager =
      teamManagerMembership === null
        ? null
        : await repositories.users.getById(teamManagerMembership.userId);
    return {
      kind: 'accepted',
      result: {
        offer: acceptedOffer,
        player,
        destinationClub,
        sourceClub,
        newMembership,
        transaction,
        transactionType,
        roleMutation: {
          discordGuildId: guild.discordGuildId,
          discordUserId: player.discordUserId,
          addRoles: [{ id: destinationClub.discordRoleId, purpose: 'TEAM' }],
          removeRoles: [],
        },
        acceptedPresentation: {
          state: 'ACCEPTED',
          guildName: guild.name,
          guildIconUrl: null,
          teamRoleName: null,
          teamEmoji: destinationClub.emoji,
          teamDiscordRoleId: destinationClub.discordRoleId,
          tmUserId: teamManager !== null ? teamManager.discordUserId : null,
          tmUsername: null,
          activePlayerCount: activePlayerCount + 1,
          effectiveSquadLimit: effectiveLimit,
        },
        announcement:
          settings?.transferChannelId === null || settings?.transferChannelId === undefined
            ? null
            : {
                discordGuildId: guild.discordGuildId,
                channelId: settings.transferChannelId,
                type: 'SIGNED',
                discordUserId: player.discordUserId,
                teamIdentity: destinationClub,
                occurredAt: acceptedAt,
                ...(offeredByUser === null
                  ? {}
                  : { actorDiscordUserId: offeredByUser.discordUserId }),
                roster: {
                  currentSize: activePlayerCount + 1,
                  maximumSize: effectiveLimit,
                  teamManagerDiscordUserId: teamManager?.discordUserId ?? null,
                },
              },
        auditAnnouncement:
          settings?.auditChannelId === null || settings?.auditChannelId === undefined
            ? null
            : {
                discordGuildId: guild.discordGuildId,
                channelId: settings.auditChannelId,
                operation: 'OFFER_ACCEPTED',
                actorDiscordUserId: player.discordUserId,
                playerDiscordUserId: player.discordUserId,
                teamIdentity: destinationClub,
                occurredAt: acceptedAt,
              },
      },
    };
  }

  private async expirePendingOffer(
    repositories: OfferAcceptanceRepositories,
    pendingOffer: Offer,
    expiredAt: Date,
  ): Promise<void> {
    const expiredOffer = await repositories.offers.expirePendingAtOrBefore(
      pendingOffer.id,
      expiredAt,
    );
    await repositories.auditEvents.create({
      guildId: pendingOffer.guildId,
      eventType: offerExpiredAuditEventType,
      entityType: 'offer',
      entityId: pendingOffer.id,
      beforeState: { status: 'PENDING' },
      afterState: { status: expiredOffer.status },
      metadata: {
        discordChannelId: expiredOffer.discordChannelId,
        discordMessageId: expiredOffer.discordMessageId,
      },
    });
  }
}
