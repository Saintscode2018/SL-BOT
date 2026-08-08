import type { Club, ClubMembership, LeagueUser, Prisma, PrismaClient } from '@prisma/client';

import {
  CallerHasNoStaffAppointmentError,
  EntityNotFoundError,
  NotCurrentlySignedError,
  ReleaseTargetIsFreeAgentError,
  SelfReleaseForbiddenError,
  StaleConfirmationError,
  TargetNotOnCallerTeamError,
  TargetRankNotManageableError,
  TeamManagerCannotBeReleasedError,
  TeamManagerCannotDemandError,
} from '../domain/errors.js';
import type { StaffMembershipType, StaffRoleCode } from '../domain/roster-mutation.js';
import { canReleaseStaffRole, toStaffRoleCode } from '../domain/roster-mutation.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { RosterMutationResult } from './roster-mutation-service.js';
import { RosterMutationService } from './roster-mutation-service.js';

export interface DemandEligibility {
  club: Club;
  user: LeagueUser;
  playerMembership: ClubMembership | null;
  staffType: Exclude<StaffMembershipType, 'TEAM_MANAGER'> | null;
  staffRole: Exclude<StaffRoleCode, 'TM'> | null;
}

export interface ReleaseEligibility {
  club: Club;
  callerStaffType: StaffMembershipType;
  callerStaffRole: StaffRoleCode;
  target: LeagueUser;
  targetPlayerMembership: ClubMembership | null;
  targetStaffType: Exclude<StaffMembershipType, 'TEAM_MANAGER'> | null;
  targetStaffRole: Exclude<StaffRoleCode, 'TM'> | null;
}

export interface ConfirmedDemandInput {
  discordGuildId: string;
  discordUserId: string;
  clubId: string;
  expectedStaffRole: Exclude<StaffRoleCode, 'TM'> | null;
  occurredAt?: Date;
}

export interface ConfirmedReleaseInput {
  discordGuildId: string;
  actorDiscordUserId: string;
  targetDiscordUserId: string;
  clubId: string;
  expectedActorStaffRole: StaffRoleCode;
  expectedTargetStaffRole: Exclude<StaffRoleCode, 'TM'> | null;
  occurredAt?: Date;
}

function fromExpectedRole(role: StaffRoleCode | null): StaffMembershipType | null {
  switch (role) {
    case 'TM':
      return 'TEAM_MANAGER';
    case 'ATM':
      return 'ASSISTANT_MANAGER';
    case 'PM':
      return 'PLAYER_MANAGER';
    case null:
      return null;
  }
}

