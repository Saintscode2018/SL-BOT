import type { ClubMembership, LeagueUser, PrismaClient } from '@prisma/client';

import {
  BotUserNotAllowedError,
  ClubInactiveError,
  EntityNotFoundError,
  NoStaffAppointmentError,
  StaffAlreadyAppointedError,
  TeamPositionOccupiedError,
} from '../domain/errors.js';

import type { MembershipType } from '../domain/enums.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { LeagueTransactionRepository } from '../repositories/transaction-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';

export type StaffType = Exclude<MembershipType, 'PLAYER'>;
export const staffAppointedAuditEventType = 'staff.appointed';
export const staffRemovedAuditEventType = 'staff.removed';

export function getFriendlyPositionName(staffType: StaffType): string {
  switch (staffType) {
    case 'TEAM_MANAGER':
      return 'Team Manager';
    case 'ASSISTANT_MANAGER':
      return 'Assistant Team Manager';
    case 'PLAYER_MANAGER':
      return 'Player Manager';
  }
}

export interface AppointStaffInput {
  authorization: AuthorizationInput;
  clubId: string;
  staffDiscordUserId: string;
  staffType: StaffType;
  staffIsBot: boolean;
  appointedAt?: Date;
}

export interface StaffAppointmentResult {
  membership: ClubMembership;
  user: LeagueUser;
}

export class StaffManagementService {
  public constructor(private readonly database: PrismaClient) {}

  public async appoint(input: AppointStaffInput): Promise<StaffAppointmentResult> {
    if (input.staffIsBot) throw new BotUserNotAllowedError('bots cannot hold staff positions');
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(input.authorization);
    return this.database.$transaction(async (transaction) => {
      const club = await new ClubRepository(transaction).getByIdInGuild(
        input.clubId,
        authorization.guild.id,
      );
      if (club === null) throw new EntityNotFoundError('team was not found');
      if (!club.active) throw new ClubInactiveError('team is inactive');
      const users = new UserRepository(transaction);
      const actor = await users.getOrCreateByDiscordUserId(input.authorization.discordUserId);
      const user = await users.getOrCreateByDiscordUserId(input.staffDiscordUserId);
      const memberships = new MembershipRepository(transaction);

      // check for an existing staff appointment
      const existingUserStaff = await memberships.getActiveStaffMembershipForUserInGuild(
        authorization.guild.id,
        user.id,
      );
      if (existingUserStaff !== null) {
        const posName = getFriendlyPositionName(existingUserStaff.membershipType as StaffType);
        throw new StaffAlreadyAppointedError(
          input.staffDiscordUserId,
          posName,
          existingUserStaff.club.name,
        );
      }

      // check whether the team position is occupied
      const existingPositionStaff = await memberships.getActiveStaffAppointment(
        club.id,
        input.staffType,
      );
      if (existingPositionStaff !== null) {
        const holderUser = await transaction.leagueUser.findUnique({
          where: { id: existingPositionStaff.userId },
        });
        const posName = getFriendlyPositionName(input.staffType);
        throw new TeamPositionOccupiedError(
          posName,
          club.name,
          holderUser?.discordUserId ?? existingPositionStaff.userId,
        );
      }

      const membership = await memberships.createActive({
        guildId: authorization.guild.id,
        clubId: club.id,
        userId: user.id,
        membershipType: input.staffType,
        ...(input.appointedAt === undefined ? {} : { joinedAt: input.appointedAt }),
        createdByUserId: actor.id,
      });
      const leagueTransaction = await new LeagueTransactionRepository(transaction).create({
        guildId: authorization.guild.id,
        userId: user.id,
        transactionType: 'STAFF_APPOINTMENT',
        destinationClubId: club.id,
        performedByUserId: actor.id,
      });
      await new AuditEventRepository(transaction).create({
        guildId: authorization.guild.id,
        actorUserId: actor.id,
        eventType: staffAppointedAuditEventType,
        entityType: 'membership',
        entityId: membership.id,
        afterState: {
          clubId: club.id,
          userId: user.id,
          membershipType: membership.membershipType,
          status: membership.status,
        },
        metadata: { transactionId: leagueTransaction.id },
      });
      return { membership, user };
    });
  }

  public async remove(
    authorizationInput: AuthorizationInput,
    clubId: string,
    staffType: StaffType,
    removedAt = new Date(),
  ): Promise<ClubMembership> {
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(authorizationInput);
    return this.database.$transaction(async (transaction) => {
      const club = await new ClubRepository(transaction).getByIdInGuild(
        clubId,
        authorization.guild.id,
      );
      if (club === null) throw new EntityNotFoundError('team was not found');
      const memberships = new MembershipRepository(transaction);
      const appointment = await memberships.getActiveStaffAppointment(club.id, staffType);
      if (appointment === null) throw new EntityNotFoundError('active staff appointment not found');
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        authorizationInput.discordUserId,
      );
      const ended = await memberships.end(appointment.id, {
        leftAt: removedAt,
        endedByUserId: actor.id,
      });
      await new AuditEventRepository(transaction).create({
        guildId: authorization.guild.id,
        actorUserId: actor.id,
        eventType: staffRemovedAuditEventType,
        entityType: 'membership',
        entityId: appointment.id,
        beforeState: { status: 'ACTIVE', membershipType: appointment.membershipType },
        afterState: { status: 'ENDED', leftAt: removedAt.toISOString() },
      });
      return ended;
    });
  }

  public async list(
    discordGuildId: string,
    clubId: string,
  ): Promise<Array<ClubMembership & { user: LeagueUser }>> {
    const guild = await new GuildRepository(this.database).getByDiscordGuildId(discordGuildId);
    if (guild === null) throw new EntityNotFoundError('server is not configured');
    const club = await new ClubRepository(this.database).getByIdInGuild(clubId, guild.id);
    if (club === null || !club.active) throw new EntityNotFoundError('active team was not found');
    return new MembershipRepository(this.database).listActiveStaffWithUsers(club.id);
  }

  public async getCallerActiveStaffClub(
    discordGuildId: string,
    discordUserId: string,
  ): Promise<{
    id: string;
    name: string;
    shortName: string;
    emoji: string | null;
    logoUrl: string | null;
  }> {
    return this.database.$transaction(async (transaction) => {
      const guild = await new GuildRepository(transaction).getByDiscordGuildId(discordGuildId);
      if (guild === null) throw new EntityNotFoundError('server is not configured');
      const user = await new UserRepository(transaction).getByDiscordUserId(discordUserId);
      if (user === null) throw new NoStaffAppointmentError();
      const staffMembership = await new MembershipRepository(
        transaction,
      ).getActiveStaffMembershipForUserInGuild(guild.id, user.id);
      if (staffMembership === null) throw new NoStaffAppointmentError();
      if (!staffMembership.club.active) throw new ClubInactiveError('team is inactive');
      return staffMembership.club;
    });
  }
}
