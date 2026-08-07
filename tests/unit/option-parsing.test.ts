import { describe, expect, it } from 'vitest';

import {
  requireChannel,
  requireInteger,
  requireRole,
  requireString,
  requireUser,
} from '../../src/bot/option-parsing.js';
import type { CommandInteractionOptions } from '../../src/bot/types.js';
import { ConfigurationError } from '../../src/domain/errors.js';

function createMockOptions(
  overrides: Partial<CommandInteractionOptions> = {},
): CommandInteractionOptions {
  return {
    getSubcommand: () => null,
    getString: () => null,
    getInteger: () => null,
    getUser: () => null,
    getRole: () => null,
    getChannel: () => null,
    ...overrides,
  };
}

describe('option-parsing helpers', () => {
  describe('requireString', () => {
    it('returns present string value', () => {
      const options = createMockOptions({
        getString: (name) => (name === 'team' ? 'team-123' : null),
      });

      expect(requireString(options, 'team')).toBe('team-123');
    });

    it('throws default ConfigurationError when string option is absent', () => {
      const options = createMockOptions();

      expect(() => requireString(options, 'team')).toThrow(
        new ConfigurationError('team is required'),
      );
    });

    it('preserves caller-supplied error wording when specified', () => {
      const options = createMockOptions();
      const customMessage = 'custom error for string option';

      expect(() => requireString(options, 'rank', customMessage)).toThrow(
        new ConfigurationError(customMessage),
      );
    });
  });

  describe('requireInteger', () => {
    it('returns present integer value', () => {
      const options = createMockOptions({
        getInteger: (name) => (name === 'amount' ? 42 : null),
      });

      expect(requireInteger(options, 'amount')).toBe(42);
    });

    it('throws default ConfigurationError when integer option is absent', () => {
      const options = createMockOptions();

      expect(() => requireInteger(options, 'amount')).toThrow(
        new ConfigurationError('amount is required'),
      );
    });
  });

  describe('requireUser', () => {
    it('returns present user object', () => {
      const mockUser = { id: 'user-1', bot: false, displayName: 'Test User' };
      const options = createMockOptions({
        getUser: (name) => (name === 'player' ? mockUser : null),
      });

      expect(requireUser(options, 'player')).toEqual(mockUser);
    });

    it('throws default ConfigurationError when user option is absent', () => {
      const options = createMockOptions();

      expect(() => requireUser(options, 'player')).toThrow(
        new ConfigurationError('player is required'),
      );
    });
  });

  describe('requireRole', () => {
    it('returns present role object', () => {
      const mockRole = { id: 'role-10' };
      const options = createMockOptions({
        getRole: (name) => (name === 'role' ? mockRole : null),
      });

      expect(requireRole(options, 'role')).toEqual(mockRole);
    });

    it('throws default ConfigurationError when role option is absent', () => {
      const options = createMockOptions();

      expect(() => requireRole(options, 'role')).toThrow(
        new ConfigurationError('role is required'),
      );
    });
  });

  describe('requireChannel', () => {
    it('returns present channel object', () => {
      const mockChannel = { id: 'channel-99', type: 0 };
      const options = createMockOptions({
        getChannel: (name) => (name === 'bot_commands' ? mockChannel : null),
      });

      expect(requireChannel(options, 'bot_commands')).toEqual(mockChannel);
    });

    it('throws default ConfigurationError when channel option is absent', () => {
      const options = createMockOptions();

      expect(() => requireChannel(options, 'bot_commands')).toThrow(
        new ConfigurationError('bot_commands is required'),
      );
    });
  });
});
