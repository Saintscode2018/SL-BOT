import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { DiscordAuditAnnouncementAdapter } from '../../src/bot/audit-announcement-adapter.js';
import {
  OfferButtonHandler,
  type OfferButtonInteraction,
} from '../../src/bot/offer-button-handler.js';
import type { OfferAuditAnnouncementPlan } from '../../src/domain/roster-mutation.js';
import type { Logger } from '../../src/logging/logger.js';
import type {
  OfferDeliveryService,
  OfferMessageAdapter,
} from '../../src/services/offer-delivery-service.js';
import type { OfferResponseService } from '../../src/services/offer-response-service.js';

import {
  BOT_COLORS,
  BOT_EMOJIS,
  BOT_LABELS,
  blockquoteLine,
  createActorFooter,
  createGuildAuthor,
  createPlayerFooter,
  createTimestampedFooter,
  formatBlockquote,
  formatDiscordLongDateTime,
  formatDiscordRelative,
  formatDiscordShortDateTime,
  formatTeamAutocompleteIdentity,
  formatTeamFooterIdentity,
  formatTeamMessageIdentity,
  formatTeamPlainRoleName,
  formatTeamReadableTitle,
  formatUserFooterName,
  formatUserMention,
  formatUserWithVisibleName,
  formatUtcFooterTimestamp,
  resolveTeamRoleColor,
  sanitizeInlineCode,
} from '../../src/bot/presentation/index.js';
import { resolveTeamPresentation } from '../../src/bot/team-presentation.js';

