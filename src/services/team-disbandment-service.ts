import type {
  Club,
  ClubMembership,
  Guild,
  GuildSettings,
  LeagueUser,
  PrismaClient,
} from '@prisma/client';

import {
  ClubInactiveError,
  DiscordRoleMissingError,
  StaleMutationStateError,
  TeamNotFoundError,
} from '../domain/errors.js';
import type { MembershipType } from '../domain/enums.js';
import type { MemberRoleMutationPlan, PlannedDiscordRole } from '../domain/roster-mutation.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';
import type { RoleSynchronizedMutationService } from './role-synchronized-mutation-service.js';

export const teamDisbandedAuditEventType = 'team.disbanded';

type ActiveMembershipWithUser = ClubMembership & { user: LeagueUser };

export interface TeamDisbandmentEligibility {
  guild: Guild;
  settings: GuildSettings;
  team: Club;
}

export interface TeamDisbandmentAffectedUser {
  discordUserId: string;
  membershipTypes: MembershipType[];
}

export interface TeamDisbandmentResult {
  guild: Guild;
  team: Club;
  endedMembershipCount: number;
  affectedUserCount: number;
  expiredOfferCount: number;
  affectedUsers: TeamDisbandmentAffectedUser[];
}

export interface DisbandTeamInput {
  authorization: AuthorizationInput;
  teamId: string;
  teamName: string;
  occurredAt?: Date;
}

