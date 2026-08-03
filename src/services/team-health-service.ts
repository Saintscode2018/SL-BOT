import type { Club, ClubMembership, Guild, LeagueUser, PrismaClient } from '@prisma/client';

import { ClubInactiveError, EntityNotFoundError, TeamNotFoundError } from '../domain/errors.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';

export interface TeamHealthOverviewItem {
  club: Club;
  activePlayerCount: number;
}

export interface DetailedTeamHealth {
  club: Club;
  activePlayerCount: number;
  effectiveSquadLimit: number;
  staff: Array<ClubMembership & { user: LeagueUser }>;
}

export interface TeamHealthOverview {
  guild: Guild;
  teams: TeamHealthOverviewItem[];
}

export interface TeamHealthDetail {
  guild: Guild;
  team: DetailedTeamHealth;
}

export class TeamHealthService {
  public constructor(private readonly database: PrismaClient) {}

  public async getOverview(discordGuildId: string): Promise<TeamHealthOverview> {
    const guild = await this.requireGuild(discordGuildId);
    const teams = await new ClubRepository(this.database).listActiveWithPlayerCounts(guild.id);
    return {
      guild,
      teams: teams.map(({ activePlayerCount, ...club }) => ({ club, activePlayerCount })),
    };
  }

  public async getDetail(discordGuildId: string, clubId: string): Promise<TeamHealthDetail> {
    const guild = await this.requireGuild(discordGuildId);
    const clubs = new ClubRepository(this.database);
    const club = await clubs.getByIdInGuild(clubId, guild.id);
    if (club === null) throw new TeamNotFoundError('team was not found in this server');
    if (!club.active) throw new ClubInactiveError('team is inactive');

    const memberships = new MembershipRepository(this.database);
    const [settings, activePlayerCount, staff] = await Promise.all([
      new GuildRepository(this.database).getSettings(guild.id),
      memberships.countActivePlayers(club.id),
      memberships.listActiveStaffWithUsers(club.id),
    ]);

    return {
      guild,
      team: {
        club,
        activePlayerCount,
        effectiveSquadLimit: getEffectiveSquadLimit(club, settings),
        staff,
      },
    };
  }

  private async requireGuild(discordGuildId: string): Promise<Guild> {
    const guild = await new GuildRepository(this.database).getByDiscordGuildId(discordGuildId);
    if (guild === null) throw new EntityNotFoundError('server is not configured');
    return guild;
  }
}
