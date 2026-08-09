import { Prisma } from '@prisma/client';
import { SlashCommandBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { CommandRegistry } from '../../src/bot/command-registry.js';
import { mapDiscordError } from '../../src/bot/error-mapper.js';
import { handleInteractionCreate } from '../../src/bot/interaction-handler.js';
import { classifyInteractionError } from '../../src/bot/interaction-error-classifier.js';
import type { CommandContext, CommandInteraction } from '../../src/bot/types.js';
import {
  AdministrativePermissionDeniedError,
  ConfigurationError,
  DiscordRoleCompensationFailedError,
  MemberAlreadySignedError,
  SquadFullError,
  StaleConfirmationError,
  StaleMutationStateError,
  TeamNotFoundError,
  ValidationError,
  WrongCommandChannelError,
} from '../../src/domain/errors.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

interface MockResponse {
  embeds?: unknown[];
  flags?: number;
}

function createMockCommandInteraction(commandName: string): {
  interaction: CommandInteraction;
  replies: MockResponse[];
  edits: MockResponse[];
  followUps: MockResponse[];
} {
  const replies: MockResponse[] = [];
  const edits: MockResponse[] = [];
  const followUps: MockResponse[] = [];

  let isReplied = false;
  let isDeferred = false;

  const interaction: CommandInteraction = {
    commandName,
    get replied() {
      return isReplied;
    },
    get deferred() {
      return isDeferred;
    },
    guildId: 'guild-123',
    guildName: 'Test Guild',
    userId: 'user-456',
    userDisplayName: 'Test User',
    channelId: 'channel-789',
    memberRoleIds: [],
    hasAdministratorPermission: false,
    options: {
      getSubcommand: () => null,
      getSubcommandGroup: () => null,
      getString: () => null,
      getInteger: () => null,
      getUser: () => null,
      getRole: () => null,
      getChannel: () => null,
    },
    getGuildEmojis: () => [],
    getGuildRoleMetadata: () => null,
    getGuildMemberDisplayName: () => null,
    resolveGuildMemberDisplayName: () => Promise.resolve(null),
    resolveGuildRoleMetadata: () => Promise.resolve(null),
    fetchGuildMembers: () => Promise.resolve([]),
    executeDebugReset: () => Promise.resolve(),
    reply: vi.fn((res) => {
      replies.push(res as MockResponse);
      isReplied = true;
      return Promise.resolve();
    }),
    deferReply: vi.fn(() => {
      isDeferred = true;
      return Promise.resolve();
    }),
    editReply: vi.fn((res) => {
      edits.push(res as MockResponse);
      return Promise.resolve();
    }),
    followUp: vi.fn((res) => {
      followUps.push(res as MockResponse);
      isReplied = true;
      return Promise.resolve();
    }),
    deleteReply: vi.fn(() => Promise.resolve()),
  };

  return { interaction, replies, edits, followUps };
}

// ---------------------------------------------------------------------------
// Classification table — tests 1-14
// Each entry: a unique command name, a factory for the thrown error, and the
// expected log level / message / context fields to assert.
// ---------------------------------------------------------------------------

type LogLevel = 'info' | 'warn' | 'error';

interface ClassificationCase {
  label: string;
  cmdName: string;
  makeError: () => unknown;
  level: LogLevel;
  message: string;
  /** Partial context fields that must appear on the log entry. */
  contextSubset: Record<string, unknown>;
}

const classificationCases: ClassificationCase[] = [
  {
    label: '1. WrongCommandChannelError',
    cmdName: 'tc-wrong-channel',
    makeError: () => new WrongCommandChannelError(['channel-789'], 'global'),
    level: 'info',
    message: 'command rejected',
    contextSubset: {
      commandName: 'tc-wrong-channel',
      reason: 'WrongCommandChannelError',
      userId: 'user-456',
      guildId: 'guild-123',
      channelId: 'channel-789',
    },
  },
  {
    label: '2. AdministrativePermissionDeniedError',
    cmdName: 'tc-unauthorized',
    makeError: () => new AdministrativePermissionDeniedError(),
    level: 'info',
    message: 'command rejected',
    contextSubset: {
      commandName: 'tc-unauthorized',
      reason: 'AdministrativePermissionDeniedError',
    },
  },
  {
    label: '3. SquadFullError',
    cmdName: 'tc-squad-full',
    makeError: () => new SquadFullError('Squad limit reached'),
    level: 'info',
    message: 'command rejected',
    contextSubset: { commandName: 'tc-squad-full', reason: 'SquadFullError' },
  },
  {
    label: '4. MemberAlreadySignedError',
    cmdName: 'tc-already-signed',
    makeError: () => new MemberAlreadySignedError(),
    level: 'info',
    message: 'command rejected',
    contextSubset: { commandName: 'tc-already-signed', reason: 'MEMBER_ALREADY_SIGNED' },
  },
  {
    label: '5. TeamNotFoundError',
    cmdName: 'tc-team-not-found',
    makeError: () => new TeamNotFoundError('Team not found'),
    level: 'info',
    message: 'command rejected',
    contextSubset: { commandName: 'tc-team-not-found', reason: 'TeamNotFoundError' },
  },
  {
    label: '6. ValidationError',
    cmdName: 'tc-validation-error',
    makeError: () => new ValidationError('Invalid options'),
    level: 'info',
    message: 'command rejected',
    contextSubset: { commandName: 'tc-validation-error', reason: 'ValidationError' },
  },
  {
    label: '7. StaleConfirmationError',
    cmdName: 'tc-stale-confirm',
    makeError: () => new StaleConfirmationError(),
    level: 'warn',
    message: 'command interaction expired before acknowledgement',
    contextSubset: { commandName: 'tc-stale-confirm', reason: 'STALE_CONFIRMATION' },
  },
  {
    label: '7b. StaleMutationStateError',
    cmdName: 'tc-stale-mutation',
    makeError: () => new StaleMutationStateError(),
    level: 'warn',
    message: 'command interaction expired before acknowledgement',
    contextSubset: { commandName: 'tc-stale-mutation', reason: 'STALE_MUTATION_STATE' },
  },
  {
    label: '8. Discord error code 10062',
    cmdName: 'tc-10062',
    makeError: () => Object.assign(new Error('Unknown interaction'), { code: 10062 }),
    level: 'warn',
    message: 'command interaction expired before acknowledgement',
    contextSubset: {
      commandName: 'tc-10062',
      discordErrorCode: 10062,
      reason: 'INTERACTION_EXPIRED',
    },
  },
  {
    label: '9. Prisma P2028 transaction timeout',
    cmdName: 'tc-p2028',
    makeError: () =>
      new Prisma.PrismaClientKnownRequestError('Transaction expired', {
        code: 'P2028',
        clientVersion: '5.0.0',
      }),
    level: 'error',
    message: 'command execution failed',
    contextSubset: { commandName: 'tc-p2028' },
  },
  {
    label: '10. PrismaClientUnknownRequestError',
    cmdName: 'tc-prisma-generic',
    makeError: () =>
      new Prisma.PrismaClientUnknownRequestError('Database connection lost', {
        clientVersion: '5.0.0',
      }),
    level: 'error',
    message: 'command execution failed',
    contextSubset: {},
  },
  {
    label: '11. DiscordAPIError (code 50035)',
    cmdName: 'tc-discord-50035',
    makeError: () =>
      Object.assign(new Error('Invalid Form Body'), { name: 'DiscordAPIError', code: 50035 }),
    level: 'error',
    message: 'command execution failed',
    contextSubset: {},
  },
  {
    label: '12. EAI_AGAIN network error',
    cmdName: 'tc-network-dns',
    makeError: () =>
      Object.assign(new Error('getaddrinfo EAI_AGAIN discord.com'), { code: 'EAI_AGAIN' }),
    level: 'error',
    message: 'command execution failed',
    contextSubset: {},
  },
  {
    label: '13. DiscordRoleCompensationFailedError',
    cmdName: 'tc-compensation-failed',
    makeError: () => new DiscordRoleCompensationFailedError(['TEAM']),
    level: 'error',
    message: 'command execution failed',
    contextSubset: {},
  },
  {
    label: '14. unexpected TypeError',
    cmdName: 'tc-type-error',
    makeError: () => new TypeError('Cannot read properties of undefined'),
    level: 'error',
    message: 'command execution failed',
    contextSubset: {},
  },
];

describe('Logging Classification & Global Error Handling', () => {
  // Shared registry for tests that don't need an isolated one (15-20)
  const registry = new CommandRegistry();

  // Tests 1-14: each gets its own isolated registry so no command name bleeds across.
  it.each(classificationCases)(
    '$label logs at expected level',
    async ({ cmdName, makeError, level, message, contextSubset }) => {
      const logger = new MemoryLogger();
      const error = makeError();
      const isolatedRegistry = new CommandRegistry();

      isolatedRegistry.register({
        data: new SlashCommandBuilder().setName(cmdName).setDescription('test'),
        execute: () => {
          throw error;
        },
      });

      const { interaction } = createMockCommandInteraction(cmdName);
      await handleInteractionCreate(interaction, isolatedRegistry, {} as CommandContext, logger);

      expect(logger.entries).toHaveLength(1);
      expect(logger.entries[0]).toMatchObject({
        level,
        message,
        ...(Object.keys(contextSubset).length > 0 ? { context: contextSubset } : {}),
        ...(level === 'error' ? { error } : {}),
      });
    },
  );

  it('15. autocomplete infrastructure failure logs error', () => {
    const error = new Prisma.PrismaClientKnownRequestError('DB error', {
      code: 'P2002',
      clientVersion: '5.0.0',
    });
    const classified = classifyInteractionError(error);

    expect(classified.level).toBe('error');
    expect(classified.isInfrastructure).toBe(true);
    expect(classified.reason).toBe('P2002');
  });

  it('16. autocomplete 10062 logs warn', () => {
    const error = { code: 10062 };
    const classified = classifyInteractionError(error);

    expect(classified.level).toBe('warn');
    expect(classified.isInfrastructure).toBe(false);
    expect(classified.reason).toBe('INTERACTION_EXPIRED');
  });

  it('17. user-facing mapped embeds are unchanged', () => {
    const wrongChannelError = new WrongCommandChannelError(['channel-123'], 'global');
    const wrongChannelMapped = mapDiscordError(wrongChannelError);
    expect(wrongChannelMapped.title).toBe('❌ Wrong Command Channel');
    expect(wrongChannelMapped.description).toBe('Use this command in <#channel-123>.');

    const adminPermError = new AdministrativePermissionDeniedError();
    const adminPermMapped = mapDiscordError(adminPermError);
    expect(adminPermMapped.title).toBe('❌ Permission Denied');

    const squadFullError = new SquadFullError('Squad limit reached');
    const squadFullMapped = mapDiscordError(squadFullError);
    expect(squadFullMapped.title).toBe('❌ Squad Limit Reached');

    const memberSignedError = new MemberAlreadySignedError();
    const memberSignedMapped = mapDiscordError(memberSignedError);
    expect(memberSignedMapped.title).toBe('❌ Roster Action Failed');

    const teamNotFoundError = new TeamNotFoundError('Team not found');
    const teamNotFoundMapped = mapDiscordError(teamNotFoundError);
    expect(teamNotFoundMapped.title).toBe('❌ Team Not Found');
  });

  it('18. existing behavior remains unchanged (replies to interaction on error)', async () => {
    const logger = new MemoryLogger();
    const error = new MemberAlreadySignedError();

    registry.register({
      data: new SlashCommandBuilder().setName('test-behavior').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction, replies } = createMockCommandInteraction('test-behavior');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(replies).toHaveLength(1);
    expect(replies[0]?.flags).toBe(64); // MessageFlags.Ephemeral
  });

  it('19. no duplicate logging of the same failure', async () => {
    const logger = new MemoryLogger();
    const error = new ValidationError('Bad input');

    registry.register({
      data: new SlashCommandBuilder().setName('test-no-duplicate').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-no-duplicate');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
  });

  it('verifies ConfigurationError base class fails closed to level: error', () => {
    const baseConfigError = new ConfigurationError('Server configuration missing');
    const classified = classifyInteractionError(baseConfigError);

    expect(classified.level).toBe('error');
    expect(classified.isInfrastructure).toBe(true);
  });
});
