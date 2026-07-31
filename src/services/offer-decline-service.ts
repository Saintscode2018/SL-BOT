import { Prisma, type Offer, type PrismaClient } from '@prisma/client';

import {
  ConflictError,
  DomainError,
  EntityNotFoundError,
  InvalidStateTransitionError,
  OfferExpiredError,
  UnauthorizedOfferAcceptanceError,
} from '../domain/errors.js';
import { discordSnowflakeSchema } from '../domain/validation.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { OfferRepository } from '../repositories/offer-repository.js';
import { UserRepository } from '../repositories/user-repository.js';

export const offerDeclinedAuditEventType = 'offer.declined';
export const offerExpiredAuditEventType = 'offer.expired';

export class OfferDeclineService {
  public constructor(private readonly database: PrismaClient) {}

  public async declineOffer(input: {
    offerId: string;
    decliningDiscordUserId: string;
    declinedAt?: Date;
  }): Promise<Offer> {
    const respondedAt = input.declinedAt ?? new Date();
    const discordUserId = discordSnowflakeSchema.parse(input.decliningDiscordUserId);
    let outcome: { kind: 'declined'; offer: Offer } | { kind: 'expired' };
    try {
      outcome = await this.database.$transaction(async (transaction) => {
        const offers = new OfferRepository(transaction);
        const offer = await offers.getById(input.offerId);
        if (offer === null) throw new EntityNotFoundError('offer was not found');
        if (offer.status !== 'PENDING') {
          throw new InvalidStateTransitionError('offer has already been handled');
        }
        const player = await new UserRepository(transaction).getById(offer.playerUserId);
        if (player === null) throw new EntityNotFoundError('offered player was not found');
        if (player.discordUserId !== discordUserId) {
          throw new UnauthorizedOfferAcceptanceError('only the offered player may respond');
        }
        if (offer.expiresAt.getTime() <= respondedAt.getTime()) {
          const expired = await offers.transition(offer.id, 'EXPIRED', respondedAt);
          await new AuditEventRepository(transaction).create({
            guildId: offer.guildId,
            actorUserId: player.id,
            eventType: offerExpiredAuditEventType,
            entityType: 'offer',
            entityId: offer.id,
            beforeState: { status: 'PENDING' },
            afterState: { status: expired.status },
          });
          return { kind: 'expired' } as const;
        }
        const declined = await offers.transition(offer.id, 'DECLINED', respondedAt);
        await new AuditEventRepository(transaction).create({
          guildId: offer.guildId,
          actorUserId: player.id,
          eventType: offerDeclinedAuditEventType,
          entityType: 'offer',
          entityId: offer.id,
          beforeState: { status: 'PENDING' },
          afterState: { status: declined.status, respondedAt: respondedAt.toISOString() },
        });
        return { kind: 'declined', offer: declined } as const;
      });
    } catch (error: unknown) {
      if (error instanceof DomainError) throw error;
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2028', 'P2034'].includes(error.code)) ||
        (error instanceof Prisma.PrismaClientUnknownRequestError &&
          /database is locked|transaction/i.test(error.message))
      ) {
        throw new ConflictError('offer response conflicted', { cause: error });
      }
      throw error;
    }
    if (outcome.kind === 'expired') throw new OfferExpiredError('offer has expired');
    return outcome.offer;
  }
}