describe('Presentation System Foundation', () => {
  describe('BOT_EMOJIS', () => {
    it('defines unique staff emojis and canonical mappings', () => {
      expect(BOT_EMOJIS.teamManager).toBe('👑');
      expect(BOT_EMOJIS.assistantTeamManager).toBe('👔');
      expect(BOT_EMOJIS.playerManager).toBe('🧠');
      expect(BOT_EMOJIS.botPermissions).toBe('⚡');
      expect(BOT_EMOJIS.roster).toBe('📊');
      expect(BOT_EMOJIS.expiry).toBe('⏰');
      expect(BOT_EMOJIS.success).toBe('✅');
      expect(BOT_EMOJIS.error).toBe('❌');
      expect(BOT_EMOJIS.warning).toBe('⚠️');
      expect(BOT_EMOJIS.appointment).toBe('📌');
      expect(BOT_EMOJIS.demotion).toBe('⬇️');
    });
  });

  describe('BOT_LABELS', () => {
    it('has exact canonical capitalization and wording', () => {
      expect(BOT_LABELS.teamManager).toBe('Team Manager');
      expect(BOT_LABELS.assistantTeamManager).toBe('Assistant Team Manager');
      expect(BOT_LABELS.playerManager).toBe('Player Manager');
      expect(BOT_LABELS.signContract).toBe('Sign Contract');
      expect(BOT_LABELS.declineOffer).toBe('Decline Offer');
      expect(BOT_LABELS.vacant).toBe('Vacant');
      expect(BOT_LABELS.none).toBe('None');
      expect(BOT_LABELS.unknownTeamRole).toBe('Unknown Team Role');
    });
  });

  describe('BOT_COLORS', () => {
    it('has exact numeric hex values', () => {
      expect(BOT_COLORS.success).toBe(0x57f287);
      expect(BOT_COLORS.info).toBe(0x5865f2);
      expect(BOT_COLORS.warning).toBe(0xfee75c);
      expect(BOT_COLORS.error).toBe(0xed4245);
      expect(BOT_COLORS.neutral).toBe(0x747f8d);
    });

    it('resolves team role colors with default fallbacks', () => {
      expect(resolveTeamRoleColor(0x123456, BOT_COLORS.info)).toBe(0x123456);
      expect(resolveTeamRoleColor(0, BOT_COLORS.info)).toBe(BOT_COLORS.info);
      expect(resolveTeamRoleColor(null, BOT_COLORS.success)).toBe(BOT_COLORS.success);
      expect(resolveTeamRoleColor(undefined, BOT_COLORS.error)).toBe(BOT_COLORS.error);
    });
  });

  describe('Timestamps', () => {
    const testDate = new Date('2026-08-02T16:25:00Z');
    const unixSeconds = 1785687900;

    it('formats relative, short, and long Discord timestamps', () => {
      expect(formatDiscordRelative(testDate)).toBe(`<t:${unixSeconds}:R>`);
      expect(formatDiscordRelative(unixSeconds)).toBe(`<t:${unixSeconds}:R>`);
      expect(formatDiscordShortDateTime(testDate)).toBe(`<t:${unixSeconds}:f>`);
      expect(formatDiscordLongDateTime(testDate)).toBe(`<t:${unixSeconds}:F>`);
    });

    it('formats fixed UTC footer timestamps deterministically', () => {
      expect(formatUtcFooterTimestamp(testDate)).toBe('02.08.2026 16:25 UTC');
    });
  });

  describe('Users', () => {
    it('formats user mentions correctly', () => {
      expect(formatUserMention('123456789')).toBe('<@123456789>');
    });

    it('formats user with visible name and sanitizes inline backticks', () => {
      expect(formatUserWithVisibleName('123', 'ARDA2')).toBe('<@123> `ARDA2`');
      expect(sanitizeInlineCode('User`Name')).toBe("User'Name");
      expect(formatUserWithVisibleName('123', 'User`Name')).toBe("<@123> `User'Name`");
    });

    it('formats footer-safe username', () => {
      expect(formatUserFooterName('  John  ')).toBe('John');
      expect(formatUserFooterName('')).toBe('Unknown User');
    });
  });

  describe('Blockquotes', () => {
    it('formats single lines and blockquote arrays', () => {
      expect(blockquoteLine('hello')).toBe('> hello');
      expect(blockquoteLine('')).toBe('>');
      expect(formatBlockquote(['line 1', '', 'line 2'])).toBe('> line 1\n>\n> line 2');
      expect(formatBlockquote([])).toBe('');
    });
  });

  describe('Authors', () => {
    it('creates guild author with or without icon URL', () => {
      expect(
        createGuildAuthor({ guildName: 'Super League', guildIconUrl: 'http://icon.png' }),
      ).toEqual({
        name: 'Super League',
        iconURL: 'http://icon.png',
      });
      expect(createGuildAuthor({ guildName: 'Super League', guildIconUrl: null })).toEqual({
        name: 'Super League',
      });
    });
  });

  describe('Footers', () => {
    const testDate = new Date('2026-08-02T16:25:00Z');

    it('creates actor footers correctly', () => {
      expect(
        createActorFooter({
          verb: 'Appointed',
          username: 'AdminUser',
          avatarUrl: 'http://avatar.png',
          timestamp: testDate,
        }),
      ).toEqual({
        text: 'Appointed by AdminUser • 02.08.2026 16:25 UTC',
        iconURL: 'http://avatar.png',
      });
    });

    it('creates player footers correctly', () => {
      expect(
        createPlayerFooter({
          username: 'Player1',
          avatarUrl: null,
          timestamp: testDate,
        }),
      ).toEqual({
        text: 'Player: Player1 • 02.08.2026 16:25 UTC',
      });
    });

    it('creates generic timestamped footers', () => {
      expect(
        createTimestampedFooter({
          text: 'Custom Text',
          avatarUrl: null,
          timestamp: testDate,
        }),
      ).toEqual({
        text: 'Custom Text • 02.08.2026 16:25 UTC',
      });
    });
  });

  describe('Roles & Team Identity', () => {
    const sampleTeam = {
      emoji: '⚽',
      discordRoleId: '400000000000000001',
      discordRoleName: 'Chelsea FC',
    };

    it('formats team identity in various bot presentation modes', () => {
      expect(formatTeamMessageIdentity(sampleTeam)).toBe('⚽ <@&400000000000000001>');
      expect(formatTeamReadableTitle(sampleTeam)).toBe('⚽ @Chelsea FC');
      expect(formatTeamPlainRoleName(sampleTeam)).toBe('Chelsea FC');
      expect(formatTeamFooterIdentity(sampleTeam)).toBe('⚽ Chelsea FC');
      expect(formatTeamAutocompleteIdentity(sampleTeam)).toBe('@Chelsea FC');
    });

    it('handles plain role name fallback when role name is missing or has leading @', () => {
      expect(formatTeamPlainRoleName({ ...sampleTeam, discordRoleName: '@Arsenal' })).toBe(
        'Arsenal',
      );
      expect(formatTeamPlainRoleName({ ...sampleTeam, discordRoleName: null })).toBe('Team');
    });
  });

  describe('resolveTeamPresentation', () => {
    const testTeam = {
      id: 'team-1',
      emoji: '🦁',
      discordRoleId: '400000000000000001',
    };

    it('resolves presentation from warm cache when getGuildRoleMetadata is available', async () => {
      const interaction = {
        getGuildRoleMetadata: (id: string) =>
          id === testTeam.discordRoleId ? { id, name: 'Warm Role', color: 0x112233 } : null,
      };

      const result = await resolveTeamPresentation(interaction, testTeam);
      expect(result.team.discordRoleName).toBe('Warm Role');
      expect(result.role).toEqual({
        id: testTeam.discordRoleId,
        name: 'Warm Role',
        color: 0x112233,
      });
    });

    it('resolves presentation from cold cache using resolveGuildRoleMetadata', async () => {
      const interaction = {
        getGuildRoleMetadata: () => null,
        resolveGuildRoleMetadata: (id: string) =>
          Promise.resolve(
            id === testTeam.discordRoleId ? { id, name: 'Cold Role', color: 0x445566 } : null,
          ),
      };

      const result = await resolveTeamPresentation(interaction, testTeam);
      expect(result.team.discordRoleName).toBe('Cold Role');
      expect(result.role).toEqual({
        id: testTeam.discordRoleId,
        name: 'Cold Role',
        color: 0x445566,
      });
    });

    it('falls back safely when both async and sync resolution return null or are unavailable', async () => {
      const interaction = {
        getGuildRoleMetadata: () => null,
        resolveGuildRoleMetadata: () => Promise.resolve(null),
      };

      const result = await resolveTeamPresentation(interaction, testTeam);
      expect(result.team.discordRoleName).toBeNull();
      expect(result.role).toBeNull();
    });

    it('falls back safely when async resolution throws an error', async () => {
      const interaction = {
        getGuildRoleMetadata: (id: string) =>
          id === testTeam.discordRoleId
            ? { id, name: 'Fallback Warm Role', color: 0x778899 }
            : null,
        resolveGuildRoleMetadata: () => Promise.reject(new Error('Discord API Error')),
      };

      const result = await resolveTeamPresentation(interaction, testTeam);
      expect(result.team.discordRoleName).toBe('Fallback Warm Role');
      expect(result.role).toEqual({
        id: testTeam.discordRoleId,
        name: 'Fallback Warm Role',
        color: 0x778899,
      });
    });
  });

  describe('Offer Button Double-Click Handling', () => {
    it('safely handles double click on decline path', async () => {
      const deferUpdateFn = vi.fn().mockResolvedValue(undefined);
      const replyFn = vi.fn();

      const mockInteraction: OfferButtonInteraction = {
        customId: 'offer:decline:123e4567-e89b-12d3-a456-426614174000',
        userId: 'player-1',
        channelId: 'dm-chan-1',
        messageId: 'dm-msg-1',
        replied: false,
        deferred: true,
        deferUpdate: deferUpdateFn,
        deferReply: vi.fn(),
        reply: replyFn,
        editReply: vi.fn(),
        followUp: vi.fn(),
      };

      const mockResponses: Pick<OfferResponseService, 'acceptOffer' | 'declineOffer'> = {
        acceptOffer: vi.fn(),
        declineOffer: vi.fn().mockRejectedValue(new Error('Already declined')),
      };

      const mockDelivery: Pick<OfferDeliveryService, 'recordMessageUpdateFailure'> = {
        recordMessageUpdateFailure: vi.fn(),
      };
      const mockMessages: OfferMessageAdapter = {
        sendOffer: vi.fn(),
        setTerminalState: vi.fn(),
        cleanupOrphan: vi.fn(),
      };
      const mockLogger = { error: vi.fn() } as unknown as Logger;

      const handler = new OfferButtonHandler(mockResponses, mockDelivery, mockMessages, mockLogger);

      await expect(handler.handle(mockInteraction)).rejects.toThrow('Already declined');
      expect(deferUpdateFn).toHaveBeenCalledTimes(1);
      expect(replyFn).not.toHaveBeenCalled();
    });
  });

  describe('Audit Announcement Formatting', () => {
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
        teamIdentity: {
          discordRoleId: '200000000000000001',
          emoji: '🔵',
        },
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
  });
});
