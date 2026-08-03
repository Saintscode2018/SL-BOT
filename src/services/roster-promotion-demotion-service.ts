import type { Club, ClubMembership, LeagueUser, Prisma, PrismaClient } from '@prisma/client';

import {
  CallerHasNoStaffAppointmentError,
  EntityNotFoundError,
  InsufficientStaffRankError,
  InvalidDemotionTargetError,
  InvalidPromotionPathError,
  MemberIsFreeAgentError,
  SelfActionForbiddenError,
  StaffSlotOccupiedError,
  TargetAlreadyDesiredRankError,
  TargetNotOnCallerTeamError,
} from '../domain/errors.js';
import type { StaffMembershipType, StaffRoleCode } from '../domain/roster-mutation.js';
import { fromStaffRoleCode, toStaffRoleCode } from '../domain/roster-mutation.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { RosterMutationResult } from './roster-mutation-service.js';
import { RosterMutationService } from './roster-mutation-service.js';

export interface PromotionEligibility {
  club: Club;
  caller: LeagueUser;
  callerStaffType: StaffMembershipType;
  callerStaffRole: StaffRoleCode;
  target: LeagueUser;
  targetPlayerMembership: ClubMembership;
  targetStaffType: StaffMembershipType | null;
  targetStaffRole: StaffRoleCode | null;
  destinationStaffType: Exclude<StaffMembershipType, 'TEAM_MANAGER'>;
  destinationStaffRole: Exclude<StaffRoleCode, 'TM'>;
}

export interface DemotionEligibility {
  club: Club;
  caller: LeagueUser;
  callerStaffType: 'TEAM_MANAGER';
  callerStaffRole: 'TM';
  target: LeagueUser;
  targetPlayerMembership: ClubMembership;
  targetStaffType: Exclude<StaffMembershipType, 'TEAM_MANAGER'>;
  targetStaffRole: Exclude<StaffRoleCode, 'TM'>;
}

export interface ConfirmedPromotionInput {
  discordGuildId: string;
  actorDiscordUserId: string;
  targetDiscordUserId: string;
  clubId: string;
  destinationStaffType: Exclude<StaffMembershipType, 'TEAM_MANAGER'>;
  expectedActorStaffRole: StaffRoleCode;
  expectedTargetStaffRole: StaffRoleCode | null;
  occurredAt?: Date;
}

export interface ConfirmedDemotionInput {
  discordGuildId: string;
  actorDiscordUserId: string;
  targetDiscordUserId: string;
  clubId: string;
  expectedActorStaffRole: StaffRoleCode;
  expectedTargetStaffRole: Exclude<StaffRoleCode, 'TM'>;
  occurredAt?: Date;
}

function fromExpectedRole(role: StaffRoleCode | null): StaffMembershipType | null {
  if (role === null) return null;
  return fromStaffRoleCode(role);
}

