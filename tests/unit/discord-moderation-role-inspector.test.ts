import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { DiscordModerationRoleInspector } from '../../src/bot/discord-moderation-role-inspector.js';
import { DiscordRoleUpdateFailedError } from '../../src/domain/errors.js';

const guildId = '994000000000000001';
const roleId = '994000000000000002';

function discordFixture(options: { roleFetchError?: Error } = {}) {
  const roleFetch = vi.fn(() =>
    options.roleFetchError === undefined
      ? Promise.resolve({ id: roleId, managed: true })
      : Promise.reject(options.roleFetchError),
  );
  const guild = {
    roles: { cache: new Map(), fetch: roleFetch },
  };
  const client = {
    guilds: { cache: new Map([[guildId, guild]]), fetch: vi.fn() },
  } as unknown as Client;
  return { client, roleFetch };
}

describe('Discord moderation role inspector', () => {
  it('exposes the resolved Discord role managed state', async () => {
    const fixture = discordFixture();

    await expect(
      new DiscordModerationRoleInspector(fixture.client).inspectGuildRole(guildId, roleId),
    ).resolves.toEqual({ managed: true });
    expect(fixture.roleFetch).toHaveBeenCalledWith(roleId);
  });

  it('returns null for an unknown role without treating it as managed', async () => {
    const fixture = discordFixture({
      roleFetchError: Object.assign(new Error('Unknown Role'), { code: 10_011 }),
    });

    await expect(
      new DiscordModerationRoleInspector(fixture.client).inspectGuildRole(guildId, roleId),
    ).resolves.toBeNull();
  });

  it('keeps Discord API failures behind the existing typed infrastructure error', async () => {
    const rawError = new Error('Discord API failed');
    const fixture = discordFixture({ roleFetchError: rawError });

    await expect(
      new DiscordModerationRoleInspector(fixture.client).inspectGuildRole(guildId, roleId),
    ).rejects.toMatchObject({
      constructor: DiscordRoleUpdateFailedError,
      cause: rawError,
    });
  });
});
