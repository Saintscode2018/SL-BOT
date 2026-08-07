import { describe, expect, it } from 'vitest';

import { extractAuthorizationInput, requireGuildExecution } from '../../src/bot/guild-execution.js';
import type { CommandInteraction, CommandInteractionOptions } from '../../src/bot/types.js';
import { ConfigurationError } from '../../src/domain/errors.js';

function createMockInteraction(overrides: Partial<CommandInteraction> = {}): CommandInteraction {
  const options: CommandInteractionOptions = {
    getSubcommand: () => null,
    getString: () => null,
    getInteger: () => null,
    getUser: () => null,
    getRole: () => null,
    getChannel: () => null,
  };

  return {
    commandName: 'test',
    replied: false,
    deferred: false,
    guildId: 'guild-123',
    guildName: 'Test Guild',
    guildOwnerId: 'owner-456',
    userId: 'user-789',
    channelId: 'channel-999',
    memberRoleIds: ['role-1', 'role-2'],
    hasAdministratorPermission: false,
    options,
    reply: () => Promise.resolve(),
    deferReply: () => Promise.resolve(),
    editReply: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    deleteReply: () => Promise.resolve(),
    ...overrides,
  };
}

describe('guild-execution helpers', () => {
  describe('extractAuthorizationInput', () => {
    it('extracts authorization input with explicit member roles and admin permission', () => {
      const auth = extractAuthorizationInput({
        guildId: 'g-1',
        userId: 'u-1',
        guildOwnerId: 'owner-1',
        memberRoleIds: ['r-1', 'r-2'],
        hasAdministratorPermission: true,
      });

      expect(auth).toEqual({
        discordGuildId: 'g-1',
        discordUserId: 'u-1',
        guildOwnerId: 'owner-1',
        memberRoleIds: ['r-1', 'r-2'],
        hasAdministratorPermission: true,
      });
    });

    it('defaults memberRoleIds to empty array and hasAdministratorPermission to false', () => {
      const auth = extractAuthorizationInput({
        guildId: 'g-1',
        userId: 'u-1',
        guildOwnerId: 'owner-1',
      });

      expect(auth).toEqual({
        discordGuildId: 'g-1',
        discordUserId: 'u-1',
        guildOwnerId: 'owner-1',
        memberRoleIds: [],
        hasAdministratorPermission: false,
      });
    });
  });

  describe('requireGuildExecution', () => {
    it('succeeds for valid guild command execution when channel is not required', () => {
      const interaction = createMockInteraction();
      const execution = requireGuildExecution(interaction);

      expect(execution.guildId).toBe('guild-123');
      expect(execution.guildName).toBe('Test Guild');
      expect(execution.authorization).toEqual({
        discordGuildId: 'guild-123',
        discordUserId: 'user-789',
        guildOwnerId: 'owner-456',
        memberRoleIds: ['role-1', 'role-2'],
        hasAdministratorPermission: false,
      });
    });

    it('succeeds without channel when requireChannel is false', () => {
      const interaction = createMockInteraction({ channelId: undefined });
      const execution = requireGuildExecution(interaction);

      expect(execution.guildId).toBe('guild-123');
      expect(execution.channelId).toBeUndefined();
    });

    it('rejects missing guild with server error message when channel is not required', () => {
      const interaction = createMockInteraction({ guildId: undefined });

      expect(() => requireGuildExecution(interaction)).toThrow(
        new ConfigurationError('this command must be used in a Discord server'),
      );
    });

    it('succeeds when requireChannel is true and channel is present', () => {
      const interaction = createMockInteraction();
      const execution = requireGuildExecution(interaction, { requireChannel: true });

      expect(execution.guildId).toBe('guild-123');
      expect(execution.channelId).toBe('channel-999');
    });

    it('rejects missing channel with text channel error message when requireChannel is true', () => {
      const interaction = createMockInteraction({ channelId: undefined });

      expect(() => requireGuildExecution(interaction, { requireChannel: true })).toThrow(
        new ConfigurationError('this command must be used in a Discord server text channel'),
      );
    });

    it('rejects missing guild with text channel error message when requireChannel is true', () => {
      const interaction = createMockInteraction({ guildId: undefined });

      expect(() => requireGuildExecution(interaction, { requireChannel: true })).toThrow(
        new ConfigurationError('this command must be used in a Discord server text channel'),
      );
    });

    it('correctly maps guild owner authorization', () => {
      const interaction = createMockInteraction({
        userId: 'owner-456',
        guildOwnerId: 'owner-456',
      });
      const execution = requireGuildExecution(interaction);

      expect(execution.authorization.discordUserId).toBe('owner-456');
      expect(execution.authorization.guildOwnerId).toBe('owner-456');
    });

    it('correctly maps Discord Administrator authorization', () => {
      const interaction = createMockInteraction({
        hasAdministratorPermission: true,
      });
      const execution = requireGuildExecution(interaction);

      expect(execution.authorization.hasAdministratorPermission).toBe(true);
    });
  });
});
