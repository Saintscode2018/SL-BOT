import type { Club, Guild, GuildSettings } from '@prisma/client';

import { GuildConfigurationNotFoundError } from '../domain/errors.js';
import type { ClubRepository } from '../repositories/club-repository.js';
import type { GuildRepository } from '../repositories/guild-repository.js';

export interface GuildConfiguration {
  guild: Guild;
  settings: GuildSettings;
  activeClubs: Club[];
}

export class GuildConfigurationService {
  public constructor(
    private readonly guilds: GuildRepository,
    private readonly clubs: ClubRepository,
  ) {}

  public async load(discordGuildId: string): Promise<GuildConfiguration> {
    const guild = await this.guilds.getByDiscordGuildId(discordGuildId);
    if (guild === null) {
      throw new GuildConfigurationNotFoundError(
        'guild',
        `guild ${discordGuildId} is not configured`,
      );
    }
    const settings = await this.guilds.getSettings(guild.id);
    if (settings === null) {
      throw new GuildConfigurationNotFoundError(
        'settings',
        `settings for guild ${guild.id} are not configured`,
      );
    }
    const activeClubs = await this.clubs.listActive(guild.id);
    return { guild, settings, activeClubs };
  }
}
