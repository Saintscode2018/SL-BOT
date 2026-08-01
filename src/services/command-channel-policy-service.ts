import type { PrismaClient } from '@prisma/client';

import {
  AdministrativePermissionDeniedError,
  AdministrativeWrongChannelError,
  BotCommandsChannelNotConfiguredError,
  DebugAdministratorPermissionRequiredError,
  LeagueSetupRequiredError,
  StaffChannelNotConfiguredError,
  WrongCommandChannelError,
} from '../domain/errors.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';

export type CommandChannelCategory = 'ADMINISTRATIVE' | 'DEBUG' | 'INFORMATIONAL' | 'TEAM_STAFF';

export interface ValidateChannelPolicyInput {
  authorization: AuthorizationInput;
  channelId: string;
  commandName: string;
  subcommand?: string | null | undefined;
}

export class CommandChannelPolicyService {
  public constructor(private readonly database: PrismaClient) {}

  public getCategory(commandName: string, subcommand?: string | null): CommandChannelCategory {
    if (commandName === 'debugreset') return 'DEBUG';
    if (commandName === 'offer') return 'TEAM_STAFF';
    if (
      commandName === 'health' ||
      commandName === 'roster' ||
      (commandName === 'team' && subcommand === 'list') ||
      (commandName === 'staff' && subcommand === 'list') ||
      (commandName === 'limit' && subcommand === 'view')
    ) {
      return 'INFORMATIONAL';
    }
    return 'ADMINISTRATIVE';
  }

  public async validateChannelPolicy(input: ValidateChannelPolicyInput): Promise<void> {
    const category = this.getCategory(input.commandName, input.subcommand);
    const guilds = new GuildRepository(this.database);
    const guild = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
    const settings = guild === null ? null : await guilds.getSettings(guild.id);
    const globalKind = await new AuthorizationService(this.database).getGlobalAuthorizationKind(
      input.authorization,
    );
    const globallyAuthorized = globalKind !== null;

    if (category === 'DEBUG') {
      if (!input.authorization.hasAdministratorPermission) {
        throw new DebugAdministratorPermissionRequiredError();
      }
      if (!settings?.staffChannelId) return;
      if (input.channelId !== settings.staffChannelId) {
        throw new AdministrativeWrongChannelError(settings.staffChannelId);
      }
      return;
    }

    if (category === 'ADMINISTRATIVE') {
      if (!globallyAuthorized) throw new AdministrativePermissionDeniedError();

      if (input.commandName === 'setup' && !settings?.staffChannelId) {
        if (!input.authorization.hasAdministratorPermission) {
          throw new AdministrativePermissionDeniedError();
        }
        return;
      }

      if (guild === null || settings === null) throw new LeagueSetupRequiredError();
      if (!settings.staffChannelId) throw new StaffChannelNotConfiguredError();
      if (input.channelId !== settings.staffChannelId) {
        throw new AdministrativeWrongChannelError(settings.staffChannelId);
      }
      return;
    }

    const botCommandsChannelId = settings?.botCommandsChannelId ?? null;
    const staffChannelId = settings?.staffChannelId ?? null;

    if (category === 'INFORMATIONAL') {
      if (!globallyAuthorized) {
        if (!botCommandsChannelId) throw new BotCommandsChannelNotConfiguredError();
        if (input.channelId !== botCommandsChannelId) {
          throw new WrongCommandChannelError([botCommandsChannelId], 'bot_commands');
        }
        return;
      }

      const allowedChannels = [botCommandsChannelId, staffChannelId].filter(
        (channelId): channelId is string => channelId !== null,
      );
      if (allowedChannels.length === 0) throw new BotCommandsChannelNotConfiguredError();
      if (!allowedChannels.includes(input.channelId)) {
        throw new WrongCommandChannelError(allowedChannels, 'global');
      }
      return;
    }

    const allowedTeamStaffChannels = [botCommandsChannelId, staffChannelId].filter(
      (channelId): channelId is string => channelId !== null,
    );
    if (allowedTeamStaffChannels.includes(input.channelId)) return;

    if (globallyAuthorized && allowedTeamStaffChannels.length > 0) {
      throw new WrongCommandChannelError(allowedTeamStaffChannels, 'global');
    }
    if (botCommandsChannelId) {
      throw new WrongCommandChannelError([botCommandsChannelId], 'bot_commands');
    }
    throw new BotCommandsChannelNotConfiguredError();
  }
}
