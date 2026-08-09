import type {
  Club,
  ClubMembership,
  Guild,
  GuildSettings,
  LeagueTransaction,
  LeagueUser,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import {
  ClubInactiveError,
  DiscordRoleMissingError,
  EntityNotFoundError,
  InsufficientStaffRankError,
  InvalidDemotionTargetError,
  InvalidPromotionPathError,
  MemberAlreadySignedError,
  MemberIsFreeAgentError,
  MemberNotOnTeamError,
  SelfActionForbiddenError,
  SquadFullError,
  StaleMutationStateError,
  StaleConfirmationError,
  StaffAlreadyAppointedError,
  StaffSlotOccupiedError,
  TargetAlreadyDesiredRankError,
  TargetNotStaffError,
  TargetRankNotManageableError,
  TeamManagerCannotDemandError,
} from '../domain/errors.js';
import type { LeagueTransactionType } from '../domain/enums.js';
import type {
  AuditAnnouncementOperation,
  AuditAnnouncementPlan,
  MemberRoleMutationPlan,
  MutationPlans,
  PlannedDiscordRole,
  StaffMembershipType,
  TransferAnnouncementType,
} from '../domain/roster-mutation.js';
import { toStaffRoleCode } from '../domain/roster-mutation.js';
import { canReleaseStaffRole } from '../domain/roster-mutation.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import type { DatabaseClient } from '../domain/types.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { LeagueTransactionRepository } from '../repositories/transaction-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { RoleSynchronizedMutationService } from './role-synchronized-mutation-service.js';

export interface MemberMutationInput {
  discordGuildId: string;
  clubId: string;
  actorDiscordUserId: string;
  targetDiscordUserId: string;
  expectedStaffType?: StaffMembershipType | null;
  expectedActorStaffType?: StaffMembershipType | null;
  occurredAt?: Date;
}

export interface StaffMutationInput extends MemberMutationInput {
  staffType: StaffMembershipType;
}

export interface RosterMutationResult extends MutationPlans {
  guild: Guild;
  club: Club;
  user: LeagueUser;
  playerMembership: ClubMembership | null;
  staffMembership: ClubMembership | null;
  previousStaffType: StaffMembershipType | null;
  transaction: LeagueTransaction;
  announcementDelivered?: boolean | null;
  auditAnnouncementDelivered?: boolean | null;
}

interface MutationContext {
  guild: Guild;
  settings: GuildSettings | null;
  club: Club;
  actor: LeagueUser;
  user: LeagueUser;
  memberships: MembershipRepository;
}

interface PlannedMutation {
  rolePlan: MemberRoleMutationPlan;
  teamMemberships: ClubMembership[];
  player: ClubMembership | null;
  staff: ClubMembership | null;
}

type MutationKind =
  | 'APPOINT'
  | 'REMOVE_STAFF'
  | 'LEAVE_STAFF'
  | 'LEAVE_TEAM'
  | 'RELEASE'
  | 'PROMOTE'
  | 'DEMOTE'
  | 'SIGN';

// The write transaction contains only Prisma work, but SQLite lock contention can consume the
// default five-second budget. Keep this override local to roster mutations after minimizing queries.
export const rosterMutationTransactionTimeoutMs = 10_000;

function sameRolePlan(left: MemberRoleMutationPlan, right: MemberRoleMutationPlan): boolean {
  return (
    left.discordGuildId === right.discordGuildId &&
    left.discordUserId === right.discordUserId &&
    JSON.stringify(left.addRoles) === JSON.stringify(right.addRoles) &&
    JSON.stringify(left.removeRoles) === JSON.stringify(right.removeRoles)
  );
}

export class RosterMutationService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly synchronization?: Pick<RoleSynchronizedMutationService, 'execute'>,
  ) {}

  public appointStaffImmediately(input: StaffMutationInput): Promise<RosterMutationResult> {
    return this.execute('APPOINT', input);
  }

  public removeStaffAppointmentImmediately(
    input: StaffMutationInput,
  ): Promise<RosterMutationResult> {
    return this.execute('REMOVE_STAFF', input);
  }

  public endStaffAppointmentOnly(input: MemberMutationInput): Promise<RosterMutationResult> {
    return this.execute('LEAVE_STAFF', input);
  }

  public leaveTeamCompletely(input: MemberMutationInput): Promise<RosterMutationResult> {
    return this.execute('LEAVE_TEAM', input);
  }

  public releaseMemberCompletely(input: MemberMutationInput): Promise<RosterMutationResult> {
    return this.execute('RELEASE', input);
  }

  public promoteRosterMember(input: StaffMutationInput): Promise<RosterMutationResult> {
    return this.execute('PROMOTE', input);
  }

  public demoteStaffToPlayer(input: MemberMutationInput): Promise<RosterMutationResult> {
    return this.execute('DEMOTE', input);
  }

  public signFreeAgent(input: MemberMutationInput): Promise<RosterMutationResult> {
    return this.execute('SIGN', input);
  }

  private async execute(
    kind: MutationKind,
    input: MemberMutationInput | StaffMutationInput,
  ): Promise<RosterMutationResult> {
    const planningContext = await this.loadContext(
      this.database,
      input,
      kind === 'APPOINT' || kind === 'SIGN',
    );
    const rolePlan = (await this.validateAndPlan(this.database, planningContext, kind, input))
      .rolePlan;
    const mutate = () =>
      this.database.$transaction(
        async (transaction) => {
          const context = await this.loadContext(
            transaction,
            input,
            kind === 'APPOINT' || kind === 'SIGN',
          );
          const commitPlan = await this.validateAndPlan(transaction, context, kind, input);
          if (!sameRolePlan(rolePlan, commitPlan.rolePlan)) throw new StaleMutationStateError();
          return this.mutate(transaction, context, kind, input, commitPlan);
        },
        { timeout: rosterMutationTransactionTimeoutMs },
      );
    if (this.synchronization === undefined) return mutate();
    return this.synchronization.execute(rolePlan, mutate);
  }

  private async loadContext(
    database: DatabaseClient,
    input: MemberMutationInput,
    createTarget: boolean,
  ): Promise<MutationContext> {
    const guilds = new GuildRepository(database);
    const guild = await guilds.getByDiscordGuildId(input.discordGuildId);
    if (guild === null) throw new EntityNotFoundError('server is not configured');
    const users = new UserRepository(database);
    const [club, settings, actor] = await Promise.all([
      new ClubRepository(database).getByIdInGuild(input.clubId, guild.id),
      guilds.getSettings(guild.id),
      users.getOrCreateByDiscordUserId(input.actorDiscordUserId),
    ]);
    if (club === null) throw new EntityNotFoundError('team was not found');
    if (!club.active) throw new ClubInactiveError('team is inactive');
    const existingUser =
      input.targetDiscordUserId === input.actorDiscordUserId
        ? actor
        : await users.getByDiscordUserId(input.targetDiscordUserId);
    if (existingUser === null && !createTarget) throw new MemberIsFreeAgentError();
    const user =
      existingUser ?? (await users.getOrCreateByDiscordUserId(input.targetDiscordUserId));
    return {
      guild,
      settings,
      club,
      actor,
      user,
      memberships: new MembershipRepository(database),
    };
  }

  private async validateAndPlan(
    database: DatabaseClient,
    context: MutationContext,
    kind: MutationKind,
    input: MemberMutationInput | StaffMutationInput,
  ): Promise<PlannedMutation> {
    const [activeMemberships, actorStaff] = await Promise.all([
      context.memberships.listActiveMembershipsForUserInGuild(context.guild.id, context.user.id),
      context.memberships.getActiveStaffMembershipForUser(context.club.id, context.actor.id),
    ]);
    const teamMemberships = activeMemberships.filter(({ clubId }) => clubId === context.club.id);
    const player =
      teamMemberships.find(({ membershipType }) => membershipType === 'PLAYER') ?? null;
    const staff =
      teamMemberships.find(({ membershipType }) => membershipType === 'TEAM_MANAGER') ??
      teamMemberships.find(({ membershipType }) => membershipType === 'ASSISTANT_MANAGER') ??
      teamMemberships.find(({ membershipType }) => membershipType === 'PLAYER_MANAGER') ??
      null;
    const addRoles: PlannedDiscordRole[] = [];
    const removeRoles: PlannedDiscordRole[] = [];

    if (kind === 'APPOINT') {
      const desired = (input as StaffMutationInput).staffType;
      const existingStaff = await context.memberships.getActiveStaffMembershipForUserInGuild(
        context.guild.id,
        context.user.id,
      );
      if (existingStaff !== null) {
        throw new StaffAlreadyAppointedError(
          context.user.discordUserId,
          toStaffRoleCode(existingStaff.membershipType as StaffMembershipType),
          formatTeamIdentity(existingStaff.club, 'message'),
        );
      }
      if (activeMemberships.some(({ clubId }) => clubId !== context.club.id)) {
        throw new MemberAlreadySignedError();
      }
      await this.assertSlotOpen(database, context.club.id, desired);
      if (teamMemberships.length === 0) await this.assertCapacity(context);
      addRoles.push(this.teamRole(context), this.staffRole(context.settings, desired));
    } else if (kind === 'SIGN') {
      if (activeMemberships.length > 0) throw new MemberAlreadySignedError();
      await this.assertCapacity(context);
      addRoles.push(this.teamRole(context));
    } else {
      const confirmationBound =
        input.expectedStaffType !== undefined || input.expectedActorStaffType !== undefined;
      if (teamMemberships.length === 0) {
        if (confirmationBound) throw new StaleConfirmationError();
        if (activeMemberships.length === 0) throw new MemberIsFreeAgentError();
        throw new MemberNotOnTeamError();
      }
      if (
        input.expectedStaffType !== undefined &&
        (staff?.membershipType ?? null) !== input.expectedStaffType
      ) {
        throw new StaleConfirmationError();
      }
      if (
        input.expectedActorStaffType !== undefined &&
        (actorStaff?.membershipType ?? null) !== input.expectedActorStaffType
      ) {
        throw new StaleConfirmationError();
      }

      if (kind === 'LEAVE_STAFF' || kind === 'LEAVE_TEAM') {
        if (context.actor.id !== context.user.id) throw new SelfActionForbiddenError();
        if (staff?.membershipType === 'TEAM_MANAGER') throw new TeamManagerCannotDemandError();
        if (kind === 'LEAVE_STAFF' && staff === null) throw new TargetNotStaffError();
      }
      if (kind === 'RELEASE') {
        if (context.actor.id === context.user.id) throw new SelfActionForbiddenError();
        this.assertMayRelease(actorStaff, staff, context.club.id);
      }
      if (kind === 'PROMOTE') {
        if (context.actor.id === context.user.id) throw new SelfActionForbiddenError();
        const desired = (input as StaffMutationInput).staffType;
        this.assertPromotion(actorStaff, staff, desired, context.club.id);
        if (staff?.membershipType === desired) throw new TargetAlreadyDesiredRankError();
        await this.assertSlotOpen(database, context.club.id, desired);
        addRoles.push(this.staffRole(context.settings, desired));
        if (staff !== null) {
          removeRoles.push(
            this.staffRole(context.settings, staff.membershipType as StaffMembershipType),
          );
        }
      }
      if (kind === 'DEMOTE') {
        if (context.actor.id === context.user.id) throw new SelfActionForbiddenError();
        if (
          actorStaff?.clubId !== context.club.id ||
          actorStaff.membershipType !== 'TEAM_MANAGER'
        ) {
          throw new InsufficientStaffRankError();
        }
        if (
          staff === null ||
          !['ASSISTANT_MANAGER', 'PLAYER_MANAGER'].includes(staff.membershipType)
        ) {
          throw new InvalidDemotionTargetError();
        }
        removeRoles.push(
          this.staffRole(context.settings, staff.membershipType as StaffMembershipType),
        );
      }
      if (kind === 'REMOVE_STAFF') {
        if (staff === null || staff.clubId !== context.club.id) throw new TargetNotStaffError();
        const expected = (input as StaffMutationInput).staffType;
        if (staff.membershipType !== expected) throw new TargetNotStaffError();
        removeRoles.push(this.staffRole(context.settings, staff.membershipType));
      }
      if ((kind === 'REMOVE_STAFF' || kind === 'LEAVE_STAFF') && player === null) {
        removeRoles.push(this.teamRole(context));
      }
      if (kind === 'LEAVE_STAFF' && staff !== null) {
        removeRoles.push(
          this.staffRole(context.settings, staff.membershipType as StaffMembershipType),
        );
      }
      if (kind === 'LEAVE_TEAM' || kind === 'RELEASE') {
        removeRoles.push(this.teamRole(context));
        for (const staffMembership of teamMemberships.filter(
          ({ membershipType }) => membershipType !== 'PLAYER',
        )) {
          removeRoles.push(
            this.staffRole(context.settings, staffMembership.membershipType as StaffMembershipType),
          );
        }
      }
    }

    return {
      rolePlan: {
        discordGuildId: context.guild.discordGuildId,
        discordUserId: context.user.discordUserId,
        addRoles,
        removeRoles,
      },
      teamMemberships,
      player,
      staff,
    };
  }

  private async mutate(
    transactionClient: Prisma.TransactionClient,
    context: MutationContext,
    kind: MutationKind,
    input: MemberMutationInput | StaffMutationInput,
    plan: PlannedMutation,
  ): Promise<RosterMutationResult> {
    const occurredAt = input.occurredAt ?? new Date();
    let player = plan.player;
    if (player?.clubId !== context.club.id) player = null;
    let staff = plan.staff;
    const previousStaffType = staff === null ? null : (staff.membershipType as StaffMembershipType);
    let transactionType: LeagueTransactionType;
    let staffAudit: {
      membership: ClubMembership;
      eventType: 'staff.appointed' | 'staff.removed';
      endedAt: Date | null;
    } | null = null;

    if (kind === 'APPOINT') {
      const desired = (input as StaffMutationInput).staffType;
      player ??= await context.memberships.createActive({
        guildId: context.guild.id,
        clubId: context.club.id,
        userId: context.user.id,
        membershipType: 'PLAYER',
        joinedAt: occurredAt,
        createdByUserId: context.actor.id,
      });
      staff = await context.memberships.createActive({
        guildId: context.guild.id,
        clubId: context.club.id,
        userId: context.user.id,
        membershipType: desired,
        joinedAt: occurredAt,
        createdByUserId: context.actor.id,
      });
      transactionType = 'STAFF_APPOINTMENT';
      staffAudit = { membership: staff, eventType: 'staff.appointed', endedAt: null };
    } else if (kind === 'SIGN') {
      player = await context.memberships.createActive({
        guildId: context.guild.id,
        clubId: context.club.id,
        userId: context.user.id,
        membershipType: 'PLAYER',
        joinedAt: occurredAt,
        createdByUserId: context.actor.id,
      });
      transactionType = 'SIGNING';
    } else {
      if (kind === 'PROMOTE') {
        const desired = (input as StaffMutationInput).staffType;
        if (staff !== null) {
          await context.memberships.end(staff.id, {
            leftAt: occurredAt,
            endedByUserId: context.actor.id,
          });
        }
        staff = await context.memberships.createActive({
          guildId: context.guild.id,
          clubId: context.club.id,
          userId: context.user.id,
          membershipType: desired,
          joinedAt: occurredAt,
          createdByUserId: context.actor.id,
        });
        transactionType = 'STAFF_PROMOTION';
      } else if (kind === 'DEMOTE' || kind === 'REMOVE_STAFF' || kind === 'LEAVE_STAFF') {
        if (staff === null) throw new TargetNotStaffError();
        if (kind === 'DEMOTE' && player === null) {
          player = await context.memberships.createActive({
            guildId: context.guild.id,
            clubId: context.club.id,
            userId: context.user.id,
            membershipType: 'PLAYER',
            joinedAt: occurredAt,
            createdByUserId: context.actor.id,
          });
        }
        const ended = await context.memberships.end(staff.id, {
          leftAt: occurredAt,
          endedByUserId: context.actor.id,
        });
        if (kind === 'REMOVE_STAFF') {
          staffAudit = {
            membership: ended,
            eventType: 'staff.removed',
            endedAt: occurredAt,
          };
        }
        staff = ended;
        transactionType = 'STAFF_DEMOTION';
      } else {
        const endedMemberships = await context.memberships.endActiveForUserOnClub(
          context.club.id,
          context.user.id,
          { leftAt: occurredAt, endedByUserId: context.actor.id },
        );
        if (endedMemberships.length !== plan.teamMemberships.length) {
          throw new StaleMutationStateError();
        }
        for (const ended of endedMemberships) {
          if (ended.membershipType === 'PLAYER') player = ended;
          else if (staff?.id === ended.id) staff = ended;
        }
        transactionType = kind === 'LEAVE_TEAM' ? 'DEMAND_RELEASE' : 'RELEASE';
      }
    }

    const leagueTransaction = await new LeagueTransactionRepository(transactionClient).create({
      guildId: context.guild.id,
      userId: context.user.id,
      transactionType,
      sourceClubId: ['SIGNING', 'STAFF_APPOINTMENT'].includes(transactionType)
        ? null
        : context.club.id,
      destinationClubId:
        transactionType === 'SIGNING' || transactionType === 'STAFF_APPOINTMENT'
          ? context.club.id
          : null,
      performedByUserId: context.actor.id,
    });
    if (staffAudit !== null) {
      await this.writeStaffAudit(
        transactionClient,
        context,
        staffAudit.membership,
        staffAudit.eventType,
        staffAudit.endedAt,
        leagueTransaction.id,
      );
    }
    const [currentRosterSize, teamManagerMembership] = await Promise.all([
      context.memberships.countActiveUniqueMembers(context.club.id),
      context.memberships.getActiveStaffAppointmentWithUser(context.club.id, 'TEAM_MANAGER'),
    ]);
    const announcement = this.buildAnnouncement(
      context,
      kind,
      input,
      player,
      staff,
      previousStaffType,
      occurredAt,
      currentRosterSize,
      teamManagerMembership?.user.discordUserId ?? null,
    );
    const auditAnnouncement = this.buildAuditAnnouncement(
      context,
      kind,
      input,
      staff,
      previousStaffType,
      occurredAt,
    );
    return {
      guild: context.guild,
      club: context.club,
      user: context.user,
      playerMembership: player,
      staffMembership: staff,
      previousStaffType,
      transaction: leagueTransaction,
      roleMutation: plan.rolePlan,
      announcement,
      auditAnnouncement,
    };
  }

  private buildAnnouncement(
    context: MutationContext,
    kind: MutationKind,
    input: MemberMutationInput | StaffMutationInput,
    resultingPlayer: ClubMembership | null,
    resultingStaff: ClubMembership | null,
    previousStaffType: StaffMembershipType | null,
    occurredAt: Date,
    currentRosterSize: number,
    teamManagerDiscordUserId: string | null,
  ): MutationPlans['announcement'] {
    const staffCode =
      kind === 'APPOINT' || kind === 'PROMOTE'
        ? toStaffRoleCode((input as StaffMutationInput).staffType)
        : previousStaffType !== null
          ? toStaffRoleCode(previousStaffType)
          : resultingStaff !== null
            ? toStaffRoleCode(resultingStaff.membershipType as StaffMembershipType)
            : undefined;
    const appointedStaffRole =
      kind === 'APPOINT' || kind === 'PROMOTE'
        ? this.staffRole(context.settings, (input as StaffMutationInput).staffType)
        : null;
    const announcementType: TransferAnnouncementType =
      kind === 'APPOINT'
        ? 'APPOINTED'
        : kind === 'SIGN'
          ? 'SIGNED'
          : kind === 'LEAVE_TEAM'
            ? 'DEMANDED'
            : kind === 'RELEASE'
              ? 'RELEASED'
              : kind === 'PROMOTE'
                ? 'PROMOTED'
                : 'DEMOTED';
    if (
      context.settings?.transferChannelId === null ||
      context.settings?.transferChannelId === undefined
    ) {
      return null;
    }
    return {
      discordGuildId: context.guild.discordGuildId,
      channelId: context.settings.transferChannelId,
      type: announcementType,
      discordUserId: context.user.discordUserId,
      teamIdentity: context.club,
      occurredAt,
      actorDiscordUserId: context.actor.discordUserId,
      ...(staffCode === undefined ? {} : { staffRole: staffCode }),
      ...(appointedStaffRole === null ? {} : { staffRoleId: appointedStaffRole.id }),
      ...(kind === 'LEAVE_STAFF'
        ? {
            departureMode: 'STAFF_ONLY' as const,
            retainsPlayerMembership: resultingPlayer?.status === 'ACTIVE',
          }
        : kind === 'LEAVE_TEAM'
          ? { departureMode: 'FULL' as const }
          : kind === 'REMOVE_STAFF' || kind === 'DEMOTE'
            ? { retainsPlayerMembership: resultingPlayer?.status === 'ACTIVE' }
            : {}),
      roster: {
        currentSize: currentRosterSize,
        maximumSize: getEffectiveSquadLimit(context.club, context.settings),
        teamManagerDiscordUserId,
      },
    };
  }

  private buildAuditAnnouncement(
    context: MutationContext,
    kind: MutationKind,
    input: MemberMutationInput | StaffMutationInput,
    resultingStaff: ClubMembership | null,
    previousStaffType: StaffMembershipType | null,
    occurredAt: Date,
  ): AuditAnnouncementPlan | null {
    if (
      context.settings?.auditChannelId === null ||
      context.settings?.auditChannelId === undefined
    ) {
      return null;
    }
    const staffCode =
      kind === 'APPOINT' || kind === 'PROMOTE'
        ? toStaffRoleCode((input as StaffMutationInput).staffType)
        : previousStaffType !== null
          ? toStaffRoleCode(previousStaffType)
          : resultingStaff !== null
            ? toStaffRoleCode(resultingStaff.membershipType as StaffMembershipType)
            : undefined;
    const operation: AuditAnnouncementOperation =
      kind === 'APPOINT'
        ? 'STAFF_APPOINTED'
        : kind === 'REMOVE_STAFF'
          ? 'STAFF_REMOVED'
          : kind === 'SIGN'
            ? 'ROSTER_PLAYER_ADDED'
            : kind === 'LEAVE_TEAM' || kind === 'LEAVE_STAFF'
              ? 'ROSTER_DEMANDED'
              : kind === 'RELEASE'
                ? 'ROSTER_RELEASED'
                : kind === 'PROMOTE'
                  ? 'ROSTER_PROMOTED'
                  : 'ROSTER_DEMOTED';

    return {
      discordGuildId: context.guild.discordGuildId,
      channelId: context.settings.auditChannelId,
      operation,
      actorDiscordUserId: context.actor.discordUserId,
      playerDiscordUserId: context.user.discordUserId,
      teamIdentity: context.club,
      occurredAt,
      ...(staffCode === undefined ? {} : { staffRole: staffCode }),
      ...(kind === 'LEAVE_STAFF'
        ? { departureMode: 'STAFF_ONLY' as const }
        : kind === 'LEAVE_TEAM'
          ? { departureMode: 'FULL' as const }
          : {}),
    };
  }

  private assertMayRelease(
    actorStaff: ClubMembership | null,
    targetStaff: ClubMembership | null,
    clubId: string,
  ): void {
    if (actorStaff?.clubId !== clubId) throw new InsufficientStaffRankError();
    const actorRole = toStaffRoleCode(actorStaff.membershipType as StaffMembershipType);
    const targetRole =
      targetStaff === null
        ? null
        : toStaffRoleCode(targetStaff.membershipType as StaffMembershipType);
    if (!canReleaseStaffRole(actorRole, targetRole)) throw new TargetRankNotManageableError();
  }

  private assertPromotion(
    actorStaff: ClubMembership | null,
    targetStaff: ClubMembership | null,
    desired: StaffMembershipType,
    clubId: string,
  ): void {
    if (actorStaff?.clubId !== clubId) throw new InsufficientStaffRankError();
    const current = targetStaff?.membershipType ?? 'PLAYER';
    const allowed =
      actorStaff.membershipType === 'TEAM_MANAGER'
        ? (current === 'PLAYER' && ['PLAYER_MANAGER', 'ASSISTANT_MANAGER'].includes(desired)) ||
          (current === 'PLAYER_MANAGER' && desired === 'ASSISTANT_MANAGER')
        : actorStaff.membershipType === 'ASSISTANT_MANAGER' &&
          current === 'PLAYER' &&
          desired === 'PLAYER_MANAGER';
    if (!allowed) throw new InvalidPromotionPathError();
  }

  private async assertSlotOpen(
    database: DatabaseClient,
    clubId: string,
    staffType: StaffMembershipType,
  ): Promise<void> {
    const occupied = await new MembershipRepository(database).getActiveStaffAppointment(
      clubId,
      staffType,
    );
    if (occupied !== null) throw new StaffSlotOccupiedError(toStaffRoleCode(staffType));
  }

  private async assertCapacity(context: MutationContext): Promise<void> {
    const count = await context.memberships.countActiveUniqueMembers(context.club.id);
    if (count >= getEffectiveSquadLimit(context.club, context.settings)) {
      throw new SquadFullError('team has reached its squad limit');
    }
  }

  private teamRole(context: MutationContext): PlannedDiscordRole {
    return { id: context.club.discordRoleId, purpose: 'TEAM' };
  }

  private staffRole(
    settings: GuildSettings | null,
    staffType: StaffMembershipType,
  ): PlannedDiscordRole {
    const purpose = toStaffRoleCode(staffType);
    const id =
      purpose === 'TM'
        ? settings?.teamManagerRoleId
        : purpose === 'ATM'
          ? settings?.assistantManagerRoleId
          : settings?.playerManagerRoleId;
    if (id === null || id === undefined) throw new DiscordRoleMissingError(purpose);
    return { id, purpose };
  }

  private async writeStaffAudit(
    transactionClient: Prisma.TransactionClient,
    context: MutationContext,
    membership: ClubMembership,
    eventType: 'staff.appointed' | 'staff.removed',
    endedAt: Date | null,
    transactionId: string,
  ): Promise<void> {
    await new AuditEventRepository(transactionClient).create({
      guildId: context.guild.id,
      actorUserId: context.actor.id,
      eventType,
      entityType: 'membership',
      entityId: membership.id,
      ...(endedAt === null
        ? {
            afterState: {
              clubId: context.club.id,
              userId: context.user.id,
              membershipType: membership.membershipType,
              status: membership.status,
            },
          }
        : {
            beforeState: { status: 'ACTIVE', membershipType: membership.membershipType },
            afterState: { status: 'ENDED', leftAt: endedAt.toISOString() },
          }),
      metadata: { transactionId },
    });
  }
}
