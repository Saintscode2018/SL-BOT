import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { DiscordModerationRoleInspector } from '../../src/bot/discord-moderation-role-inspector.js';
import { DiscordRoleUpdateFailedError } from '../../src/domain/errors.js';

const guildId = '994000000000000001';
const roleId = '994000000000000002';

function discordFixture(options: { role?: { id: string; managed: boolean } | null; roleFetchError?: Error } = {}) {
  const roleFetch = vi.fn(() =>
    options.roleFetchError === undefined
      ? Promise.resolve(options.role === undefined ? { id: roleId, managed: false } : options.role)
      : Promise.reject(options.roleFetchError),
  );
  const guild = {
    roles: { cache: new Map(), fetch: roleFetch },
  };
  const client = {
    guilds: { cache: new Map([[guildId, guild]]), fetch: vi.fn() },
  } as unknown as Client;
  return { client, guild, roleFetch };
}

describe('Discord moderation role inspector', () => {
  it('returns an existing unmanaged Discord role', async () => {
    const fixture = discordFixture();

    await expect(
      new DiscordModerationRoleInspector(fixture.client).inspectGuildRole(guildId, roleId),
    ).resolves.toEqual({ managed: false });
    expect(fixture.roleFetch).toHaveBeenCalledWith(roleId, { force: true });
  });

  it('returns an existing Discord-managed role', async () => {
    const fixture = discordFixture({ role: { id: roleId, managed: true } });

    await expect(
      new DiscordModerationRoleInspector(fixture.client).inspectGuildRole(guildId, roleId),
    ).resolves.toEqual({ managed: true });
  });

  it('returns null when Discord definitively reports an unknown role', async () => {
    const fixture = discordFixture({ role: null });

    await expect(
      new DiscordModerationRoleInspector(fixture.client).inspectGuildRole(guildId, roleId),
    ).resolves.toBeNull();
  });

  it('does not accept a stale cached role when the authoritative fetch reports it missing', async () => {
    const fixture = discordFixture({ role: null });
    const cachedRole = { id: roleId, managed: false };
    fixture.guild.roles.cache.set(roleId, cachedRole);

    await expect(
      new DiscordModerationRoleInspector(fixture.client).inspectGuildRole(guildId, roleId),
    ).resolves.toBeNull();
    expect(fixture.roleFetch).toHaveBeenCalledWith(roleId, { force: true });
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
