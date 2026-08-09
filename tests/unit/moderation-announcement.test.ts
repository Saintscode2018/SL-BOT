import type { Client, EmbedBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { DiscordModerationAnnouncementAdapter } from '../../src/bot/moderation-announcement-adapter.js';
import { DiscordModerationAnnouncementPresentationProvider } from '../../src/bot/moderation-announcement-presentation.js';
import {
  ModerationAnnouncementService,
  type ModerationAnnouncementPlan,
} from '../../src/services/moderation-announcement-service.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const guildId = '993000000000000001';
const targetId = '993000000000000002';
const actorId = '993000000000000003';
const caseFilesChannelId = '993000000000000004';
const auditChannelId = '993000000000000005';
const occurredAt = new Date('2026-08-09T17:45:00.000Z');

function plan(overrides: Partial<ModerationAnnouncementPlan> = {}): ModerationAnnouncementPlan {
  return {
    operation: 'MUTE',
    discordGuildId: guildId,
    caseFilesChannelId,
    auditChannelId,
    targetDiscordUserId: targetId,
    actorDiscordUserId: actorId,
    caseNumber: 42,
    reason: null,
    durationSeconds: 9_000,
    bail: 125,
    occurredAt,
    presentation: {
      serverName: 'Presentation League',
      serverIconUrl: 'https://cdn.example.test/guild.png',
      target: { username: 'Target Member', avatarUrl: null },
      actor: { username: 'Actual Moderator', avatarUrl: 'https://cdn.example.test/actor.png' },
    },
    ...overrides,
  };
}

describe('moderation Case Files and Audit announcements', () => {
  it('publishes the same mute embed to Case Files and Audit with no Transfer Market output', async () => {
    const sent: Array<{ channelId: string; payload: unknown }> = [];
    const fetchChannel = vi.fn((channelId: string) =>
      Promise.resolve({
        guildId,
        isSendable: () => true,
        send: vi.fn((payload: unknown) => {
          sent.push({ channelId, payload });
          return Promise.resolve();
        }),
      }),
    );
    const client = {
      channels: {
        fetch: fetchChannel,
      },
    } as unknown as Client;
    const result = await new ModerationAnnouncementService(
      new DiscordModerationAnnouncementAdapter(client),
      new MemoryLogger(),
    ).publish(plan());
    expect(result).toEqual({ caseFilesDelivered: true, auditDelivered: true });
    expect(fetchChannel).toHaveBeenNthCalledWith(1, caseFilesChannelId);
    expect(fetchChannel).toHaveBeenNthCalledWith(2, auditChannelId);
    expect(sent).toHaveLength(2);
    for (const { payload } of sent) {
      const value = payload as { allowedMentions: unknown; embeds: EmbedBuilder[] };
      expect(value.allowedMentions).toEqual({ parse: [] });
      const embed = value.embeds[0]?.toJSON();
      expect(embed).toMatchObject({
        title: 'Mute • Case #42',
        author: { name: 'Presentation League' },
        fields: [
          { name: 'User', value: `<@${targetId}> \`Target Member\`` },
          { name: 'Reason', value: 'No reason given' },
          { name: 'Punishment', value: '2 hours 30 minutes' },
          { name: 'Bail', value: '125' },
        ],
        footer: { icon_url: 'https://cdn.example.test/actor.png' },
      });
      expect(embed?.footer?.text).toContain('Muted by Actual Moderator');
    }
  });

  it('publishes the persisted case number and resolution reason in both unmute outputs', async () => {
    const sent: unknown[] = [];
    const client = {
      channels: {
        fetch: vi.fn(() =>
          Promise.resolve({
            guildId,
            isSendable: () => true,
            send: vi.fn((payload: unknown) => {
              sent.push(payload);
              return Promise.resolve();
            }),
          }),
        ),
      },
    } as unknown as Client;
    const unmute = plan({
      operation: 'UNMUTE',
      caseNumber: 73,
      reason: 'Appeal approved',
      durationSeconds: null,
      bail: null,
    });
    const result = await new ModerationAnnouncementService(
      new DiscordModerationAnnouncementAdapter(client),
      new MemoryLogger(),
    ).publish(unmute);
    expect(result).toEqual({ caseFilesDelivered: true, auditDelivered: true });
    expect(sent).toHaveLength(2);
    for (const payload of sent) {
      const embed = (payload as { embeds: EmbedBuilder[] }).embeds[0]!.toJSON();
      expect(embed).toMatchObject({
        title: 'Unmute • Case #73',
        fields: [{ name: 'User' }, { name: 'Reason', value: 'Appeal approved' }],
      });
      expect(embed.footer?.text).toContain('Unmuted by Actual Moderator');
      expect(embed.fields).toHaveLength(2);
    }
  });

  it('continues to Audit after Case Files fails and reports precise partial delivery', async () => {
    const logger = new MemoryLogger();
    const send = vi.fn((_plan: ModerationAnnouncementPlan, channelId: string) =>
      channelId === caseFilesChannelId
        ? Promise.reject(new Error('case files unavailable'))
        : Promise.resolve(),
    );
    const result = await new ModerationAnnouncementService({ send }, logger).publish(plan());
    expect(result).toEqual({ caseFilesDelivered: false, auditDelivered: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(logger.entries[0]?.level).toBe('error');
    expect(logger.entries[0]?.message).toBe('moderation announcement delivery failed');
    expect(logger.entries[0]?.context).toMatchObject({
      commandName: 'mute',
      guildId,
      actorDiscordUserId: actorId,
      targetDiscordUserId: targetId,
      caseNumber: 42,
      destination: 'CASE_FILES',
    });
  });

  it('fetches cold-cache target and actor names for presentation', async () => {
    const members = new Map([
      [
        targetId,
        {
          displayName: 'Fetched Target',
          user: { globalName: null, username: 'target-user' },
          displayAvatarURL: () => 'https://cdn.example.test/target.png',
        },
      ],
      [
        actorId,
        {
          displayName: 'Fetched Moderator',
          user: { globalName: null, username: 'actor-user' },
          displayAvatarURL: () => 'https://cdn.example.test/moderator.png',
        },
      ],
    ]);
    const fetchMember = vi.fn((userId: string) => Promise.resolve(members.get(userId)));
    const guild = {
      name: 'Cold Cache League',
      iconURL: () => 'https://cdn.example.test/cold-guild.png',
      members: { cache: new Map(), fetch: fetchMember },
    };
    const fetchUser = vi.fn();
    const client = {
      guilds: { cache: new Map([[guildId, guild]]), fetch: vi.fn() },
      users: { cache: new Map(), fetch: fetchUser },
    } as unknown as Client;
    const unresolved = plan();
    delete unresolved.presentation;
    const resolved = await new DiscordModerationAnnouncementPresentationProvider(client).resolve(
      unresolved,
    );
    expect(fetchMember).toHaveBeenCalledTimes(2);
    expect(resolved.presentation).toMatchObject({
      serverName: 'Cold Cache League',
      target: { username: 'Fetched Target' },
      actor: { username: 'Fetched Moderator' },
    });
    expect(fetchUser).not.toHaveBeenCalled();
  });
});
