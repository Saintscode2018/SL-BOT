import type { Guild, GuildSettings, PrismaClient } from '@prisma/client';

import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { ConfigurationError } from '../domain/errors.js';
import {
  requireValidTeamBannerConfig,
  teamBannerConfigFrom,
  type TeamBannerConfig,
} from '../domain/team-label.js';

export const guildConfiguredAuditEventType = 'guild.configured';
export const bannerConfiguredAuditEventType = 'guild.banner_configured';

export interface SetupGuildInput {
  authorization: AuthorizationInput;
  guildName: string;
  transferChannelId?: string;
  auditChannelId?: string;
  botCommandsChannelId?: string;
  staffChannelId?: string;
  botPermissionsRoleId?: string;
  teamManagerRoleId?: string;
  assistantManagerRoleId?: string;
  playerManagerRoleId?: string;
  offerTimeoutSeconds?: number;
}

export interface SetupChannelsInput {
  authorization: AuthorizationInput;
  guildName: string;
  botCommandsChannelId: string;
  staffChannelId: string;
  transferChannelId: string;
  auditChannelId: string;
}

export interface SetupRolesInput {
  authorization: AuthorizationInput;
  guildName: string;
  botPermissionsRoleId: string;
  teamManagerRoleId: string;
  assistantManagerRoleId: string;
  playerManagerRoleId: string;
}

export interface GuildSetupResult {
  guild: Guild;
  settings: GuildSettings;
  created: boolean;
}

export interface BannerConfigurationInput extends TeamBannerConfig {
  authorization: AuthorizationInput;
}

export interface BannerConfigurationResult {
  guild: Guild;
  settings: GuildSettings;
  before: TeamBannerConfig;
  after: TeamBannerConfig;
}

export interface SetupViewResult {
  guildName: string;
  channels: {
    botCommandsChannelId: string | null;
    staffChannelId: string | null;
    transferChannelId: string | null;
    auditChannelId: string | null;
  };
  roles: {
    botPermissionsRoleId: string | null;
    teamManagerRoleId: string | null;
    assistantManagerRoleId: string | null;
    playerManagerRoleId: string | null;
  };
  defaultSquadLimit: number;
  offerTimeoutMinutes: number;
  banner: TeamBannerConfig;
  missingConfigurations: string[];
}

export class GuildSetupService {
  public constructor(private readonly database: PrismaClient) {}

