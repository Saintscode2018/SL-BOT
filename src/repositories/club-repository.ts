import type { Club, Prisma } from '@prisma/client';

import { EntityNotFoundError } from '../domain/errors.js';
import type { DatabaseClient } from '../domain/types.js';
import { discordSnowflakeSchema } from '../domain/validation.js';
import { MembershipRepository } from './membership-repository.js';
import { translateDatabaseError } from './repository-errors.js';

export interface CreateClubInput {
  guildId: string;
  discordRoleId: string;
  emoji: string;
  squadLimitOverride?: number | null;
}

export interface UpdateClubInput {
  discordRoleId?: string;
  emoji?: string;
  squadLimitOverride?: number | null;
  active?: boolean;
}

export class ClubRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async create(input: CreateClubInput): Promise<Club> {
    try {
      return await this.db.club.create({
        data: {
          guildId: input.guildId,
          discordRoleId: discordSnowflakeSchema.parse(input.discordRoleId),
          emoji: input.emoji,
          squadLimitOverride: input.squadLimitOverride ?? null,
        },
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'create club');
    }
  }

  public async update(id: string, input: UpdateClubInput): Promise<Club> {
    const data: Prisma.ClubUncheckedUpdateInput = {};
    if (input.discordRoleId !== undefined) {
      data.discordRoleId = discordSnowflakeSchema.parse(input.discordRoleId);
    }
    if (input.emoji !== undefined) data.emoji = input.emoji;
    if (input.squadLimitOverride !== undefined) data.squadLimitOverride = input.squadLimitOverride;
    if (input.active !== undefined) data.active = input.active;
    try {
      return await this.db.club.update({ where: { id }, data });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'update club');
    }
  }

  public async deactivate(id: string): Promise<Club> {
    return this.update(id, { active: false });
  }

  public async getById(id: string): Promise<Club | null> {
    return this.db.club.findUnique({ where: { id } });
  }

  public async getByIdInGuild(id: string, guildId: string): Promise<Club | null> {
    return this.db.club.findFirst({ where: { id, guildId } });
  }

  public async getByDiscordRoleId(guildId: string, discordRoleId: string): Promise<Club | null> {
    return this.db.club.findUnique({
      where: {
        guildId_discordRoleId: {
          guildId,
          discordRoleId: discordSnowflakeSchema.parse(discordRoleId),
        },
      },
    });
  }

  public async listActive(guildId: string): Promise<Club[]> {
    return this.db.club.findMany({
      where: { guildId, active: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  public async listActiveWithUniqueMemberCounts(
    guildId: string,
  ): Promise<Array<Club & { activePlayerCount: number }>> {
    const clubs = await this.listActive(guildId);
    const memberships = new MembershipRepository(this.db);
    return Promise.all(
      clubs.map(async (club) => ({
        ...club,
        activePlayerCount: await memberships.countActiveUniqueMembers(club.id),
      })),
    );
  }

  public async countActivePlayers(clubId: string): Promise<number> {
    return this.db.clubMembership.count({
      where: { clubId, membershipType: 'PLAYER', status: 'ACTIVE' },
    });
  }

  public async requireById(id: string): Promise<Club> {
    const club = await this.getById(id);
    if (club === null) {
      throw new EntityNotFoundError(`club ${id} was not found`);
    }
    return club;
  }
}
