import type { PrismaClient } from '@prisma/client';

import { AuthorizationError, ConfigurationError } from '../domain/errors.js';
import { GuildRepository } from '../repositories/guild-repository.js';

export type CommandChannelCategory = 'DUAL' | 'STAFF_ONLY';

export interface ValidateChannelPolicyInput {
  discordGuildId: string;
  channelId: string;
  commandName: string;
  subcommand?: string | null | undefined;
  hasAdministratorPermission?: boolean;
}

export class CommandChannelPolicyService {
  public constructor(private readonly database: PrismaClient) {}

  public getCategory(commandName: string, subcommand?: string | null): CommandChannelCategory {
    if (
      commandName === 'health' ||
      commandName === 'roster' ||
      commandName === 'offer' ||
      (commandName === 'team' && subcommand === 'list') ||
      (commandName === 'staff' && subcommand === 'list') ||
      (commandName === 'limit' && subcommand === 'view')
    ) {
      return 'DUAL';
    }

    return 'STAFF_ONLY';
  }

  public async validateChannelPolicy(input: ValidateChannelPolicyInput): Promise<void> {
    const category = this.getCategory(input.commandName, input.subcommand);
    const guild = await new GuildRepository(this.database).getByDiscordGuildId(
      input.discordGuildId,
    );

    const settings =
      guild === null ? null : await new GuildRepository(this.database).getSettings(guild.id);

    if (input.commandName === 'health') {
      if (guild === null || settings === null) {
        return;
      }
      const allowedChannels: string[] = [];
      if (settings.botCommandsChannelId) allowedChannels.push(settings.botCommandsChannelId);
      if (settings.staffChannelId) allowedChannels.push(settings.staffChannelId);
      if (allowedChannels.length === 0 || allowedChannels.includes(input.channelId)) {
        return;
      }
      const channelMentionStr = allowedChannels.map((id) => `<#${id}>`).join(' or ');
      throw new ConfigurationError(`This command can only be used in ${channelMentionStr}.`);
    }

    if (input.commandName === 'setup') {
      const staffChannelId = settings?.staffChannelId;
      if (!staffChannelId) {
        // Bootstrap exception: before staff channel exists, Discord Administrator can bootstrap setup
        if (input.hasAdministratorPermission ?? true) {
          return;
        }
        throw new AuthorizationError(
          'You need the configured bot permissions role to use this command.',
        );
      }
      if (input.channelId !== staffChannelId) {
        throw new ConfigurationError(`This command can only be used in <#${staffChannelId}>.`);
      }
      return;
    }

    if (guild === null || settings === null) {
      throw new ConfigurationError('A user with bot permissions must run /setup league first.');
    }

    if (category === 'STAFF_ONLY') {
      const staffChannelId = settings.staffChannelId;
      if (!staffChannelId) {
        throw new ConfigurationError(
          'The staff channel has not been configured yet. Please ask an admin to configure it using /setup channels.',
        );
      }
      if (input.channelId !== staffChannelId) {
        throw new ConfigurationError(`This command can only be used in <#${staffChannelId}>.`);
      }
      return;
    }

    if (category === 'DUAL') {
      const allowedChannels: string[] = [];
      if (settings.botCommandsChannelId) allowedChannels.push(settings.botCommandsChannelId);
      if (settings.staffChannelId) allowedChannels.push(settings.staffChannelId);

      if (allowedChannels.length === 0) {
        throw new ConfigurationError(
          'The bot commands channel has not been configured yet. Please ask an admin to configure it using /setup channels.',
        );
      }

      if (!allowedChannels.includes(input.channelId)) {
        const channelMentionStr = allowedChannels.map((id) => `<#${id}>`).join(' or ');
        throw new ConfigurationError(`This command can only be used in ${channelMentionStr}.`);
      }
    }
  }
}
