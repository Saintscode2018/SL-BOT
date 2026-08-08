import type { Guild, GuildSettings } from '@prisma/client';

import { botPermissionLevelSchema, type BotPermissionLevel } from '../domain/enums.js';
import { AuthorizationError, GuildNotConfiguredError } from '../domain/errors.js';
import type { DatabaseClient } from '../domain/types.js';
import { BotPermissionRepository } from '../repositories/bot-permission-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { UserRepository } from '../repositories/user-repository.js';

export interface AuthorizationInput {
  discordGuildId: string;
  discordUserId: string;
  guildOwnerId: string;
  memberRoleIds: readonly string[];
  hasAdministratorPermission: boolean;
}

export interface AuthorizationResult {
  guild: Guild;
  settings: GuildSettings;
  kind: BotPermissionLevel | 'club_staff';
}

export type GlobalAuthorizationKind = BotPermissionLevel;

export class AuthorizationService {
  public constructor(private readonly database: DatabaseClient) {}

  public async getGlobalAuthorizationKind(
    input: AuthorizationInput,
  ): Promise<GlobalAuthorizationKind | null> {
    const permission = await new BotPermissionRepository(this.database).getForDiscordIdentity(
      input.discordGuildId,
      input.discordUserId,
    );
    return permission === null ? null : botPermissionLevelSchema.parse(permission.level);
  }

  public async hasAnyBotPermissions(discordGuildId: string): Promise<boolean> {
    const guild = await new GuildRepository(this.database).getByDiscordGuildId(discordGuildId);
    if (guild === null) return false;
    return (await new BotPermissionRepository(this.database).countForGuild(guild.id)) > 0;
  }

  public async assertCanSetup(
    input: AuthorizationInput,
    options: { allowDiscordAdministratorBootstrap?: boolean } = {},
  ): Promise<void> {
    if ((await this.getGlobalAuthorizationKind(input)) !== null) return;
    if (
      options.allowDiscordAdministratorBootstrap === true &&
      input.hasAdministratorPermission &&
      !(await this.hasAnyBotPermissions(input.discordGuildId))
    ) {
      return;
    }
    throw new AuthorizationError('A database Bot Permission is required to use this command.');
  }

  public async assertCanManageBotPermissions(
    input: AuthorizationInput,
    options: { allowFirstDiscordAdministratorGrant?: boolean } = {},
  ): Promise<void> {
    await this.assertCanSetup(input, {
      allowDiscordAdministratorBootstrap: options.allowFirstDiscordAdministratorGrant === true,
    });
  }

  public async authorizeLeagueAdministration(
    input: AuthorizationInput,
  ): Promise<AuthorizationResult> {
    const configuration = await this.loadConfiguration(input.discordGuildId);
    const kind = await this.getGlobalAuthorizationKind(input);
    if (kind !== null) return { ...configuration, kind };
    throw new AuthorizationError('A database Bot Permission is required to use this command.');
  }

  public async authorizeClubAction(
    input: AuthorizationInput,
    clubId: string,
  ): Promise<AuthorizationResult> {
    const configuration = await this.loadConfiguration(input.discordGuildId);
    const globalKind = await this.getGlobalAuthorizationKind(input);
    if (globalKind !== null) return { ...configuration, kind: globalKind };

    const user = await new UserRepository(this.database).getByDiscordUserId(input.discordUserId);
    if (user !== null) {
      const membership = await new MembershipRepository(
        this.database,
      ).getActiveStaffMembershipForUser(clubId, user.id);
      if (membership !== null && membership.guildId === configuration.guild.id) {
        return { ...configuration, kind: 'club_staff' };
      }
    }
    throw new AuthorizationError('team staff permission is required');
  }

  private async loadConfiguration(
    discordGuildId: string,
  ): Promise<{ guild: Guild; settings: GuildSettings }> {
    const guilds = new GuildRepository(this.database);
    const guild = await guilds.getByDiscordGuildId(discordGuildId);
    if (guild === null) {
      throw new GuildNotConfiguredError('this server has not been configured');
    }
    const settings = await guilds.getSettings(guild.id);
    if (settings === null) {
      throw new GuildNotConfiguredError('this server has no settings');
    }
    return { guild, settings };
  }
}