export class RosterDepartureService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly mutations = new RosterMutationService(database),
  ) {}

  public getDemandEligibility(
    discordGuildId: string,
    discordUserId: string,
  ): Promise<DemandEligibility> {
    return this.database.$transaction((transaction) =>
      this.loadDemandEligibility(transaction, discordGuildId, discordUserId),
    );
  }

  public getReleaseEligibility(
    discordGuildId: string,
    callerDiscordUserId: string,
    targetDiscordUserId: string,
  ): Promise<ReleaseEligibility> {
    return this.database.$transaction((transaction) =>
      this.loadReleaseEligibility(
        transaction,
        discordGuildId,
        callerDiscordUserId,
        targetDiscordUserId,
      ),
    );
  }

  public async leaveStaffPosition(input: ConfirmedDemandInput): Promise<RosterMutationResult> {
    const expectedStaffType = fromExpectedRole(input.expectedStaffRole);
    if (expectedStaffType === null) throw new StaleConfirmationError();
    return this.mutations.endStaffAppointmentOnly({
      discordGuildId: input.discordGuildId,
      clubId: input.clubId,
      actorDiscordUserId: input.discordUserId,
      targetDiscordUserId: input.discordUserId,
      expectedStaffType,
      expectedActorStaffType: expectedStaffType,
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    });
  }

  public demandFullDeparture(input: ConfirmedDemandInput): Promise<RosterMutationResult> {
    const expectedStaffType = fromExpectedRole(input.expectedStaffRole);
    return this.mutations.leaveTeamCompletely({
      discordGuildId: input.discordGuildId,
      clubId: input.clubId,
      actorDiscordUserId: input.discordUserId,
      targetDiscordUserId: input.discordUserId,
      expectedStaffType,
      expectedActorStaffType: expectedStaffType,
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    });
  }

  public release(input: ConfirmedReleaseInput): Promise<RosterMutationResult> {
    return this.mutations.releaseMemberCompletely({
      discordGuildId: input.discordGuildId,
      clubId: input.clubId,
      actorDiscordUserId: input.actorDiscordUserId,
      targetDiscordUserId: input.targetDiscordUserId,
      expectedStaffType: fromExpectedRole(input.expectedTargetStaffRole),
      expectedActorStaffType: fromExpectedRole(input.expectedActorStaffRole),
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    });
  }

  private async loadDemandEligibility(
    transaction: Prisma.TransactionClient,
    discordGuildId: string,
    discordUserId: string,
  ): Promise<DemandEligibility> {
    const guild = await new GuildRepository(transaction).getByDiscordGuildId(discordGuildId);
    if (guild === null) throw new EntityNotFoundError('server is not configured');
    const user = await new UserRepository(transaction).getByDiscordUserId(discordUserId);
    if (user === null) throw new NotCurrentlySignedError();
    const memberships = new MembershipRepository(transaction);
    const activeMemberships = await memberships.listActiveMembershipsForUserInGuild(
      guild.id,
      user.id,
    );
    const staffMembership = await memberships.getActiveStaffMembershipForUserInGuild(
      guild.id,
      user.id,
    );
    const playerMembership =
      activeMemberships.find(({ membershipType }) => membershipType === 'PLAYER') ?? null;
    if (playerMembership === null && staffMembership === null) throw new NotCurrentlySignedError();
    if (activeMemberships.some(({ membershipType }) => membershipType === 'TEAM_MANAGER')) {
      throw new TeamManagerCannotDemandError();
    }
    const clubId = staffMembership?.clubId ?? playerMembership?.clubId;
    if (
      clubId === undefined ||
      activeMemberships.some((membership) => membership.clubId !== clubId)
    ) {
      throw new StaleConfirmationError();
    }
    const club =
      staffMembership?.club ?? (await transaction.club.findUnique({ where: { id: clubId } }));
    if (club === null || club.guildId !== guild.id || !club.active) {
      throw new EntityNotFoundError('active team was not found');
    }
    const staffType =
      staffMembership === null
        ? null
        : (staffMembership.membershipType as Exclude<StaffMembershipType, 'TEAM_MANAGER'>);
    return {
      club,
      user,
      playerMembership,
      staffType,
      staffRole: staffType === null ? null : (toStaffRoleCode(staffType) as 'ATM' | 'PM'),
    };
  }

  private async loadReleaseEligibility(
    transaction: Prisma.TransactionClient,
    discordGuildId: string,
    callerDiscordUserId: string,
    targetDiscordUserId: string,
  ): Promise<ReleaseEligibility> {
    const guild = await new GuildRepository(transaction).getByDiscordGuildId(discordGuildId);
    if (guild === null) throw new EntityNotFoundError('server is not configured');
    const users = new UserRepository(transaction);
    const caller = await users.getByDiscordUserId(callerDiscordUserId);
    if (caller === null) throw new CallerHasNoStaffAppointmentError();
    const memberships = new MembershipRepository(transaction);
    const callerStaff = await memberships.getActiveStaffMembershipForUserInGuild(
      guild.id,
      caller.id,
    );
    if (callerStaff === null || !callerStaff.club.active) {
      throw new CallerHasNoStaffAppointmentError();
    }
    if (callerDiscordUserId === targetDiscordUserId) throw new SelfReleaseForbiddenError();

    const target = await users.getByDiscordUserId(targetDiscordUserId);
    if (target === null) throw new ReleaseTargetIsFreeAgentError();
    const targetMemberships = await memberships.listActiveMembershipsForUserInGuild(
      guild.id,
      target.id,
    );
    if (targetMemberships.length === 0) throw new ReleaseTargetIsFreeAgentError();
    const targetTeamMemberships = targetMemberships.filter(
      ({ clubId }) => clubId === callerStaff.clubId,
    );
    if (targetTeamMemberships.length === 0) throw new TargetNotOnCallerTeamError();
    if (targetMemberships.length !== targetTeamMemberships.length) {
      throw new TargetNotOnCallerTeamError();
    }
    const targetPlayer =
      targetTeamMemberships.find(({ membershipType }) => membershipType === 'PLAYER') ?? null;
    if (targetTeamMemberships.some(({ membershipType }) => membershipType === 'TEAM_MANAGER')) {
      throw new TeamManagerCannotBeReleasedError();
    }
    const targetStaff =
      targetTeamMemberships.find(({ membershipType }) => membershipType === 'ASSISTANT_MANAGER') ??
      targetTeamMemberships.find(({ membershipType }) => membershipType === 'PLAYER_MANAGER') ??
      null;

    const callerRank = callerStaff.membershipType as StaffMembershipType;
    const callerStaffRole = toStaffRoleCode(callerRank);
    const targetStaffRole =
      targetStaff === null
        ? null
        : toStaffRoleCode(targetStaff.membershipType as StaffMembershipType);
    if (!canReleaseStaffRole(callerStaffRole, targetStaffRole)) {
      throw new TargetRankNotManageableError();
    }

    const targetStaffType =
      targetStaff === null
        ? null
        : (targetStaff.membershipType as Exclude<StaffMembershipType, 'TEAM_MANAGER'>);
    return {
      club: callerStaff.club,
      callerStaffType: callerRank,
      callerStaffRole,
      target,
      targetPlayerMembership: targetPlayer,
      targetStaffType,
      targetStaffRole: targetStaffRole as 'ATM' | 'PM' | null,
    };
  }
}
