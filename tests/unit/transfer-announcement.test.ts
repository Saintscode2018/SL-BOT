import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { TransferAnnouncementDeliveryError } from '../../src/domain/errors.js';
import type { TransferAnnouncementPlan } from '../../src/domain/roster-mutation.js';
import { DiscordTransferAnnouncementAdapter } from '../../src/bot/transfer-announcement-adapter.js';
import { DiscordTransferAnnouncementPresentationProvider } from '../../src/bot/transfer-announcement-presentation.js';
import { RoleSynchronizedMutationService } from '../../src/services/role-synchronized-mutation-service.js';
import { TransferAnnouncementService } from '../../src/services/transfer-announcement-service.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const announcement: TransferAnnouncementPlan = {
  discordGuildId: '100000000000000001',
  channelId: '200000000000000001',
  type: 'SIGNED',
  discordUserId: '300000000000000001',
  teamIdentity: {
    emoji: '⚽',
    discordRoleId: '400000000000000001',
  },
  occurredAt: new Date('2026-08-02T12:00:00Z'),
  roster: {
    currentSize: 4,
    maximumSize: 17,
    teamManagerDiscordUserId: '300000000000000009',
  },
  presentation: {
    serverName: 'Stage 4B League',
    serverIconUrl: 'https://cdn.discordapp.com/icons/guild/icon.png',
    teamRoleName: 'T1',
    teamRoleColor: 0x123456,
    subject: {
      username: 'ARDA2',
      avatarUrl: 'https://cdn.discordapp.com/avatars/player/avatar.png',
    },
    teamManager: {
      username: 'Manager',
      avatarUrl: 'https://cdn.discordapp.com/avatars/tm/avatar.png',
    },
  },
};

