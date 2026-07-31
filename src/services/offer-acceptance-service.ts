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
  AlreadyMemberOfClubError,
  ConflictError,
  DomainError,
  EntityNotFoundError,
  InvalidStateTransitionError,
  OfferExpiredError,
  SquadFullError,
  UnauthorizedOfferAcceptanceError,
} from '../domain/errors.js';
import type { DatabaseClient } from '../domain/types.js';
import { discordSnowflakeSchema } from '../domain/validation.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { OfferRepository } from '../repositories/offer-repository.js';
import { LeagueTransactionRepository } from '../repositories/transaction-repository.js';
import { UserRepository } from '../repositories/user-repository.js';

export const offerAcceptedAuditEventType = 'offer.accepted';

export interface AcceptOfferInput {
  offerId: string;
  acceptingDiscordUserId: string;
  acceptedAt?: Date;
}

export interface OfferAcceptanceResult {
  offer: Offer;
  player: LeagueUser;
  destinationClub: Club;
  sourceClub: Club | null;
  newMembership: ClubMembership;
  transaction: LeagueTransaction;
  transactionType: 'SIGNING' | 'TRANSFER';
}

export interface OfferAcceptanceRepositories {
  offers: Pick<OfferRepository, 'getById' | 'transition'>;
  users: Pick<UserRepository, 'getById'>;
  clubs: Pick<ClubRepository, 'getById'>;
  memberships: Pick<
    MembershipRepository,
    'getActivePlayerMembership' | 'countActivePlayers' | 'end' | 'createActive'
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
    memberships: new MembershipRepository(database),
    transactions: new LeagueTransactionRepository(database),
    auditEvents: new AuditEventRepository(database),
  };
}

type AcceptanceTransactionOutcome =
  | { kind: 'accepted'; result: OfferAcceptanceResult }
  | { kind: 'expired' };

export class OfferAcceptanceService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly repositoryFactory: OfferAcceptanceRepositoryFactory = createOfferAcceptanceRepositories,
  ) {}

  public async acceptOffer(input: AcceptOfferInput): Promise<OfferAcceptanceResult> {
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
      await repositories.offers.transition(offerId, 'EXPIRED', acceptedAt);
      return { kind: 'expired' };
    }

    const destinationClub = await repositories.clubs.getById(pendingOffer.clubId);
    if (destinationClub === null) {
      throw new EntityNotFoundError(`club ${pendingOffer.clubId} was not found`);
    }
    if (!destinationClub.active) {
      throw new InvalidStateTransitionError(`club ${destinationClub.id} is inactive`);
    }

    const previousMembership = await repositories.memberships.getActivePlayerMembership(
      pendingOffer.guildId,
      player.id,
    );
    if (previousMembership?.clubId === destinationClub.id) {
      throw new AlreadyMemberOfClubError(
        `player ${player.id} is already active in club ${destinationClub.id}`,
      );
    }
    const activePlayerCount = await repositories.memberships.countActivePlayers(destinationClub.id);
    if (activePlayerCount >= destinationClub.squadLimit) {
      throw new SquadFullError(`club ${destinationClub.id} has reached its squad limit`);
    }

    const acceptedOffer = await repositories.offers.transition(offerId, 'ACCEPTED', acceptedAt);
    const sourceClub =
      previousMembership === null
        ? null
        : await repositories.clubs.getById(previousMembership.clubId);
    if (previousMembership !== null && sourceClub === null) {
      throw new EntityNotFoundError(`club ${previousMembership.clubId} was not found`);
    }
    if (previousMembership !== null) {
      await repositories.memberships.end(previousMembership.id, {
        leftAt: acceptedAt,
        endedByUserId: pendingOffer.offeredByUserId,
      });
    }
    const newMembership = await repositories.memberships.createActive({
      guildId: pendingOffer.guildId,
      clubId: destinationClub.id,
      userId: player.id,
      membershipType: 'PLAYER',
      joinedAt: acceptedAt,
      createdByUserId: pendingOffer.offeredByUserId,
    });
    const transactionType = previousMembership === null ? 'SIGNING' : 'TRANSFER';
    const transaction = await repositories.transactions.create({
      guildId: pendingOffer.guildId,
      userId: player.id,
      transactionType,
      sourceClubId: sourceClub?.id ?? null,
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
        sourceMembership:
          previousMembership === null
            ? null
            : {
                id: previousMembership.id,
                clubId: previousMembership.clubId,
                status: previousMembership.status,
              },
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
        sourceClubId: sourceClub?.id ?? null,
        destinationClubId: destinationClub.id,
        transactionId: transaction.id,
        transactionType,
      },
    });

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
      },
    };
  }
}
