import type { Client, Guild, Role } from 'discord.js';

import { DiscordRoleUpdateFailedError } from '../domain/errors.js';
import type {
  ModerationRoleInspector,
  ModerationRoleInspection,
} from '../services/moderation-role-service.js';

export class DiscordModerationRoleInspector implements ModerationRoleInspector {
  public constructor(private readonly client: Client) {}

  public async inspectGuildRole(
    discordGuildId: string,
    discordRoleId: string,
  ): Promise<ModerationRoleInspection | null> {
    const guild = await this.fetchGuild(discordGuildId);
    const role = await this.fetchRole(guild, discordRoleId);
    return role === null ? null : { managed: role.managed };
  }

  private async fetchGuild(discordGuildId: string): Promise<Guild> {
    const cached = this.client.guilds.cache.get(discordGuildId);
    if (cached !== undefined) return cached;
    return this.client.guilds.fetch(discordGuildId).catch((error: unknown) => {
      throw new DiscordRoleUpdateFailedError({ cause: error });
    });
  }

  private async fetchRole(guild: Guild, discordRoleId: string): Promise<Role | null> {
    const cached = guild.roles.cache.get(discordRoleId);
    if (cached !== undefined) return cached;
    return guild.roles.fetch(discordRoleId).catch((error: unknown) => {
      if (discordErrorCode(error) === 10_011) return null;
      throw new DiscordRoleUpdateFailedError({ cause: error });
    });
  }
}

function discordErrorCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const parsed = Number(error.code);
  return Number.isFinite(parsed) ? parsed : null;
}