describe('transfer-market announcements', () => {
  it('renders a structured accepted offer announcement into the target channel', async () => {
    const send = vi.fn((payload: unknown) => {
      void payload;
      return Promise.resolve();
    });
    const fetchChannel = vi.fn(() =>
      Promise.resolve({
        guildId: announcement.discordGuildId,
        isSendable: () => true,
        send,
      }),
    );
    const client = {
      channels: {
        fetch: fetchChannel,
      },
    } as unknown as Client;

    await new DiscordTransferAnnouncementAdapter(client).send(announcement);

    expect(fetchChannel).toHaveBeenCalledWith('200000000000000001');
    const payload = vi.mocked(send).mock.calls[0]![0] as {
      allowedMentions: { parse: string[] };
      embeds: Array<{
        toJSON(): {
          author?: { name: string; icon_url?: string };
          title?: string;
          description?: string;
          color?: number;
          footer?: { text: string; icon_url?: string };
          thumbnail?: { url: string };
        };
      }>;
    };
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(payload.embeds[0]!.toJSON()).toMatchObject({
      author: {
        name: 'Stage 4B League',
        icon_url: 'https://cdn.discordapp.com/icons/guild/icon.png',
      },
      title: '✅ Offer Accepted - T1',
      description:
        '> <@300000000000000001> `ARDA2` has accepted the offer from ⚽ <@&400000000000000001>\n> 📊 Roster: 4/17\n> 👑 Team Manager: <@300000000000000009> `Manager`',
      color: 0x123456,
      footer: {
        text: 'Player: ARDA2 • 02.08.2026 12:00 UTC',
        icon_url: 'https://cdn.discordapp.com/avatars/player/avatar.png',
      },
    });
    expect(payload.embeds[0]!.toJSON().thumbnail?.url).toContain('twemoji');
    expect(payload.embeds[0]!.toJSON().title).not.toContain('@T1');
    expect(JSON.stringify(payload.embeds[0]!.toJSON())).not.toMatch(
      /Remaining Spaces|Offered Player|Expires|audit/i,
    );
  });

  it.each([
    ['TM', '400000000000000011'],
    ['ATM', '400000000000000012'],
    ['PM', '400000000000000013'],
  ] as const)('renders a structured %s appointment transaction', async (staffRole, staffRoleId) => {
    const send = vi.fn((payload: unknown) => {
      void payload;
      return Promise.resolve();
    });
    const plan: TransferAnnouncementPlan = {
      ...announcement,
      type: 'APPOINTED',
      actorDiscordUserId: '300000000000000099',
      staffRole,
      staffRoleId,
      teamIdentity: {
        emoji: '<:T1:987654321098765432>',
        discordRoleId: announcement.teamIdentity.discordRoleId,
      },
      presentation: {
        serverName: 'Stage 4B League',
        serverIconUrl: 'https://cdn.discordapp.com/icons/guild/icon.png',
        teamRoleName: 'T1',
        teamRoleColor: 0xf97316,
        actor: {
          username: 'ardaryusz',
          avatarUrl: 'https://cdn.discordapp.com/avatars/actor/avatar.png',
        },
      },
    };
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

    const payload = vi.mocked(send).mock.calls[0]![0] as {
      embeds: Array<{
        toJSON(): {
          author?: { name: string; icon_url?: string };
          title?: string;
          color?: number;
          fields?: Array<{ name: string; value: string }>;
          footer?: { text: string; icon_url?: string };
          thumbnail?: { url: string };
        };
      }>;
    };
    const embed = payload.embeds[0]!.toJSON();
    expect(embed).toMatchObject({
      author: {
        name: 'Stage 4B League',
        icon_url: 'https://cdn.discordapp.com/icons/guild/icon.png',
      },
      title: 'T1 Transaction (Appointment)',
      color: 0xf97316,
      fields: [
        {
          name: '👑 Appointment',
          value: `> <@${plan.discordUserId}> \`Unknown User\` has been appointed as <@&${staffRoleId}> for <:T1:987654321098765432> <@&${plan.teamIdentity.discordRoleId}> by <@300000000000000099> \`ardaryusz\`!`,
        },
      ],
      footer: {
        text: 'Appointed by ardaryusz • 02.08.2026 12:00 UTC',
        icon_url: 'https://cdn.discordapp.com/avatars/actor/avatar.png',
      },
    });
    expect(embed.thumbnail?.url).toBe('https://cdn.discordapp.com/emojis/987654321098765432.png');
    expect(embed.title).not.toMatch(/^@/u);
    expect(JSON.stringify(embed)).not.toContain('Franchise Owner');
  });

  it('renders a structured demotion with actor attribution in body and footer', async () => {
    const send = vi.fn((payload: unknown) => {
      void payload;
      return Promise.resolve();
    });
    const plan: TransferAnnouncementPlan = {
      ...announcement,
      type: 'DEMOTED',
      actorDiscordUserId: '300000000000000099',
      staffRole: 'ATM',
      presentation: {
        serverName: 'Stage 4B League',
        serverIconUrl: null,
        teamRoleName: 'Newcastle United',
        teamRoleColor: 0x3498db,
        actor: {
          username: 'ardaryusz',
          avatarUrl: 'https://cdn.discordapp.com/avatars/actor/avatar.png',
        },
      },
    };
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

    const payload = vi.mocked(send).mock.calls[0]![0] as {
      embeds: Array<{
        toJSON(): {
          author?: { name: string; icon_url?: string };
          title?: string;
          color?: number;
          fields?: Array<{ name: string; value: string }>;
          footer?: { text: string; icon_url?: string };
        };
      }>;
    };
    const embed = payload.embeds[0]!.toJSON();
    expect(embed).toMatchObject({
      author: { name: 'Stage 4B League' },
      title: 'Newcastle United Transaction (Demotion)',
      color: 0x3498db,
      fields: [
        {
          name: '📉 Demotion',
          value: `> <@${plan.discordUserId}> \`Unknown User\` has been demoted to player for ⚽ <@&${plan.teamIdentity.discordRoleId}> by <@300000000000000099> \`ardaryusz\`!`,
        },
      ],
      footer: {
        text: 'Demoted by ardaryusz • 02.08.2026 12:00 UTC',
        icon_url: 'https://cdn.discordapp.com/avatars/actor/avatar.png',
      },
    });
    expect(embed.author?.icon_url).toBeUndefined();
    expect(embed.title).not.toMatch(/^@/u);
    expect(JSON.stringify(embed)).not.toContain('ATM');
  });

  it('uses a safe Team transaction fallback when the team role name is unavailable', async () => {
    const send = vi.fn((payload: unknown) => {
      void payload;
      return Promise.resolve();
    });
    const plan: TransferAnnouncementPlan = {
      ...announcement,
      type: 'DEMOTED',
      actorDiscordUserId: '300000000000000099',
      presentation: {
        serverName: 'Stage 4B League',
        teamRoleName: null,
        actor: { username: 'ardaryusz' },
      },
    };
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

    const payload = vi.mocked(send).mock.calls[0]![0] as {
      embeds: Array<{ toJSON(): { title?: string; fields?: Array<{ value: string }> } }>;
    };
    const embed = payload.embeds[0]!.toJSON();
    expect(embed.title).toBe('Team Transaction (Demotion)');
    expect(embed.fields?.[0]?.value).toBe(
      `> <@${plan.discordUserId}> \`Unknown User\` has been demoted to player for ⚽ <@&400000000000000001> by <@300000000000000099> \`ardaryusz\`!`,
    );
    expect(embed.title).not.toMatch(/@|400000000000000001/u);
  });

  it('resolves plain Discord presentation metadata before the message adapter runs', async () => {
    const subject = {
      displayName: 'ARDA2',
      displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/player/avatar.png',
      user: { globalName: null, username: 'arda2' },
    };
    const actor = {
      displayName: 'ardaryusz',
      displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/actor/avatar.png',
      user: { globalName: null, username: 'ardaryusz' },
    };
    const client = {
      guilds: {
        cache: {
          get: () => ({
            name: 'Stage 4B League',
            iconURL: () => 'https://cdn.discordapp.com/icons/guild/icon.png',
            roles: {
              cache: { get: () => ({ name: 'T1', color: 0xf97316 }) },
            },
            members: {
              cache: new Map([
                [announcement.discordUserId, subject],
                ['300000000000000099', actor],
              ]),
            },
          }),
        },
      },
    } as unknown as Client;
    const plan = {
      ...announcement,
      actorDiscordUserId: '300000000000000099',
    };

    await expect(
      new DiscordTransferAnnouncementPresentationProvider(client).resolve(plan),
    ).resolves.toMatchObject({
      presentation: {
        serverName: 'Stage 4B League',
        serverIconUrl: 'https://cdn.discordapp.com/icons/guild/icon.png',
        teamRoleName: 'T1',
        teamRoleColor: 0xf97316,
        subject: {
          username: 'ARDA2',
          avatarUrl: 'https://cdn.discordapp.com/avatars/player/avatar.png',
        },
        actor: {
          username: 'ardaryusz',
          avatarUrl: 'https://cdn.discordapp.com/avatars/actor/avatar.png',
        },
      },
    });
  });

  it('fails with a delivery error when the configured channel is missing, cross-guild, or non-sendable', async () => {
    const client = {
      channels: {
        fetch: vi.fn(() => Promise.resolve(null)),
      },
    } as unknown as Client;

    await expect(new DiscordTransferAnnouncementAdapter(client).send(announcement)).rejects.toThrow(
      TransferAnnouncementDeliveryError,
    );
  });

  it('logs delivery failure and keeps the completed state successful', async () => {
    const logger = new MemoryLogger();
    const service = new TransferAnnouncementService(
      { send: vi.fn(() => Promise.reject(new Error('Discord unavailable'))) },
      logger,
    );
    await expect(service.publish(announcement)).resolves.toBe(false);
    expect(logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          message: 'transfer-market announcement delivery failed',
        }),
      ]),
    );
  });
});

