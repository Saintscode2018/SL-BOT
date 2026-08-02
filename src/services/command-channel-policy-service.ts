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

export type CommandChannelScope = 'BOT_OR_STAFF' | 'STAFF_ONLY';

export interface ValidateChannelPolicyInput {
  authorization: AuthorizationInput;
  channelId: string;
  commandName: string;
  subcommand?: string | null | undefined;
}

export class CommandChannelPolicyService {
  public constructor(private readonly database: PrismaClient) {}

  public getScope(commandName: string, subcommand?: string | null): CommandChannelScope {
    if (
      commandName === 'health' ||
      commandName === 'demand' ||
      commandName === 'release' ||
      commandName === 'offer' ||
      commandName === 'roster' ||
      (commandName === 'team' && subcommand === 'list') ||
      (commandName === 'staff' && subcommand === 'list') ||
      (commandName === 'limit' && subcommand === 'view')
    ) {
      return 'BOT_OR_STAFF';
    }
    return 'STAFF_ONLY';
  }

  public async validateChannelPolicy(input: ValidateChannelPolicyInput): Promise<void> {
    const scope = this.getScope(input.commandName, input.subcommand);
    const guilds = new GuildRepository(this.database);
    const guild = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
    const settings = guild === null ? null : await guilds.getSettings(guild.id);

    const globalKind = await new AuthorizationService(this.database).getGlobalAuthorizationKind(
      input.authorization,
    );
    const globallyAuthorized = globalKind !== null;

    if (input.commandName === 'debugreset') {
      if (!input.authorization.hasAdministratorPermission) {
        throw new DebugAdministratorPermissionRequiredError();
      }
      if (!settings?.staffChannelId) return;
      if (input.channelId !== settings.staffChannelId) {
        throw new AdministrativeWrongChannelError(settings.staffChannelId);
      }
      return;
    }

    if (scope === 'STAFF_ONLY') {
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

    const allowedChannels = [botCommandsChannelId, staffChannelId].filter(
      (channelId): channelId is string => channelId !== null,
    );
    if (allowedChannels.includes(input.channelId)) return;

    if (globallyAuthorized && allowedChannels.length > 0) {
      throw new WrongCommandChannelError(allowedChannels, 'global');
    }
    if (botCommandsChannelId) {
      throw new WrongCommandChannelError([botCommandsChannelId], 'bot_or_staff');
    }
    throw new BotCommandsChannelNotConfiguredError();
  }
}
