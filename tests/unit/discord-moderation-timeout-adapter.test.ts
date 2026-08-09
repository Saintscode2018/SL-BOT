import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { DiscordModerationTimeoutAdapter } from '../../src/bot/discord-moderation-timeout-adapter.js';
import {
  ModerationMemberNotFoundError,
  ModerationTimeoutApplyError,
} from '../../src/domain/errors.js';

const guildId = '994000000000000001';
const targetId = '994000000000000002';
const botId = '994000000000000003';

function discordFixture(options: { memberFetchError?: Error; applyError?: Error } = {}) {
  const disableCommunicationUntil = vi.fn((until: Date | null, reason: string) => {
    void until;
    void reason;
    return options.applyError === undefined
      ? Promise.resolve()
      : Promise.reject(options.applyError);
  });
  const timeout = vi.fn(() => Promise.resolve());
  const target = {
    id: targetId,
    user: { bot: false },
    moderatable: true,
    communicationDisabledUntil: new Date('2026-08-09T18:00:00.000Z'),
    disableCommunicationUntil,
    timeout,
  };
  const bot = { permissions: { has: vi.fn(() => true) } };
  const fetch = vi.fn(() =>
    options.memberFetchError === undefined
      ? Promise.resolve(target)
      : Promise.reject(options.memberFetchError),
  );
  const guild = {
    members: {
      cache: new Map(),
      me: null,
      fetch,
      fetchMe: vi.fn(() => Promise.resolve(bot)),
    },
  };
  const client = {
    user: { id: botId },
    guilds: { cache: new Map([[guildId, guild]]), fetch: vi.fn() },
  } as unknown as Client;
  return { client, target, bot, fetch, disableCommunicationUntil, timeout };
}

describe('Discord moderation timeout adapter', () => {
  it('fetches a cold-cache member and exposes Discord moderation capability state', async () => {
    const fixture = discordFixture();
    const snapshot = await new DiscordModerationTimeoutAdapter(fixture.client).inspect(
      guildId,
      targetId,
    );
    expect(fixture.fetch).toHaveBeenCalledWith({ user: targetId, force: true });
    expect(snapshot).toEqual({
      targetIsBot: false,
      targetIsSelf: false,
      targetModeratable: true,
      botHasModerateMembers: true,
      timeoutUntil: new Date('2026-08-09T18:00:00.000Z'),
    });
  });

  it('uses absolute Discord.js timeout expiry and the canonical timeout removal API', async () => {
    const fixture = discordFixture();
    const adapter = new DiscordModerationTimeoutAdapter(fixture.client);
    const expiry = new Date('2026-08-09T19:00:00.000Z');
    await adapter.applyTimeout(guildId, targetId, expiry, 'mute reason');
    await adapter.removeTimeout(guildId, targetId, 'unmute reason');
    expect(fixture.disableCommunicationUntil).toHaveBeenCalledWith(expiry, 'mute reason');
    expect(fixture.timeout).toHaveBeenCalledWith(null, 'unmute reason');
  });

  it('maps Discord unknown-member code 10007 to a clean business error', async () => {
    const fixture = discordFixture({
      memberFetchError: Object.assign(new Error('Unknown Member'), { code: 10_007 }),
    });
    await expect(
      new DiscordModerationTimeoutAdapter(fixture.client).inspect(guildId, targetId),
    ).rejects.toBeInstanceOf(ModerationMemberNotFoundError);
  });

  it('keeps raw Discord apply failures behind the typed infrastructure error', async () => {
    const rawError = new Error('Discord API failed');
    const fixture = discordFixture({ applyError: rawError });
    await expect(
      new DiscordModerationTimeoutAdapter(fixture.client).applyTimeout(
        guildId,
        targetId,
        new Date('2026-08-09T19:00:00.000Z'),
        'mute reason',
      ),
    ).rejects.toMatchObject({
      constructor: ModerationTimeoutApplyError,
      cause: rawError,
    });
  });
});
