import type { Offer } from '@prisma/client';

import { EntityNotFoundError, InvalidStateTransitionError } from '../domain/errors.js';
import type { TerminalOfferStatus } from '../domain/enums.js';
import type { DatabaseClient } from '../domain/types.js';
import { discordSnowflakeSchema } from '../domain/validation.js';
import { translateDatabaseError } from './repository-errors.js';

export interface CreateOfferInput {
  guildId: string;
  clubId: string;
  playerUserId: string;
  offeredByUserId: string;
  expiresAt: Date;
  discordChannelId?: string | null;
  discordMessageId?: string | null;
}

export class OfferRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async createPending(input: CreateOfferInput): Promise<Offer> {
    try {
      return await this.db.offer.create({
        data: {
          guildId: input.guildId,
          clubId: input.clubId,
          playerUserId: input.playerUserId,
          offeredByUserId: input.offeredByUserId,
          status: 'PENDING',
          expiresAt: input.expiresAt,
          discordChannelId:
            input.discordChannelId == null
              ? null
              : discordSnowflakeSchema.parse(input.discordChannelId),
          discordMessageId:
            input.discordMessageId == null
              ? null
              : discordSnowflakeSchema.parse(input.discordMessageId),
        },
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'create offer');
    }
  }

  public async getById(id: string): Promise<Offer | null> {
    return this.db.offer.findUnique({ where: { id } });
  }

  public async listPendingForPlayer(guildId: string, playerUserId: string): Promise<Offer[]> {
    return this.db.offer.findMany({
      where: { guildId, playerUserId, status: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  public async listPendingForClub(clubId: string): Promise<Offer[]> {
    return this.db.offer.findMany({
      where: { clubId, status: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  public async getPendingForClubAndPlayer(
    clubId: string,
    playerUserId: string,
  ): Promise<Offer | null> {
    return this.db.offer.findFirst({
      where: { clubId, playerUserId, status: 'PENDING' },
    });
  }

  public async setMessageReference(
    id: string,
    discordChannelId: string,
    discordMessageId: string,
  ): Promise<Offer> {
    const result = await this.db.offer.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        discordChannelId: discordSnowflakeSchema.parse(discordChannelId),
        discordMessageId: discordSnowflakeSchema.parse(discordMessageId),
      },
    });
    if (result.count !== 1) {
      const existing = await this.getById(id);
      if (existing === null) throw new EntityNotFoundError(`offer ${id} was not found`);
      throw new InvalidStateTransitionError(`offer ${id} is not pending`);
    }
    const offer = await this.getById(id);
    if (offer === null) throw new EntityNotFoundError(`offer ${id} was not found`);
    return offer;
  }

  public async listExpiredPending(now = new Date()): Promise<Offer[]> {
    return this.db.offer.findMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      orderBy: [{ expiresAt: 'asc' }],
    });
  }

  public async transition(
    id: string,
    status: TerminalOfferStatus,
    at = new Date(),
  ): Promise<Offer> {
    const data =
      status === 'CANCELLED'
        ? { status, respondedAt: at, cancelledAt: at }
        : { status, respondedAt: at };
    const result = await this.db.offer.updateMany({
      where: { id, status: 'PENDING' },
      data,
    });
    if (result.count === 1) {
      const offer = await this.db.offer.findUnique({ where: { id } });
      if (offer !== null) return offer;
    }
    const existing = await this.db.offer.findUnique({ where: { id } });
    if (existing === null) {
      throw new EntityNotFoundError(`offer ${id} was not found`);
    }
    throw new InvalidStateTransitionError(
      `offer ${id} cannot transition from ${existing.status} to ${status}`,
    );
  }

  public async voidPendingForSignedPlayer(
    guildId: string,
    playerUserId: string,
    acceptedOfferId: string | null,
    at = new Date(),
  ): Promise<Offer[]> {
    const pendingOffers = await this.db.offer.findMany({
      where: {
        guildId,
        playerUserId,
        status: 'PENDING',
        ...(acceptedOfferId === null ? {} : { id: { not: acceptedOfferId } }),
      },
    });
    const voidedOffers: Offer[] = [];

    for (const pendingOffer of pendingOffers) {
      const result = await this.db.offer.updateMany({
        where: {
          AND: [
            { id: pendingOffer.id },
            { guildId },
            { playerUserId },
            { status: 'PENDING' },
            ...(acceptedOfferId === null ? [] : [{ id: { not: acceptedOfferId } }]),
          ],
        },
        data: { status: 'VOIDED', respondedAt: at },
      });
      if (result.count !== 1) continue;

      const voidedOffer = await this.getById(pendingOffer.id);
      if (voidedOffer !== null) voidedOffers.push(voidedOffer);
    }

    return voidedOffers;
  }

  public async expirePendingAtOrBefore(id: string, at: Date): Promise<Offer> {
    const result = await this.db.offer.updateMany({
      where: { id, status: 'PENDING', expiresAt: { lte: at } },
      data: { status: 'EXPIRED', respondedAt: at },
    });
    if (result.count === 1) {
      const offer = await this.getById(id);
      if (offer !== null) return offer;
    }
    const existing = await this.getById(id);
    if (existing === null) throw new EntityNotFoundError(`offer ${id} was not found`);
    throw new InvalidStateTransitionError(
      `offer ${id} cannot expire from ${existing.status} at the operation time`,
    );
  }

  public async markExpiredPending(now = new Date()): Promise<number> {
    const result = await this.db.offer.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', respondedAt: now },
    });
    return result.count;
  }

  public async cancel(id: string, at = new Date()): Promise<Offer> {
    return this.transition(id, 'CANCELLED', at);
  }
}
