import type { Client } from 'discord.js';
import type { Club, LeagueUser, Offer, PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { DiscordAuditAnnouncementAdapter } from '../../src/bot/audit-announcement-adapter.js';
import {
  OfferButtonHandler,
  type OfferButtonInteraction,
} from '../../src/bot/offer-button-handler.js';
import type {
  AuditAnnouncementPlan,
  OfferAuditAnnouncementPlan,
} from '../../src/domain/roster-mutation.js';
import type { Logger } from '../../src/logging/logger.js';
import type { AuditAnnouncementPublisher } from '../../src/services/audit-announcement-service.js';
import { OfferCreationService } from '../../src/services/offer-creation-service.js';
import { OfferDeclineService } from '../../src/services/offer-decline-service.js';
import { OfferDeliveryService } from '../../src/services/offer-delivery-service.js';
import { OfferExpirationService } from '../../src/services/offer-expiration-service.js';

describe('Offer Lifecycle Audit Routing', () => {
  const dummyClub: Club = {
    id: '11111111-1111-4111-8111-111111111111',
    guildId: '100000000000000001',
    discordRoleId: '200000000000000001',
    emoji: '🔵',
    logoUrl: null,
    squadLimitOverride: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const dummyPlayer: LeagueUser = {
    id: '22222222-2222-4222-8222-222222222222',
    discordUserId: '300000000000000001',
    robloxUserId: null,
    robloxUsername: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const dummyOfferedBy: LeagueUser = {
    id: '33333333-3333-4333-8333-333333333333',
    discordUserId: '300000000000000002',
    robloxUserId: null,
    robloxUsername: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const dummyOffer: Offer = {
    id: '44444444-4444-4444-8444-444444444444',
    guildId: '100000000000000001',
    clubId: '11111111-1111-4111-8111-111111111111',
    playerUserId: '22222222-2222-4222-8222-222222222222',
    offeredByUserId: '33333333-3333-4333-8333-333333333333',
    status: 'PENDING',
    createdAt: new Date('2026-08-08T10:00:00Z'),
    updatedAt: new Date('2026-08-08T10:00:00Z'),
    expiresAt: new Date('2026-08-09T10:00:00Z'),
    respondedAt: null,
    cancelledAt: null,
    discordChannelId: '400000000000000001',
    discordMessageId: '500000000000000001',
  };

  describe('/offer create Audit channel publishing', () => {
    it('builds OFFER_CREATED audit plan when auditChannelId is configured', async () => {
      const mockPrisma = {
        $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
          const fakeTx = {
            club: {
              findFirst: vi.fn().mockResolvedValue(dummyClub),
              findUnique: vi.fn().mockResolvedValue(dummyClub),
            },
            leagueUser: {
              findUnique: vi
                .fn()
                .mockImplementation(
                  ({ where }: { where: { discordUserId?: string; id?: string } }) => {
                    if (where.discordUserId === '300000000000000001' || where.id === dummyPlayer.id)
                      return Promise.resolve(dummyPlayer);
                    if (
                      where.discordUserId === '300000000000000002' ||
                      where.id === dummyOfferedBy.id
                    )
                      return Promise.resolve(dummyOfferedBy);
                    return Promise.resolve(null);
                  },
                ),
              upsert: vi
                .fn()
                .mockImplementation(({ where }: { where: { discordUserId: string } }) => {
                  if (where.discordUserId === '300000000000000001')
                    return Promise.resolve(dummyPlayer);
                  return Promise.resolve(dummyOfferedBy);
                }),
            },
            clubMembership: {
              findFirst: vi.fn().mockResolvedValue(null),
              count: vi.fn().mockResolvedValue(5),
            },
            offer: {
              findFirst: vi.fn().mockResolvedValue(null),
              create: vi.fn().mockResolvedValue(dummyOffer),
            },
            auditEvent: {
              create: vi.fn().mockResolvedValue({ id: 'audit-evt-1' }),
            },
          };
          return callback(fakeTx);
        }),
      } as unknown as PrismaClient;

      const service = new OfferCreationService(mockPrisma);

      const authServiceModule = await import('../../src/services/authorization-service.js');
      vi.spyOn(
        authServiceModule.AuthorizationService.prototype,
        'authorizeClubAction',
      ).mockResolvedValue({
        kind: 'club_staff',
        guild: {
          id: '100000000000000001',
          discordGuildId: '100000000000000001',
          name: 'Super League',
        } as never,
        settings: { auditChannelId: '900000000000000001', offerTimeoutSeconds: 86400 } as never,
      });

      const result = await service.createOffer({
        authorization: { discordUserId: '300000000000000002' } as never,
        destinationClubId: dummyClub.id,
        playerDiscordUserId: '300000000000000001',
        playerIsBot: false,
      });

      expect(result.auditAnnouncement).toBeDefined();
      expect(result.auditAnnouncement).toEqual({
        discordGuildId: '100000000000000001',
        channelId: '900000000000000001',
        operation: 'OFFER_CREATED',
        actorDiscordUserId: '300000000000000002',
        playerDiscordUserId: '300000000000000001',
        teamIdentity: dummyClub,
        occurredAt: dummyOffer.createdAt,
        expiresAt: dummyOffer.expiresAt,
      });

      expect('announcement' in result).toBe(false);
    });

    it('publishes Audit post-commit only after message reference persistence succeeds', async () => {
      const mockCreationService = {
        createOffer: vi.fn().mockResolvedValue({
          offer: dummyOffer,
          destinationClub: dummyClub,
          sourceClub: null,
          player: dummyPlayer,
          offeredBy: dummyOfferedBy,
          leagueName: 'Super League',
          activePlayerCount: 5,
          effectiveSquadLimit: 17,
          auditAnnouncement: {
            discordGuildId: '100000000000000001',
            channelId: '900000000000000001',
            operation: 'OFFER_CREATED',
            actorDiscordUserId: '300000000000000002',
            playerDiscordUserId: '300000000000000001',
            teamIdentity: dummyClub,
            occurredAt: dummyOffer.createdAt,
            expiresAt: dummyOffer.expiresAt,
          },
        }),
      };

      const sendOfferFn = vi
        .fn()
        .mockResolvedValue({ channelId: '400000000000000001', messageId: '500000000000000001' });
      const mockMessages = {
        sendOffer: sendOfferFn,
        setTerminalState: vi.fn(),
        cleanupOrphan: vi.fn(),
      };

      const publishFn = vi.fn().mockResolvedValue(true);
      const mockAuditPublisher: AuditAnnouncementPublisher = {
        publish: publishFn,
      };

      const offerRepoModule = await import('../../src/repositories/offer-repository.js');
      vi.spyOn(offerRepoModule.OfferRepository.prototype, 'setMessageReference').mockResolvedValue({
        ...dummyOffer,
        discordChannelId: '400000000000000001',
        discordMessageId: '500000000000000001',
      });

      const deliveryService = new OfferDeliveryService(
        {} as PrismaClient,
        mockMessages,
        { error: vi.fn() } as never,
        mockCreationService as never,
        mockAuditPublisher,
      );

      const deliveryResult = await deliveryService.createAndDeliver({
        authorization: {} as never,
        destinationClubId: dummyClub.id,
        playerDiscordUserId: '300000000000000001',
        playerIsBot: false,
      });

      expect(sendOfferFn).toHaveBeenCalledTimes(1);
      expect(publishFn).toHaveBeenCalledTimes(1);
      expect(deliveryResult.auditAnnouncementDelivered).toBe(true);
    });

    it('does not publish Audit if DM send fails and voids offer', async () => {
      const mockCreationService = {
        createOffer: vi.fn().mockResolvedValue({
          offer: dummyOffer,
          destinationClub: dummyClub,
          offeredBy: dummyOfferedBy,
          auditAnnouncement: { operation: 'OFFER_CREATED' },
        }),
      };

      const mockMessages = {
        sendOffer: vi.fn().mockRejectedValue(new Error('DM blocked')),
        setTerminalState: vi.fn(),
        cleanupOrphan: vi.fn(),
      };

      const publishFn = vi.fn();
      const mockAuditPublisher: AuditAnnouncementPublisher = {
        publish: publishFn,
      };

      const offerRepoModule = await import('../../src/repositories/offer-repository.js');
      vi.spyOn(offerRepoModule.OfferRepository.prototype, 'transition').mockResolvedValue({
        ...dummyOffer,
        status: 'VOIDED',
      });

      const mockPrisma = {
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
          return cb({
            auditEvent: { create: vi.fn().mockResolvedValue({}) },
          });
        }),
      } as unknown as PrismaClient;

      const deliveryService = new OfferDeliveryService(
        mockPrisma,
        mockMessages,
        { error: vi.fn() } as never,
        mockCreationService as never,
        mockAuditPublisher,
      );

      await expect(
        deliveryService.createAndDeliver({
          authorization: {} as never,
          destinationClubId: dummyClub.id,
          playerDiscordUserId: '300000000000000001',
          playerIsBot: false,
        }),
      ).rejects.toThrow();

      expect(publishFn).not.toHaveBeenCalled();
    });
  });

  describe('Offer Decline Audit channel publishing', () => {
    it('publishes OFFER_DECLINED with player as actor on decline', async () => {
      const mockPrisma = {
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
          const fakeTx = {
            offer: {
              findUnique: vi.fn().mockResolvedValue(dummyOffer),
              updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            leagueUser: {
              findUnique: vi.fn().mockResolvedValue(dummyPlayer),
            },
            club: {
              findUnique: vi.fn().mockResolvedValue(dummyClub),
            },
            clubMembership: {
              count: vi.fn().mockResolvedValue(3),
              findFirst: vi.fn().mockResolvedValue(null),
            },
            guildSettings: {
              findUnique: vi
                .fn()
                .mockResolvedValue({ auditChannelId: '900000000000000001', defaultSquadLimit: 17 }),
            },
            guild: {
              findUnique: vi
                .fn()
                .mockResolvedValue({ discordGuildId: '100000000000000001', name: 'Super League' }),
            },
            auditEvent: {
              create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
            },
          };
          return cb(fakeTx);
        }),
      } as unknown as PrismaClient;

      const publishFn = vi.fn().mockResolvedValue(true);
      const mockAuditPublisher: AuditAnnouncementPublisher = {
        publish: publishFn,
      };

      const declineService = new OfferDeclineService(mockPrisma, mockAuditPublisher);

      const result = await declineService.declineOffer({
        offerId: dummyOffer.id,
        decliningDiscordUserId: '300000000000000001',
      });

      expect(publishFn).toHaveBeenCalledTimes(1);
      expect(publishFn).toHaveBeenCalledWith(
        expect.objectContaining({
          discordGuildId: '100000000000000001',
          channelId: '900000000000000001',
          operation: 'OFFER_DECLINED',
          actorDiscordUserId: '300000000000000001',
          playerDiscordUserId: '300000000000000001',
          teamIdentity: dummyClub,
        }),
      );
      expect(result.auditAnnouncementDelivered).toBe(true);
    });

    it('sends ephemeral followUp warning if Audit delivery fails on decline', async () => {
      const mockDeclineService = {
        declineOffer: vi.fn().mockResolvedValue({
          status: 'DECLINED',
          offer: { ...dummyOffer, status: 'DECLINED' },
          destinationClub: dummyClub,
          teamManagerDiscordUserId: null,
          activePlayerCount: 3,
          effectiveSquadLimit: 17,
          guildName: 'Super League',
          auditAnnouncementDelivered: false,
        }),
      };

      const mockMessages = {
        sendOffer: vi.fn(),
        setTerminalState: vi.fn().mockResolvedValue(undefined),
        cleanupOrphan: vi.fn(),
      };

      const mockDelivery = {
        recordMessageUpdateFailure: vi.fn(),
      };

      const mockResponseService = {
        acceptOffer: vi.fn(),
        declineOffer: mockDeclineService.declineOffer,
      };

      const handler = new OfferButtonHandler(mockResponseService, mockDelivery, mockMessages, {
        error: vi.fn(),
      } as unknown as Logger);

      const followUpFn = vi.fn().mockResolvedValue(undefined);
      const mockInteraction = {
        customId: `offer:decline:${dummyOffer.id}`,
        userId: '300000000000000001',
        channelId: '400000000000000001',
        messageId: '500000000000000001',
        replied: false,
        deferred: false,
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        followUp: followUpFn,
      };

      const success = await handler.handle(mockInteraction as unknown as OfferButtonInteraction);
      expect(success).toBe(true);
      expect(followUpFn).toHaveBeenCalledTimes(1);
      const followUpArg = followUpFn.mock.calls[0]?.[0] as { content: string };
      expect(followUpArg.content).toContain('Audit announcement could not be delivered');
    });
  });

  describe('Offer Expiration Audit channel publishing', () => {
    it('publishes OFFER_EXPIRED with System/Automatic actor semantics', async () => {
      const mockPrisma = {
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
          const fakeTx = {
            offer: {
              updateMany: vi.fn().mockResolvedValue({ count: 1 }),
              findUnique: vi.fn().mockResolvedValue({ ...dummyOffer, status: 'EXPIRED' }),
            },
            auditEvent: {
              create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
            },
            club: {
              findUnique: vi.fn().mockResolvedValue(dummyClub),
            },
            leagueUser: {
              findUnique: vi.fn().mockResolvedValue(dummyPlayer),
            },
            guildSettings: {
              findUnique: vi.fn().mockResolvedValue({ auditChannelId: '900000000000000001' }),
            },
            guild: {
              findUnique: vi.fn().mockResolvedValue({ discordGuildId: '100000000000000001' }),
            },
          };
          return cb(fakeTx);
        }),
      } as unknown as PrismaClient;

      const offerRepoModule = await import('../../src/repositories/offer-repository.js');
      vi.spyOn(offerRepoModule.OfferRepository.prototype, 'listExpiredPending').mockResolvedValue([
        dummyOffer,
      ]);

      const publishFn = vi.fn().mockResolvedValue(true);
      const mockAuditPublisher: AuditAnnouncementPublisher = {
        publish: publishFn,
      };

      const expirationService = new OfferExpirationService(mockPrisma, mockAuditPublisher);

      const expired = await expirationService.expire();

      expect(expired).toHaveLength(1);
      expect(publishFn).toHaveBeenCalledTimes(1);
      expect(publishFn).toHaveBeenCalledWith(
        expect.objectContaining({
          discordGuildId: '100000000000000001',
          channelId: '900000000000000001',
          operation: 'OFFER_EXPIRED',
          playerDiscordUserId: '300000000000000001',
          teamIdentity: dummyClub,
        }),
      );

      const firstCall = publishFn.mock.calls[0] as [AuditAnnouncementPlan] | undefined;
      const publishedPlan = firstCall !== undefined ? firstCall[0] : undefined;
      expect(publishedPlan).not.toHaveProperty('actorDiscordUserId');
    });

    it('renders OFFER_EXPIRED in DiscordAuditAnnouncementAdapter with System (Automatic Expiration)', async () => {
      const sendFn = vi.fn().mockResolvedValue({ id: 'audit-msg-1' });
      const mockChannel = {
        isSendable: () => true,
        guildId: '100000000000000001',
        send: sendFn,
      };
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
      } as unknown as Client;

      const adapter = new DiscordAuditAnnouncementAdapter(mockClient);

      const offerExpiredPlan: OfferAuditAnnouncementPlan = {
        discordGuildId: '100000000000000001',
        channelId: '900000000000000001',
        operation: 'OFFER_EXPIRED',
        playerDiscordUserId: '300000000000000001',
        teamIdentity: dummyClub,
        occurredAt: new Date(),
      };

      await adapter.send(offerExpiredPlan);

      expect(sendFn).toHaveBeenCalledTimes(1);
      const sendArg = sendFn.mock.calls[0]?.[0] as {
        embeds: Array<{
          data: {
            title: string;
            description: string;
            fields: Array<{ name: string; value: string }>;
          };
        }>;
      };

      expect(sendArg.embeds[0]?.data.title).toContain('Offer Expired');
      expect(sendArg.embeds[0]?.data.fields).toEqual([
        {
          name: 'Expired by',
          value: 'System (Automatic Expiration)',
          inline: false,
        },
      ]);
    });

    it('skips audit publishing cleanly when auditChannelId is unconfigured', async () => {
      const mockPrisma = {
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
          const fakeTx = {
            offer: {
              updateMany: vi.fn().mockResolvedValue({ count: 1 }),
              findUnique: vi.fn().mockResolvedValue({ ...dummyOffer, status: 'EXPIRED' }),
            },
            auditEvent: {
              create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
            },
            club: {
              findUnique: vi.fn().mockResolvedValue(dummyClub),
            },
            leagueUser: {
              findUnique: vi.fn().mockResolvedValue(dummyPlayer),
            },
            guildSettings: {
              findUnique: vi.fn().mockResolvedValue({ auditChannelId: null }),
            },
            guild: {
              findUnique: vi.fn().mockResolvedValue({ discordGuildId: '100000000000000001' }),
            },
          };
          return cb(fakeTx);
        }),
      } as unknown as PrismaClient;

      const offerRepoModule = await import('../../src/repositories/offer-repository.js');
      vi.spyOn(offerRepoModule.OfferRepository.prototype, 'listExpiredPending').mockResolvedValue([
        dummyOffer,
      ]);

      const publishFn = vi.fn();
      const mockAuditPublisher: AuditAnnouncementPublisher = {
        publish: publishFn,
      };

      const service = new OfferExpirationService(mockPrisma, mockAuditPublisher);
      const expired = await service.expire();

      expect(expired).toHaveLength(1);
      expect(publishFn).not.toHaveBeenCalled();
    });
  });
});
