import { Events, GatewayIntentBits, SlashCommandBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { createDiscordClient } from '../../src/bot/client.js';
import { CommandRegistry } from '../../src/bot/command-registry.js';
import { EventRegistry, type RegisterableEvent } from '../../src/bot/event-registry.js';
import { handleInteractionCreate } from '../../src/bot/interaction-handler.js';
import type {
  CommandContext,
  CommandDefinition,
  CommandInteraction,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import { ConflictError } from '../../src/domain/errors.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

class FakeInteraction implements CommandInteraction {
  public readonly replies: SafeInteractionResponse[] = [];
  public readonly followUps: SafeInteractionResponse[] = [];

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

  public followUp(response: SafeInteractionResponse): Promise<void> {
    this.followUps.push(response);
    return Promise.resolve();
  }
}

function command(name: string, execute = vi.fn(() => Promise.resolve())): CommandDefinition {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription('test command'),
    execute,
  };
}

function context(logger: MemoryLogger): CommandContext {
  return {
    logger,
    guildConfigurationService: {
      load: () => Promise.reject(new Error('not used')),
    },
    offerAcceptanceService: {
      acceptOffer: () => Promise.reject(new Error('not used')),
    },
  };
}

describe('discord client factory', () => {
  it('uses only the guilds intent without connecting', async () => {
    const client = createDiscordClient();
    expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
    expect(client.options.intents.has(GatewayIntentBits.GuildMembers)).toBe(false);
    expect(client.options.intents.has(GatewayIntentBits.MessageContent)).toBe(false);
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
    expect(interaction.replies).toEqual([
      {
        content: 'The command could not be completed. Please try again later.',
        ephemeral: true,
      },
    ]);
    expect(JSON.stringify(interaction.replies)).not.toContain('private database detail');
  });

  it('follows up safely after the interaction was deferred', async () => {
    const logger = new MemoryLogger();
    const registry = new CommandRegistry([
      command(
        'alpha',
        vi.fn(() => Promise.reject(new Error('private detail'))),
      ),
    ]);
    const interaction = new FakeInteraction('alpha', false, true);
    await handleInteractionCreate(interaction, registry, context(logger), logger);
    expect(interaction.replies).toEqual([]);
    expect(interaction.followUps).toHaveLength(1);
    expect(JSON.stringify(interaction.followUps)).not.toContain('private detail');
  });
});
