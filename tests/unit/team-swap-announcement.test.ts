import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { DiscordAuditAnnouncementAdapter } from '../../src/bot/audit-announcement-adapter.js';
import { DiscordTransferAnnouncementAdapter } from '../../src/bot/transfer-announcement-adapter.js';
import type {
  AuditAnnouncementPlan,
  TransferAnnouncementPlan,
} from '../../src/domain/roster-mutation.js';

const now = new Date('2026-08-06T12:00:00Z');

interface EmbedData {
  title?: string;
  description?: string;
  fields?: Array<{ name: string; value: string }>;
}

function mockChannel() {
  const send = vi.fn(() => Promise.resolve());
  const channel = {
    id: 'channel-1',
    guildId: '100000000000000001',
    isSendable: () => true,
    send,
  };
  const client = {
    channels: {
      fetch: vi.fn((id: string) =>
        id === channel.id ? Promise.resolve(channel) : Promise.reject(new Error('not found')),
      ),
    },
  } as unknown as Client;
  return { client, channel, send };
}

describe('Team Swap Announcement Adapters', () => {
  it('renders Transfer Market team swap announcement without administrative actor', async () => {
    const { client, send } = mockChannel();
    const adapter = new DiscordTransferAnnouncementAdapter(client);

    const plan: TransferAnnouncementPlan = {
      discordGuildId: '100000000000000001',
      channelId: 'channel-1',
      type: 'TEAM_SWAPPED',
      team1Identity: { discordRoleId: 'role-1', emoji: '🦁' },
      team2Identity: { discordRoleId: 'role-2', emoji: '🐯' },
      occurredAt: now,
      swapDetails: {
        team1MovedCount: 3,
        team2MovedCount: 2,
      },
    };

    await adapter.send(plan);
    expect(send).toHaveBeenCalledOnce();

    const firstCall = send.mock.calls[0] as [{ embeds?: Array<{ data: EmbedData }> }] | undefined;
    const embed = firstCall?.[0]?.embeds?.[0]?.data;

    expect(embed?.title).toContain('Teams Swapped');
    expect(embed?.description).toContain('<@&role-1>');
    expect(embed?.description).toContain('<@&role-2>');
    expect(embed?.description).toContain('2** members moved to 🦁 <@&role-1>');
    expect(embed?.description).toContain('3** members moved to 🐯 <@&role-2>');
    // Actor must NOT be in Transfer Market announcement
    expect(JSON.stringify(embed)).not.toContain('actor');
  });

  it('renders Audit channel team swap announcement WITH administrative actor', async () => {
    const { client, send } = mockChannel();
    const adapter = new DiscordAuditAnnouncementAdapter(client);

    const plan: AuditAnnouncementPlan = {
      discordGuildId: '100000000000000001',
      channelId: 'channel-1',
      operation: 'TEAM_SWAPPED',
      actorDiscordUserId: '500000000000000001',
      team1Identity: { discordRoleId: 'role-1', emoji: '🦁' },
      team2Identity: { discordRoleId: 'role-2', emoji: '🐯' },
      occurredAt: now,
      swapDetails: {
        team1MovedCount: 3,
        team2MovedCount: 2,
      },
      presentation: {
        serverName: 'League Guild',
        actor: { username: 'Admin User' },
      },
    };

    await adapter.send(plan);
    expect(send).toHaveBeenCalledOnce();

    const firstCall = send.mock.calls[0] as [{ embeds?: Array<{ data: EmbedData }> }] | undefined;
    const embed = firstCall?.[0]?.embeds?.[0]?.data;

    expect(embed?.title).toContain('Team Population Swap');
    expect(embed?.description).toContain('<@&role-1>');
    expect(embed?.description).toContain('<@&role-2>');
    expect(embed?.fields?.[0]?.name).toBe('Swapped by');
    expect(embed?.fields?.[0]?.value).toContain('<@500000000000000001>');
    expect(embed?.fields?.[0]?.value).toContain('Admin User');
  });
});
