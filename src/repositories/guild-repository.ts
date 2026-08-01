import type { Guild, GuildSettings, Prisma } from '@prisma/client';

import { EntityNotFoundError } from '../domain/errors.js';
import type { DatabaseClient } from '../domain/types.js';
import { discordSnowflakeSchema } from '../domain/validation.js';
import { translateDatabaseError } from './repository-errors.js';

export interface CreateGuildInput {
  discordGuildId: string;
  name: string;
}

export interface UpsertGuildSettingsInput {
  botCommandsChannelId?: string | null;
  staffChannelId?: string | null;
  transferChannelId?: string | null;
  auditChannelId?: string | null;
  botPermissionsRoleId?: string | null;
  teamManagerRoleId?: string | null;
  assistantManagerRoleId?: string | null;
  playerManagerRoleId?: string | null;
  defaultSquadLimit?: number;
  offerTimeoutSeconds?: number;
}

function settingsData(
  input: UpsertGuildSettingsInput,
): Omit<Prisma.GuildSettingsUncheckedCreateInput, 'guildId'> {
  const data: Omit<Prisma.GuildSettingsUncheckedCreateInput, 'guildId'> = {};
  const snowflakeFields = [
    'botCommandsChannelId',
    'staffChannelId',
    'transferChannelId',
    'auditChannelId',
    'botPermissionsRoleId',
    'teamManagerRoleId',
    'assistantManagerRoleId',
    'playerManagerRoleId',
  ] as const;
  for (const field of snowflakeFields) {
    const value = input[field];
    if (value !== undefined) {
      data[field] = value === null ? null : discordSnowflakeSchema.parse(value);
    }
  }
  if (input.defaultSquadLimit !== undefined) {
    data.defaultSquadLimit = input.defaultSquadLimit;
  }
  if (input.offerTimeoutSeconds !== undefined) {
    data.offerTimeoutSeconds = input.offerTimeoutSeconds;
  }
  return data;
}

export class GuildRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async create(input: CreateGuildInput): Promise<Guild> {
    try {
      return await this.db.guild.create({
        data: {
          discordGuildId: discordSnowflakeSchema.parse(input.discordGuildId),
          name: input.name,
        },
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'create guild');
    }
  }

  public async upsertByDiscordGuildId(input: CreateGuildInput): Promise<Guild> {
    try {
      return await this.db.guild.upsert({
        where: { discordGuildId: discordSnowflakeSchema.parse(input.discordGuildId) },
        create: {
          discordGuildId: input.discordGuildId,
          name: input.name,
        },
        update: { name: input.name },
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'save guild');
    }
  }

  public async getById(id: string): Promise<Guild | null> {
    return this.db.guild.findUnique({ where: { id } });
  }

  public async getByDiscordGuildId(discordGuildId: string): Promise<Guild | null> {
    return this.db.guild.findUnique({
      where: { discordGuildId: discordSnowflakeSchema.parse(discordGuildId) },
    });
  }

  public async upsertSettings(
    guildId: string,
    input: UpsertGuildSettingsInput,
  ): Promise<GuildSettings> {
    const data = settingsData(input);
    try {
      return await this.db.guildSettings.upsert({
        where: { guildId },
        create: { ...data, guildId },
        update: data,
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'save guild settings');
    }
  }

  public async getSettings(guildId: string): Promise<GuildSettings | null> {
    return this.db.guildSettings.findUnique({ where: { guildId } });
  }

  public async requireById(id: string): Promise<Guild> {
    const guild = await this.getById(id);
    if (guild === null) {
      throw new EntityNotFoundError(`guild ${id} was not found`);
    }
    return guild;
  }
}
