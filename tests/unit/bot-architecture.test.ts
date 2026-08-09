import { Events, GatewayIntentBits, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { createDiscordClient } from '../../src/bot/client.js';
import { CommandRegistry } from '../../src/bot/command-registry.js';
import { EventRegistry, type RegisterableEvent } from '../../src/bot/event-registry.js';
import { handleInteractionCreate } from '../../src/bot/interaction-handler.js';
import type {
  CommandContext,
  CommandDefinition,
  CommandInteraction,
  DeferredInteractionResponse,
  EditedInteractionResponse,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import {
  ConflictError,
  MemberAlreadySignedError,
  SquadFullError,
  TeamNotFoundError,
} from '../../src/domain/errors.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

class FakeInteraction implements CommandInteraction {
  public readonly replies: SafeInteractionResponse[] = [];
  public readonly edits: EditedInteractionResponse[] = [];
  public readonly followUps: SafeInteractionResponse[] = [];
  public readonly deferrals: Array<DeferredInteractionResponse | undefined> = [];

  public constructor(
    public readonly commandName: string,
    public replied = false,
    public deferred = false,
  ) {}

  public reply(response: SafeInteractionResponse): Promise<void> {
    this.replies.push(response);
    this.replied = true;
    return Promise.resolve();
  }

  public deferReply(response?: DeferredInteractionResponse): Promise<void> {
    this.deferrals.push(response);
    this.deferred = true;
    return Promise.resolve();
  }

  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.edits.push(response);
    this.replied = true;
    return Promise.resolve();
  }

  public followUp(response: SafeInteractionResponse): Promise<void> {
    this.followUps.push(response);
    return Promise.resolve();
  }

  public deleteReply(): Promise<void> {
    return Promise.resolve();
  }
}

function command(
  name: string,
  execute: CommandDefinition['execute'] = vi.fn(() => Promise.resolve()),
): CommandDefinition {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription('test command'),
    execute,
  };
}

function context(logger: MemoryLogger): CommandContext {
  return {
    logger,
    database: {} as CommandContext['database'],
    databaseHealth: { check: () => Promise.resolve(true) },
    guildConfigurationService: {
      load: () => Promise.reject(new Error('not used')),
    },
    offerAcceptanceService: {
      acceptOffer: () => Promise.reject(new Error('not used')),
    },
    guildSetupService: {
      setup: () => Promise.reject(new Error('not used')),
      setupGuildOnly: () => Promise.reject(new Error('not used')),
      setupChannels: () => Promise.reject(new Error('not used')),
      setupRoles: () => Promise.reject(new Error('not used')),
      getView: () => Promise.reject(new Error('not used')),
    },
    clubManagementService: {
      create: () => Promise.reject(new Error('not used')),
      edit: () => Promise.reject(new Error('not used')),
      deactivate: () => Promise.reject(new Error('not used')),
      listActive: () => Promise.reject(new Error('not used')),
      autocomplete: () => Promise.reject(new Error('not used')),
    },
    staffManagementService: {
      appoint: () => Promise.reject(new Error('not used')),
      remove: () => Promise.reject(new Error('not used')),
      list: () => Promise.reject(new Error('not used')),
      getCallerActiveStaffClub: () => Promise.reject(new Error('not used')),
    },

    rosterManagementService: {
      add: () => Promise.reject(new Error('not used')),
      remove: () => Promise.reject(new Error('not used')),
      list: () => Promise.reject(new Error('not used')),
    },
    limitManagementService: {
      setDefaultLimit: () => Promise.reject(new Error('not used')),
      setTeamLimit: () => Promise.reject(new Error('not used')),
      resetTeamLimit: () => Promise.reject(new Error('not used')),
      viewLimit: () => Promise.reject(new Error('not used')),
    },
    commandChannelPolicyService: {
      validateChannelPolicy: () => Promise.resolve(),
    },
    offerDeliveryService: {
      createAndDeliver: () => Promise.reject(new Error('not used')),
    },
    offerButtonHandler: { handle: () => Promise.reject(new Error('not used')) },
    setupAuditService: { publish: () => Promise.resolve(true) },
  };
}

describe('discord client factory', () => {
  it('uses only the guild and guild-member intents without connecting', async () => {
    const client = createDiscordClient();
    expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
    expect(client.options.intents.has(GatewayIntentBits.GuildMembers)).toBe(true);
    expect(client.options.intents.has(GatewayIntentBits.MessageContent)).toBe(false);
    expect(client.options.intents.has(GatewayIntentBits.GuildPresences)).toBe(false);
    await client.destroy();
  });
});

describe('command registry', () => {
  it('registers and resolves a command', () => {
    const definition = command('alpha');
    const registry = new CommandRegistry();
    registry.register(definition);
    expect(registry.resolve('alpha')).toBe(definition);
    expect(registry.resolve('missing')).toBeNull();
  });

  it('rejects duplicate names', () => {
    const registry = new CommandRegistry([command('alpha')]);
    expect(() => registry.register(command('alpha'))).toThrow(ConflictError);
  });

  it('exports slash command json', () => {
    const registry = new CommandRegistry([command('alpha')]);
    expect(registry.toJSON()).toEqual([
      expect.objectContaining({ name: 'alpha', description: 'test command', type: 1 }),
    ]);
  });
});

describe('event registry', () => {
  it('rejects duplicate event names', () => {
    const event: RegisterableEvent = {
      name: Events.ClientReady,
      register: vi.fn(),
    };
    expect(() => new EventRegistry([event, event])).toThrow(ConflictError);
  });
});

