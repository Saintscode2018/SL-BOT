import { Prisma, type Club, type LeagueUser, type Offer, type PrismaClient } from '@prisma/client';

import {
  BotUserNotAllowedError,
  ClubInactiveError,
  ConflictError,
  DomainError,
  DuplicateOfferError,
  EntityNotFoundError,
  MemberAlreadySignedError,
  SquadFullError,
  StaffMemberCannotReceiveOffersError,
} from '../domain/errors.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { OfferRepository } from '../repositories/offer-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import { getFriendlyPositionName, type StaffType } from './staff-management-service.js';

import type {
  OfferCreatedAuditAnnouncementPlan,
  OfferExpiredAuditAnnouncementPlan,
} from '../domain/roster-mutation.js';
import { offerExpiredAuditEventType } from './offer-decline-service.js';

export const offerCreatedAuditEventType = 'offer.created';

export interface CreateOfferWorkflowInput {
  authorization: AuthorizationInput;
  destinationClubId: string;
  playerDiscordUserId: string;
  playerIsBot: boolean;
  expiresAt?: Date;
}

export interface OfferCreationResult {
  offer: Offer;
  destinationClub: Club;
  sourceClub: Club | null;
  player: LeagueUser;
  offeredBy: LeagueUser;
  leagueName: string;
  activePlayerCount: number;
  effectiveSquadLimit: number;
  auditAnnouncement?: OfferCreatedAuditAnnouncementPlan | null;
  auditAnnouncementDelivered?: boolean | null;
  expiredAuditAnnouncement?: OfferExpiredAuditAnnouncementPlan | null;
  expiredAuditAnnouncementDelivered?: boolean | null;
  expiredOffer?: Offer;
}

export class OfferCreationService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async createOffer(input: CreateOfferWorkflowInput): Promise<OfferCreationResult> {
    if (input.playerIsBot) throw new BotUserNotAllowedError('bots cannot receive offers');
    const authorization = await new AuthorizationService(this.database).authorizeClubAction(
      input.authorization,
      input.destinationClubId,
    );
    const now = this.now();
    const transactionResult = this.database.$transaction(async (transaction) => {
      const clubs = new ClubRepository(transaction);
      const destinationClub = await clubs.getByIdInGuild(
        input.destinationClubId,
        authorization.guild.id,
      );
      if (destinationClub === null) throw new EntityNotFoundError('team was not found');
      if (!destinationClub.active) throw new ClubInactiveError('team is inactive');
      const users = new UserRepository(transaction);
      const existingPlayer = await users.getByDiscordUserId(input.playerDiscordUserId);
      const memberships = new MembershipRepository(transaction);
      if (existingPlayer !== null) {
        const activeMembership = await memberships.getActivePlayerMembership(
          authorization.guild.id,
          existingPlayer.id,
        );
        if (activeMembership !== null) throw new MemberAlreadySignedError();
        const staffMembership = await memberships.getActiveStaffMembershipForUserInGuild(
          authorization.guild.id,
          existingPlayer.id,
        );
        if (staffMembership !== null) {
          throw new StaffMemberCannotReceiveOffersError(
            input.playerDiscordUserId,
            getFriendlyPositionName(staffMembership.membershipType as StaffType),
            formatTeamIdentity(staffMembership.club, 'message'),
          );
        }
      }
      const player =
        existingPlayer ?? (await users.getOrCreateByDiscordUserId(input.playerDiscordUserId));
      const offeredBy = await users.getOrCreateByDiscordUserId(input.authorization.discordUserId);
      const activeMembership = await memberships.getActivePlayerMembership(
        authorization.guild.id,
        player.id,
      );
      if (activeMembership !== null) throw new MemberAlreadySignedError();
      const playerCount = await memberships.countActiveUniqueMembers(destinationClub.id);
      const effectiveSquadLimit = getEffectiveSquadLimit(destinationClub, authorization.settings);
      if (playerCount >= effectiveSquadLimit) {
        throw new SquadFullError('destination team roster is full');
      }
      const offers = new OfferRepository(transaction);
      const existingPending = await offers.getPendingForClubAndPlayer(
        destinationClub.id,
        player.id,
      );
      let expiredAuditAnnouncement: OfferExpiredAuditAnnouncementPlan | null = null;
      let expiredOffer: Offer | undefined;
      if (existingPending !== null) {
        if (existingPending.expiresAt.getTime() > now.getTime()) {
          throw new DuplicateOfferError('a pending offer already exists for this player and team');
        }
        const expired = await offers.transition(existingPending.id, 'EXPIRED', now);
        expiredOffer = expired;
        await new AuditEventRepository(transaction).create({
          guildId: existingPending.guildId,
          eventType: offerExpiredAuditEventType,
          entityType: 'offer',
          entityId: existingPending.id,
          beforeState: { status: 'PENDING' },
          afterState: { status: 'EXPIRED' },
          metadata: {
            discordChannelId: expired.discordChannelId,
            discordMessageId: expired.discordMessageId,
          },
        });
        expiredAuditAnnouncement =
          authorization.settings.auditChannelId === null ||
          authorization.settings.auditChannelId === undefined
            ? null
            : {
                discordGuildId: authorization.guild.discordGuildId,
                channelId: authorization.settings.auditChannelId,
                operation: 'OFFER_EXPIRED',
                playerDiscordUserId: player.discordUserId,
                teamIdentity: destinationClub,
                occurredAt: now,
              };
      }
      const expiresAt =
        input.expiresAt ??
        new Date(now.getTime() + authorization.settings.offerTimeoutSeconds * 1000);
      const offer = await offers.createPending({
        guildId: authorization.guild.id,
        clubId: destinationClub.id,
        playerUserId: player.id,
        offeredByUserId: offeredBy.id,
        expiresAt,
      });
      const sourceClub = null;
      await new AuditEventRepository(transaction).create({
        guildId: authorization.guild.id,
        actorUserId: offeredBy.id,
        eventType: offerCreatedAuditEventType,
        entityType: 'offer',
        entityId: offer.id,
        afterState: {
          status: offer.status,
          destinationClubId: destinationClub.id,
          playerUserId: player.id,
          expiresAt: offer.expiresAt.toISOString(),
        },
        metadata: { sourceClubId: null },
      });
      const auditAnnouncement: OfferCreatedAuditAnnouncementPlan | null =
        authorization.settings.auditChannelId === null ||
        authorization.settings.auditChannelId === undefined
          ? null
          : {
              discordGuildId: authorization.guild.discordGuildId,
              channelId: authorization.settings.auditChannelId,
              operation: 'OFFER_CREATED',
              actorDiscordUserId: offeredBy.discordUserId,
              playerDiscordUserId: player.discordUserId,
              teamIdentity: destinationClub,
              occurredAt: offer.createdAt,
              expiresAt: offer.expiresAt,
            };
      return {
        offer,
        destinationClub,
        sourceClub,
        player,
        offeredBy,
        leagueName: authorization.guild.name,
        activePlayerCount: playerCount,
        effectiveSquadLimit,
        auditAnnouncement,
        expiredAuditAnnouncement,
        ...(expiredOffer === undefined ? {} : { expiredOffer }),
      };
    });
    return transactionResult.catch((error: unknown) => {
      if (error instanceof DomainError) throw error;
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2028', 'P2034'].includes(error.code)) ||
        (error instanceof Prisma.PrismaClientUnknownRequestError &&
          /database is locked|transaction/i.test(error.message))
      ) {
        throw new ConflictError('offer creation conflicted', { cause: error });
      }
      throw error;
    });
  }
}
