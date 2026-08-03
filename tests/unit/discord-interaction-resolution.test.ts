import { Collection, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import {
  DiscordButtonAdapter,
  DiscordCommandInteraction,
} from '../../src/bot/interaction-handler.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

function createInteraction(options: {
  guild: object | null;
  guilds?: Collection<string, object>;
  userFetch?: ReturnType<typeof vi.fn>;
}) {
  return {
    user: { id: 'invoking-user', globalName: 'Invoker', username: 'invoker' },
    member: null,
    guild: options.guild,
    client: {
      guilds: { cache: options.guilds ?? new Collection<string, object>() },
      users: {
        cache: new Collection<string, object>(),
        fetch: options.userFetch ?? vi.fn().mockRejectedValue(new Error('unknown user')),
      },
    },
  };
}

describe('Discord interaction cold-cache resolution', () => {
  it('fetches an uncached guild member and uses the fetched display name', async () => {
    const memberFetch = vi.fn().mockResolvedValue({
      displayName: 'Fetched Nickname',
      user: { globalName: 'Fetched Global Name', username: 'fetched-user' },
    });
    const userFetch = vi.fn();
    const guild = {
      id: 'guild-1',
      members: { cache: new Collection(), fetch: memberFetch },
      roles: { cache: new Collection(), fetch: vi.fn() },
    };
    const raw = createInteraction({ guild, userFetch });
    const logger = new MemoryLogger();
    const interaction = new DiscordCommandInteraction(
      raw as unknown as ChatInputCommandInteraction,
      logger,
    );

    await expect(interaction.resolveGuildMemberDisplayName('member-1')).resolves.toBe(
      'Fetched Nickname',
    );
    expect(memberFetch).toHaveBeenCalledWith('member-1');
    expect(userFetch).not.toHaveBeenCalled();
    expect(logger.entries.map(({ message }) => message)).toEqual([
      'Discord guild member cache miss',
      'Discord guild member fetch succeeded',
    ]);
  });

  it('falls through an unknown member to a fresh Discord user fetch', async () => {
    const memberFetch = vi.fn().mockRejectedValue(new Error('unknown member'));
    const userFetch = vi.fn().mockResolvedValue({
      globalName: 'Fetched User',
      username: 'fetched-user',
    });
    const guild = {
      id: 'guild-1',
      members: { cache: new Collection(), fetch: memberFetch },
      roles: { cache: new Collection(), fetch: vi.fn() },
    };
    const raw = createInteraction({ guild, userFetch });
    const logger = new MemoryLogger();
    const interaction = new DiscordCommandInteraction(
      raw as unknown as ChatInputCommandInteraction,
      logger,
    );

    await expect(interaction.resolveGuildMemberDisplayName('user-1')).resolves.toBe('Fetched User');
    expect(userFetch).toHaveBeenCalledWith('user-1');
    expect(logger.entries.map(({ message }) => message)).toEqual([
      'Discord guild member cache miss',
      'Discord guild member fetch failed',
      'Discord user fetch succeeded',
    ]);
  });

  it('returns null only after both member and user fetches fail', async () => {
    const guild = {
      id: 'guild-1',
      members: {
        cache: new Collection(),
        fetch: vi.fn().mockRejectedValue(new Error('unknown member')),
      },
      roles: { cache: new Collection(), fetch: vi.fn() },
    };
    const raw = createInteraction({ guild });
    const logger = new MemoryLogger();
    const interaction = new DiscordCommandInteraction(
      raw as unknown as ChatInputCommandInteraction,
      logger,
    );

    await expect(interaction.resolveGuildMemberDisplayName('missing-user')).resolves.toBeNull();
    expect(logger.entries.map(({ message }) => message)).toEqual([
      'Discord guild member cache miss',
      'Discord guild member fetch failed',
      'Discord user fetch failed',
    ]);
  });

  it('fetches an uncached role for a DM button from the bot guild cache', async () => {
    const roleFetch = vi.fn().mockResolvedValue({ id: 'role-1', name: '@T1', color: 0x123456 });
    const guild = {
      id: 'guild-1',
      members: { cache: new Collection(), fetch: vi.fn() },
      roles: { cache: new Collection(), fetch: roleFetch },
    };
    const guilds = new Collection<string, object>([['guild-1', guild]]);
    const raw = createInteraction({ guild: null, guilds });
    const logger = new MemoryLogger();
    const interaction = new DiscordButtonAdapter(raw as unknown as ButtonInteraction, logger);

    await expect(interaction.resolveGuildRoleMetadata('role-1')).resolves.toEqual({
      id: 'role-1',
      name: '@T1',
      color: 0x123456,
    });
    expect(roleFetch).toHaveBeenCalledWith('role-1');
    expect(logger.entries.map(({ message }) => message)).toEqual([
      'Discord guild role cache miss',
      'Discord guild role fetch succeeded',
    ]);
  });

  it('returns null only after a fresh role fetch cannot resolve the role', async () => {
    const guild = {
      id: 'guild-1',
      members: { cache: new Collection(), fetch: vi.fn() },
      roles: { cache: new Collection(), fetch: vi.fn().mockResolvedValue(null) },
    };
    const raw = createInteraction({ guild });
    const logger = new MemoryLogger();
    const interaction = new DiscordCommandInteraction(
      raw as unknown as ChatInputCommandInteraction,
      logger,
    );

    await expect(interaction.resolveGuildRoleMetadata('missing-role')).resolves.toBeNull();
    expect(logger.entries.map(({ message }) => message)).toEqual([
      'Discord guild role cache miss',
      'Discord guild role fetch failed',
    ]);
  });
});
