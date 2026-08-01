import type { Club, ClubMembership, LeagueUser } from '@prisma/client';

import { EntityNotFoundError, InvalidStateTransitionError } from '../domain/errors.js';
import type { MembershipType } from '../domain/enums.js';
import type { DatabaseClient } from '../domain/types.js';
import { translateDatabaseError } from './repository-errors.js';

export interface CreateMembershipInput {
  guildId: string;
  clubId: string;
  userId: string;
  membershipType: MembershipType;
  joinedAt?: Date;
  createdByUserId?: string | null;
}

export class MembershipRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async createActive(input: CreateMembershipInput): Promise<ClubMembership> {
    try {
      return await this.db.clubMembership.create({
        data: {
          guildId: input.guildId,
          clubId: input.clubId,
          userId: input.userId,
          membershipType: input.membershipType,
          status: 'ACTIVE',
          joinedAt: input.joinedAt ?? new Date(),
          createdByUserId: input.createdByUserId ?? null,
        },
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'create membership');
    }
  }

  public async getActivePlayerMembership(
    guildId: string,
    userId: string,
  ): Promise<ClubMembership | null> {
    return this.db.clubMembership.findFirst({
      where: { guildId, userId, membershipType: 'PLAYER', status: 'ACTIVE' },
    });
  }

  public async getActiveStaffAppointments(clubId: string): Promise<ClubMembership[]> {
    return this.db.clubMembership.findMany({
      where: {
        clubId,
        status: 'ACTIVE',
        membershipType: { in: ['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] },
      },
      orderBy: [{ membershipType: 'asc' }, { joinedAt: 'asc' }],
    });
  }

  public async getActiveStaffAppointment(
    clubId: string,
    membershipType: Exclude<MembershipType, 'PLAYER'>,
  ): Promise<ClubMembership | null> {
    return this.db.clubMembership.findFirst({
      where: { clubId, membershipType, status: 'ACTIVE' },
    });
  }

  public async getActiveStaffMembershipForUser(
    clubId: string,
    userId: string,
  ): Promise<ClubMembership | null> {
    return this.db.clubMembership.findFirst({
      where: {
        clubId,
        userId,
        status: 'ACTIVE',
        membershipType: { in: ['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] },
      },
    });
  }

  public async getActiveStaffMembershipForUserInGuild(
    guildId: string,
    userId: string,
  ): Promise<(ClubMembership & { club: Club }) | null> {
    return this.db.clubMembership.findFirst({
      where: {
        guildId,
        userId,
        status: 'ACTIVE',
        membershipType: { in: ['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] },
      },
      include: { club: true },
    });
  }

  public async listActiveStaffWithUsers(
    clubId: string,
  ): Promise<Array<ClubMembership & { user: LeagueUser }>> {
    return this.db.clubMembership.findMany({
      where: {
        clubId,
        status: 'ACTIVE',
        membershipType: { in: ['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] },
      },
      include: { user: true },
      orderBy: [{ membershipType: 'asc' }],
    });
  }

  public async listActivePlayers(clubId: string): Promise<ClubMembership[]> {
    return this.db.clubMembership.findMany({
      where: { clubId, membershipType: 'PLAYER', status: 'ACTIVE' },
      orderBy: [{ joinedAt: 'asc' }],
    });
  }

  public async listActivePlayersWithUsers(
    clubId: string,
  ): Promise<Array<ClubMembership & { user: LeagueUser }>> {
    return this.db.clubMembership.findMany({
      where: { clubId, membershipType: 'PLAYER', status: 'ACTIVE' },
      include: { user: true },
      orderBy: [{ joinedAt: 'asc' }],
    });
  }

  public async end(
    id: string,
    input: { leftAt?: Date; endedByUserId?: string | null } = {},
  ): Promise<ClubMembership> {
    const leftAt = input.leftAt ?? new Date();
    try {
      const result = await this.db.clubMembership.updateMany({
        where: { id, status: 'ACTIVE' },
        data: { status: 'ENDED', leftAt, endedByUserId: input.endedByUserId ?? null },
      });
      if (result.count === 1) {
        const membership = await this.db.clubMembership.findUnique({ where: { id } });
        if (membership !== null) return membership;
      }
      const existing = await this.db.clubMembership.findUnique({ where: { id } });
      if (existing === null) {
        throw new EntityNotFoundError(`membership ${id} was not found`);
      }
      throw new InvalidStateTransitionError(`membership ${id} is already ended`);
    } catch (error: unknown) {
      if (error instanceof EntityNotFoundError || error instanceof InvalidStateTransitionError) {
        throw error;
      }
      return translateDatabaseError(error, 'end membership');
    }
  }

  public async listHistoryForUser(userId: string): Promise<ClubMembership[]> {
    return this.db.clubMembership.findMany({
      where: { userId },
      orderBy: [{ joinedAt: 'desc' }],
    });
  }

  public async countActivePlayers(clubId: string): Promise<number> {
    return this.db.clubMembership.count({
      where: { clubId, membershipType: 'PLAYER', status: 'ACTIVE' },
    });
  }
}
