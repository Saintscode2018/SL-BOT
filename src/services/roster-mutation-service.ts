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
  StaffAlreadyAppointedError,
  StaffSlotOccupiedError,
  TargetAlreadyDesiredRankError,
  TargetNotStaffError,
  TargetRankNotManageableError,
  TeamManagerCannotDemandError,
} from '../domain/errors.js';
import type { LeagueTransactionType } from '../domain/enums.js';
import type {
  MemberRoleMutationPlan,
  MutationPlans,
  PlannedDiscordRole,
  StaffMembershipType,
  TransferAnnouncementType,
} from '../domain/roster-mutation.js';
import { toStaffRoleCode } from '../domain/roster-mutation.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { formatTeamIdentity } from '../domain/team-label.js';
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
  occurredAt?: Date;
}

export interface StaffMutationInput extends MemberMutationInput {
  staffType: StaffMembershipType;
}

export interface RosterMutationResult extends MutationPlans {
  guild: Guild;
  club: Club;
  user: LeagueUser;
  playerMembership: ClubMembership;
  staffMembership: ClubMembership | null;
  previousStaffType: StaffMembershipType | null;
  transaction: LeagueTransaction;
  announcementDelivered?: boolean | null;
}

interface MutationContext {
  guild: Guild;
  settings: GuildSettings | null;
  club: Club;
  actor: LeagueUser;
  user: LeagueUser;
  memberships: MembershipRepository;
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
    const rolePlan = await this.database.$transaction(async (transaction) => {
      const context = await this.loadContext(
        transaction,
        input,
        kind === 'APPOINT' || kind === 'SIGN',
      );
      return this.validateAndPlan(transaction, context, kind, input);
    });
    const mutate = () =>
      this.database.$transaction(async (transaction) => {
        const context = await this.loadContext(
          transaction,
          input,
          kind === 'APPOINT' || kind === 'SIGN',
        );
        const commitRolePlan = await this.validateAndPlan(transaction, context, kind, input);
        return this.mutate(transaction, context, kind, input, commitRolePlan);
      });
    if (this.synchronization === undefined) return mutate();
    return this.synchronization.execute(rolePlan, mutate);
  }

  private async loadContext(
    transaction: Prisma.TransactionClient,
    input: MemberMutationInput,
    createTarget: boolean,
  ): Promise<MutationContext> {
    const guilds = new GuildRepository(transaction);
    const guild = await guilds.getByDiscordGuildId(input.discordGuildId);
    if (guild === null) throw new EntityNotFoundError('server is not configured');
    const club = await new ClubRepository(transaction).getByIdInGuild(input.clubId, guild.id);
    if (club === null) throw new EntityNotFoundError('team was not found');
    if (!club.active) throw new ClubInactiveError('team is inactive');
    const users = new UserRepository(transaction);
    const actor = await users.getOrCreateByDiscordUserId(input.actorDiscordUserId);
    const existingUser = await users.getByDiscordUserId(input.targetDiscordUserId);
    if (existingUser === null && !createTarget) throw new MemberIsFreeAgentError();
    const user =
      existingUser ?? (await users.getOrCreateByDiscordUserId(input.targetDiscordUserId));
    return {
      guild,
      settings: await guilds.getSettings(guild.id),
      club,
      actor,
      user,
      memberships: new MembershipRepository(transaction),
    };
  }

  private async validateAndPlan(
    transaction: Prisma.TransactionClient,
    context: MutationContext,
    kind: MutationKind,
    input: MemberMutationInput | StaffMutationInput,
  ): Promise<MemberRoleMutationPlan> {
    const player = await context.memberships.getActivePlayerMembership(
      context.guild.id,
      context.user.id,
    );
    const staff = await context.memberships.getActiveStaffMembershipForUserInGuild(
      context.guild.id,
      context.user.id,
    );
    const actorStaff = await context.memberships.getActiveStaffMembershipForUserInGuild(
      context.guild.id,
      context.actor.id,
    );
    const addRoles: PlannedDiscordRole[] = [];
    const removeRoles: PlannedDiscordRole[] = [];

    if (kind === 'APPOINT') {
      const desired = (input as StaffMutationInput).staffType;
      if (staff !== null) {
        throw new StaffAlreadyAppointedError(
          context.user.discordUserId,
          toStaffRoleCode(staff.membershipType as StaffMembershipType),
          formatTeamIdentity(staff.club, 'message'),
        );
      }
      if (player !== null && player.clubId !== context.club.id)
        throw new MemberAlreadySignedError();
      await this.assertSlotOpen(transaction, context.club.id, desired);
      if (player === null) await this.assertCapacity(context);
      addRoles.push(this.teamRole(context), this.staffRole(context.settings, desired));
    } else if (kind === 'SIGN') {
      if (player !== null || staff !== null) throw new MemberAlreadySignedError();
      await this.assertCapacity(context);
      addRoles.push(this.teamRole(context));
    } else {
      if (player === null) throw new MemberIsFreeAgentError();
      if (player.clubId !== context.club.id) throw new MemberNotOnTeamError();

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
        const desired = (input as StaffMutationInput).staffType;
        this.assertPromotion(actorStaff, staff, desired, context.club.id);
        if (staff?.membershipType === desired) throw new TargetAlreadyDesiredRankError();
        await this.assertSlotOpen(transaction, context.club.id, desired);
        addRoles.push(this.staffRole(context.settings, desired));
        if (staff !== null) {
          removeRoles.push(
            this.staffRole(context.settings, staff.membershipType as StaffMembershipType),
          );
        }
      }
      if (kind === 'DEMOTE') {
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
      if (kind === 'LEAVE_STAFF' && staff !== null) {
        removeRoles.push(
          this.staffRole(context.settings, staff.membershipType as StaffMembershipType),
        );
      }
      if (kind === 'LEAVE_TEAM' || kind === 'RELEASE') {
        removeRoles.push(this.teamRole(context));
        if (staff !== null) {
          removeRoles.push(
            this.staffRole(context.settings, staff.membershipType as StaffMembershipType),
          );
        }
      }
    }

    return {
      discordGuildId: context.guild.discordGuildId,
      discordUserId: context.user.discordUserId,
      addRoles,
      removeRoles,
    };
  }

  private async mutate(
    transactionClient: Prisma.TransactionClient,
    context: MutationContext,
    kind: MutationKind,
    input: MemberMutationInput | StaffMutationInput,
    roleMutation: MemberRoleMutationPlan,
  ): Promise<RosterMutationResult> {
    const occurredAt = input.occurredAt ?? new Date();
    let player = await context.memberships.getActivePlayerMembership(
      context.guild.id,
      context.user.id,
    );
    let staff: ClubMembership | null =
      await context.memberships.getActiveStaffMembershipForUserInGuild(
        context.guild.id,
        context.user.id,
      );
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
      if (player === null) throw new MemberIsFreeAgentError();
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
        if (staff !== null) {
          staff = await context.memberships.end(staff.id, {
            leftAt: occurredAt,
            endedByUserId: context.actor.id,
          });
        }
        player = await context.memberships.end(player.id, {
          leftAt: occurredAt,
          endedByUserId: context.actor.id,
        });
        transactionType = kind === 'LEAVE_TEAM' ? 'DEMAND_RELEASE' : 'RELEASE';
      }
    }

    if (player === null) throw new MemberIsFreeAgentError();
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
    const announcement = this.buildAnnouncement(
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
      roleMutation,
      announcement,
    };
  }

  private buildAnnouncement(
    context: MutationContext,
    kind: MutationKind,
    input: MemberMutationInput | StaffMutationInput,
    resultingStaff: ClubMembership | null,
    previousStaffType: StaffMembershipType | null,
    occurredAt: Date,
  ): MutationPlans['announcement'] {
    const staffCode =
      kind === 'APPOINT' || kind === 'PROMOTE'
        ? toStaffRoleCode((input as StaffMutationInput).staffType)
        : resultingStaff === null
          ? undefined
          : toStaffRoleCode(
              previousStaffType ?? (resultingStaff.membershipType as StaffMembershipType),
            );
    const appointedStaffRole =
      kind === 'APPOINT'
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
    };
  }

  private assertMayRelease(
    actorStaff: (ClubMembership & { club: Club }) | null,
    targetStaff: (ClubMembership & { club: Club }) | null,
    clubId: string,
  ): void {
    if (actorStaff?.clubId !== clubId) throw new InsufficientStaffRankError();
    const actorRank = actorStaff.membershipType;
    const targetRank = targetStaff?.membershipType ?? 'PLAYER';
    const permitted =
      actorRank === 'TEAM_MANAGER'
        ? targetRank !== 'TEAM_MANAGER'
        : actorRank === 'ASSISTANT_MANAGER'
          ? ['PLAYER', 'PLAYER_MANAGER'].includes(targetRank)
          : actorRank === 'PLAYER_MANAGER' && targetRank === 'PLAYER';
    if (!permitted) throw new TargetRankNotManageableError();
  }

  private assertPromotion(
    actorStaff: (ClubMembership & { club: Club }) | null,
    targetStaff: (ClubMembership & { club: Club }) | null,
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
    transaction: Prisma.TransactionClient,
    clubId: string,
    staffType: StaffMembershipType,
  ): Promise<void> {
    const occupied = await new MembershipRepository(transaction).getActiveStaffAppointment(
      clubId,
      staffType,
    );
    if (occupied !== null) throw new StaffSlotOccupiedError(toStaffRoleCode(staffType));
  }

  private async assertCapacity(context: MutationContext): Promise<void> {
    const count = await context.memberships.countActivePlayers(context.club.id);
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