export class TeamDisbandmentService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly synchronizedMutations: Pick<RoleSynchronizedMutationService, 'executeMany'>,
  ) {}

  public async getEligibility(
    authorizationInput: AuthorizationInput,
    teamId: string,
  ): Promise<TeamDisbandmentEligibility> {
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(authorizationInput);
    const team = await new ClubRepository(this.database).getByIdInGuild(
      teamId,
      authorization.guild.id,
    );
    if (team === null) throw new TeamNotFoundError('team was not found in this server');
    if (!team.active) throw new ClubInactiveError('team is already inactive');
    return { guild: authorization.guild, settings: authorization.settings, team };
  }

  public async disband(input: DisbandTeamInput): Promise<TeamDisbandmentResult> {
    const occurredAt = input.occurredAt ?? new Date();
    const eligibility = await this.getEligibility(input.authorization, input.teamId);
    const activeMemberships = await this.listActiveMemberships(
      eligibility.guild.id,
      eligibility.team.id,
    );
    const affectedUsers = this.groupAffectedUsers(activeMemberships);
    const rolePlans = this.buildRolePlans(eligibility, affectedUsers);
    const expectedMembershipIds = activeMemberships.map(({ id }) => id).sort();

    return this.synchronizedMutations.executeMany(rolePlans, () =>
      this.database.$transaction(async (transaction) => {
        const authorization = await new AuthorizationService(
          transaction,
        ).authorizeLeagueAdministration(input.authorization);
        const team = await new ClubRepository(transaction).getByIdInGuild(
          input.teamId,
          authorization.guild.id,
        );
        if (team === null) throw new TeamNotFoundError('team was not found in this server');
        if (!team.active) throw new ClubInactiveError('team is already inactive');

        const currentMemberships = await transaction.clubMembership.findMany({
          where: { guildId: authorization.guild.id, clubId: team.id, status: 'ACTIVE' },
          include: { user: true },
          orderBy: [{ id: 'asc' }],
        });
        const currentIds = currentMemberships.map(({ id }) => id).sort();
        if (
          currentIds.length !== expectedMembershipIds.length ||
          currentIds.some((id, index) => id !== expectedMembershipIds[index])
        ) {
          throw new StaleMutationStateError();
        }

        const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
          input.authorization.discordUserId,
        );
        const playerUserIds = [
          ...new Set(
            currentMemberships
              .filter(({ membershipType }) => membershipType === 'PLAYER')
              .map(({ userId }) => userId),
          ),
        ];
        const ended = await transaction.clubMembership.updateMany({
          where: { id: { in: currentIds }, status: 'ACTIVE' },
          data: { status: 'ENDED', leftAt: occurredAt, endedByUserId: actor.id },
        });
        if (ended.count !== currentIds.length) throw new StaleMutationStateError();

        const expired = await transaction.offer.updateMany({
          where: {
            guildId: authorization.guild.id,
            status: 'PENDING',
            OR: [
              { clubId: team.id },
              ...(playerUserIds.length === 0 ? [] : [{ playerUserId: { in: playerUserIds } }]),
            ],
          },
          data: { status: 'EXPIRED', respondedAt: occurredAt },
        });
        const deactivated = await transaction.club.updateMany({
          where: { id: team.id, guildId: authorization.guild.id, active: true },
          data: { active: false },
        });
        if (deactivated.count !== 1) throw new ClubInactiveError('team is already inactive');
        const deactivatedTeam = await transaction.club.findUniqueOrThrow({
          where: { id: team.id },
        });

        await new AuditEventRepository(transaction).create({
          guildId: authorization.guild.id,
          actorUserId: actor.id,
          eventType: teamDisbandedAuditEventType,
          entityType: 'club',
          entityId: team.id,
          beforeState: { active: true },
          afterState: { active: false },
          metadata: {
            discordGuildId: authorization.guild.discordGuildId,
            teamId: team.id,
            teamName: input.teamName,
            teamDiscordRoleId: team.discordRoleId,
            actorDiscordUserId: input.authorization.discordUserId,
            endedMembershipCount: ended.count,
            affectedUserCount: affectedUsers.length,
            expiredOfferCount: expired.count,
            timestamp: occurredAt.toISOString(),
          },
        });

        return {
          guild: authorization.guild,
          team: deactivatedTeam,
          endedMembershipCount: ended.count,
          affectedUserCount: affectedUsers.length,
          expiredOfferCount: expired.count,
          affectedUsers,
        };
      }),
    );
  }

  private async listActiveMemberships(
    guildId: string,
    teamId: string,
  ): Promise<ActiveMembershipWithUser[]> {
    return this.database.clubMembership.findMany({
      where: { guildId, clubId: teamId, status: 'ACTIVE' },
      include: { user: true },
      orderBy: [{ userId: 'asc' }, { membershipType: 'asc' }, { id: 'asc' }],
    });
  }

  private groupAffectedUsers(
    memberships: readonly ActiveMembershipWithUser[],
  ): TeamDisbandmentAffectedUser[] {
    const byUser = new Map<string, Set<MembershipType>>();
    for (const membership of memberships) {
      const types = byUser.get(membership.user.discordUserId) ?? new Set<MembershipType>();
      if (
        ['PLAYER', 'TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'].includes(
          membership.membershipType,
        )
      ) {
        types.add(membership.membershipType as MembershipType);
      }
      byUser.set(membership.user.discordUserId, types);
    }
    return [...byUser.entries()].map(([discordUserId, membershipTypes]) => ({
      discordUserId,
      membershipTypes: [...membershipTypes],
    }));
  }

  private buildRolePlans(
    eligibility: TeamDisbandmentEligibility,
    affectedUsers: readonly TeamDisbandmentAffectedUser[],
  ): MemberRoleMutationPlan[] {
    return affectedUsers.map((affectedUser) => {
      const roles = new Map<string, PlannedDiscordRole>();
      roles.set(eligibility.team.discordRoleId, {
        id: eligibility.team.discordRoleId,
        purpose: 'TEAM',
      });
      for (const membershipType of affectedUser.membershipTypes) {
        const role = this.staffRole(eligibility.settings, membershipType);
        if (role !== null && !roles.has(role.id)) roles.set(role.id, role);
      }
      return {
        discordGuildId: eligibility.guild.discordGuildId,
        discordUserId: affectedUser.discordUserId,
        addRoles: [],
        removeRoles: [...roles.values()],
      };
    });
  }

  private staffRole(
    settings: GuildSettings,
    membershipType: MembershipType,
  ): PlannedDiscordRole | null {
    if (membershipType === 'PLAYER') return null;
    const purpose =
      membershipType === 'TEAM_MANAGER'
        ? 'TM'
        : membershipType === 'ASSISTANT_MANAGER'
          ? 'ATM'
          : 'PM';
    const id =
      purpose === 'TM'
        ? settings.teamManagerRoleId
        : purpose === 'ATM'
          ? settings.assistantManagerRoleId
          : settings.playerManagerRoleId;
    if (id === null) throw new DiscordRoleMissingError(purpose);
    return { id, purpose };
  }
}
