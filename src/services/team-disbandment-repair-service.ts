import type { Club, ClubMembership, Guild, PrismaClient } from '@prisma/client';

import { ConfigurationError, StaleMutationStateError, TeamNotFoundError } from '../domain/errors.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';
import {
  groupClubRoleCandidates,
  planClubRoleRemovals,
  sameIds,
} from './club-role-entitlement-service.js';
import type { RoleSynchronizedMutationService } from './role-synchronized-mutation-service.js';

type HistoricalMembershipWithUser = ClubMembership & { user: { discordUserId: string } };

export interface TeamDisbandmentRepairEligibility {
  guild: Guild;
  team: Club;
}

export interface RepairTeamDisbandmentInput {
  authorization: AuthorizationInput;
  teamId: string;
  occurredAt?: Date;
}

export interface TeamDisbandmentRepairResult {
  guild: Guild;
  team: Club;
  historicalMembershipCount: number;
  candidateUserCount: number;
  endedMembershipCount: number;
  discordRoleMutationsApplied: number;
}

/** Repairs only one explicitly selected inactive club; it never scans a guild. */
export class TeamDisbandmentRepairService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly synchronizedMutations: Pick<RoleSynchronizedMutationService, 'executeMany'>,
  ) {}

  public async getEligibility(
    authorizationInput: AuthorizationInput,
    teamId: string,
  ): Promise<TeamDisbandmentRepairEligibility> {
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeBotPermissionAdmin(authorizationInput);
    const team = await new ClubRepository(this.database).getByIdInGuild(
      teamId,
      authorization.guild.id,
    );
    if (team === null) throw new TeamNotFoundError('team was not found in this server');
    if (team.active) throw new ConfigurationError('Only an inactive team can be repaired.');
    return { guild: authorization.guild, team };
  }

  public async repair(input: RepairTeamDisbandmentInput): Promise<TeamDisbandmentRepairResult> {
    const occurredAt = input.occurredAt ?? new Date();
    const eligibility = await this.getEligibility(input.authorization, input.teamId);
    const historicalMemberships = await this.listHistoricalMemberships(
      eligibility.guild.id,
      eligibility.team.id,
    );
    const candidates = groupClubRoleCandidates(historicalMemberships);
    const rolePlanning = await planClubRoleRemovals(this.database, {
      guild: eligibility.guild,
      settings: await this.requireSettings(eligibility.guild.id),
      club: eligibility.team,
      candidates,
    });
    const expectedTargetActiveMembershipIds = historicalMemberships
      .filter(({ status }) => status === 'ACTIVE')
      .map(({ id }) => id)
      .sort();

    const outcome = await this.synchronizedMutations.executeMany(rolePlanning.rolePlans, () =>
      this.database.$transaction(async (transaction) => {
        const guilds = new GuildRepository(transaction);
        await guilds.acquireWriteLock(input.authorization.discordGuildId);
        const authorization = await new AuthorizationService(
          transaction,
        ).authorizeBotPermissionAdmin(input.authorization);
        const team = await new ClubRepository(transaction).getByIdInGuild(
          input.teamId,
          authorization.guild.id,
        );
        if (team === null) throw new TeamNotFoundError('team was not found in this server');
        if (team.active) throw new ConfigurationError('Only an inactive team can be repaired.');

        const activeTargetMemberships = await transaction.clubMembership.findMany({
          where: { guildId: authorization.guild.id, clubId: team.id, status: 'ACTIVE' },
          select: { id: true },
          orderBy: [{ id: 'asc' }],
        });
        if (
          !sameIds(
            activeTargetMemberships.map(({ id }) => id),
            expectedTargetActiveMembershipIds,
          )
        ) {
          throw new StaleMutationStateError();
        }
        const lockedRolePlanning = await planClubRoleRemovals(transaction, {
          guild: authorization.guild,
          settings: authorization.settings,
          club: team,
          candidates,
        });
        if (
          !sameIds(
            lockedRolePlanning.expectedCandidateActiveMembershipIds,
            rolePlanning.expectedCandidateActiveMembershipIds,
          ) || !sameRolePlans(lockedRolePlanning.rolePlans, rolePlanning.rolePlans)
        ) {
          throw new StaleMutationStateError();
        }

        const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
          input.authorization.discordUserId,
        );
        const ended = await transaction.clubMembership.updateMany({
          where: { id: { in: expectedTargetActiveMembershipIds }, status: 'ACTIVE' },
          data: { status: 'ENDED', leftAt: occurredAt, endedByUserId: actor.id },
        });
        if (ended.count !== expectedTargetActiveMembershipIds.length) {
          throw new StaleMutationStateError();
        }
        return { guild: authorization.guild, team, endedMembershipCount: ended.count };
      }),
    );

    return {
      guild: outcome.guild,
      team: outcome.team,
      historicalMembershipCount: historicalMemberships.length,
      candidateUserCount: candidates.length,
      endedMembershipCount: outcome.endedMembershipCount,
      discordRoleMutationsApplied: outcome.roleMutationsApplied ?? 0,
    };
  }

  private async listHistoricalMemberships(
    guildId: string,
    teamId: string,
  ): Promise<HistoricalMembershipWithUser[]> {
    return this.database.clubMembership.findMany({
      where: { guildId, clubId: teamId },
      include: { user: { select: { discordUserId: true } } },
      orderBy: [{ userId: 'asc' }, { membershipType: 'asc' }, { id: 'asc' }],
    });
  }

  private async requireSettings(guildId: string) {
    const settings = await new GuildRepository(this.database).getSettings(guildId);
    if (settings === null) throw new ConfigurationError('this server has no league settings');
    return settings;
  }
}

function sameRolePlans(
  left: readonly { discordGuildId: string; discordUserId: string; addRoles: unknown; removeRoles: unknown }[],
  right: readonly { discordGuildId: string; discordUserId: string; addRoles: unknown; removeRoles: unknown }[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
