import type { Client, EmbedBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { DiscordAuditAnnouncementAdapter } from '../../src/bot/audit-announcement-adapter.js';
import { DiscordAuditAnnouncementPresentationProvider } from '../../src/bot/audit-announcement-presentation.js';
import { DiscordTransferAnnouncementAdapter } from '../../src/bot/transfer-announcement-adapter.js';
import { DiscordTransferAnnouncementPresentationProvider } from '../../src/bot/transfer-announcement-presentation.js';
import type {
  AuditAnnouncementPlan,
  TeamDisbandAuditAnnouncementPlan,
  TeamDisbandTransferAnnouncementPlan,
  TransferAnnouncementPlan,
  UserAuditAnnouncementPlan,
  UserTransferAnnouncementPlan,
} from '../../src/domain/roster-mutation.js';

const occurredAt = new Date('2026-08-08T12:00:00.000Z');

function disbandTransferPlan(): TeamDisbandTransferAnnouncementPlan {
  return {
    discordGuildId: '100000000000000001',
    channelId: '200000000000000001',
    type: 'TEAM_DISBANDED',
    teamIdentity: {
      emoji: '🦁',
      discordRoleId: '300000000000000001',
    },
    occurredAt,
    presentation: {
      serverName: 'Super League',
      serverIconUrl: 'https://cdn.discordapp.com/icons/guild/icon.png',
      teamRoleName: 'Lions',
      teamRoleColor: 0x3b82f6,
    },
  };
}

function disbandAuditPlan(): TeamDisbandAuditAnnouncementPlan {
  return {
    discordGuildId: '100000000000000001',
    channelId: '200000000000000002',
    operation: 'TEAM_DISBANDED',
    actorDiscordUserId: '400000000000000001',
    teamIdentity: {
      emoji: '🦁',
      discordRoleId: '300000000000000001',
    },
    occurredAt,
    disbandDetails: {
      endedMembershipCount: 7,
      affectedUserCount: 4,
      expiredOfferCount: 2,
    },
    presentation: {
      serverName: 'Super League',
      serverIconUrl: 'https://cdn.discordapp.com/icons/guild/icon.png',
      teamRoleName: 'Lions',
      teamRoleColor: 0x3b82f6,
      actor: {
        username: 'AdminActor',
        avatarUrl: 'https://cdn.discordapp.com/avatars/admin/avatar.png',
      },
    },
  };
}

async function renderTransfer(announcement: TransferAnnouncementPlan) {
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

async function renderAudit(announcement: AuditAnnouncementPlan) {
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
  await new DiscordAuditAnnouncementAdapter(client).send(announcement);
  const payload = send.mock.calls[0]?.[0];
  if (!payload) throw new Error('announcement was not sent');
  return {
    payload,
    embed: payload.embeds[0]!.toJSON(),
  };
}

describe('Team disbandment announcement presentation and routing', () => {
  it('renders Transfer Market announcement with team identity and blockquote, without actor privacy leaks', async () => {
    const { payload, embed } = await renderTransfer(disbandTransferPlan());
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(embed).toMatchObject({
      author: {
        name: 'Super League',
        icon_url: 'https://cdn.discordapp.com/icons/guild/icon.png',
      },
      title: '⚠️ Team Disbanded - Lions',
      color: 0x3b82f6,
      description: [
        '> 🦁 <@&300000000000000001> has officially disbanded.',
        '> Its members are now free agents and outstanding pending offers involving the team have been expired.',
      ].join('\n'),
      footer: {
        text: 'Team Disbanded • 08.08.2026 12:00 UTC',
      },
    });

    const embedJson = JSON.stringify(embed);
    expect(embedJson).not.toContain('400000000000000001');
    expect(embedJson).not.toContain('AdminActor');
    expect(embedJson).not.toMatch(/database|prisma|role-sync|compensation/i);
  });

  it('renders Audit channel announcement with administrative actor and disband details', async () => {
    const { payload, embed } = await renderAudit(disbandAuditPlan());
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(embed).toMatchObject({
      author: {
        name: 'Super League',
        icon_url: 'https://cdn.discordapp.com/icons/guild/icon.png',
      },
      title: '✅ Team Disbanded',
      color: 0x3b82f6,
      description: [
        '🦁 <@&300000000000000001> was disbanded.',
        '',
        '> Staff and player memberships ended: **7**',
        '> Members moved to free agency: **4**',
        '> Outstanding offers expired: **2**',
      ].join('\n'),
      fields: [
        {
          name: 'Disbanded by',
          value: '<@400000000000000001> `AdminActor`',
          inline: false,
        },
      ],
    });
  });

  it('preserves team role resolution when role remains in guild cache post-commit', async () => {
    const guild = {
      name: 'Super League Guild',
      iconURL: () => 'https://cdn.discordapp.com/icons/guild/icon.png',
      roles: {
        cache: new Map([['300000000000000001', { name: 'Preserved Team Role', color: 0xff0000 }]]),
      },
      members: { cache: new Map() },
      client: { users: { cache: new Map() } },
    };
    const client = {
      guilds: {
        cache: new Map([['100000000000000001', guild]]),
      },
    } as unknown as Client;

    const auditProvider = new DiscordAuditAnnouncementPresentationProvider(client);
    const resolvedAudit = await auditProvider.resolve(disbandAuditPlan());
    expect('presentation' in resolvedAudit ? resolvedAudit.presentation : undefined).toMatchObject({
      serverName: 'Super League Guild',
      teamRoleName: 'Preserved Team Role',
      teamRoleColor: 0xff0000,
    });

    const transferProvider = new DiscordTransferAnnouncementPresentationProvider(client);
    const resolvedTransfer = await transferProvider.resolve(disbandTransferPlan());
    expect(resolvedTransfer.presentation).toMatchObject({
      serverName: 'Super League Guild',
      teamRoleName: 'Preserved Team Role',
      teamRoleColor: 0xff0000,
    });
  });

  it('proves discriminated union compile-time guarantees for user-based vs team-disband plans', () => {
    const userTransfer: UserTransferAnnouncementPlan = {
      discordGuildId: 'g1',
      channelId: 'c1',
      type: 'SIGNED',
      discordUserId: 'u1',
      teamIdentity: { discordRoleId: 'r1', emoji: '⚽' },
      occurredAt,
    };
    const teamTransfer: TeamDisbandTransferAnnouncementPlan = {
      discordGuildId: 'g1',
      channelId: 'c1',
      type: 'TEAM_DISBANDED',
      teamIdentity: { discordRoleId: 'r1', emoji: '🦁' },
      occurredAt,
    };

    const userAudit: UserAuditAnnouncementPlan = {
      discordGuildId: 'g1',
      channelId: 'c2',
      operation: 'ROSTER_PLAYER_ADDED',
      actorDiscordUserId: 'a1',
      playerDiscordUserId: 'p1',
      teamIdentity: { discordRoleId: 'r1', emoji: '⚽' },
      occurredAt,
    };
    const teamAudit: TeamDisbandAuditAnnouncementPlan = {
      discordGuildId: 'g1',
      channelId: 'c2',
      operation: 'TEAM_DISBANDED',
      actorDiscordUserId: 'a1',
      teamIdentity: { discordRoleId: 'r1', emoji: '🦁' },
      occurredAt,
    };

    expect(userTransfer.discordUserId).toBe('u1');
    expect(teamTransfer.type).toBe('TEAM_DISBANDED');
    expect(userAudit.playerDiscordUserId).toBe('p1');
    expect(teamAudit.operation).toBe('TEAM_DISBANDED');
  });
});
