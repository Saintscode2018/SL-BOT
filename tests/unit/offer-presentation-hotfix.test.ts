import type { Client } from 'discord.js';
import type { Offer } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BOT_COLORS } from '../../src/bot/presentation/colors.js';
import { formatUserWithVisibleName, getUserDisplayName } from '../../src/bot/presentation/users.js';
import { formatStaffDirectoryTeamSection } from '../../src/bot/commands.js';
import { DiscordOfferMessageAdapter } from '../../src/bot/offer-message-adapter.js';
import {
  OfferButtonHandler,
  type OfferButtonInteraction,
} from '../../src/bot/offer-button-handler.js';
import type { Logger } from '../../src/logging/logger.js';
import type {
  OfferDeliveryService,
  OfferMessageAdapter,
  OfferMessageReference,
} from '../../src/services/offer-delivery-service.js';
import type { OfferAcceptanceResult } from '../../src/services/offer-acceptance-service.js';
import type { OfferResponseService } from '../../src/services/offer-response-service.js';

describe('Presentation Hotfix - Hard Regression Guards & Presentation Logic', () => {
  describe('Requirement 1: Visible Usernames Retention', () => {
    it('formats users with visible names using actual display names without returning Unknown User', () => {
      const formatted = formatUserWithVisibleName('123456789', 'ArdaYus');
      expect(formatted).toBe('<@123456789> `ArdaYus`');
      expect(formatted).not.toContain('Unknown User');
    });

    it('getUserDisplayName resolves provided fallback or display name correctly', () => {
      const mockInteraction = {
        userId: '100',
        userDisplayName: 'ArdaUser',
        getGuildMemberDisplayName: (id: string) => (id === '200' ? 'TM_Manager' : null),
      };

      expect(getUserDisplayName(mockInteraction, '100')).toBe('ArdaUser');
      expect(getUserDisplayName(mockInteraction, '200')).toBe('TM_Manager');
    });
  });

  describe('Requirement 3 & 5: Staff Directory Blockquote Layout', () => {
    it('renders single team staff directory block with exact blockquote layout and no extra blank line after header', () => {
      const header = '🔵 <@&999888777>';
      const tm = formatUserWithVisibleName('tm1', 'TM_Alice');
      const atm = formatUserWithVisibleName('atm1', 'ATM_Bob');
      const pm = formatUserWithVisibleName('pm1', 'PM_Charlie');

      const result = formatStaffDirectoryTeamSection(header, tm, atm, pm);

      expect(result).toBe(
        '🔵 <@&999888777>\n' +
          '> 👑 Team Manager: <@tm1> `TM_Alice`\n' +
          '> 👔 Assistant Team Manager: <@atm1> `ATM_Bob`\n' +
          '> 🧠 Player Manager: <@pm1> `PM_Charlie`',
      );
      expect(result).not.toContain('Unknown User');
    });
  });

  describe('Requirement 4, 5 & 6: Accepted and Declined Terminal Offer Cards', () => {
    it('renders accepted offer DM embed with success color, author, thumbnail, description blockquotes and empty components', async () => {
      const mockMessage = {
        edit: vi.fn().mockResolvedValue(undefined),
      };
      const mockChannel = {
        type: 1, // ChannelType.DM
        messages: {
          fetch: vi.fn().mockResolvedValue(mockMessage),
        },
      };
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
      } as unknown as Client;

      const adapter = new DiscordOfferMessageAdapter(mockClient);
      const reference: OfferMessageReference = { channelId: 'chan-1', messageId: 'msg-1' };

      const payload = {
        state: 'ACCEPTED' as const,
        guildName: 'Super League',
        guildIconUrl: 'https://example.com/icon.png',
        teamRoleName: 'T1',
        teamEmoji: '🔵',
        teamDiscordRoleId: 'role-123',
        tmUserId: 'tm-user-1',
        tmUsername: 'ManagerName',
        activePlayerCount: 3,
        effectiveSquadLimit: 17,
      };

      await adapter.setTerminalState(reference, 'ACCEPTED', payload);

      expect(mockMessage.edit).toHaveBeenCalledTimes(1);
      const editArg = mockMessage.edit.mock.calls[0]?.[0] as {
        components: unknown[];
        embeds: {
          data: {
            title: string;
            color: number;
            author?: { name: string; icon_url: string };
            description: string;
          };
        }[];
      };

      expect(editArg.components).toEqual([]);
      expect(editArg.embeds).toHaveLength(1);

      const embed = editArg.embeds[0]?.data;
      expect(embed?.title).toBe('Accepted Offer');
      expect(embed?.color).toBe(BOT_COLORS.success);
      expect(embed?.author?.name).toBe('Super League');
      expect(embed?.author?.icon_url).toBe('https://example.com/icon.png');
      expect(embed?.description).toBe(
        'You have accepted the offer to T1.\n\n' +
          '> 👑 Team Manager: <@tm-user-1> `ManagerName`\n' +
          '> 📊 Roster: 3/17',
      );
      expect(embed?.description).not.toContain('Unknown User');
      expect(embed?.description).not.toContain('@unknown-role');
      expect(embed?.description).not.toContain('You have accepted the offer to Team.');
    });

    it('renders declined offer DM embed with error color, title Declined Offer, exact sentence and empty components', async () => {
      const mockMessage = {
        edit: vi.fn().mockResolvedValue(undefined),
      };
      const mockChannel = {
        type: 1,
        messages: {
          fetch: vi.fn().mockResolvedValue(mockMessage),
        },
      };
      const mockClient = {
        channels: {
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
      } as unknown as Client;

      const adapter = new DiscordOfferMessageAdapter(mockClient);
      const reference: OfferMessageReference = { channelId: 'chan-1', messageId: 'msg-1' };

      const payload = {
        state: 'DECLINED' as const,
        guildName: 'Super League',
        guildIconUrl: 'https://example.com/icon.png',
        teamRoleName: 'T1',
        teamEmoji: '🔵',
        teamDiscordRoleId: 'role-123',
        tmUserId: 'tm-user-1',
        tmUsername: 'ManagerName',
        activePlayerCount: 2,
        effectiveSquadLimit: 17,
      };

      await adapter.setTerminalState(reference, 'DECLINED', payload);

      expect(mockMessage.edit).toHaveBeenCalledTimes(1);
      const editArg = mockMessage.edit.mock.calls[0]?.[0] as {
        components: unknown[];
        embeds: {
          data: {
            title: string;
            color: number;
            author?: { name: string; icon_url: string };
            description: string;
          };
        }[];
      };

      expect(editArg.components).toEqual([]);
      expect(editArg.embeds).toHaveLength(1);

      const embed = editArg.embeds[0]?.data;
      expect(embed?.title).toBe('Declined Offer');
      expect(embed?.color).toBe(BOT_COLORS.error);
      expect(embed?.author?.name).toBe('Super League');
      expect(embed?.author?.icon_url).toBe('https://example.com/icon.png');
      expect(embed?.description).toBe(
        'You have declined the offer to T1.\n\n' +
          '> 👑 Team Manager: <@tm-user-1> `ManagerName`\n' +
          '> 📊 Roster: 2/17',
      );
      expect(embed?.description).not.toContain('This offer is now declined.');
      expect(embed?.description).not.toContain('Unknown User');
    });
  });

  describe('Requirement 5 & 7: Immediate Decline Acknowledgement', () => {
    it('enriches an accepted terminal card with freshly fetched role and TM names', async () => {
      const resolveRole = vi
        .fn()
        .mockResolvedValue({ id: 'role-123', name: '@T1', color: 0x00ff00 });
      const resolveMember = vi.fn().mockResolvedValue('Fetched ManagerName');
      const setTerminalState = vi.fn().mockResolvedValue(undefined);
      const interaction: OfferButtonInteraction = {
        customId: 'offer:accept:123e4567-e89b-12d3-a456-426614174000',
        userId: 'player-1',
        channelId: 'dm-chan-1',
        messageId: 'dm-msg-1',
        replied: false,
        deferred: false,
        guildName: 'Super League',
        resolveGuildRoleMetadata: resolveRole,
        resolveGuildMemberDisplayName: resolveMember,
        deferUpdate: vi.fn(),
        deferReply: vi.fn().mockImplementation(() => {
          interaction.deferred = true;
          return Promise.resolve();
        }),
        reply: vi.fn(),
        editReply: vi.fn(),
        followUp: vi.fn(),
      };
      const offer = { id: 'offer-id-123' } as Offer;
      const mockResponses: Pick<OfferResponseService, 'acceptOffer' | 'declineOffer'> = {
        acceptOffer: vi.fn().mockResolvedValue({
          offer,
          player: { discordUserId: 'player-1' },
          destinationClub: { discordRoleId: 'role-123', emoji: 'ðŸ”µ' },
          acceptedPresentation: {
            state: 'ACCEPTED',
            guildName: 'Super League',
            tmUserId: 'tm-user-1',
            activePlayerCount: 3,
            effectiveSquadLimit: 17,
          },
        }),
        declineOffer: vi.fn(),
      };
      const messages: OfferMessageAdapter = {
        sendOffer: vi.fn(),
        setTerminalState,
        cleanupOrphan: vi.fn(),
      };
      const handler = new OfferButtonHandler(
        mockResponses,
        { recordMessageUpdateFailure: vi.fn() },
        messages,
        { error: vi.fn() } as unknown as Logger,
      );

      await expect(handler.handle(interaction)).resolves.toBe(true);

      expect(resolveRole).toHaveBeenCalledWith('role-123');
      expect(resolveMember).toHaveBeenCalledWith('tm-user-1');
      expect(setTerminalState).toHaveBeenCalledWith(
        { channelId: 'dm-chan-1', messageId: 'dm-msg-1' },
        'ACCEPTED',
        {
          state: 'ACCEPTED',
          guildName: 'Super League',
          guildIconUrl: null,
          teamRoleName: 'T1',
          teamEmoji: 'ðŸ”µ',
          teamDiscordRoleId: 'role-123',
          tmUserId: 'tm-user-1',
          tmUsername: 'Fetched ManagerName',
          activePlayerCount: 3,
          effectiveSquadLimit: 17,
        },
      );
      expect(JSON.stringify(setTerminalState.mock.calls)).not.toContain('Unknown User');
      expect(JSON.stringify(setTerminalState.mock.calls)).not.toContain('"teamRoleName":"Team"');
    });

    it('calls deferUpdate before decline processing and edits terminal state without extra reply', async () => {
      const callOrder: string[] = [];

      const deferUpdateFn = vi.fn().mockImplementation(() => {
        callOrder.push('deferUpdate');
        return Promise.resolve();
      });
      const replyFn = vi.fn();
      const resolveRole = vi.fn().mockResolvedValue({ id: 'role-123', name: '@T1', color: 0 });
      const resolveMember = vi.fn().mockResolvedValue('Fetched ManagerName');

      const mockInteraction: OfferButtonInteraction = {
        customId: 'offer:decline:123e4567-e89b-12d3-a456-426614174000',
        userId: 'player-1',
        channelId: 'dm-chan-1',
        messageId: 'dm-msg-1',
        replied: false,
        deferred: false,
        guildName: 'Super League',
        resolveGuildRoleMetadata: resolveRole,
        resolveGuildMemberDisplayName: resolveMember,
        deferUpdate: deferUpdateFn,
        deferReply: vi.fn(),
        reply: replyFn,
        editReply: vi.fn(),
        followUp: vi.fn(),
      };

      const mockResponses: Pick<OfferResponseService, 'acceptOffer' | 'declineOffer'> = {
        acceptOffer: vi.fn(),
        declineOffer: vi.fn().mockImplementation(() => {
          callOrder.push('declineOffer');
          return Promise.resolve({
            offer: { id: 'offer-id-123', clubId: 'club-1' } as unknown as Offer,
            destinationClub: { id: 'club-1', discordRoleId: 'role-123', emoji: '🔵' },
            teamManagerDiscordUserId: 'tm-user-1',
            activePlayerCount: 2,
            effectiveSquadLimit: 17,
            guildName: 'Super League',
          });
        }),
      };

      const mockDelivery: Pick<OfferDeliveryService, 'recordMessageUpdateFailure'> = {
        recordMessageUpdateFailure: vi.fn(),
      };

      const setTerminalStateFn = vi.fn().mockImplementation(() => {
        callOrder.push('setTerminalState');
        return Promise.resolve();
      });

      const mockMessages: OfferMessageAdapter = {
        sendOffer: vi.fn(),
        setTerminalState: setTerminalStateFn,
        cleanupOrphan: vi.fn(),
      };

      const mockLogger = {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      } as unknown as Logger;

      const handler = new OfferButtonHandler(mockResponses, mockDelivery, mockMessages, mockLogger);

      const handled = await handler.handle(mockInteraction);

      expect(handled).toBe(true);
      expect(callOrder).toEqual(['deferUpdate', 'declineOffer', 'setTerminalState']);
      expect(deferUpdateFn).toHaveBeenCalledTimes(1);
      expect(replyFn).not.toHaveBeenCalled();
      expect(setTerminalStateFn).toHaveBeenCalledWith(
        { channelId: 'dm-chan-1', messageId: 'dm-msg-1' },
        'DECLINED',
        {
          state: 'DECLINED',
          guildName: 'Super League',
          guildIconUrl: null,
          teamRoleName: 'T1',
          teamEmoji: '🔵',
          teamDiscordRoleId: 'role-123',
          tmUserId: 'tm-user-1',
          tmUsername: 'Fetched ManagerName',
          activePlayerCount: 2,
          effectiveSquadLimit: 17,
        },
      );
      expect(resolveRole).toHaveBeenCalledWith('role-123');
      expect(resolveMember).toHaveBeenCalledWith('tm-user-1');
    });

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

    it('formats appropriate warnings on accepted offer response based on announcement delivery results', async () => {
      const editReplyFn = vi.fn().mockResolvedValue(undefined);
      const createInteraction = (): OfferButtonInteraction => ({
        customId: 'offer:accept:123e4567-e89b-12d3-a456-426614174000',
        userId: 'player-1',
        channelId: 'dm-chan-1',
        messageId: 'dm-msg-1',
        replied: false,
        deferred: true,
        deferReply: vi.fn().mockResolvedValue(undefined),
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        reply: vi.fn(),
        editReply: editReplyFn,
        followUp: vi.fn(),
      });

      const baseResult: OfferAcceptanceResult = {
        offer: {
          id: '123e4567-e89b-12d3-a456-426614174000',
        } as unknown as OfferAcceptanceResult['offer'],
        player: {
          id: 'player-1',
          discordUserId: 'player-1',
        } as unknown as OfferAcceptanceResult['player'],
        destinationClub: {
          discordRoleId: 'role-1',
          emoji: '⚽',
        } as unknown as OfferAcceptanceResult['destinationClub'],
        sourceClub: null,
        newMembership: {} as unknown as OfferAcceptanceResult['newMembership'],
        transaction: {} as unknown as OfferAcceptanceResult['transaction'],
        transactionType: 'SIGNING',
        roleMutation: { discordGuildId: 'g1', discordUserId: 'u1', addRoles: [], removeRoles: [] },
        announcement: null,
      };

      const mockDelivery: Pick<OfferDeliveryService, 'recordMessageUpdateFailure'> = {
        recordMessageUpdateFailure: vi.fn(),
      };
      const mockMessages: OfferMessageAdapter = {
        sendOffer: vi.fn(),
        setTerminalState: vi.fn().mockResolvedValue(undefined),
        cleanupOrphan: vi.fn(),
      };
      const mockLogger: Logger = { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };

      // 1. Both true -> no warning
      const mockResponses1 = {
        acceptOffer: vi.fn().mockResolvedValue({
          ...baseResult,
          announcementDelivered: true,
          auditAnnouncementDelivered: true,
        }),
        declineOffer: vi.fn(),
      };
      const handler1 = new OfferButtonHandler(
        mockResponses1,
        mockDelivery,
        mockMessages,
        mockLogger,
      );
      await handler1.handle(createInteraction());
      expect(editReplyFn).toHaveBeenLastCalledWith({ content: 'Offer accepted successfully.' });

      // 2. Audit false + Transfer true -> Audit warning
      const mockResponses2 = {
        acceptOffer: vi.fn().mockResolvedValue({
          ...baseResult,
          announcementDelivered: true,
          auditAnnouncementDelivered: false,
        }),
        declineOffer: vi.fn(),
      };
      const handler2 = new OfferButtonHandler(
        mockResponses2,
        mockDelivery,
        mockMessages,
        mockLogger,
      );
      await handler2.handle(createInteraction());
      expect(editReplyFn).toHaveBeenLastCalledWith({
        content:
          'Offer accepted successfully.\n\n⚠️ The roster was updated, but the Audit announcement could not be delivered.',
      });

      // 3. Audit true + Transfer false -> Transfer Market warning
      const mockResponses3 = {
        acceptOffer: vi.fn().mockResolvedValue({
          ...baseResult,
          announcementDelivered: false,
          auditAnnouncementDelivered: true,
        }),
        declineOffer: vi.fn(),
      };
      const handler3 = new OfferButtonHandler(
        mockResponses3,
        mockDelivery,
        mockMessages,
        mockLogger,
      );
      await handler3.handle(createInteraction());
      expect(editReplyFn).toHaveBeenLastCalledWith({
        content:
          'Offer accepted successfully.\n\n⚠️ The roster was updated, but the Transfer Market announcement could not be delivered.',
      });

      // 4. Both false -> Combined warning
      const mockResponses4 = {
        acceptOffer: vi.fn().mockResolvedValue({
          ...baseResult,
          announcementDelivered: false,
          auditAnnouncementDelivered: false,
        }),
        declineOffer: vi.fn(),
      };
      const handler4 = new OfferButtonHandler(
        mockResponses4,
        mockDelivery,
        mockMessages,
        mockLogger,
      );
      await handler4.handle(createInteraction());
      expect(editReplyFn).toHaveBeenLastCalledWith({
        content:
          'Offer accepted successfully.\n\n⚠️ The roster was updated, but the Audit and Transfer Market announcements could not be delivered.',
      });

      // 5. Unconfigured (null) -> no warning
      const mockResponses5 = {
        acceptOffer: vi.fn().mockResolvedValue({
          ...baseResult,
          announcementDelivered: null,
          auditAnnouncementDelivered: null,
        }),
        declineOffer: vi.fn(),
      };
      const handler5 = new OfferButtonHandler(
        mockResponses5,
        mockDelivery,
        mockMessages,
        mockLogger,
      );
      await handler5.handle(createInteraction());
      expect(editReplyFn).toHaveBeenLastCalledWith({ content: 'Offer accepted successfully.' });
    });
  });
});