  public async setupGuildOnly(input: {
    authorization: AuthorizationInput;
    guildName: string;
    offerTimeoutSeconds?: number;
  }): Promise<GuildSetupResult> {
    await new AuthorizationService(this.database).assertCanSetup(input.authorization);
    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      const existing = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const guild = await guilds.upsertByDiscordGuildId({
        discordGuildId: input.authorization.discordGuildId,
        name: input.guildName,
      });
      const previousSettings = await guilds.getSettings(guild.id);
      const settings = await guilds.upsertSettings(guild.id, {
        ...(input.offerTimeoutSeconds === undefined
          ? {}
          : { offerTimeoutSeconds: input.offerTimeoutSeconds }),
      });
      await new AuditEventRepository(transaction).create({
        guildId: guild.id,
        actorUserId: actor.id,
        eventType: guildConfiguredAuditEventType,
        entityType: 'guild_settings',
        entityId: settings.id,
        beforeState:
          previousSettings === null
            ? { configured: false }
            : {
                offerTimeoutSeconds: previousSettings.offerTimeoutSeconds,
              },
        afterState: {
          configured: true,
          offerTimeoutSeconds: settings.offerTimeoutSeconds,
        },
      });
      return { guild, settings, created: existing === null };
    });
  }

  public async setupChannels(input: SetupChannelsInput): Promise<GuildSetupResult> {
    await new AuthorizationService(this.database).assertCanSetup(input.authorization);
    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      const existing = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const guild = await guilds.upsertByDiscordGuildId({
        discordGuildId: input.authorization.discordGuildId,
        name: input.guildName,
      });
      const previousSettings = await guilds.getSettings(guild.id);
      const settings = await guilds.upsertSettings(guild.id, {
        botCommandsChannelId: input.botCommandsChannelId,
        staffChannelId: input.staffChannelId,
        transferChannelId: input.transferChannelId,
        auditChannelId: input.auditChannelId,
      });
      await new AuditEventRepository(transaction).create({
        guildId: guild.id,
        actorUserId: actor.id,
        eventType: 'guild.channels_configured',
        entityType: 'guild_settings',
        entityId: settings.id,
        beforeState:
          previousSettings === null
            ? {}
            : {
                botCommandsChannelId: previousSettings.botCommandsChannelId,
                staffChannelId: previousSettings.staffChannelId,
                transferChannelId: previousSettings.transferChannelId,
                auditChannelId: previousSettings.auditChannelId,
              },
        afterState: {
          botCommandsChannelId: settings.botCommandsChannelId,
          staffChannelId: settings.staffChannelId,
          transferChannelId: settings.transferChannelId,
          auditChannelId: settings.auditChannelId,
        },
      });
      return { guild, settings, created: existing === null };
    });
  }

  public async setupRoles(input: SetupRolesInput): Promise<GuildSetupResult> {
    await new AuthorizationService(this.database).assertCanSetup(input.authorization);
    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      const existing = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const guild = await guilds.upsertByDiscordGuildId({
        discordGuildId: input.authorization.discordGuildId,
        name: input.guildName,
      });
      const previousSettings = await guilds.getSettings(guild.id);
      const settings = await guilds.upsertSettings(guild.id, {
        botPermissionsRoleId: input.botPermissionsRoleId,
        teamManagerRoleId: input.teamManagerRoleId,
        assistantManagerRoleId: input.assistantManagerRoleId,
        playerManagerRoleId: input.playerManagerRoleId,
      });
      await new AuditEventRepository(transaction).create({
        guildId: guild.id,
        actorUserId: actor.id,
        eventType: 'guild.roles_configured',
        entityType: 'guild_settings',
        entityId: settings.id,
        beforeState:
          previousSettings === null
            ? {}
            : {
                botPermissionsRoleId: previousSettings.botPermissionsRoleId,
                teamManagerRoleId: previousSettings.teamManagerRoleId,
                assistantManagerRoleId: previousSettings.assistantManagerRoleId,
                playerManagerRoleId: previousSettings.playerManagerRoleId,
              },
        afterState: {
          botPermissionsRoleId: settings.botPermissionsRoleId,
          teamManagerRoleId: settings.teamManagerRoleId,
          assistantManagerRoleId: settings.assistantManagerRoleId,
          playerManagerRoleId: settings.playerManagerRoleId,
        },
      });
      return { guild, settings, created: existing === null };
    });
  }

  public async updateBannerConfiguration(
    input: BannerConfigurationInput,
  ): Promise<BannerConfigurationResult> {
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(input.authorization);
    const requested = requireValidTeamBannerConfig(teamBannerConfigFrom(input));

    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      const previousSettings = await guilds.getSettings(authorization.guild.id);
      if (previousSettings === null) throw new ConfigurationError('league settings are missing');
      const before = teamBannerConfigFrom(previousSettings);
      const settings = await guilds.upsertSettings(authorization.guild.id, requested);
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const after = teamBannerConfigFrom(settings);
      await new AuditEventRepository(transaction).create({
        guildId: authorization.guild.id,
        actorUserId: actor.id,
        eventType: bannerConfiguredAuditEventType,
        entityType: 'guild_settings',
        entityId: settings.id,
        beforeState: { ...before },
        afterState: { ...after },
      });
      return { guild: authorization.guild, settings, before, after };
    });
  }

  public async setup(input: SetupGuildInput): Promise<GuildSetupResult> {
    await new AuthorizationService(this.database).assertCanSetup(input.authorization);
    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      const existing = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const guild = await guilds.upsertByDiscordGuildId({
        discordGuildId: input.authorization.discordGuildId,
        name: input.guildName,
      });
      const previousSettings = await guilds.getSettings(guild.id);
      const settings = await guilds.upsertSettings(guild.id, {
        ...(input.botCommandsChannelId !== undefined
          ? { botCommandsChannelId: input.botCommandsChannelId }
          : {}),
        ...(input.staffChannelId !== undefined ? { staffChannelId: input.staffChannelId } : {}),
        ...(input.transferChannelId !== undefined
          ? { transferChannelId: input.transferChannelId }
          : {}),
        ...(input.auditChannelId !== undefined ? { auditChannelId: input.auditChannelId } : {}),
        ...(input.botPermissionsRoleId !== undefined
          ? { botPermissionsRoleId: input.botPermissionsRoleId }
          : {}),
        ...(input.teamManagerRoleId !== undefined
          ? { teamManagerRoleId: input.teamManagerRoleId }
          : {}),
        ...(input.assistantManagerRoleId !== undefined
          ? { assistantManagerRoleId: input.assistantManagerRoleId }
          : {}),
        ...(input.playerManagerRoleId !== undefined
          ? { playerManagerRoleId: input.playerManagerRoleId }
          : {}),
        ...(input.offerTimeoutSeconds === undefined
          ? {}
          : { offerTimeoutSeconds: input.offerTimeoutSeconds }),
      });
      await new AuditEventRepository(transaction).create({
        guildId: guild.id,
        actorUserId: actor.id,
        eventType: guildConfiguredAuditEventType,
        entityType: 'guild_settings',
        entityId: settings.id,
        beforeState:
          previousSettings === null
            ? { configured: false }
            : {
                transferChannelId: previousSettings.transferChannelId,
                auditChannelId: previousSettings.auditChannelId,
                botPermissionsRoleId: previousSettings.botPermissionsRoleId,
              },
        afterState: {
          configured: true,
          transferChannelId: settings.transferChannelId,
          auditChannelId: settings.auditChannelId,
          botPermissionsRoleId: settings.botPermissionsRoleId,
          offerTimeoutSeconds: settings.offerTimeoutSeconds,
        },
      });
      return { guild, settings, created: existing === null };
    });
  }

  public async getView(discordGuildId: string): Promise<SetupViewResult> {
    const guilds = new GuildRepository(this.database);
    const guild = await guilds.getByDiscordGuildId(discordGuildId);
    if (guild === null) {
      throw new ConfigurationError('league has not been setup yet');
    }
    const settings = await guilds.getSettings(guild.id);
    const missing: string[] = [];

    if (!settings?.botCommandsChannelId) missing.push('Bot Commands Channel');
    if (!settings?.staffChannelId) missing.push('Staff Channel');
    if (!settings?.transferChannelId) missing.push('Transfer Channel');
    if (!settings?.auditChannelId) missing.push('Audit Channel');
    if (!settings?.botPermissionsRoleId) missing.push('Bot Permissions Role');
    if (!settings?.teamManagerRoleId) missing.push('Team Manager Role');
    if (!settings?.assistantManagerRoleId) missing.push('Assistant Manager Role');
    if (!settings?.playerManagerRoleId) missing.push('Player Manager Role');

    return {
      guildName: guild.name,
      channels: {
        botCommandsChannelId: settings?.botCommandsChannelId ?? null,
        staffChannelId: settings?.staffChannelId ?? null,
        transferChannelId: settings?.transferChannelId ?? null,
        auditChannelId: settings?.auditChannelId ?? null,
      },
      roles: {
        botPermissionsRoleId: settings?.botPermissionsRoleId ?? null,
        teamManagerRoleId: settings?.teamManagerRoleId ?? null,
        assistantManagerRoleId: settings?.assistantManagerRoleId ?? null,
        playerManagerRoleId: settings?.playerManagerRoleId ?? null,
      },
      defaultSquadLimit: settings?.defaultSquadLimit ?? 17,
      offerTimeoutMinutes: Math.round((settings?.offerTimeoutSeconds ?? 86400) / 60),
      banner: teamBannerConfigFrom(settings),
      missingConfigurations: missing,
    };
  }
}
