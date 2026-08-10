import type { Offer, PrismaClient } from '@prisma/client';

import { InvalidStateTransitionError } from '../domain/errors.js';
import type { OfferExpiredAuditAnnouncementPlan } from '../domain/roster-mutation.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { OfferRepository } from '../repositories/offer-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuditAnnouncementPublisher } from './audit-announcement-service.js';
import type { OfferDeliveryService } from './offer-delivery-service.js';
import { offerExpiredAuditEventType } from './offer-decline-service.js';

export class OfferExpirationService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly auditAnnouncements?: AuditAnnouncementPublisher,
    private readonly terminalizer?: Pick<OfferDeliveryService, 'terminalizeOffer'>,
  ) {}

  public async expire(now = new Date()): Promise<Offer[]> {
    const candidates = await new OfferRepository(this.database).listExpiredPending(now);
    const expired: Offer[] = [];
    for (const candidate of candidates) {
      let result: Offer | null;
      let auditPlan: OfferExpiredAuditAnnouncementPlan | null;
      try {
        const outcome = await this.database.$transaction(async (transaction) => {
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

          const destinationClub = await new ClubRepository(transaction).getById(offer.clubId);
          const player = await new UserRepository(transaction).getById(offer.playerUserId);
          const guild = await new GuildRepository(transaction).requireById(offer.guildId);
          const settings = await new GuildRepository(transaction).getSettings(offer.guildId);

          const plan: OfferExpiredAuditAnnouncementPlan | null =
            settings?.auditChannelId === null || settings?.auditChannelId === undefined
              ? null
              : {
                  discordGuildId: guild.discordGuildId,
                  channelId: settings.auditChannelId,
                  operation: 'OFFER_EXPIRED',
                  playerDiscordUserId: player?.discordUserId ?? '',
                  teamIdentity: destinationClub ?? {
                    discordRoleId: '',
                    emoji: '',
                  },
                  occurredAt: now,
                };
          return { offer, plan };
        });
        result = outcome.offer;
        auditPlan = outcome.plan;
      } catch (error: unknown) {
        if (error instanceof InvalidStateTransitionError) continue;
        throw error;
      }
      if (result !== null) {
        expired.push(result);
        await this.terminalizer?.terminalizeOffer(result, 'EXPIRED');
        if (auditPlan !== null && this.auditAnnouncements !== undefined) {
          await this.auditAnnouncements.publish(auditPlan).catch(() => false);
        }
      }
    }
    return expired;
  }
}
