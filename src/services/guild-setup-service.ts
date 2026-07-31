import type { Guild, GuildSettings, PrismaClient } from '@prisma/client';

import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { UserRepository } from '../repositories/user-repository.js';

export const guildConfiguredAuditEventType = 'guild.configured';

export interface SetupGuildInput {
  authorization: AuthorizationInput;
  guildName: string;
  transferChannelId: string;
  auditChannelId: string;
  adminRoleId: string;
  teamManagerRoleId: string;
  assistantManagerRoleId: string;
  playerManagerRoleId: string;
  offerTimeoutSeconds?: number;
}

export interface GuildSetupResult {
  guild: Guild;
  settings: GuildSettings;
  created: boolean;
}

export class GuildSetupService {
  public constructor(private readonly database: PrismaClient) {}

  public async setup(input: SetupGuildInput): Promise<GuildSetupResult> {
    new AuthorizationService(this.database).assertCanSetup(input.authorization);
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
        transferChannelId: input.transferChannelId,
        auditChannelId: input.auditChannelId,
        adminRoleId: input.adminRoleId,
        teamManagerRoleId: input.teamManagerRoleId,
        assistantManagerRoleId: input.assistantManagerRoleId,
        playerManagerRoleId: input.playerManagerRoleId,
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
                adminRoleId: previousSettings.adminRoleId,
              },
        afterState: {
          configured: true,
          transferChannelId: settings.transferChannelId,
          auditChannelId: settings.auditChannelId,
          adminRoleId: settings.adminRoleId,
          offerTimeoutSeconds: settings.offerTimeoutSeconds,
        },
      });
      return { guild, settings, created: existing === null };
    });
  }
}
