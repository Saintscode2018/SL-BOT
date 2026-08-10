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
  const target: {
    id: string;
    user: { bot: boolean };
    moderatable: boolean;
    communicationDisabledUntil: Date | null;
    disableCommunicationUntil: typeof disableCommunicationUntil;
    timeout: typeof timeout;
  } = {
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
  return { client, guild, target, bot, fetch, disableCommunicationUntil, timeout };
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

  it('uses absolute Discord.js timeout expiry and removes a matching owned timeout', async () => {
    const fixture = discordFixture();
    const adapter = new DiscordModerationTimeoutAdapter(fixture.client);
    const expiry = new Date('2026-08-09T19:00:00.123Z');
    const activeAt = new Date('2026-08-09T18:00:00.000Z');
    await adapter.applyTimeout(guildId, targetId, expiry, 'mute reason');
    fixture.target.communicationDisabledUntil = expiry;
    await expect(
      adapter.removeTimeoutIfExpiresAtMatches(
        guildId,
        targetId,
        expiry,
        activeAt,
        'unmute reason',
      ),
    ).resolves.toBe('REMOVED');
    expect(fixture.disableCommunicationUntil).toHaveBeenCalledWith(expiry, 'mute reason');
    expect(fixture.timeout).toHaveBeenCalledWith(null, 'unmute reason');
  });

  it('force-fetches past stale cache and preserves an active one-millisecond mismatch', async () => {
    const fixture = discordFixture();
    const adapter = new DiscordModerationTimeoutAdapter(fixture.client);
    const caseExpiry = new Date('2026-08-09T19:00:00.123Z');
    const externalExpiry = new Date('2026-08-09T19:00:00.124Z');
    const cachedTimeout = vi.fn(() => Promise.resolve());
    fixture.guild.members.cache.set(targetId, {
      ...fixture.target,
      communicationDisabledUntil: caseExpiry,
      timeout: cachedTimeout,
    });
    fixture.target.communicationDisabledUntil = externalExpiry;

    await expect(
      adapter.removeTimeoutIfExpiresAtMatches(
        guildId,
        targetId,
        caseExpiry,
        new Date('2026-08-09T18:00:00.000Z'),
        'unmute reason',
      ),
    ).resolves.toBe('MISMATCH');

    expect(fixture.fetch).toHaveBeenCalledWith({ user: targetId, force: true });
    expect(fixture.timeout).not.toHaveBeenCalled();
    expect(cachedTimeout).not.toHaveBeenCalled();
    expect(fixture.target.communicationDisabledUntil).toEqual(externalExpiry);
  });

  it.each([
    ['null', null],
    ['expired', new Date('2026-08-09T17:59:59.999Z')],
  ])('treats a %s Discord timeout as absent without calling timeout(null)', async (_label, until) => {
    const fixture = discordFixture();
    fixture.target.communicationDisabledUntil = until;

    await expect(
      new DiscordModerationTimeoutAdapter(fixture.client).removeTimeoutIfExpiresAtMatches(
        guildId,
        targetId,
        new Date('2026-08-09T19:00:00.123Z'),
        new Date('2026-08-09T18:00:00.000Z'),
        'unmute reason',
      ),
    ).resolves.toBe('ABSENT');

    expect(fixture.timeout).not.toHaveBeenCalled();
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
