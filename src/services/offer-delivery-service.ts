import type { Offer, PrismaClient } from '@prisma/client';

import { OfferDeliveryError } from '../domain/errors.js';
import type { Logger } from '../logging/logger.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { OfferRepository } from '../repositories/offer-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuditAnnouncementPublisher } from './audit-announcement-service.js';
import type { CreateOfferWorkflowInput, OfferCreationResult } from './offer-creation-service.js';
import { OfferCreationService } from './offer-creation-service.js';

export const offerDeliveryFailedAuditEventType = 'offer.delivery_failed';
export const offerMessageUpdateFailedAuditEventType = 'offer.discord_message_update_failed';

export interface OfferMessageReference {
  channelId: string;
  messageId: string;
}

export interface OfferPresentationMetadata {
  sourceTeamRoleColor?: number | null;
  sourceTeamRoleName?: string | null;
  guildName?: string | null;
  guildIconUrl?: string | null;
  offeredByUsername?: string | null;
}

export interface TerminalOfferPresentationPayload {
  state: 'ACCEPTED' | 'DECLINED';
  guildName?: string | null;
  guildIconUrl?: string | null;
  teamRoleName?: string | null;
  teamEmoji?: string | null;
  teamDiscordRoleId?: string | null;
  tmUserId?: string | null;
  tmUsername?: string | null;
  activePlayerCount?: number;
  effectiveSquadLimit?: number;
}

export type AcceptedOfferPresentationData = TerminalOfferPresentationPayload;

export interface OfferMessageAdapter {
  sendOffer(
    result: OfferCreationResult,
    presentation?: OfferPresentationMetadata,
  ): Promise<OfferMessageReference>;
  setTerminalState(
    reference: OfferMessageReference,
    state: 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'VOIDED' | 'CANCELLED',
    detail?: string | TerminalOfferPresentationPayload,
  ): Promise<void>;
  cleanupOrphan(reference: OfferMessageReference): Promise<void>;
}

export class OfferDeliveryService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly messages: OfferMessageAdapter,
    private readonly logger: Logger,
    private readonly creation = new OfferCreationService(database),
    private readonly auditAnnouncements?: AuditAnnouncementPublisher,
  ) {}

  public async createAndDeliver(
    input: CreateOfferWorkflowInput,
    presentation: OfferPresentationMetadata = {},
  ): Promise<OfferCreationResult> {
    const result = await this.creation.createOffer(input);
    let reference: OfferMessageReference;
    try {
      reference = await this.messages.sendOffer(result, presentation);
    } catch (error: unknown) {
      try {
        await this.voidOffer(result.offer.id, result.offeredBy.id, 'send_failed');
      } catch (recoveryError: unknown) {
        throw new OfferDeliveryError('offer delivery and database recovery both failed', {
          cause: new AggregateError([error, recoveryError], 'offer delivery recovery failed'),
        });
      }
      throw new OfferDeliveryError('offer message could not be delivered', { cause: error });
    }
    try {
      const offer = await new OfferRepository(this.database).setMessageReference(
        result.offer.id,
        reference.channelId,
        reference.messageId,
      );
      let auditAnnouncementDelivered: boolean | null = null;
      if (result.auditAnnouncement && this.auditAnnouncements) {
        auditAnnouncementDelivered = await this.auditAnnouncements.publish(
          result.auditAnnouncement,
        );
      }
      return { ...result, offer, auditAnnouncementDelivered };
    } catch (error: unknown) {
      let cleanupError: unknown;
      try {
        await this.messages.cleanupOrphan(reference);
      } catch (caught: unknown) {
        cleanupError = caught;
        this.logger.error('offer orphan cleanup failed', caught, {
          offerId: result.offer.id,
          channelId: reference.channelId,
          messageId: reference.messageId,
        });
      }
      try {
        await this.voidOffer(result.offer.id, result.offeredBy.id, 'reference_save_failed');
      } catch (recoveryError: unknown) {
        this.logger.error('offer reference recovery failed', recoveryError, {
          offerId: result.offer.id,
        });
        throw new OfferDeliveryError('offer reference persistence and database recovery failed', {
          cause: new AggregateError(
            cleanupError === undefined
              ? [error, recoveryError]
              : [error, cleanupError, recoveryError],
            'offer reference recovery failed',
          ),
        });
      }
      if (cleanupError !== undefined) {
        throw new OfferDeliveryError(
          'offer was voided but its orphan Discord message could not be cleaned up',
          {
            cause: new AggregateError(
              [error, cleanupError],
              'offer message reference and cleanup failed',
            ),
          },
        );
      }
      throw new OfferDeliveryError('offer message reference could not be saved', { cause: error });
    }
  }

  public async recordMessageUpdateFailure(
    offer: Offer,
    actorDiscordUserId: string,
    state: string,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        actorDiscordUserId,
      );
      await new AuditEventRepository(transaction).create({
        guildId: offer.guildId,
        actorUserId: actor.id,
        eventType: offerMessageUpdateFailedAuditEventType,
        entityType: 'offer',
        entityId: offer.id,
        metadata: { terminalState: state },
      });
    });
  }

  private async voidOffer(offerId: string, actorUserId: string, reason: string): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const offer = await new OfferRepository(transaction).transition(offerId, 'VOIDED');
      await new AuditEventRepository(transaction).create({
        guildId: offer.guildId,
        actorUserId,
        eventType: offerDeliveryFailedAuditEventType,
        entityType: 'offer',
        entityId: offer.id,
        beforeState: { status: 'PENDING' },
        afterState: { status: 'VOIDED' },
        metadata: { reason },
      });
    });
  }
}