export class RosterPromotionDemotionService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly mutations = new RosterMutationService(database),
  ) {}

  public getPromotionEligibility(
    discordGuildId: string,
    callerDiscordUserId: string,
    targetDiscordUserId: string,
    destinationStaffType: Exclude<StaffMembershipType, 'TEAM_MANAGER'>,
  ): Promise<PromotionEligibility> {
    return this.database.$transaction((transaction) =>
      this.loadPromotionEligibility(
        transaction,
        discordGuildId,
        callerDiscordUserId,
        targetDiscordUserId,
        destinationStaffType,
      ),
    );
  }

  public getDemotionEligibility(
    discordGuildId: string,
    callerDiscordUserId: string,
    targetDiscordUserId: string,
  ): Promise<DemotionEligibility> {
    return this.database.$transaction((transaction) =>
      this.loadDemotionEligibility(
        transaction,
        discordGuildId,
        callerDiscordUserId,
        targetDiscordUserId,
      ),
    );
  }

  public promote(input: ConfirmedPromotionInput): Promise<RosterMutationResult> {
    return this.mutations.promoteRosterMember({
      discordGuildId: input.discordGuildId,
      clubId: input.clubId,
      actorDiscordUserId: input.actorDiscordUserId,
      targetDiscordUserId: input.targetDiscordUserId,
      staffType: input.destinationStaffType,
      expectedStaffType: fromExpectedRole(input.expectedTargetStaffRole),
      expectedActorStaffType: fromExpectedRole(input.expectedActorStaffRole),
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    });
  }

  public demote(input: ConfirmedDemotionInput): Promise<RosterMutationResult> {
    return this.mutations.demoteStaffToPlayer({
      discordGuildId: input.discordGuildId,
      clubId: input.clubId,
      actorDiscordUserId: input.actorDiscordUserId,
      targetDiscordUserId: input.targetDiscordUserId,
      expectedStaffType: fromExpectedRole(input.expectedTargetStaffRole),
      expectedActorStaffType: fromExpectedRole(input.expectedActorStaffRole),
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    });
  }

  private async loadPromotionEligibility(
    transaction: Prisma.TransactionClient,
    discordGuildId: string,
    callerDiscordUserId: string,
    targetDiscordUserId: string,
    destinationStaffType: Exclude<StaffMembershipType, 'TEAM_MANAGER'>,
  ): Promise<PromotionEligibility> {
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
    const callerStaffType = callerStaff.membershipType as StaffMembershipType;
    if (!['TEAM_MANAGER', 'ASSISTANT_MANAGER'].includes(callerStaffType)) {
      throw new InsufficientStaffRankError();
    }

    if (callerDiscordUserId === targetDiscordUserId) {
      throw new SelfActionForbiddenError();
    }

    const target = await users.getByDiscordUserId(targetDiscordUserId);
    if (target === null) throw new MemberIsFreeAgentError();

    const targetPlayer = await memberships.getActivePlayerMembership(guild.id, target.id);
    if (targetPlayer === null) throw new MemberIsFreeAgentError();

    if (targetPlayer.clubId !== callerStaff.clubId) {
      throw new TargetNotOnCallerTeamError();
    }

    const targetStaff = await memberships.getActiveStaffMembershipForUserInGuild(
      guild.id,
      target.id,
    );
    const targetStaffType =
      targetStaff === null ? null : (targetStaff.membershipType as StaffMembershipType);

    if (targetStaffType === 'TEAM_MANAGER') {
      throw new InvalidPromotionPathError();
    }

    if (targetStaffType === destinationStaffType) {
      throw new TargetAlreadyDesiredRankError();
    }

    // Path checks:
    // TM: Player -> PM, Player -> ATM, PM -> ATM
    // ATM: Player -> PM
    const isAllowedPath =
      callerStaffType === 'TEAM_MANAGER'
        ? (targetStaffType === null &&
            ['PLAYER_MANAGER', 'ASSISTANT_MANAGER'].includes(destinationStaffType)) ||
          (targetStaffType === 'PLAYER_MANAGER' && destinationStaffType === 'ASSISTANT_MANAGER')
        : callerStaffType === 'ASSISTANT_MANAGER' &&
          targetStaffType === null &&
          destinationStaffType === 'PLAYER_MANAGER';

    if (!isAllowedPath) {
      throw new InvalidPromotionPathError();
    }

    // Check slot availability
    const occupiedSlot = await memberships.getActiveStaffAppointment(
      callerStaff.clubId,
      destinationStaffType,
    );
    if (occupiedSlot !== null) {
      throw new StaffSlotOccupiedError(toStaffRoleCode(destinationStaffType));
    }

    const destinationStaffRole = toStaffRoleCode(destinationStaffType) as 'ATM' | 'PM';
    const targetStaffRole = targetStaffType === null ? null : toStaffRoleCode(targetStaffType);

    return {
      club: callerStaff.club,
      caller,
      callerStaffType,
      callerStaffRole: toStaffRoleCode(callerStaffType),
      target,
      targetPlayerMembership: targetPlayer,
      targetStaffType,
      targetStaffRole,
      destinationStaffType,
      destinationStaffRole,
    };
  }

  private async loadDemotionEligibility(
    transaction: Prisma.TransactionClient,
    discordGuildId: string,
    callerDiscordUserId: string,
    targetDiscordUserId: string,
  ): Promise<DemotionEligibility> {
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

    if (callerStaff.membershipType !== 'TEAM_MANAGER') {
      throw new InsufficientStaffRankError();
    }

    if (callerDiscordUserId === targetDiscordUserId) {
      throw new SelfActionForbiddenError();
    }

    const target = await users.getByDiscordUserId(targetDiscordUserId);
    if (target === null) throw new MemberIsFreeAgentError();

    const targetPlayer = await memberships.getActivePlayerMembership(guild.id, target.id);
    if (targetPlayer === null) throw new MemberIsFreeAgentError();

    if (targetPlayer.clubId !== callerStaff.clubId) {
      throw new TargetNotOnCallerTeamError();
    }

    const targetStaff = await memberships.getActiveStaffMembershipForUserInGuild(
      guild.id,
      target.id,
    );
    if (
      targetStaff === null ||
      !['ASSISTANT_MANAGER', 'PLAYER_MANAGER'].includes(targetStaff.membershipType)
    ) {
      throw new InvalidDemotionTargetError();
    }

    const targetStaffType = targetStaff.membershipType as Exclude<
      StaffMembershipType,
      'TEAM_MANAGER'
    >;

    return {
      club: callerStaff.club,
      caller,
      callerStaffType: 'TEAM_MANAGER',
      callerStaffRole: 'TM',
      target,
      targetPlayerMembership: targetPlayer,
      targetStaffType,
      targetStaffRole: toStaffRoleCode(targetStaffType) as 'ATM' | 'PM',
    };
  }
}
