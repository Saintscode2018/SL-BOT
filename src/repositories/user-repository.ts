import type { LeagueUser } from '@prisma/client';

import type { DatabaseClient } from '../domain/types.js';
import { discordSnowflakeSchema, robloxUserIdSchema } from '../domain/validation.js';
import { translateDatabaseError } from './repository-errors.js';

export interface RobloxIdentityInput {
  robloxUserId: string | null;
  robloxUsername: string | null;
}

export class UserRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async getOrCreateByDiscordUserId(discordUserId: string): Promise<LeagueUser> {
    const validatedId = discordSnowflakeSchema.parse(discordUserId);
    try {
      return await this.db.leagueUser.upsert({
        where: { discordUserId: validatedId },
        create: { discordUserId: validatedId },
        update: {},
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'get or create user');
    }
  }

  public async getById(id: string): Promise<LeagueUser | null> {
    return this.db.leagueUser.findUnique({ where: { id } });
  }

  public async getByDiscordUserId(discordUserId: string): Promise<LeagueUser | null> {
    return this.db.leagueUser.findUnique({
      where: { discordUserId: discordSnowflakeSchema.parse(discordUserId) },
    });
  }

  public async updateRobloxIdentity(id: string, input: RobloxIdentityInput): Promise<LeagueUser> {
    try {
      return await this.db.leagueUser.update({
        where: { id },
        data: {
          robloxUserId:
            input.robloxUserId === null ? null : robloxUserIdSchema.parse(input.robloxUserId),
          robloxUsername: input.robloxUsername,
        },
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'update roblox identity');
    }
  }
}
