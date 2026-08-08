import { Prisma, type BotPermission, type LeagueUser } from '@prisma/client';

import { botPermissionLevelSchema, type BotPermissionLevel } from '../domain/enums.js';
import type { DatabaseClient } from '../domain/types.js';
import { translateDatabaseError } from './repository-errors.js';

export type BotPermissionWithUser = BotPermission & { user: LeagueUser };

export interface CreateBotPermissionInput {
  guildId: string;
  userId: string;
  level: BotPermissionLevel;
  grantedByUserId: string;
}

export class BotPermissionRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async countForGuild(guildId: string): Promise<number> {
    return this.db.botPermission.count({ where: { guildId } });
  }

  public async getForGuildUser(guildId: string, userId: string): Promise<BotPermission | null> {
    return this.db.botPermission.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
  }

  public async getForDiscordIdentity(
    discordGuildId: string,
    discordUserId: string,
  ): Promise<BotPermission | null> {
    return this.db.botPermission.findFirst({
      where: {
        guild: { discordGuildId },
        user: { discordUserId },
      },
    });
  }

  public async listForGuild(guildId: string): Promise<BotPermissionWithUser[]> {
    return this.db.botPermission.findMany({
      where: { guildId },
      include: { user: true },
      orderBy: [{ level: 'asc' }, { user: { discordUserId: 'asc' } }],
    });
  }

  public async create(input: CreateBotPermissionInput): Promise<BotPermission> {
    try {
      return await this.db.botPermission.create({
        data: {
          guildId: input.guildId,
          userId: input.userId,
          level: botPermissionLevelSchema.parse(input.level),
          grantedByUserId: input.grantedByUserId,
        },
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'create bot permission');
    }
  }

  public async updateLevel(
    id: string,
    level: BotPermissionLevel,
    grantedByUserId: string,
  ): Promise<BotPermission> {
    try {
      return await this.db.botPermission.update({
        where: { id },
        data: {
          level: botPermissionLevelSchema.parse(level),
          grantedByUserId,
        },
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'update bot permission');
    }
  }

  public async delete(id: string): Promise<BotPermission> {
    try {
      return await this.db.botPermission.delete({ where: { id } });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'delete bot permission');
    }
  }

  public async deleteStandardIfAnotherPermissionExists(
    id: string,
    guildId: string,
  ): Promise<boolean> {
    try {
      const deleted = await this.db.$executeRaw(
        Prisma.sql`
          DELETE FROM "BotPermission"
          WHERE "id" = ${id}
            AND "guildId" = ${guildId}
            AND "level" = 'BOTPERM'
            AND (SELECT COUNT(*) FROM "BotPermission" WHERE "guildId" = ${guildId}) > 1
        `,
      );
      return deleted === 1;
    } catch (error: unknown) {
      return translateDatabaseError(error, 'delete bot permission');
    }
  }
}
