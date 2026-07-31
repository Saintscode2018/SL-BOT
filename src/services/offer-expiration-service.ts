import type { Offer, PrismaClient } from '@prisma/client';

import { InvalidStateTransitionError } from '../domain/errors.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { OfferRepository } from '../repositories/offer-repository.js';
import { offerExpiredAuditEventType } from './offer-decline-service.js';

export class OfferExpirationService {
  public constructor(private readonly database: PrismaClient) {}

  public async expire(now = new Date()): Promise<Offer[]> {
    const candidates = await new OfferRepository(this.database).listExpiredPending(now);
    const expired: Offer[] = [];
    for (const candidate of candidates) {
      let result: Offer | null;
      try {
        result = await this.database.$transaction(async (transaction) => {
          const offer = await new OfferRepository(transaction).transition(
            candidate.id,
            'EXPIRED',
            now,
          );
          await new AuditEventRepository(transaction).create({
            guildId: offer.guildId,
            eventType: offerExpiredAuditEventType,
            entityType: 'offer',
            entityId: offer.id,
            beforeState: { status: 'PENDING' },
            afterState: { status: 'EXPIRED' },
            metadata: {
              discordChannelId: offer.discordChannelId,
              discordMessageId: offer.discordMessageId,
            },
          });
          return offer;
        });
      } catch (error: unknown) {
        if (error instanceof InvalidStateTransitionError) continue;
        throw error;
      }
      if (result !== null) expired.push(result);
    }
    return expired;
  }
}