describe('interaction handler', () => {
  it('ignores non chat input interactions', async () => {
    const logger = new MemoryLogger();
    await handleInteractionCreate(null, new CommandRegistry(), context(logger), logger);
    expect(logger.entries).toEqual([]);
  });

  it('logs an unknown command', async () => {
    const logger = new MemoryLogger();
    await handleInteractionCreate(
      new FakeInteraction('missing'),
      new CommandRegistry(),
      context(logger),
      logger,
    );
    expect(logger.entries).toContainEqual({
      level: 'warn',
      message: 'unknown command received',
      context: { commandName: 'missing' },
    });
  });

  it('executes a known command with its context', async () => {
    const logger = new MemoryLogger();
    const execute = vi.fn(() => Promise.resolve());
    const registry = new CommandRegistry([command('alpha', execute)]);
    const commandContext = context(logger);
    const interaction = new FakeInteraction('alpha');
    await handleInteractionCreate(interaction, registry, commandContext, logger);
    expect(execute).toHaveBeenCalledWith(interaction, commandContext);
  });

  it('logs failures and replies safely before the initial response', async () => {
    const logger = new MemoryLogger();
    const registry = new CommandRegistry([
      command(
        'alpha',
        vi.fn(() => Promise.reject(new Error('private database detail'))),
      ),
    ]);
    const interaction = new FakeInteraction('alpha');
    await handleInteractionCreate(interaction, registry, context(logger), logger);
    expect(logger.entries.some(({ level }) => level === 'error')).toBe(true);
    expect(interaction.replies).toHaveLength(1);
    expect(interaction.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(interaction.replies[0]?.embeds?.[0]?.data?.title).toBe('❌ Command Failed');
    expect(JSON.stringify(interaction.replies)).not.toContain('private database detail');
  });

  it('edits safely after the interaction was deferred', async () => {
    const logger = new MemoryLogger();
    const registry = new CommandRegistry([
      command(
        'alpha',
        vi.fn(() => Promise.reject(new Error('private detail'))),
      ),
    ]);
    const interaction = new FakeInteraction('alpha');
    interaction.deferred = true;
    await handleInteractionCreate(interaction, registry, context(logger), logger);
    expect(interaction.edits).toHaveLength(1);
    expect(interaction.edits[0]?.embeds?.[0]?.data?.title).toBe('❌ Command Failed');
    expect(JSON.stringify(interaction.edits)).not.toContain('private detail');
  });

  it('uses a follow-up after an interaction already replied', async () => {
    const logger = new MemoryLogger();
    const registry = new CommandRegistry([
      command(
        'alpha',
        vi.fn(() => Promise.reject(new Error('private detail'))),
      ),
    ]);
    const interaction = new FakeInteraction('alpha', true, false);
    await handleInteractionCreate(interaction, registry, context(logger), logger);
    expect(interaction.replies).toEqual([]);
    expect(interaction.edits).toEqual([]);
    expect(interaction.followUps).toHaveLength(1);
  });

  it('preserves a public defer and does not acknowledge twice', async () => {
    const logger = new MemoryLogger();
    const interaction = new FakeInteraction('alpha');
    const slowWork = vi.fn(() => Promise.resolve());
    const registry = new CommandRegistry([
      command('alpha', async (current) => {
        await current.deferReply();
        await slowWork();
      }),
    ]);
    await handleInteractionCreate(interaction, registry, context(logger), logger);
    expect(interaction.deferrals).toEqual([undefined]);
    expect(slowWork).toHaveBeenCalledOnce();
    expect(interaction.replies).toEqual([]);
  });

  it('does not retry a response when Discord reports unknown interaction', async () => {
    const logger = new MemoryLogger();
    const registry = new CommandRegistry([
      command(
        'alpha',
        vi.fn(() =>
          Promise.reject(Object.assign(new Error('Unknown interaction'), { code: 10_062 })),
        ),
      ),
    ]);
    const interaction = new FakeInteraction('alpha');
    await handleInteractionCreate(interaction, registry, context(logger), logger);
    expect(interaction.replies).toEqual([]);
    expect(interaction.edits).toEqual([]);
    expect(interaction.followUps).toEqual([]);
    expect(logger.entries).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: 'command interaction expired before acknowledgement',
      }),
    ]);
  });

  it.each([
    new SquadFullError('full'),
    new MemberAlreadySignedError(),
    new TeamNotFoundError('missing'),
  ])('logs expected domain rejection %s below error level', async (error) => {
    const logger = new MemoryLogger();
    const registry = new CommandRegistry([
      command(
        'alpha',
        vi.fn(() => Promise.reject(error)),
      ),
    ]);
    await handleInteractionCreate(new FakeInteraction('alpha'), registry, context(logger), logger);
    expect(logger.entries.some(({ level }) => level === 'error')).toBe(false);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'command rejected',
      }),
    );
  });

  it.each(['P2028', 50_013] as const)(
    'keeps infrastructure failure $code at error level',
    async (code) => {
      const logger = new MemoryLogger();
      const error = Object.assign(new Error(`infrastructure failure ${code}`), { code });
      const registry = new CommandRegistry([
        command(
          'alpha',
          vi.fn(() => Promise.reject(error)),
        ),
      ]);
      await handleInteractionCreate(
        new FakeInteraction('alpha'),
        registry,
        context(logger),
        logger,
      );
      expect(logger.entries).toContainEqual(
        expect.objectContaining({ level: 'error', message: 'command execution failed' }),
      );
    },
  );
});
