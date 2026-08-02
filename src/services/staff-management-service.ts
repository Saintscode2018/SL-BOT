import type { Club, ClubMembership, LeagueUser, PrismaClient } from '@prisma/client';

import {
  BotUserNotAllowedError,
  EntityNotFoundError,
  InactiveSourceTeamError,
  NoStaffAppointmentError,
} from '../domain/errors.js';

import type { MembershipType } from '../domain/enums.js';
import type { MemberRoleMutationPlan } from '../domain/roster-mutation.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';
import { RosterMutationService } from './roster-mutation-service.js';

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
  club: Club;
}

export interface StaffRemovalResult {
  membership: ClubMembership;
  user: LeagueUser;
  club: Club;
  previousStaffType: StaffType;
  roleMutation: MemberRoleMutationPlan;
  announcementDelivered?: boolean | null;
}

export class StaffManagementService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly mutations = new RosterMutationService(database),
  ) {}

  public async appoint(input: AppointStaffInput): Promise<StaffAppointmentResult> {
    if (input.staffIsBot) throw new BotUserNotAllowedError('bots cannot hold staff positions');
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(input.authorization);
    const result = await this.mutations.appointStaffImmediately({
      discordGuildId: authorization.guild.discordGuildId,
      clubId: input.clubId,
      actorDiscordUserId: input.authorization.discordUserId,
      targetDiscordUserId: input.staffDiscordUserId,
      staffType: input.staffType,
      ...(input.appointedAt === undefined ? {} : { occurredAt: input.appointedAt }),
    });
    if (result.staffMembership === null) throw new EntityNotFoundError('staff appointment missing');
    return {
      membership: result.staffMembership,
      user: result.user,
      club: result.club,
    };
  }

  public async remove(
    authorizationInput: AuthorizationInput,
    clubId: string,
    staffType: StaffType,
    removedAt = new Date(),
  ): Promise<StaffRemovalResult> {
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(authorizationInput);
    const appointment = await new MembershipRepository(this.database).getActiveStaffAppointment(
      clubId,
      staffType,
    );
    if (appointment === null) throw new EntityNotFoundError('active staff appointment not found');
    const user = await new UserRepository(this.database).getById(appointment.userId);
    if (user === null) throw new EntityNotFoundError('appointed staff user was not found');
    const result = await this.mutations.removeStaffAppointmentImmediately({
      discordGuildId: authorization.guild.discordGuildId,
      clubId,
      actorDiscordUserId: authorizationInput.discordUserId,
      targetDiscordUserId: user.discordUserId,
      staffType,
      occurredAt: removedAt,
    });
    if (result.staffMembership === null) throw new EntityNotFoundError('staff appointment missing');
    if (result.previousStaffType === null) {
      throw new EntityNotFoundError('previous staff rank missing');
    }
    return {
      membership: result.staffMembership,
      user: result.user,
      club: result.club,
      previousStaffType: result.previousStaffType,
      roleMutation: result.roleMutation,
      ...(result.announcementDelivered === undefined
        ? {}
        : { announcementDelivered: result.announcementDelivered }),
    };
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
  ): Promise<Club> {
    return this.database.$transaction(async (transaction) => {
      const guild = await new GuildRepository(transaction).getByDiscordGuildId(discordGuildId);
      if (guild === null) throw new EntityNotFoundError('server is not configured');
      const user = await new UserRepository(transaction).getByDiscordUserId(discordUserId);
      if (user === null) throw new NoStaffAppointmentError();
      const staffMembership = await new MembershipRepository(
        transaction,
      ).getActiveStaffMembershipForUserInGuild(guild.id, user.id);
      if (staffMembership === null) throw new NoStaffAppointmentError();
      if (!staffMembership.club.active) {
        throw new InactiveSourceTeamError(formatTeamIdentity(staffMembership.club, 'message'));
      }
      return staffMembership.club;
    });
  }
}
