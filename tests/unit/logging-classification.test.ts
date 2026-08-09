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

describe('Logging Classification & Global Error Handling', () => {
  const registry = new CommandRegistry();

  it('1. wrong-channel command rejection logs info, not error', async () => {
    const logger = new MemoryLogger();
    const error = new WrongCommandChannelError(['channel-789'], 'global');

    registry.register({
      data: new SlashCommandBuilder().setName('test-wrong-channel').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-wrong-channel');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'info',
      message: 'command rejected',
      context: {
        commandName: 'test-wrong-channel',
        reason: 'WrongCommandChannelError',
        userId: 'user-456',
        guildId: 'guild-123',
        channelId: 'channel-789',
      },
    });
  });

  it('2. unauthorized command logs info', async () => {
    const logger = new MemoryLogger();
    const error = new AdministrativePermissionDeniedError();

    registry.register({
      data: new SlashCommandBuilder().setName('test-unauthorized').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-unauthorized');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'info',
      message: 'command rejected',
      context: {
        commandName: 'test-unauthorized',
        reason: 'AdministrativePermissionDeniedError',
      },
    });
  });

  it('3. SquadFullError logs info', async () => {
    const logger = new MemoryLogger();
    const error = new SquadFullError('Squad limit reached');

    registry.register({
      data: new SlashCommandBuilder().setName('test-squad-full').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-squad-full');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'info',
      message: 'command rejected',
      context: {
        commandName: 'test-squad-full',
        reason: 'SquadFullError',
      },
    });
  });

  it('4. MemberAlreadySignedError logs info', async () => {
    const logger = new MemoryLogger();
    const error = new MemberAlreadySignedError();

    registry.register({
      data: new SlashCommandBuilder().setName('test-already-signed').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-already-signed');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'info',
      message: 'command rejected',
      context: {
        commandName: 'test-already-signed',
        reason: 'MEMBER_ALREADY_SIGNED',
      },
    });
  });

  it('5. TeamNotFoundError expected user rejection logs info', async () => {
    const logger = new MemoryLogger();
    const error = new TeamNotFoundError('Team not found');

    registry.register({
      data: new SlashCommandBuilder().setName('test-team-not-found').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-team-not-found');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'info',
      message: 'command rejected',
      context: {
        commandName: 'test-team-not-found',
        reason: 'TeamNotFoundError',
      },
    });
  });

  it('6. validation failure logs info', async () => {
    const logger = new MemoryLogger();
    const error = new ValidationError('Invalid options');

    registry.register({
      data: new SlashCommandBuilder().setName('test-validation-error').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-validation-error');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'info',
      message: 'command rejected',
      context: {
        commandName: 'test-validation-error',
        reason: 'ValidationError',
      },
    });
  });

  it('7. stale confirmation logs warn', async () => {
    const logger = new MemoryLogger();
    const error = new StaleConfirmationError();

    registry.register({
      data: new SlashCommandBuilder().setName('test-stale-confirm').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-stale-confirm');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'warn',
      message: 'command interaction expired before acknowledgement',
      context: {
        commandName: 'test-stale-confirm',
        reason: 'STALE_CONFIRMATION',
      },
    });
  });

  it('7b. StaleMutationStateError logs warn', async () => {
    const logger = new MemoryLogger();
    const error = new StaleMutationStateError();

    registry.register({
      data: new SlashCommandBuilder().setName('test-stale-mutation').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-stale-mutation');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'warn',
      message: 'command interaction expired before acknowledgement',
      context: {
        commandName: 'test-stale-mutation',
        reason: 'STALE_MUTATION_STATE',
      },
    });
  });

  it('8. Discord 10062 logs warn', async () => {
    const logger = new MemoryLogger();
    const error = new Error('Unknown interaction');
    Object.assign(error, { code: 10062 });

    registry.register({
      data: new SlashCommandBuilder().setName('test-10062').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-10062');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'warn',
      message: 'command interaction expired before acknowledgement',
      context: {
        commandName: 'test-10062',
        discordErrorCode: 10062,
        reason: 'INTERACTION_EXPIRED',
      },
    });
  });

  it('9. Prisma P2028 logs error', async () => {
    const logger = new MemoryLogger();
    const error = new Prisma.PrismaClientKnownRequestError('Transaction expired', {
      code: 'P2028',
      clientVersion: '5.0.0',
    });

    registry.register({
      data: new SlashCommandBuilder().setName('test-p2028').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-p2028');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'error',
      message: 'command execution failed',
      error,
      context: {
        commandName: 'test-p2028',
      },
    });
  });

  it('10. generic Prisma error logs error', async () => {
    const logger = new MemoryLogger();
    const error = new Prisma.PrismaClientUnknownRequestError('Database connection lost', {
      clientVersion: '5.0.0',
    });

    registry.register({
      data: new SlashCommandBuilder().setName('test-prisma-generic').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-prisma-generic');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'error',
      message: 'command execution failed',
      error,
    });
  });

  it('11. Discord API error other than 10062 logs error', async () => {
    const logger = new MemoryLogger();
    const error = new Error('Invalid Form Body');
    Object.assign(error, { name: 'DiscordAPIError', code: 50035 });

    registry.register({
      data: new SlashCommandBuilder().setName('test-discord-50035').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-discord-50035');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'error',
      message: 'command execution failed',
      error,
    });
  });

  it('12. EAI_AGAIN/network error logs error', async () => {
    const logger = new MemoryLogger();
    const error = Object.assign(new Error('getaddrinfo EAI_AGAIN discord.com'), {
      code: 'EAI_AGAIN',
    });

    registry.register({
      data: new SlashCommandBuilder().setName('test-network-dns').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-network-dns');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'error',
      message: 'command execution failed',
      error,
    });
  });

  it('13. DiscordRoleCompensationFailedError logs error', async () => {
    const logger = new MemoryLogger();
    const error = new DiscordRoleCompensationFailedError(['TEAM']);

    registry.register({
      data: new SlashCommandBuilder().setName('test-compensation-failed').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-compensation-failed');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'error',
      message: 'command execution failed',
      error,
    });
  });

  it('14. unexpected TypeError logs error', async () => {
    const logger = new MemoryLogger();
    const error = new TypeError('Cannot read properties of undefined');

    registry.register({
      data: new SlashCommandBuilder().setName('test-type-error').setDescription('test'),
      execute: () => {
        throw error;
      },
    });

    const { interaction } = createMockCommandInteraction('test-type-error');
    await handleInteractionCreate(interaction, registry, {} as CommandContext, logger);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'error',
      message: 'command execution failed',
      error,
    });
  });

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
