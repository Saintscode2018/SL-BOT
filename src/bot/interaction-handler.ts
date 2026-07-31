import type { ChatInputCommandInteraction, Interaction } from 'discord.js';

import type { Logger } from '../logging/logger.js';
import type { CommandRegistry } from './command-registry.js';
import type { CommandContext, CommandInteraction, SafeInteractionResponse } from './types.js';

class DiscordCommandInteraction implements CommandInteraction {
  public constructor(private readonly interaction: ChatInputCommandInteraction) {}

  public get commandName(): string {
    return this.interaction.commandName;
  }

  public get replied(): boolean {
    return this.interaction.replied;
  }

  public get deferred(): boolean {
    return this.interaction.deferred;
  }

  public async reply(response: SafeInteractionResponse): Promise<void> {
    await this.interaction.reply(response);
  }

  public async followUp(response: SafeInteractionResponse): Promise<void> {
    await this.interaction.followUp(response);
  }
}

export async function handleInteractionCreate(
  interaction: CommandInteraction | null,
  registry: CommandRegistry,
  context: CommandContext,
  logger: Logger,
): Promise<void> {
  if (interaction === null) return;
  const command = registry.resolve(interaction.commandName);
  if (command === null) {
    logger.warn('unknown command received', { commandName: interaction.commandName });
    return;
  }

  try {
    await command.execute(interaction, context);
  } catch (error: unknown) {
    logger.error('command execution failed', error, { commandName: interaction.commandName });
    const response = {
      content: 'The command could not be completed. Please try again later.',
      ephemeral: true,
    } as const;
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    } catch (responseError: unknown) {
      logger.warn('command failure response could not be sent', {
        commandName: interaction.commandName,
        error: responseError,
      });
    }
  }
}

export function createInteractionCreateHandler(
  registry: CommandRegistry,
  context: CommandContext,
  logger: Logger,
): (interaction: Interaction) => Promise<void> {
  return async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    await handleInteractionCreate(
      new DiscordCommandInteraction(interaction),
      registry,
      context,
      logger,
    );
  };
}
