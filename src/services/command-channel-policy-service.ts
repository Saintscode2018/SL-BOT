import type { PrismaClient } from '@prisma/client';

import {
  AdministrativePermissionDeniedError,
  AdministrativeWrongChannelError,
  BotCommandsChannelNotConfiguredError,
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
  subcommandGroup?: string | null | undefined;
}

export class CommandChannelPolicyService {
  public constructor(private readonly database: PrismaClient) {}

  public getScope(
    commandName: string,
    subcommand?: string | null,
    subcommandGroup?: string | null,
  ): CommandChannelScope {
    if (
      commandName === 'health' ||
      commandName === 'demand' ||
      commandName === 'release' ||
      commandName === 'promote' ||
      commandName === 'demote' ||
      commandName === 'offer' ||
      (commandName === 'roster' && subcommand === 'view') ||
      (commandName === 'team' && subcommand === 'list') ||
      (commandName === 'staff' && subcommand === 'list') ||
      (commandName === 'limit' && subcommand === 'view') ||
      (commandName === 'setup' &&
        (subcommandGroup === 'botperm' ||
          subcommandGroup === 'botpermadmin' ||
          subcommandGroup === 'modrole') &&
        subcommand === 'view')
    ) {
      return 'BOT_OR_STAFF';
    }
    return 'STAFF_ONLY';
  }

  public async validateChannelPolicy(input: ValidateChannelPolicyInput): Promise<void> {
    const scope = this.getScope(input.commandName, input.subcommand, input.subcommandGroup);
    const guilds = new GuildRepository(this.database);
    const guild = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
    const settings = guild === null ? null : await guilds.getSettings(guild.id);

    const authorization = new AuthorizationService(this.database);
    const globalKind = await authorization.getGlobalAuthorizationKind(input.authorization);
    const globallyAuthorized = globalKind !== null;
    const hasAnyBotPermissions = await authorization.hasAnyBotPermissions(
      input.authorization.discordGuildId,
    );
    const isBootstrapSetupMutation =
      input.commandName === 'setup' &&
      input.authorization.hasAdministratorPermission &&
      !hasAnyBotPermissions &&
      ((input.subcommandGroup === null || input.subcommandGroup === undefined) &&
      (input.subcommand === 'league' || input.subcommand === 'channels')
        ? true
        : input.subcommandGroup === 'botperm' && input.subcommand === 'add');

    if (input.commandName === 'debugreset') {
      if (!globallyAuthorized) throw new AdministrativePermissionDeniedError();
      if (!settings?.staffChannelId) return;
      if (input.channelId !== settings.staffChannelId) {
        throw new AdministrativeWrongChannelError(settings.staffChannelId);
      }
      return;
    }

    if (scope === 'STAFF_ONLY') {
      if (!globallyAuthorized && !isBootstrapSetupMutation) {
        throw new AdministrativePermissionDeniedError();
      }

      if (input.commandName === 'setup' && !settings?.staffChannelId) {
        if (globallyAuthorized || input.subcommand === 'league' || input.subcommand === 'channels')
          return;
        throw new StaffChannelNotConfiguredError();
      }

      if (guild === null || settings === null) throw new LeagueSetupRequiredError();
      if (!settings.staffChannelId) throw new StaffChannelNotConfiguredError();
      if (input.channelId !== settings.staffChannelId) {
        throw new AdministrativeWrongChannelError(settings.staffChannelId);
      }
      return;
    }

    if (
      input.commandName === 'setup' &&
      (input.subcommandGroup === 'botperm' ||
        input.subcommandGroup === 'botpermadmin' ||
        input.subcommandGroup === 'modrole') &&
      !globallyAuthorized
    ) {
      throw new AdministrativePermissionDeniedError();
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
