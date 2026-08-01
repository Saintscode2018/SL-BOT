import type { Guild, GuildSettings } from '@prisma/client';

import { AuthorizationError, GuildNotConfiguredError } from '../domain/errors.js';
import type { DatabaseClient } from '../domain/types.js';
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
  kind: 'owner' | 'administrator' | 'league_admin' | 'club_staff';
}

export type GlobalAuthorizationKind = 'owner' | 'administrator' | 'league_admin';

export class AuthorizationService {
  public constructor(private readonly database: DatabaseClient) {}

  public async getGlobalAuthorizationKind(
    input: AuthorizationInput,
  ): Promise<GlobalAuthorizationKind | null> {
    if (input.discordUserId === input.guildOwnerId) return 'owner';
    if (input.hasAdministratorPermission) return 'administrator';

    const guilds = new GuildRepository(this.database);
    const guild = await guilds.getByDiscordGuildId(input.discordGuildId);
    if (guild === null) return null;
    const settings = await guilds.getSettings(guild.id);
    if (
      settings?.botPermissionsRoleId !== null &&
      settings?.botPermissionsRoleId !== undefined &&
      input.memberRoleIds.includes(settings.botPermissionsRoleId)
    ) {
      return 'league_admin';
    }
    return null;
  }

  public async assertCanSetup(input: AuthorizationInput): Promise<void> {
    if ((await this.getGlobalAuthorizationKind(input)) !== null) return;
    throw new AuthorizationError(
      'You need the configured bot permissions role to use this command.',
    );
  }

  public async authorizeLeagueAdministration(
    input: AuthorizationInput,
  ): Promise<AuthorizationResult> {
    const configuration = await this.loadConfiguration(input.discordGuildId);
    const kind = await this.getGlobalAuthorizationKind(input);
    if (kind !== null) return { ...configuration, kind };
    throw new AuthorizationError(
      'You need the configured bot permissions role to use this command.',
    );
  }

  public async authorizeClubAction(
    input: AuthorizationInput,
    clubId: string,
  ): Promise<AuthorizationResult> {
    const configuration = await this.loadConfiguration(input.discordGuildId);
    if (input.discordUserId === input.guildOwnerId) {
      return { ...configuration, kind: 'owner' };
    }
    if (input.hasAdministratorPermission) {
      return { ...configuration, kind: 'administrator' };
    }
    if (
      configuration.settings.botPermissionsRoleId !== null &&
      input.memberRoleIds.includes(configuration.settings.botPermissionsRoleId)
    ) {
      return { ...configuration, kind: 'league_admin' };
    }
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
