import type { Client, EmbedBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { DiscordTransferAnnouncementAdapter } from '../../src/bot/transfer-announcement-adapter.js';
import type {
  TransferAnnouncementPlan,
  UserTransferAnnouncementPlan,
} from '../../src/domain/roster-mutation.js';

const playerId = '300000000000000001';
const actorId = '300000000000000099';
const tmId = '300000000000000009';
const occurredAt = new Date('2026-08-02T12:00:00.000Z');

function plan(type: 'DEMANDED' | 'RELEASED' | 'DEMOTED'): UserTransferAnnouncementPlan {
  return {
    discordGuildId: '100000000000000001',
    channelId: '200000000000000001',
    type,
    discordUserId: playerId,
    actorDiscordUserId: type === 'RELEASED' ? actorId : playerId,
    teamIdentity: {
      emoji: '🔥',
      discordRoleId: '400000000000000001',
    },
    occurredAt,
    roster: {
      currentSize: type === 'DEMOTED' ? 5 : 4,
      maximumSize: 17,
      teamManagerDiscordUserId: tmId,
    },
    presentation: {
      serverName: 'Stage 4B League',
      serverIconUrl: 'https://cdn.discordapp.com/icons/guild/icon.png',
      teamRoleName: '@T1',
      teamRoleColor: 0xf97316,
      subject: {
        username: 'Visible Player',
        avatarUrl: 'https://cdn.discordapp.com/avatars/player/avatar.png',
      },
      actor: {
        username: type === 'RELEASED' ? 'Secret Manager' : 'Visible Player',
        avatarUrl: 'https://cdn.discordapp.com/avatars/actor/avatar.png',
      },
      teamManager: {
        username: 'Team Manager',
        avatarUrl: 'https://cdn.discordapp.com/avatars/tm/avatar.png',
      },
    },
    ...(type === 'DEMOTED'
      ? { departureMode: 'STAFF_ONLY' as const, staffRole: 'PM' as const }
      : type === 'DEMANDED'
        ? { departureMode: 'FULL' as const }
        : {}),
  };
}

async function render(announcement: TransferAnnouncementPlan) {
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
          guildId: announcement.discordGuildId,
          isSendable: () => true,
          send,
        }),
      ),
    },
  } as unknown as Client;
  await new DiscordTransferAnnouncementAdapter(client).send(announcement);
  const payload = send.mock.calls[0]?.[0];
  if (!payload) throw new Error('announcement was not sent');
  return {
    payload,
    embed: payload.embeds[0]!.toJSON(),
  };
}

describe('Stage 4B.2 transfer announcements', () => {
  it('renders the full demand panel with post-departure roster and demanding-player footer', async () => {
    const { payload, embed } = await render(plan('DEMANDED'));
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(embed).toMatchObject({
      author: {
        name: 'Stage 4B League',
        icon_url: 'https://cdn.discordapp.com/icons/guild/icon.png',
      },
      title: '📣 Demand - T1',
      color: 0xf97316,
      description: [
        '> <@300000000000000001> `Visible Player` has demanded from 🔥 <@&400000000000000001>!',
        '> 📊 Roster: 4/17',
      ].join('\n'),
      footer: {
        text: 'Action by Visible Player • 02.08.2026 12:00 UTC',
        icon_url: 'https://cdn.discordapp.com/avatars/player/avatar.png',
      },
    });
    expect(embed.thumbnail?.url).toBeTruthy();
    expect(embed.description?.split('\n')).toHaveLength(2);
    expect(embed.description).not.toContain('\n>\n');
    expect(JSON.stringify(embed)).not.toMatch(/Demands Left|reason|audit/i);
  });

  it('renders release with adjacent roster/TM lines and no acting-manager attribution', async () => {
    const { embed } = await render(plan('RELEASED'));
    expect(embed).toMatchObject({
      author: { name: 'Stage 4B League' },
      title: '🚪 Release - T1',
      color: 0xf97316,
      description: [
        '> <@300000000000000001> `Visible Player` has been released from 🔥 <@&400000000000000001>!',
        '> 📊 Roster: 4/17',
        '> 👑 Team Manager: <@300000000000000009> `Team Manager`',
      ].join('\n'),
      footer: {
        text: 'Player: Visible Player • 02.08.2026 12:00 UTC',
        icon_url: 'https://cdn.discordapp.com/avatars/player/avatar.png',
      },
    });
    expect(embed.description?.split('\n')).toHaveLength(3);
    expect(embed.description).not.toContain('\n>\n');
    expect(JSON.stringify(embed)).not.toContain(actorId);
    expect(JSON.stringify(embed)).not.toContain('Secret Manager');
    expect(JSON.stringify(embed)).not.toMatch(/released by|reason|audit/i);
  });

  it('renders staff-only demand as a self-authored step-down demotion', async () => {
    const { embed } = await render(plan('DEMOTED'));
    expect(embed).toMatchObject({
      title: '⬇️ Demotion - T1',
      description:
        '> <@300000000000000001> `Visible Player` has stepped down to player for 🔥 <@&400000000000000001>!\n> 📊 Roster: 5/17\n> 👑 Team Manager: <@300000000000000009> `Team Manager`',
      footer: {
        text: 'Action by Visible Player • 02.08.2026 12:00 UTC',
      },
    });
    expect(JSON.stringify(embed)).not.toMatch(/by <@300000000000000001>|demoted by/i);
  });

  it('uses Vacant when the release team has no active Team Manager', async () => {
    const vacant = plan('RELEASED');
    vacant.roster = { currentSize: 0, maximumSize: 17, teamManagerDiscordUserId: null };
    vacant.presentation = { ...vacant.presentation!, teamManager: null };
    const { embed } = await render(vacant);
    expect(embed.description).toContain('> 👑 Team Manager: Vacant');
  });

  it.each([
    ['DEMANDED', '📣 Demand - Team'],
    ['RELEASED', '🚪 Release - Team'],
  ] as const)('uses the safe team-name fallback for %s', async (type, expectedTitle) => {
    const fallback = plan(type);
    fallback.presentation = { ...fallback.presentation!, teamRoleName: null };
    const { embed } = await render(fallback);
    expect(embed.title).toBe(expectedTitle);
  });
});