describe('role-synchronized mutation orchestration', () => {
  const rolePlan = {
    discordGuildId: announcement.discordGuildId,
    discordUserId: announcement.discordUserId,
    addRoles: [{ id: announcement.teamIdentity.discordRoleId, purpose: 'TEAM' as const }],
    removeRoles: [],
  };

  it('announces only after role and database success', async () => {
    const order: string[] = [];
    const roles = {
      apply: vi.fn(() => {
        order.push('roles');
        return Promise.resolve({ addedRoles: rolePlan.addRoles, removedRoles: [] });
      }),
      compensate: vi.fn(() => Promise.resolve()),
    };
    const announcements = {
      publish: vi.fn(() => {
        order.push('announcement');
        return Promise.resolve(false);
      }),
    };
    const service = new RoleSynchronizedMutationService(roles, announcements, new MemoryLogger());
    const result = await service.execute(rolePlan, () => {
      order.push('database');
      return Promise.resolve({ roleMutation: rolePlan, announcement });
    });
    expect(order).toEqual(['roles', 'database', 'announcement']);
    expect(result.announcementDelivered).toBe(false);
  });

  it('compensates roles and never announces after database failure', async () => {
    const applied = { addedRoles: rolePlan.addRoles, removedRoles: [] };
    const roles = {
      apply: vi.fn(() => Promise.resolve(applied)),
      compensate: vi.fn(() => Promise.resolve()),
    };
    const announcements = { publish: vi.fn(() => Promise.resolve(true)) };
    const service = new RoleSynchronizedMutationService(roles, announcements, new MemoryLogger());
    await expect(
      service.execute(rolePlan, () => Promise.reject(new Error('database conflict'))),
    ).rejects.toThrow('database conflict');
    expect(roles.compensate).toHaveBeenCalledWith(rolePlan, applied);
    expect(announcements.publish).not.toHaveBeenCalled();
  });

  it('never mutates or announces when critical Discord role synchronization fails', async () => {
    const roles = {
      apply: vi.fn(() => Promise.reject(new Error('role synchronization failed'))),
      compensate: vi.fn(() => Promise.resolve()),
    };
    const announcements = { publish: vi.fn(() => Promise.resolve(true)) };
    const mutate = vi.fn(() => Promise.resolve({ roleMutation: rolePlan, announcement }));
    const service = new RoleSynchronizedMutationService(roles, announcements, new MemoryLogger());

    await expect(service.execute(rolePlan, mutate)).rejects.toThrow('role synchronization failed');
    expect(mutate).not.toHaveBeenCalled();
    expect(announcements.publish).not.toHaveBeenCalled();
  });
});
