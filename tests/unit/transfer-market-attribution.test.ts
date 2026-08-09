import type { Client, EmbedBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { DiscordTransferAnnouncementAdapter } from '../../src/bot/transfer-announcement-adapter.js';
import { DiscordTransferAnnouncementPresentationProvider } from '../../src/bot/transfer-announcement-presentation.js';
import type {
  TransferAnnouncementPlan,
  UserTransferAnnouncementPlan,
} from '../../src/domain/roster-mutation.js';

describe('Transfer Market Actor Attribution', () => {
  const guildId = '100000000000000001';
  const channelId = '200000000000000001';
  const teamRoleId = '400000000000000001';
  const playerId = '300000000000000001';
  const tmUserId = '300000000000000009';
  const senderUserId = '300000000000000088';
  const occurredAt = new Date('2026-08-02T12:00:00.000Z');

  async function renderAdapter(plan: TransferAnnouncementPlan) {
    const send = vi.fn(
      (payload: { allowedMentions: { parse: string[] }; embeds: EmbedBuilder[] }) => {
        void payload;
        return Promise.resolve();
      },
    );
    const client = {
      channels: {
        fetch: vi.fn(() =>
          Promise.resolve({
            guildId: plan.discordGuildId,
            isSendable: () => true,
            send,
          }),
        ),
      },
    } as unknown as Client;

    await new DiscordTransferAnnouncementAdapter(client).send(plan);
    const payload = send.mock.calls[0]?.[0];
    if (!payload) throw new Error('announcement was not sent');
    return payload.embeds[0]!.toJSON();
  }

  describe('1-7. ACCEPTED OFFER Attribution', () => {
    it('1. TM sends offer -> accepted TM post says Offered by TM', async () => {
      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'SIGNED',
        discordUserId: playerId,
        actorDiscordUserId: tmUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
        roster: { currentSize: 5, maximumSize: 17, teamManagerDiscordUserId: tmUserId },
        presentation: {
          serverName: 'Stage 4B League',
          teamRoleName: 'T1',
          subject: { username: 'PlayerOne' },
          actor: { username: 'TeamManagerUser', avatarUrl: 'https://cdn.example.com/tm.png' },
          teamManager: { username: 'TeamManagerUser' },
        },
      };

      const embed = await renderAdapter(plan);
      expect(embed.footer?.text).toBe('Offered by TeamManagerUser • 02.08.2026 12:00 UTC');
      expect(embed.footer?.icon_url).toBe('https://cdn.example.com/tm.png');
    });

    it('2. ATM sends offer -> accepted TM post says Offered by ATM', async () => {
      const atmUserId = '300000000000000077';
      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'SIGNED',
        discordUserId: playerId,
        actorDiscordUserId: atmUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
        roster: { currentSize: 5, maximumSize: 17, teamManagerDiscordUserId: tmUserId },
        presentation: {
          serverName: 'Stage 4B League',
          teamRoleName: 'T1',
          subject: { username: 'PlayerOne' },
          actor: { username: 'ATMUser', avatarUrl: 'https://cdn.example.com/atm.png' },
          teamManager: { username: 'TeamManagerUser' },
        },
      };

      const embed = await renderAdapter(plan);
      expect(embed.footer?.text).toBe('Offered by ATMUser • 02.08.2026 12:00 UTC');
      expect(embed.footer?.icon_url).toBe('https://cdn.example.com/atm.png');
    });

    it('3. PM sends offer -> accepted TM post says Offered by PM', async () => {
      const pmUserId = '300000000000000066';
      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'SIGNED',
        discordUserId: playerId,
        actorDiscordUserId: pmUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
        roster: { currentSize: 5, maximumSize: 17, teamManagerDiscordUserId: tmUserId },
        presentation: {
          serverName: 'Stage 4B League',
          teamRoleName: 'T1',
          subject: { username: 'PlayerOne' },
          actor: { username: 'PMUser', avatarUrl: 'https://cdn.example.com/pm.png' },
          teamManager: { username: 'TeamManagerUser' },
        },
      };

      const embed = await renderAdapter(plan);
      expect(embed.footer?.text).toBe('Offered by PMUser • 02.08.2026 12:00 UTC');
      expect(embed.footer?.icon_url).toBe('https://cdn.example.com/pm.png');
    });

    it('4. current Team Manager differs from offer sender -> sender still shown', async () => {
      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'SIGNED',
        discordUserId: playerId,
        actorDiscordUserId: senderUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
        roster: { currentSize: 5, maximumSize: 17, teamManagerDiscordUserId: tmUserId },
        presentation: {
          serverName: 'Stage 4B League',
          teamRoleName: 'T1',
          subject: { username: 'PlayerOne' },
          actor: {
            username: 'OriginalSenderUser',
            avatarUrl: 'https://cdn.example.com/sender.png',
          },
          teamManager: { username: 'DifferentManagerUser' },
        },
      };

      const embed = await renderAdapter(plan);
      expect(embed.footer?.text).toBe('Offered by OriginalSenderUser • 02.08.2026 12:00 UTC');
      expect(embed.description).toContain('DifferentManagerUser');
    });

    it('5. accepting player differs from offer sender -> accepting player is NOT used as Offered by', async () => {
      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'SIGNED',
        discordUserId: playerId,
        actorDiscordUserId: senderUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
        roster: { currentSize: 5, maximumSize: 17, teamManagerDiscordUserId: tmUserId },
        presentation: {
          serverName: 'Stage 4B League',
          teamRoleName: 'T1',
          subject: { username: 'AcceptingPlayer' },
          actor: { username: 'OfferSenderStaff' },
          teamManager: { username: 'TeamManagerUser' },
        },
      };

      const embed = await renderAdapter(plan);
      expect(embed.footer?.text).toBe('Offered by OfferSenderStaff • 02.08.2026 12:00 UTC');
      expect(embed.footer?.text).not.toContain('AcceptingPlayer');
    });

    it('6. cold-cache sender username resolves correctly', async () => {
      const coldCacheUser = {
        globalName: 'ColdCacheDisplay',
        username: 'coldcache_user',
        displayAvatarURL: () => 'https://cdn.example.com/cold.png',
      };
      const client = {
        guilds: {
          cache: {
            get: () => ({
              name: 'Stage 4B League',
              roles: { cache: { get: () => ({ name: 'T1' }) } },
              members: { cache: new Map() }, // member cache miss
              client: {
                users: {
                  cache: new Map([[senderUserId, coldCacheUser]]),
                },
              },
            }),
          },
        },
      } as unknown as Client;

      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'SIGNED',
        discordUserId: playerId,
        actorDiscordUserId: senderUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
      };

      const resolved = await new DiscordTransferAnnouncementPresentationProvider(client).resolve(
        plan,
      );
      expect(resolved.presentation?.actor).toEqual({
        username: 'ColdCacheDisplay',
        avatarUrl: 'https://cdn.example.com/cold.png',
      });
    });

    it('7. existing accepted-offer presentation otherwise unchanged', async () => {
      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'SIGNED',
        discordUserId: playerId,
        actorDiscordUserId: senderUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
        roster: { currentSize: 5, maximumSize: 17, teamManagerDiscordUserId: tmUserId },
        presentation: {
          serverName: 'Stage 4B League',
          teamRoleName: 'T1',
          teamRoleColor: 0x123456,
          subject: { username: 'AcceptingPlayer' },
          actor: { username: 'OfferSenderStaff' },
          teamManager: { username: 'TMUser' },
        },
      };

      const embed = await renderAdapter(plan);
      expect(embed.title).toBe('✅ Offer Accepted - T1');
      expect(embed.description).toContain(
        '<@300000000000000001> `AcceptingPlayer` has accepted the offer from ⚽ <@&400000000000000001>',
      );
      expect(embed.description).toContain('📊 Roster: 5/17');
      expect(embed.description).toContain('👑 Team Manager: <@300000000000000009> `TMUser`');
      expect(embed.color).toBe(0x123456);
    });
  });

  describe('8-14. RELEASE Attribution', () => {
    it('8. TM performs release -> Released by TM', async () => {
      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'RELEASED',
        discordUserId: playerId,
        actorDiscordUserId: tmUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
        roster: { currentSize: 4, maximumSize: 17, teamManagerDiscordUserId: tmUserId },
        presentation: {
          serverName: 'Stage 4B League',
          teamRoleName: 'T1',
          subject: { username: 'ReleasedPlayer' },
          actor: { username: 'TMUser', avatarUrl: 'https://cdn.example.com/tm.png' },
          teamManager: { username: 'TMUser' },
        },
      };

      const embed = await renderAdapter(plan);
      expect(embed.footer?.text).toBe('Released by TMUser • 02.08.2026 12:00 UTC');
      expect(embed.footer?.icon_url).toBe('https://cdn.example.com/tm.png');
    });

    it('9. ATM performs release where allowed -> Released by ATM', async () => {
      const atmUserId = '300000000000000077';
      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'RELEASED',
        discordUserId: playerId,
        actorDiscordUserId: atmUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
        roster: { currentSize: 4, maximumSize: 17, teamManagerDiscordUserId: tmUserId },
        presentation: {
          serverName: 'Stage 4B League',
          teamRoleName: 'T1',
          subject: { username: 'ReleasedPlayer' },
          actor: { username: 'ATMUser', avatarUrl: 'https://cdn.example.com/atm.png' },
          teamManager: { username: 'TMUser' },
        },
      };

      const embed = await renderAdapter(plan);
      expect(embed.footer?.text).toBe('Released by ATMUser • 02.08.2026 12:00 UTC');
      expect(embed.footer?.icon_url).toBe('https://cdn.example.com/atm.png');
    });

    it('10. BotPerm/admin performs release where allowed -> Released by actual admin', async () => {
      const adminUserId = '300000000000000099';
      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'RELEASED',
        discordUserId: playerId,
        actorDiscordUserId: adminUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
        roster: { currentSize: 4, maximumSize: 17, teamManagerDiscordUserId: tmUserId },
        presentation: {
          serverName: 'Stage 4B League',
          teamRoleName: 'T1',
          subject: { username: 'ReleasedPlayer' },
          actor: { username: 'AdminUser', avatarUrl: 'https://cdn.example.com/admin.png' },
          teamManager: { username: 'TMUser' },
        },
      };

      const embed = await renderAdapter(plan);
      expect(embed.footer?.text).toBe('Released by AdminUser • 02.08.2026 12:00 UTC');
    });

    it('11. released player is NOT shown as Released by', async () => {
      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'RELEASED',
        discordUserId: playerId,
        actorDiscordUserId: tmUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
        roster: { currentSize: 4, maximumSize: 17, teamManagerDiscordUserId: tmUserId },
        presentation: {
          serverName: 'Stage 4B League',
          teamRoleName: 'T1',
          subject: { username: 'ReleasedPlayer' },
          actor: { username: 'ReleasingActor' },
          teamManager: { username: 'TMUser' },
        },
      };

      const embed = await renderAdapter(plan);
      expect(embed.footer?.text).toBe('Released by ReleasingActor • 02.08.2026 12:00 UTC');
      expect(embed.footer?.text).not.toContain('ReleasedPlayer');
    });

    it('12. current Team Manager differs from release actor -> actual release actor still shown', async () => {
      const actingAtmUserId = '300000000000000077';
      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'RELEASED',
        discordUserId: playerId,
        actorDiscordUserId: actingAtmUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
        roster: { currentSize: 4, maximumSize: 17, teamManagerDiscordUserId: tmUserId },
        presentation: {
          serverName: 'Stage 4B League',
          teamRoleName: 'T1',
          subject: { username: 'ReleasedPlayer' },
          actor: { username: 'ActingATM' },
          teamManager: { username: 'CurrentTM' },
        },
      };

      const embed = await renderAdapter(plan);
      expect(embed.footer?.text).toBe('Released by ActingATM • 02.08.2026 12:00 UTC');
      expect(embed.description).toContain('CurrentTM');
    });

    it('13. cold-cache release actor username resolves correctly', async () => {
      const coldCacheActor = {
        globalName: 'ColdCacheAdminDisplay',
        username: 'coldcache_admin',
        displayAvatarURL: () => 'https://cdn.example.com/cold_admin.png',
      };
      const client = {
        guilds: {
          cache: {
            get: () => ({
              name: 'Stage 4B League',
              roles: { cache: { get: () => ({ name: 'T1' }) } },
              members: { cache: new Map() },
              client: {
                users: {
                  cache: new Map([['300000000000000099', coldCacheActor]]),
                },
              },
            }),
          },
        },
      } as unknown as Client;

      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'RELEASED',
        discordUserId: playerId,
        actorDiscordUserId: '300000000000000099',
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
      };

      const resolved = await new DiscordTransferAnnouncementPresentationProvider(client).resolve(
        plan,
      );
      expect(resolved.presentation?.actor).toEqual({
        username: 'ColdCacheAdminDisplay',
        avatarUrl: 'https://cdn.example.com/cold_admin.png',
      });
    });

    it('14. existing release announcement presentation otherwise unchanged', async () => {
      const plan: UserTransferAnnouncementPlan = {
        discordGuildId: guildId,
        channelId,
        type: 'RELEASED',
        discordUserId: playerId,
        actorDiscordUserId: tmUserId,
        teamIdentity: { emoji: '⚽', discordRoleId: teamRoleId },
        occurredAt,
        roster: { currentSize: 4, maximumSize: 17, teamManagerDiscordUserId: tmUserId },
        presentation: {
          serverName: 'Stage 4B League',
          teamRoleName: 'T1',
          teamRoleColor: 0xf97316,
          subject: { username: 'ReleasedPlayer' },
          actor: { username: 'TMUser' },
          teamManager: { username: 'TMUser' },
        },
      };

      const embed = await renderAdapter(plan);
      expect(embed.title).toBe('🚪 Release - T1');
      expect(embed.description).toContain(
        '<@300000000000000001> `ReleasedPlayer` has been released from ⚽ <@&400000000000000001>!',
      );
      expect(embed.description).toContain('📊 Roster: 4/17');
      expect(embed.description).toContain('👑 Team Manager: <@300000000000000009> `TMUser`');
      expect(embed.color).toBe(0xf97316);
    });
  });
});
