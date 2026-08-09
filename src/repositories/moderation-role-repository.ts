import type { ModerationRole } from '@prisma/client';

import type { DatabaseClient } from '../domain/types.js';
import { discordSnowflakeSchema } from '../domain/validation.js';
import { translateDatabaseError } from './repository-errors.js';

export interface CreateModerationRoleInput {
  guildId: string;
  discordRoleId: string;
  createdByUserId: string;
}

export class ModerationRoleRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async getForGuildRole(
    guildId: string,
    discordRoleId: string,
  ): Promise<ModerationRole | null> {
    return this.db.moderationRole.findUnique({
      where: {
        guildId_discordRoleId: {
          guildId,
          discordRoleId: discordSnowflakeSchema.parse(discordRoleId),
        },
      },
    });
  }

  public async hasAnyForDiscordGuild(
    discordGuildId: string,
    memberRoleIds: readonly string[],
  ): Promise<boolean> {
    const roleIds = [...new Set(memberRoleIds)].map((roleId) =>
      discordSnowflakeSchema.parse(roleId),
    );
    if (roleIds.length === 0) return false;
    return (
      (await this.db.moderationRole.findFirst({
        where: {
          guild: { discordGuildId: discordSnowflakeSchema.parse(discordGuildId) },
          discordRoleId: { in: roleIds },
        },
        select: { id: true },
      })) !== null
    );
  }

  public async listForGuild(guildId: string): Promise<ModerationRole[]> {
    return this.db.moderationRole.findMany({
      where: { guildId },
      orderBy: [{ discordRoleId: 'asc' }],
    });
  }

  public async create(input: CreateModerationRoleInput): Promise<ModerationRole> {
    try {
      return await this.db.moderationRole.create({
        data: {
          guildId: input.guildId,
          discordRoleId: discordSnowflakeSchema.parse(input.discordRoleId),
          createdByUserId: input.createdByUserId,
        },
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'create moderation role');
    }
  }

  public async delete(id: string): Promise<ModerationRole> {
    try {
      return await this.db.moderationRole.delete({ where: { id } });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'delete moderation role');
    }
  }
}
