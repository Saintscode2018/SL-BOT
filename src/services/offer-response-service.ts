import type { PrismaClient } from '@prisma/client';

import { EntityNotFoundError, InvalidOfferMessageError } from '../domain/errors.js';
import { discordSnowflakeSchema } from '../domain/validation.js';
import { OfferRepository } from '../repositories/offer-repository.js';
import type { OfferAcceptanceResult } from './offer-acceptance-service.js';
import { OfferAcceptanceService } from './offer-acceptance-service.js';
import type { OfferDeclineResult } from './offer-decline-service.js';
import { OfferDeclineService } from './offer-decline-service.js';

import type { AuditAnnouncementPublisher } from './audit-announcement-service.js';

export interface OfferResponseInput {
  offerId: string;
  respondingDiscordUserId: string;
  discordChannelId: string;
  discordMessageId: string;
}

export class OfferResponseService {
  private readonly database: PrismaClient;
  private readonly acceptance: OfferAcceptanceService;
  private readonly decline: OfferDeclineService;

  public constructor(
    database: PrismaClient,
    acceptance?: OfferAcceptanceService,
    decline?: OfferDeclineService,
    auditAnnouncements?: AuditAnnouncementPublisher,
  ) {
    this.database = database;
    this.acceptance = acceptance ?? new OfferAcceptanceService(database);
    this.decline = decline ?? new OfferDeclineService(database, auditAnnouncements);
  }

  public async acceptOffer(input: OfferResponseInput): Promise<OfferAcceptanceResult> {
    await this.validateMessage(input);
    return this.acceptance.acceptOffer({
      offerId: input.offerId,
      acceptingDiscordUserId: input.respondingDiscordUserId,
    });
  }

  public async declineOffer(input: OfferResponseInput): Promise<OfferDeclineResult> {
    await this.validateMessage(input);
    return this.decline.declineOffer({
      offerId: input.offerId,
      decliningDiscordUserId: input.respondingDiscordUserId,
    });
  }

  private async validateMessage(input: OfferResponseInput): Promise<void> {
    const discordChannelId = discordSnowflakeSchema.parse(input.discordChannelId);
    const discordMessageId = discordSnowflakeSchema.parse(input.discordMessageId);
    const offer = await new OfferRepository(this.database).getById(input.offerId);
    if (offer === null) throw new EntityNotFoundError('offer was not found');
    if (
      offer.discordChannelId === null ||
      offer.discordMessageId === null ||
      offer.discordChannelId !== discordChannelId ||
      offer.discordMessageId !== discordMessageId
    ) {
      throw new InvalidOfferMessageError('offer response came from an unrecognized message');
    }
  }
}
