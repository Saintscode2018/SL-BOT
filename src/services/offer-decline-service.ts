import { Prisma, type Club, type Offer, type PrismaClient } from '@prisma/client';

import {
  ConflictError,
  DomainError,
  EntityNotFoundError,
  InvalidStateTransitionError,
  OfferExpiredError,
  UnauthorizedOfferAcceptanceError,
} from '../domain/errors.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { discordSnowflakeSchema } from '../domain/validation.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { OfferRepository } from '../repositories/offer-repository.js';
import { UserRepository } from '../repositories/user-repository.js';

import type {
  OfferDeclinedAuditAnnouncementPlan,
  OfferExpiredAuditAnnouncementPlan,
} from '../domain/roster-mutation.js';
import type { AuditAnnouncementPublisher } from './audit-announcement-service.js';

export const offerDeclinedAuditEventType = 'offer.declined';
export const offerExpiredAuditEventType = 'offer.expired';

export interface OfferDeclineResult {
  status: 'DECLINED';
  offer: Offer;
  destinationClub: Club;
  teamManagerDiscordUserId: string | null;
  activePlayerCount: number;
  effectiveSquadLimit: number;
  guildName: string;
  auditAnnouncement?: OfferDeclinedAuditAnnouncementPlan | null;
  auditAnnouncementDelivered?: boolean | null;
}

export class OfferDeclineService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly auditAnnouncements?: AuditAnnouncementPublisher,
  ) {}

  public async declineOffer(input: {
    offerId: string;
    decliningDiscordUserId: string;
    declinedAt?: Date;
  }): Promise<OfferDeclineResult> {
    const respondedAt = input.declinedAt ?? new Date();
    const discordUserId = discordSnowflakeSchema.parse(input.decliningDiscordUserId);
    let outcome:
      | { kind: 'declined'; result: OfferDeclineResult }
      | { kind: 'expired'; auditAnnouncement: OfferExpiredAuditAnnouncementPlan | null };
    try {
      outcome = await this.database.$transaction(async (transaction) => {
        const offers = new OfferRepository(transaction);
        const offer = await offers.getById(input.offerId);
        if (offer === null) throw new EntityNotFoundError('offer was not found');
        if (offer.status !== 'PENDING') {
          throw new InvalidStateTransitionError('offer has already been handled');
        }
        const userRepo = new UserRepository(transaction);
        const player = await userRepo.getById(offer.playerUserId);
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

          const destinationClub = await new ClubRepository(transaction).getById(offer.clubId);
          const guildSettings = await new GuildRepository(transaction).getSettings(offer.guildId);
          const guild = await new GuildRepository(transaction).requireById(offer.guildId);

          const auditAnnouncement: OfferExpiredAuditAnnouncementPlan | null =
            guildSettings?.auditChannelId === null || guildSettings?.auditChannelId === undefined
              ? null
              : {
                  discordGuildId: guild.discordGuildId,
                  channelId: guildSettings.auditChannelId,
                  operation: 'OFFER_EXPIRED',
                  playerDiscordUserId: player.discordUserId,
                  teamIdentity: destinationClub ?? {
                    discordRoleId: '',
                    emoji: '',
                  },
                  occurredAt: respondedAt,
                };

          return { kind: 'expired', auditAnnouncement } as const;
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

        const destinationClub = await new ClubRepository(transaction).getById(offer.clubId);
        if (destinationClub === null) throw new EntityNotFoundError('club was not found');

        const memberships = new MembershipRepository(transaction);
        const activePlayerCount = await memberships.countActiveUniqueMembers(destinationClub.id);
        const guildSettings = await new GuildRepository(transaction).getSettings(offer.guildId);
        const effectiveSquadLimit = getEffectiveSquadLimit(destinationClub, guildSettings);
        const guild = await new GuildRepository(transaction).requireById(offer.guildId);

        const tmMembership = await memberships.getActiveStaffAppointment(
          destinationClub.id,
          'TEAM_MANAGER',
        );
        const tmUser = tmMembership === null ? null : await userRepo.getById(tmMembership.userId);

        const auditAnnouncement: OfferDeclinedAuditAnnouncementPlan | null =
          guildSettings?.auditChannelId === null || guildSettings?.auditChannelId === undefined
            ? null
            : {
                discordGuildId: guild.discordGuildId,
                channelId: guildSettings.auditChannelId,
                operation: 'OFFER_DECLINED',
                actorDiscordUserId: player.discordUserId,
                playerDiscordUserId: player.discordUserId,
                teamIdentity: destinationClub,
                occurredAt: respondedAt,
              };

        return {
          kind: 'declined',
          result: {
            status: 'DECLINED',
            offer: declined,
            destinationClub,
            teamManagerDiscordUserId: tmUser?.discordUserId ?? null,
            activePlayerCount,
            effectiveSquadLimit,
            guildName: guild.name,
            auditAnnouncement,
          },
        } as const;
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
    if (outcome.kind === 'expired') {
      if (outcome.auditAnnouncement && this.auditAnnouncements) {
        await this.auditAnnouncements.publish(outcome.auditAnnouncement).catch(() => false);
      }
      throw new OfferExpiredError('offer has expired');
    }
    let auditAnnouncementDelivered: boolean | null = null;
    if (outcome.result.auditAnnouncement && this.auditAnnouncements) {
      auditAnnouncementDelivered = await this.auditAnnouncements.publish(
        outcome.result.auditAnnouncement,
      );
    }
    return { ...outcome.result, auditAnnouncementDelivered };
  }
}
