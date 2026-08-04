import type { Club, ClubMembership, Guild, LeagueUser, PrismaClient } from '@prisma/client';

import { EntityNotFoundError } from '../domain/errors.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';

export interface FranchiseOwnerListItem {
  club: Club;
  teamManager: (ClubMembership & { user: LeagueUser }) | null;
}

export interface FranchiseOwnerListResult {
  guild: Guild;
  items: FranchiseOwnerListItem[];
}

export class FranchiseOwnerListService {
  public constructor(private readonly database: PrismaClient) {}

  public async getList(discordGuildId: string): Promise<FranchiseOwnerListResult> {
    const guild = await this.requireGuild(discordGuildId);
    const clubs = await new ClubRepository(this.database).listActive(guild.id);
    const memberships = new MembershipRepository(this.database);

    const items = await Promise.all(
      clubs.map(async (club) => {
        const staff = await memberships.listActiveStaffWithUsers(club.id);
        const teamManager =
          staff.find((member) => member.membershipType === 'TEAM_MANAGER') ?? null;
        return {
          club,
          teamManager,
        };
      }),
    );

    return {
      guild,
      items,
    };
  }

  private async requireGuild(discordGuildId: string): Promise<Guild> {
    const guild = await new GuildRepository(this.database).getByDiscordGuildId(discordGuildId);
    if (guild === null) throw new EntityNotFoundError('server is not configured');
    return guild;
  }
}
