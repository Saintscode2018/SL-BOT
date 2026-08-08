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
  SquadFullError,
  StaleMutationStateError,
  TeamNotFoundError,
  ValidationError,
} from '../domain/errors.js';
import type {
  AuditAnnouncementPlan,
  MemberRoleMutationPlan,
  TeamSwapDetails,
  TransferAnnouncementPlan,
} from '../domain/roster-mutation.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { LeagueTransactionRepository } from '../repositories/transaction-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';
import type { RoleSynchronizedMutationService } from './role-synchronized-mutation-service.js';

export const teamSwappedAuditEventType = 'team.swapped';

export type ActiveMembershipWithUser = ClubMembership & { user: LeagueUser };

export interface TeamSwapEligibility {
  guild: Guild;
  settings: GuildSettings;
  team1: Club;
  team2: Club;
  team1Memberships: ActiveMembershipWithUser[];
  team2Memberships: ActiveMembershipWithUser[];
  team1EffectiveLimit: number;
  team2EffectiveLimit: number;
  team1ActivePlayerCount: number;
  team2ActivePlayerCount: number;
}

export interface TeamSwapResult {
  guild: Guild;
  team1: Club;
  team2: Club;
  team1MovedCount: number;
  team2MovedCount: number;
  announcement?: TransferAnnouncementPlan | null;
  auditAnnouncement?: AuditAnnouncementPlan | null;
  announcementDelivered?: boolean | null;
  auditAnnouncementDelivered?: boolean | null;
}

export interface SwapTeamsInput {
  authorization: AuthorizationInput;
  team1Id: string;
  team2Id: string;
  occurredAt?: Date;
}

