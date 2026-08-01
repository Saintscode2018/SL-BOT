import type { PrismaClient } from '@prisma/client';

import { ConfigurationError } from '../domain/errors.js';
import { GuildRepository } from '../repositories/guild-repository.js';

export type CommandChannelCategory = 'BOT_COMMANDS' | 'STAFF' | 'ANY';

export class CommandChannelPolicyService {
  public constructor(private readonly database: PrismaClient) {}

  public getCategory(commandName: string, subcommand?: string | null): CommandChannelCategory {
    if (commandName === 'health') return 'ANY';

    if (commandName === 'roster') return 'BOT_COMMANDS';

    if (commandName === 'team') {
      if (subcommand === 'list') return 'BOT_COMMANDS';
      if (subcommand === 'add' || subcommand === 'edit') return 'STAFF';
    }

    if (commandName === 'staff') {
      if (subcommand === 'list') return 'BOT_COMMANDS';
      if (subcommand === 'appoint' || subcommand === 'remove') return 'STAFF';
    }

    if (commandName === 'limit') {
      if (subcommand === 'view') return 'BOT_COMMANDS';
      if (subcommand === 'default' || subcommand === 'team' || subcommand === 'reset')
        return 'STAFF';
    }

    if (commandName === 'setup' || commandName === 'offer') {
      return 'STAFF';
    }

    return 'STAFF';
  }

  public async validateChannelPolicy(input: {
    discordGuildId: string;
    channelId: string;
    commandName: string;
    subcommand?: string | null | undefined;
  }): Promise<void> {
    const category = this.getCategory(input.commandName, input.subcommand);
    if (category === 'ANY') return;

    const guild = await new GuildRepository(this.database).getByDiscordGuildId(
      input.discordGuildId,
    );
    if (guild === null) {
      if (input.commandName === 'setup') {
        return; // Allow setup bootstrap when guild is not yet registered
      }
      throw new ConfigurationError('server configuration was not found. Please run /setup first.');
    }

    const settings = await new GuildRepository(this.database).getSettings(guild.id);

    if (category === 'BOT_COMMANDS') {
      const requiredChannelId = settings?.botCommandsChannelId;
      if (!requiredChannelId) {
        throw new ConfigurationError(
          'the bot commands channel has not been configured yet. Please ask an admin to configure it using /setup channels.',
        );
      }
      if (input.channelId !== requiredChannelId) {
        throw new ConfigurationError(`this command can only be used in <#${requiredChannelId}>.`);
      }
      return;
    }

    if (category === 'STAFF') {
      const requiredChannelId = settings?.staffChannelId;
      if (!requiredChannelId) {
        // Bootstrap exception: if staff channel is not configured yet and command is /setup, allow bootstrap
        if (input.commandName === 'setup') {
          return;
        }
        throw new ConfigurationError(
          'the staff channel has not been configured yet. Please ask an admin to configure it using /setup channels.',
        );
      }
      if (input.channelId !== requiredChannelId) {
        throw new ConfigurationError(`this command can only be used in <#${requiredChannelId}>.`);
      }
      return;
    }
  }
}
