import type { Club, ClubMembership, LeagueUser, PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import {
  CallerHasNoStaffAppointmentError,
  InsufficientStaffRankError,
  InvalidDemotionTargetError,
  InvalidPromotionPathError,
  MemberIsFreeAgentError,
  SelfActionForbiddenError,
  StaffSlotOccupiedError,
  TargetAlreadyDesiredRankError,
  TargetNotOnCallerTeamError,
} from '../../src/domain/errors.js';
import { RosterPromotionDemotionService } from '../../src/services/roster-promotion-demotion-service.js';

const guildId = '100000000000000001';
const callerId = '200000000000000001';
const targetId = '200000000000000002';
const baseDate = new Date('2026-08-02T12:00:00.000Z');

function club(id = 'club-1'): Club {
  return {
    id,
    guildId: 'database-guild-1',
    discordRoleId: '400000000000000001',
    logoUrl: null,
    emoji: '⚽',
    squadLimitOverride: null,
    active: true,
    createdAt: baseDate,
    updatedAt: baseDate,
  };
}

function user(discordUserId: string): LeagueUser {
  return {
    id: `database-${discordUserId}`,
    discordUserId,
    robloxUserId: null,
    robloxUsername: null,
    createdAt: baseDate,
    updatedAt: baseDate,
  };
}

function membership(type = 'PLAYER', clubId = 'club-1'): ClubMembership {
  return {
    id: `membership-${type}-${clubId}`,
    guildId: 'database-guild-1',
    clubId,
    userId: 'database-user',
    membershipType: type,
    status: 'ACTIVE',
    joinedAt: baseDate,
    leftAt: null,
    createdByUserId: null,
    endedByUserId: null,
    createdAt: baseDate,
    updatedAt: baseDate,
  };
}

interface PrismaMockOptions {
  callerStaffType?: string | null;
  targetPlayerClubId?: string | null;
  targetStaffType?: string | null;
  occupiedSlotType?: string | null;
}

function createPrismaMock(options: PrismaMockOptions = {}) {
  const callerStaffType =
    options.callerStaffType !== undefined ? options.callerStaffType : 'TEAM_MANAGER';
  const targetPlayerClubId =
    options.targetPlayerClubId !== undefined ? options.targetPlayerClubId : 'club-1';
  const targetStaffType = options.targetStaffType !== undefined ? options.targetStaffType : null;
  const occupiedSlotType = options.occupiedSlotType !== undefined ? options.occupiedSlotType : null;

  const prismaMock = {
    guild: {
      findUnique: vi.fn(() => Promise.resolve({ id: 'database-guild-1', discordGuildId: guildId })),
    },
    leagueUser: {
      findUnique: vi.fn(({ where: { discordUserId } }: { where: { discordUserId: string } }) => {
        if (discordUserId === 'non-existent-user') return Promise.resolve(null);
        return Promise.resolve(user(discordUserId));
      }),
    },
    clubMembership: {
      findMany: vi.fn(({ where: { userId } }: { where: { userId: string } }) => {
        if (userId !== `database-${targetId}`) return Promise.resolve([]);
        const activeMemberships: ClubMembership[] = [];
        if (targetPlayerClubId !== null) {
          activeMemberships.push(membership('PLAYER', targetPlayerClubId));
        }
        if (targetStaffType !== null) {
          activeMemberships.push(membership(targetStaffType, targetPlayerClubId ?? 'club-1'));
        }
        return Promise.resolve(activeMemberships);
      }),
      findFirst: vi.fn(
        ({
          where: { userId, membershipType, clubId },
        }: {
          where: {
            userId: string;
            status?: string;
            membershipType?: string | object;
            clubId?: string;
          };
        }) => {
          if (userId === `database-${callerId}`) {
            if (callerStaffType === null) return Promise.resolve(null);
            if (membershipType === 'PLAYER') return Promise.resolve(membership('PLAYER', 'club-1'));
            return Promise.resolve({
              ...membership(callerStaffType, 'club-1'),
              club: club('club-1'),
            });
          }
          if (userId === `database-${targetId}`) {
            if (membershipType === 'PLAYER') {
              if (targetPlayerClubId === null) return Promise.resolve(null);
              return Promise.resolve(membership('PLAYER', targetPlayerClubId));
            }
            if (targetStaffType !== null) {
              return Promise.resolve(membership(targetStaffType, targetPlayerClubId ?? 'club-1'));
            }
            return Promise.resolve(null);
          }
          if (
            clubId === 'club-1' &&
            occupiedSlotType !== null &&
            membershipType === occupiedSlotType
          ) {
            return Promise.resolve(membership(occupiedSlotType, 'club-1'));
          }
          return Promise.resolve(null);
        },
      ),
    },
    $transaction: vi.fn((cb: (tx: PrismaClient) => Promise<unknown>) =>
      cb(prismaMock as unknown as PrismaClient),
    ),
  };
  return prismaMock as unknown as PrismaClient;
}

describe('RosterPromotionDemotionService eligibility', () => {
  it('allows Team Manager to promote Player to PM, Player to ATM, and PM to ATM', async () => {
    const prisma = createPrismaMock({ callerStaffType: 'TEAM_MANAGER' });
    const service = new RosterPromotionDemotionService(prisma);

    const pmEligibility = await service.getPromotionEligibility(
      guildId,
      callerId,
      targetId,
      'PLAYER_MANAGER',
    );
    expect(pmEligibility.destinationStaffType).toBe('PLAYER_MANAGER');
    expect(pmEligibility.callerStaffType).toBe('TEAM_MANAGER');

    const atmEligibility = await service.getPromotionEligibility(
      guildId,
      callerId,
      targetId,
      'ASSISTANT_MANAGER',
    );
    expect(atmEligibility.destinationStaffType).toBe('ASSISTANT_MANAGER');
  });

  it('allows Assistant Team Manager to promote Player to PM only', async () => {
    const prisma = createPrismaMock({ callerStaffType: 'ASSISTANT_MANAGER' });
    const service = new RosterPromotionDemotionService(prisma);

    const pmEligibility = await service.getPromotionEligibility(
      guildId,
      callerId,
      targetId,
      'PLAYER_MANAGER',
    );
    expect(pmEligibility.destinationStaffType).toBe('PLAYER_MANAGER');

    await expect(
      service.getPromotionEligibility(guildId, callerId, targetId, 'ASSISTANT_MANAGER'),
    ).rejects.toThrow(InvalidPromotionPathError);
  });

  it('blocks Player Manager from promoting any team member', async () => {
    const prisma = createPrismaMock({ callerStaffType: 'PLAYER_MANAGER' });
    const service = new RosterPromotionDemotionService(prisma);

    await expect(
      service.getPromotionEligibility(guildId, callerId, targetId, 'PLAYER_MANAGER'),
    ).rejects.toThrow(InsufficientStaffRankError);
  });

  it('blocks ordinary players and free agents without staff appointments from promoting', async () => {
    const prisma = createPrismaMock({ callerStaffType: null });
    const service = new RosterPromotionDemotionService(prisma);

    await expect(
      service.getPromotionEligibility(guildId, callerId, targetId, 'PLAYER_MANAGER'),
    ).rejects.toThrow(CallerHasNoStaffAppointmentError);
  });

  it('rejects self-promotion and self-demotion', async () => {
    const prisma = createPrismaMock({ callerStaffType: 'TEAM_MANAGER' });
    const service = new RosterPromotionDemotionService(prisma);

    await expect(
      service.getPromotionEligibility(guildId, callerId, callerId, 'PLAYER_MANAGER'),
    ).rejects.toThrow(SelfActionForbiddenError);

    await expect(service.getDemotionEligibility(guildId, callerId, callerId)).rejects.toThrow(
      SelfActionForbiddenError,
    );
  });

  it('rejects promotion when target is free agent or on another team', async () => {
    const freeAgentPrisma = createPrismaMock({ targetPlayerClubId: null });
    const freeAgentService = new RosterPromotionDemotionService(freeAgentPrisma);
    await expect(
      freeAgentService.getPromotionEligibility(guildId, callerId, targetId, 'PLAYER_MANAGER'),
    ).rejects.toThrow(MemberIsFreeAgentError);

    const otherTeamPrisma = createPrismaMock({ targetPlayerClubId: 'club-2' });
    const otherTeamService = new RosterPromotionDemotionService(otherTeamPrisma);
    await expect(
      otherTeamService.getPromotionEligibility(guildId, callerId, targetId, 'PLAYER_MANAGER'),
    ).rejects.toThrow(TargetNotOnCallerTeamError);
  });

  it('rejects promotion when target is already desired rank or is Team Manager', async () => {
    const alreadyPmPrisma = createPrismaMock({ targetStaffType: 'PLAYER_MANAGER' });
    const service = new RosterPromotionDemotionService(alreadyPmPrisma);

    await expect(
      service.getPromotionEligibility(guildId, callerId, targetId, 'PLAYER_MANAGER'),
    ).rejects.toThrow(TargetAlreadyDesiredRankError);

    const tmTargetPrisma = createPrismaMock({ targetStaffType: 'TEAM_MANAGER' });
    const tmService = new RosterPromotionDemotionService(tmTargetPrisma);

    await expect(
      tmService.getPromotionEligibility(guildId, callerId, targetId, 'ASSISTANT_MANAGER'),
    ).rejects.toThrow(InvalidPromotionPathError);
  });

  it('rejects promotion when destination slot (PM or ATM) is already occupied', async () => {
    const occupiedPmPrisma = createPrismaMock({ occupiedSlotType: 'PLAYER_MANAGER' });
    const pmService = new RosterPromotionDemotionService(occupiedPmPrisma);
    await expect(
      pmService.getPromotionEligibility(guildId, callerId, targetId, 'PLAYER_MANAGER'),
    ).rejects.toThrow(StaffSlotOccupiedError);

    const occupiedAtmPrisma = createPrismaMock({ occupiedSlotType: 'ASSISTANT_MANAGER' });
    const atmService = new RosterPromotionDemotionService(occupiedAtmPrisma);
    await expect(
      atmService.getPromotionEligibility(guildId, callerId, targetId, 'ASSISTANT_MANAGER'),
    ).rejects.toThrow(StaffSlotOccupiedError);
  });

  it('allows Team Manager to demote ATM or PM to Player', async () => {
    const prismaAtm = createPrismaMock({
      callerStaffType: 'TEAM_MANAGER',
      targetStaffType: 'ASSISTANT_MANAGER',
    });
    const serviceAtm = new RosterPromotionDemotionService(prismaAtm);
    const atmEligibility = await serviceAtm.getDemotionEligibility(guildId, callerId, targetId);
    expect(atmEligibility.callerStaffRole).toBe('TM');
    expect(atmEligibility.targetStaffRole).toBe('ATM');

    const prismaPm = createPrismaMock({
      callerStaffType: 'TEAM_MANAGER',
      targetStaffType: 'PLAYER_MANAGER',
    });
    const servicePm = new RosterPromotionDemotionService(prismaPm);
    const pmEligibility = await servicePm.getDemotionEligibility(guildId, callerId, targetId);
    expect(pmEligibility.targetStaffRole).toBe('PM');
  });

  it('rejects demotion by ATM, PM, or non-staff callers', async () => {
    const atmCaller = createPrismaMock({
      callerStaffType: 'ASSISTANT_MANAGER',
      targetStaffType: 'PLAYER_MANAGER',
    });
    await expect(
      new RosterPromotionDemotionService(atmCaller).getDemotionEligibility(
        guildId,
        callerId,
        targetId,
      ),
    ).rejects.toThrow(InsufficientStaffRankError);

    const pmCaller = createPrismaMock({
      callerStaffType: 'PLAYER_MANAGER',
      targetStaffType: 'ASSISTANT_MANAGER',
    });
    await expect(
      new RosterPromotionDemotionService(pmCaller).getDemotionEligibility(
        guildId,
        callerId,
        targetId,
      ),
    ).rejects.toThrow(InsufficientStaffRankError);

    const nonStaff = createPrismaMock({ callerStaffType: null, targetStaffType: 'PLAYER_MANAGER' });
    await expect(
      new RosterPromotionDemotionService(nonStaff).getDemotionEligibility(
        guildId,
        callerId,
        targetId,
      ),
    ).rejects.toThrow(CallerHasNoStaffAppointmentError);
  });

  it('rejects demotion of ordinary players, TM targets, or other-team members', async () => {
    const ordinaryPlayer = createPrismaMock({ targetStaffType: null });
    await expect(
      new RosterPromotionDemotionService(ordinaryPlayer).getDemotionEligibility(
        guildId,
        callerId,
        targetId,
      ),
    ).rejects.toThrow(InvalidDemotionTargetError);

    const tmTarget = createPrismaMock({ targetStaffType: 'TEAM_MANAGER' });
    await expect(
      new RosterPromotionDemotionService(tmTarget).getDemotionEligibility(
        guildId,
        callerId,
        targetId,
      ),
    ).rejects.toThrow(InvalidDemotionTargetError);

    const otherTeam = createPrismaMock({
      targetStaffType: 'ASSISTANT_MANAGER',
      targetPlayerClubId: 'club-2',
    });
    await expect(
      new RosterPromotionDemotionService(otherTeam).getDemotionEligibility(
        guildId,
        callerId,
        targetId,
      ),
    ).rejects.toThrow(TargetNotOnCallerTeamError);
  });
});
