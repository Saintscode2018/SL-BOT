import type { LeagueTransaction } from '@prisma/client';

import { EntityNotFoundError, InvalidStateTransitionError } from '../domain/errors.js';
import type { LeagueTransactionType } from '../domain/enums.js';
import type { DatabaseClient } from '../domain/types.js';
import { translateDatabaseError } from './repository-errors.js';

export interface CreateLeagueTransactionInput {
  guildId: string;
  userId: string;
  transactionType: LeagueTransactionType;
  sourceClubId?: string | null;
  destinationClubId?: string | null;
  performedByUserId: string;
  offerId?: string | null;
  reason?: string | null;
}

export class LeagueTransactionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async create(input: CreateLeagueTransactionInput): Promise<LeagueTransaction> {
    try {
      return await this.db.leagueTransaction.create({
        data: {
          guildId: input.guildId,
          userId: input.userId,
          transactionType: input.transactionType,
          sourceClubId: input.sourceClubId ?? null,
          destinationClubId: input.destinationClubId ?? null,
          performedByUserId: input.performedByUserId,
          offerId: input.offerId ?? null,
          reason: input.reason ?? null,
        },
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'create league transaction');
    }
  }

  public async listForUser(guildId: string, userId: string): Promise<LeagueTransaction[]> {
    return this.db.leagueTransaction.findMany({
      where: { guildId, userId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  public async listForClub(guildId: string, clubId: string): Promise<LeagueTransaction[]> {
    return this.db.leagueTransaction.findMany({
      where: {
        guildId,
        OR: [{ sourceClubId: clubId }, { destinationClubId: clubId }],
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  public async markReversed(
    id: string,
    reversedByUserId: string,
    reversedAt = new Date(),
  ): Promise<LeagueTransaction> {
    const result = await this.db.leagueTransaction.updateMany({
      where: { id, reversedAt: null },
      data: { reversedAt, reversedByUserId },
    });
    if (result.count === 1) {
      const transaction = await this.db.leagueTransaction.findUnique({ where: { id } });
      if (transaction !== null) return transaction;
    }
    const existing = await this.db.leagueTransaction.findUnique({ where: { id } });
    if (existing === null) {
      throw new EntityNotFoundError(`league transaction ${id} was not found`);
    }
    throw new InvalidStateTransitionError(`league transaction ${id} is already reversed`);
  }
}