export class TeamSwapService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly synchronizedMutations: Pick<RoleSynchronizedMutationService, 'executeMany'>,
  ) {}

  public async getEligibility(
    authorizationInput: AuthorizationInput,
    team1Id: string,
    team2Id: string,
  ): Promise<TeamSwapEligibility> {
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(authorizationInput);

    if (team1Id === team2Id) {
      throw new ValidationError('cannot swap a team with itself');
    }

    const clubRepo = new ClubRepository(this.database);
    const team1 = await clubRepo.getByIdInGuild(team1Id, authorization.guild.id);
    if (team1 === null) throw new TeamNotFoundError('first team was not found in this server');
    if (!team1.active) throw new ClubInactiveError('first team is inactive');

    const team2 = await clubRepo.getByIdInGuild(team2Id, authorization.guild.id);
    if (team2 === null) throw new TeamNotFoundError('second team was not found in this server');
    if (!team2.active) throw new ClubInactiveError('second team is inactive');

    const [team1Memberships, team2Memberships] = await Promise.all([
      this.listActiveMemberships(authorization.guild.id, team1.id),
      this.listActiveMemberships(authorization.guild.id, team2.id),
    ]);

    const team1EffectiveLimit = getEffectiveSquadLimit(team1, authorization.settings);
    const team2EffectiveLimit = getEffectiveSquadLimit(team2, authorization.settings);

    const team1ActivePlayerCount = team1Memberships.filter(
      (m) => m.membershipType === 'PLAYER',
    ).length;
    const team2ActivePlayerCount = team2Memberships.filter(
      (m) => m.membershipType === 'PLAYER',
    ).length;

    const team1Exceeds = team1ActivePlayerCount > team2EffectiveLimit;
    const team2Exceeds = team2ActivePlayerCount > team1EffectiveLimit;

    if (team1Exceeds && team2Exceeds) {
      throw new SquadFullError(
        `Swap blocked: both destination teams would exceed effective squad limits (Team 1 incoming roster ${team1ActivePlayerCount} > Team 2 limit ${team2EffectiveLimit}, Team 2 incoming roster ${team2ActivePlayerCount} > Team 1 limit ${team1EffectiveLimit})`,
      );
    }
    if (team1Exceeds) {
      throw new SquadFullError(
        `Swap blocked: Team 1 incoming roster count (${team1ActivePlayerCount}) exceeds Team 2 effective squad limit (${team2EffectiveLimit})`,
      );
    }
    if (team2Exceeds) {
      throw new SquadFullError(
        `Swap blocked: Team 2 incoming roster count (${team2ActivePlayerCount}) exceeds Team 1 effective squad limit (${team1EffectiveLimit})`,
      );
    }

    return {
      guild: authorization.guild,
      settings: authorization.settings,
      team1,
      team2,
      team1Memberships,
      team2Memberships,
      team1EffectiveLimit,
      team2EffectiveLimit,
      team1ActivePlayerCount,
      team2ActivePlayerCount,
    };
  }

  public async swap(input: SwapTeamsInput): Promise<TeamSwapResult> {
    const occurredAt = input.occurredAt ?? new Date();
    const eligibility = await this.getEligibility(
      input.authorization,
      input.team1Id,
      input.team2Id,
    );

    const rolePlans = this.buildRolePlans(
      eligibility.guild.discordGuildId,
      eligibility.team1,
      eligibility.team2,
      eligibility.team1Memberships,
      eligibility.team2Memberships,
    );

    const expectedTeam1Ids = eligibility.team1Memberships.map(({ id }) => id).sort();
    const expectedTeam2Ids = eligibility.team2Memberships.map(({ id }) => id).sort();

    const team1StaffCount = eligibility.team1Memberships.filter(
      (m) => m.membershipType !== 'PLAYER',
    ).length;
    const team1PlayerCount = eligibility.team1ActivePlayerCount;
    const team2StaffCount = eligibility.team2Memberships.filter(
      (m) => m.membershipType !== 'PLAYER',
    ).length;
    const team2PlayerCount = eligibility.team2ActivePlayerCount;

    const swapDetails: TeamSwapDetails = {
      team1MovedCount: expectedTeam1Ids.length,
      team2MovedCount: expectedTeam2Ids.length,
      team1StaffCount,
      team1PlayerCount,
      team2StaffCount,
      team2PlayerCount,
    };

    const announcement: TransferAnnouncementPlan | null = eligibility.settings.transferChannelId
      ? {
          discordGuildId: eligibility.guild.discordGuildId,
          channelId: eligibility.settings.transferChannelId,
          type: 'TEAM_SWAPPED',
          team1Identity: eligibility.team1,
          team2Identity: eligibility.team2,
          occurredAt,
          swapDetails,
        }
      : null;

    return this.synchronizedMutations.executeMany(rolePlans, () =>
      this.database.$transaction(async (transaction) => {
        const authorization = await new AuthorizationService(
          transaction,
        ).authorizeLeagueAdministration(input.authorization);

        const currentTeam1Memberships = await transaction.clubMembership.findMany({
          where: { guildId: authorization.guild.id, clubId: input.team1Id, status: 'ACTIVE' },
          include: { user: true },
          orderBy: [{ id: 'asc' }],
        });
        const currentTeam2Memberships = await transaction.clubMembership.findMany({
          where: { guildId: authorization.guild.id, clubId: input.team2Id, status: 'ACTIVE' },
          include: { user: true },
          orderBy: [{ id: 'asc' }],
        });

        const currentTeam1Ids = currentTeam1Memberships.map(({ id }) => id).sort();
        const currentTeam2Ids = currentTeam2Memberships.map(({ id }) => id).sort();

        if (
          currentTeam1Ids.length !== expectedTeam1Ids.length ||
          currentTeam1Ids.some((id, index) => id !== expectedTeam1Ids[index]) ||
          currentTeam2Ids.length !== expectedTeam2Ids.length ||
          currentTeam2Ids.some((id, index) => id !== expectedTeam2Ids[index])
        ) {
          throw new StaleMutationStateError();
        }

        const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
          input.authorization.discordUserId,
        );

        if (expectedTeam1Ids.length > 0) {
          const updated1 = await transaction.clubMembership.updateMany({
            where: { id: { in: expectedTeam1Ids }, status: 'ACTIVE' },
            data: { clubId: eligibility.team2.id },
          });
          if (updated1.count !== expectedTeam1Ids.length) throw new StaleMutationStateError();
        }

        if (expectedTeam2Ids.length > 0) {
          const updated2 = await transaction.clubMembership.updateMany({
            where: { id: { in: expectedTeam2Ids }, status: 'ACTIVE' },
            data: { clubId: eligibility.team1.id },
          });
          if (updated2.count !== expectedTeam2Ids.length) throw new StaleMutationStateError();
        }

        const txRepo = new LeagueTransactionRepository(transaction);
        for (const membership of currentTeam1Memberships) {
          await txRepo.create({
            guildId: authorization.guild.id,
            userId: membership.userId,
            transactionType: 'TEAM_SWAP',
            sourceClubId: eligibility.team1.id,
            destinationClubId: eligibility.team2.id,
            performedByUserId: actor.id,
          });
        }
        for (const membership of currentTeam2Memberships) {
          await txRepo.create({
            guildId: authorization.guild.id,
            userId: membership.userId,
            transactionType: 'TEAM_SWAP',
            sourceClubId: eligibility.team2.id,
            destinationClubId: eligibility.team1.id,
            performedByUserId: actor.id,
          });
        }

        await new AuditEventRepository(transaction).create({
          guildId: authorization.guild.id,
          actorUserId: actor.id,
          eventType: teamSwappedAuditEventType,
          entityType: 'club',
          entityId: eligibility.team1.id,
          beforeState: { team1Id: eligibility.team1.id, team2Id: eligibility.team2.id },
          afterState: { team1Id: eligibility.team1.id, team2Id: eligibility.team2.id },
          metadata: {
            discordGuildId: authorization.guild.discordGuildId,
            team1Id: eligibility.team1.id,
            team2Id: eligibility.team2.id,
            team1MovedCount: expectedTeam1Ids.length,
            team2MovedCount: expectedTeam2Ids.length,
            actorDiscordUserId: input.authorization.discordUserId,
            timestamp: occurredAt.toISOString(),
          },
        });

        const auditAnnouncement: AuditAnnouncementPlan | null = eligibility.settings.auditChannelId
          ? {
              discordGuildId: authorization.guild.discordGuildId,
              channelId: eligibility.settings.auditChannelId,
              operation: 'TEAM_SWAPPED',
              actorDiscordUserId: input.authorization.discordUserId,
              team1Identity: eligibility.team1,
              team2Identity: eligibility.team2,
              occurredAt,
              swapDetails,
            }
          : null;

        return {
          guild: authorization.guild,
          team1: eligibility.team1,
          team2: eligibility.team2,
          team1MovedCount: expectedTeam1Ids.length,
          team2MovedCount: expectedTeam2Ids.length,
          announcement,
          auditAnnouncement,
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

  private buildRolePlans(
    discordGuildId: string,
    team1: Club,
    team2: Club,
    team1Memberships: readonly ActiveMembershipWithUser[],
    team2Memberships: readonly ActiveMembershipWithUser[],
  ): MemberRoleMutationPlan[] {
    const plansByUser = new Map<string, MemberRoleMutationPlan>();

    for (const membership of team1Memberships) {
      const userId = membership.user.discordUserId;
      const existing = plansByUser.get(userId) ?? {
        discordGuildId,
        discordUserId: userId,
        addRoles: [],
        removeRoles: [],
      };
      if (!existing.removeRoles.some((r) => r.id === team1.discordRoleId)) {
        existing.removeRoles.push({ id: team1.discordRoleId, purpose: 'TEAM' });
      }
      if (!existing.addRoles.some((r) => r.id === team2.discordRoleId)) {
        existing.addRoles.push({ id: team2.discordRoleId, purpose: 'TEAM' });
      }
      plansByUser.set(userId, existing);
    }

    for (const membership of team2Memberships) {
      const userId = membership.user.discordUserId;
      const existing = plansByUser.get(userId) ?? {
        discordGuildId,
        discordUserId: userId,
        addRoles: [],
        removeRoles: [],
      };
      if (!existing.removeRoles.some((r) => r.id === team2.discordRoleId)) {
        existing.removeRoles.push({ id: team2.discordRoleId, purpose: 'TEAM' });
      }
      if (!existing.addRoles.some((r) => r.id === team1.discordRoleId)) {
        existing.addRoles.push({ id: team1.discordRoleId, purpose: 'TEAM' });
      }
      plansByUser.set(userId, existing);
    }

    return [...plansByUser.values()];
  }
}
