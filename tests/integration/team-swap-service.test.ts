import { Prisma, type PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AuthorizationError,
  ClubInactiveError,
  SquadFullError,
  TeamNotFoundError,
  ValidationError,
} from '../../src/domain/errors.js';
import type { MembershipType } from '../../src/domain/enums.js';
import type { MemberRoleMutationPlan } from '../../src/domain/roster-mutation.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import {
  TeamSwapService,
  teamSwappedAuditEventType,
} from '../../src/services/team-swap-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  grantBotPermission,
  type TestDatabase,
} from '../helpers/database.js';

const discordGuildId = '100000000000000001';
const ownerId = '200000000000000001';
const adminUserId = '200000000000000002';
const team1RoleId = '300000000000000001';
const team2RoleId = '300000000000000002';
const tmRoleId = '400000000000000001';
const atmRoleId = '400000000000000002';
const pmRoleId = '400000000000000003';
const botPermissionsRoleId = '400000000000000004';
const staffChannelId = '500000000000000001';

function authInput(
  userId = ownerId,
  options: { hasAdmin?: boolean; roleIds?: string[] } = {},
): AuthorizationInput {
  return {
    discordGuildId,
    discordUserId: userId,
    guildOwnerId: ownerId,
    memberRoleIds: options.roleIds ?? [],
    hasAdministratorPermission: options.hasAdmin ?? false,
  };
}

describe('TeamSwapService Integration Tests', () => {
  let database: TestDatabase;
  let client: PrismaClient;
  let guildId: string;
  let team1Id: string;
  let team2Id: string;
  let capturedPlans: MemberRoleMutationPlan[];
  let service: TeamSwapService;

  beforeAll(() => {
    database = createTestDatabase();
    client = database.client;
  }, 60_000);

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  beforeEach(async () => {
    await clearDatabase(client);
    capturedPlans = [];

    const guild = await client.guild.create({
      data: {
        discordGuildId,
        name: 'Super League',
        settings: {
          create: {
            staffChannelId,
            botPermissionsRoleId,
            teamManagerRoleId: tmRoleId,
            assistantManagerRoleId: atmRoleId,
            playerManagerRoleId: pmRoleId,
            defaultSquadLimit: 5,
          },
        },
      },
    });
    guildId = guild.id;
    await grantBotPermission(client, discordGuildId, ownerId);

    const team1 = await client.club.create({
      data: { guildId, discordRoleId: team1RoleId, emoji: '🦁' },
    });
    team1Id = team1.id;

    const team2 = await client.club.create({
      data: { guildId, discordRoleId: team2RoleId, emoji: '🐯' },
    });
    team2Id = team2.id;

    service = new TeamSwapService(client, {
      executeMany: async <T>(
        plans: readonly MemberRoleMutationPlan[],
        mutate: () => Promise<T>,
      ) => {
        capturedPlans = [...plans];
        const res = await mutate();
        return {
          ...res,
          announcementDelivered: null,
          auditAnnouncementDelivered: null,
        };
      },
    });
  });

  describe('Authorization & Policy Scenarios', () => {
    it('authorizes only the database Bot Permission holder', async () => {
      await expect(
        service.getEligibility(authInput(ownerId), team1Id, team2Id),
      ).resolves.toBeDefined();
      await expect(
        service.getEligibility(authInput(adminUserId, { hasAdmin: true }), team1Id, team2Id),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        service.getEligibility(
          authInput('600000000000000001', { roleIds: [botPermissionsRoleId] }),
          team1Id,
          team2Id,
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it('denies TM/ATM/PM/ordinary players who lack global authorization', async () => {
      const unauthorizedAuth = authInput('700000000000000001', {
        roleIds: [tmRoleId], // merely has TM role
        hasAdmin: false,
      });
      await expect(
        service.getEligibility(unauthorizedAuth, team1Id, team2Id),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  describe('Validation Scenarios', () => {
    it('rejects swapping a team with itself', async () => {
      await expect(service.getEligibility(authInput(), team1Id, team1Id)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects inactive teams', async () => {
      await client.club.update({ where: { id: team2Id }, data: { active: false } });
      await expect(service.getEligibility(authInput(), team1Id, team2Id)).rejects.toBeInstanceOf(
        ClubInactiveError,
      );
    });

    it('rejects missing teams', async () => {
      await expect(
        service.getEligibility(authInput(), team1Id, 'non-existent-team-id'),
      ).rejects.toBeInstanceOf(TeamNotFoundError);
    });

    it('blocks swap if Team A population exceeds Team B effective limit', async () => {
      // Set Team 2 limit to 2
      await client.club.update({
        where: { id: team2Id },
        data: { squadLimitOverride: 2 },
      });

      // Add three unique members with mixed player/staff-only memberships to Team 1.
      const membershipTypes = ['PLAYER', 'TEAM_MANAGER', 'ASSISTANT_MANAGER'] as const;
      for (let i = 1; i <= 3; i++) {
        const user = await client.leagueUser.create({
          data: { discordUserId: `user-t1-${i}` },
        });
        await client.clubMembership.create({
          data: {
            guildId,
            clubId: team1Id,
            userId: user.id,
            membershipType: membershipTypes[i - 1]!,
          },
        });
      }

      await expect(
        service.swap({ authorization: authInput(), team1Id, team2Id }),
      ).rejects.toBeInstanceOf(SquadFullError);
    });

    it('blocks swap if Team B population exceeds Team A effective limit', async () => {
      // Set Team 1 limit to 1
      await client.club.update({
        where: { id: team1Id },
        data: { squadLimitOverride: 1 },
      });

      // Add 2 players to Team 2
      for (let i = 1; i <= 2; i++) {
        const user = await client.leagueUser.create({
          data: { discordUserId: `user-t2-${i}` },
        });
        await client.clubMembership.create({
          data: { guildId, clubId: team2Id, userId: user.id, membershipType: 'PLAYER' },
        });
      }

      await expect(
        service.swap({ authorization: authInput(), team1Id, team2Id }),
      ).rejects.toBeInstanceOf(SquadFullError);
    });

    it('allows valid exact-at-limit swap', async () => {
      // Set Team 2 limit to 2
      await client.club.update({
        where: { id: team2Id },
        data: { squadLimitOverride: 2 },
      });

      // Add 2 unique people to Team 1 (exact limit for Team 2).
      let firstUserId: string | null = null;
      for (let i = 1; i <= 2; i++) {
        const user = await client.leagueUser.create({
          data: { discordUserId: `user-t1-${i}` },
        });
        await client.clubMembership.create({
          data: { guildId, clubId: team1Id, userId: user.id, membershipType: 'PLAYER' },
        });
        firstUserId ??= user.id;
      }
      await client.clubMembership.create({
        data: {
          guildId,
          clubId: team1Id,
          userId: firstUserId!,
          membershipType: 'TEAM_MANAGER',
        },
      });

      await expect(
        service.swap({ authorization: authInput(), team1Id, team2Id }),
      ).resolves.toBeDefined();
    });
  });

  describe('Database Swap & History Scenarios', () => {
    it('atomically swaps active memberships, preserves staff ranks, and creates Audit DB trail', async () => {
      const auditChannelId = '500000000000000088';
      await client.guildSettings.update({
        where: { guildId },
        data: { auditChannelId },
      });

      // Setup Team 1: 1 TM, 1 ATM, 1 Player
      const tm1 = await client.leagueUser.create({ data: { discordUserId: 'tm-1' } });
      const atm1 = await client.leagueUser.create({ data: { discordUserId: 'atm-1' } });
      const p1 = await client.leagueUser.create({ data: { discordUserId: 'p-1' } });

      await client.clubMembership.create({
        data: { guildId, clubId: team1Id, userId: tm1.id, membershipType: 'TEAM_MANAGER' },
      });
      await client.clubMembership.create({
        data: { guildId, clubId: team1Id, userId: atm1.id, membershipType: 'ASSISTANT_MANAGER' },
      });
      await client.clubMembership.create({
        data: { guildId, clubId: team1Id, userId: p1.id, membershipType: 'PLAYER' },
      });

      // Setup Team 2: 1 PM, 1 Player
      const pm2 = await client.leagueUser.create({ data: { discordUserId: 'pm-2' } });
      const p2 = await client.leagueUser.create({ data: { discordUserId: 'p-2' } });

      await client.clubMembership.create({
        data: { guildId, clubId: team2Id, userId: pm2.id, membershipType: 'PLAYER_MANAGER' },
      });
      await client.clubMembership.create({
        data: { guildId, clubId: team2Id, userId: p2.id, membershipType: 'PLAYER' },
      });

      // Inactive historical membership (should be untouched)
      const endedUser = await client.leagueUser.create({ data: { discordUserId: 'ended-user' } });
      await client.clubMembership.create({
        data: {
          guildId,
          clubId: team1Id,
          userId: endedUser.id,
          membershipType: 'PLAYER',
          status: 'ENDED',
          leftAt: new Date(),
        },
      });

      const result = await service.swap({ authorization: authInput(), team1Id, team2Id });

      expect(result.team1MovedCount).toBe(3);
      expect(result.team2MovedCount).toBe(2);

      // Verify active memberships on Team 2 (formerly Team 1 members)
      const team2ActiveMemberships = await client.clubMembership.findMany({
        where: { clubId: team2Id, status: 'ACTIVE' },
      });
      expect(team2ActiveMemberships.map((m) => m.userId).sort()).toEqual(
        [tm1.id, atm1.id, p1.id].sort(),
      );

      // Verify ranks preserved
      const tm1Membership = team2ActiveMemberships.find((m) => m.userId === tm1.id);
      expect(tm1Membership?.membershipType).toBe('TEAM_MANAGER');
      const atm1Membership = team2ActiveMemberships.find((m) => m.userId === atm1.id);
      expect(atm1Membership?.membershipType).toBe('ASSISTANT_MANAGER');
      const p1Membership = team2ActiveMemberships.find((m) => m.userId === p1.id);
      expect(p1Membership?.membershipType).toBe('PLAYER');

      // Verify active memberships on Team 1 (formerly Team 2 members)
      const team1ActiveMemberships = await client.clubMembership.findMany({
        where: { clubId: team1Id, status: 'ACTIVE' },
      });
      expect(team1ActiveMemberships.map((m) => m.userId).sort()).toEqual([pm2.id, p2.id].sort());

      // Verify inactive membership unaffected
      const endedMembership = await client.clubMembership.findFirst({
        where: { userId: endedUser.id },
      });
      expect(endedMembership?.clubId).toBe(team1Id);
      expect(endedMembership?.status).toBe('ENDED');

      // Verify Audit DB Event
      const auditEvents = await client.auditEvent.findMany({
        where: { eventType: teamSwappedAuditEventType },
      });
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0]?.entityId).toBe(team1Id);
      expect(auditEvents[0]?.actorUserId).not.toBe(tm1.id);
      expect(result.auditAnnouncement).toMatchObject({
        operation: 'TEAM_SWAPPED',
        actorDiscordUserId: ownerId,
        channelId: auditChannelId,
      });
      if (result.auditAnnouncement?.operation !== 'TEAM_SWAPPED') {
        throw new Error('Expected a team-swapped Audit announcement');
      }
      expect(result.auditAnnouncement.actorDiscordUserId).not.toBe(tm1.discordUserId);

      // Verify LeagueTransaction entries
      const transactions = await client.leagueTransaction.findMany({
        where: { transactionType: 'TEAM_SWAP' },
      });
      expect(transactions).toHaveLength(5);

      // Verify role plans
      expect(capturedPlans).toHaveLength(5);
      const tm1Plan = capturedPlans.find((p) => p.discordUserId === 'tm-1');
      expect(tm1Plan?.removeRoles).toEqual([{ id: team1RoleId, purpose: 'TEAM' }]);
      expect(tm1Plan?.addRoles).toEqual([{ id: team2RoleId, purpose: 'TEAM' }]);
      // Global TM role should NOT be in remove/add roles
      expect(tm1Plan?.removeRoles.some((r) => r.id === tmRoleId)).toBe(false);
      expect(tm1Plan?.addRoles.some((r) => r.id === tmRoleId)).toBe(false);
    });
  });

  describe('Active staff uniqueness collision characterization', () => {
    async function createMembership(
      clubId: string,
      membershipType: MembershipType,
      discordUserId: string,
    ) {
      const user = await client.leagueUser.create({ data: { discordUserId } });
      return client.clubMembership.create({
        data: { guildId, clubId, userId: user.id, membershipType },
      });
    }

    async function membershipAssignments(ids: readonly string[]) {
      const memberships = await client.clubMembership.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, clubId: true },
      });
      const clubIdByMembershipId = new Map(memberships.map(({ id, clubId }) => [id, clubId]));
      return ids.map((id) => {
        const clubId = clubIdByMembershipId.get(id);
        if (clubId === undefined) throw new Error(`membership ${id} was not found`);
        return { id, clubId };
      });
    }

    async function expectAtomicStaffCollision(
      membershipIds: readonly string[],
      originalClubs: readonly { id: string; active: boolean; discordRoleId: string }[],
    ) {
      const originalAssignments = await membershipAssignments(membershipIds);

      let thrown: unknown;
      try {
        await service.swap({ authorization: authInput(), team1Id, team2Id });
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      if (!(thrown instanceof Prisma.PrismaClientKnownRequestError)) {
        throw new Error('Expected a PrismaClientKnownRequestError');
      }
      expect(thrown.code).toBe('P2002');
      expect(thrown.meta).toMatchObject({ modelName: 'ClubMembership', target: ['clubId'] });

      expect(await membershipAssignments(membershipIds)).toEqual(originalAssignments);
      await expect(
        client.leagueTransaction.count({ where: { transactionType: 'TEAM_SWAP' } }),
      ).resolves.toBe(0);
      await expect(client.auditEvent.count({ where: { eventType: teamSwappedAuditEventType } })).resolves.toBe(
        0,
      );
      await expect(
        client.club.findMany({
          where: { id: { in: [team1Id, team2Id] } },
          select: { id: true, active: true, discordRoleId: true },
          orderBy: { id: 'asc' },
        }),
      ).resolves.toEqual([...originalClubs].sort((a, b) => a.id.localeCompare(b.id)));
    }

    it('CASE 1: swaps PLAYER-only teams successfully', async () => {
      const team1Player = await createMembership(team1Id, 'PLAYER', 'case-1-team-1-player');
      const team2Player = await createMembership(team2Id, 'PLAYER', 'case-1-team-2-player');

      await expect(service.swap({ authorization: authInput(), team1Id, team2Id })).resolves.toMatchObject({
        team1MovedCount: 1,
        team2MovedCount: 1,
      });
      await expect(membershipAssignments([team1Player.id, team2Player.id])).resolves.toEqual([
        { id: team1Player.id, clubId: team2Id },
        { id: team2Player.id, clubId: team1Id },
      ]);
    });

    it('CASE 2: swaps a one-sided TEAM_MANAGER successfully', async () => {
      const team1Manager = await createMembership(
        team1Id,
        'TEAM_MANAGER',
        'case-2-team-1-manager',
      );
      const team2Player = await createMembership(team2Id, 'PLAYER', 'case-2-team-2-player');

      await expect(service.swap({ authorization: authInput(), team1Id, team2Id })).resolves.toBeDefined();
      await expect(membershipAssignments([team1Manager.id, team2Player.id])).resolves.toEqual([
        { id: team1Manager.id, clubId: team2Id },
        { id: team2Player.id, clubId: team1Id },
      ]);
    });

    for (const membershipType of ['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] as const) {
      it(`CASE ${
        membershipType === 'TEAM_MANAGER' ? 3 : membershipType === 'ASSISTANT_MANAGER' ? 4 : 5
      }: fully rolls back when both teams have an active ${membershipType}`, async () => {
        const team1Membership = await createMembership(
          team1Id,
          membershipType,
          `case-${membershipType}-team-1`,
        );
        const team2Membership = await createMembership(
          team2Id,
          membershipType,
          `case-${membershipType}-team-2`,
        );
        const originalClubs = await client.club.findMany({
          where: { id: { in: [team1Id, team2Id] } },
          select: { id: true, active: true, discordRoleId: true },
        });

        await expectAtomicStaffCollision(
          [team1Membership.id, team2Membership.id],
          originalClubs,
        );
      });
    }

    it('CASE 6: swaps mixed staff types without a same-slot collision', async () => {
      const team1Manager = await createMembership(
        team1Id,
        'TEAM_MANAGER',
        'case-6-team-1-manager',
      );
      const team2Assistant = await createMembership(
        team2Id,
        'ASSISTANT_MANAGER',
        'case-6-team-2-assistant',
      );

      await expect(service.swap({ authorization: authInput(), team1Id, team2Id })).resolves.toBeDefined();
      await expect(membershipAssignments([team1Manager.id, team2Assistant.id])).resolves.toEqual([
        { id: team1Manager.id, clubId: team2Id },
        { id: team2Assistant.id, clubId: team1Id },
      ]);
    });

    it('CASE 7: fully rolls back when all matching staff slots are occupied', async () => {
      const memberships = await Promise.all(
        (['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] as const).flatMap(
          (membershipType) => [
            createMembership(team1Id, membershipType, `case-7-team-1-${membershipType}`),
            createMembership(team2Id, membershipType, `case-7-team-2-${membershipType}`),
          ],
        ),
      );
      const originalClubs = await client.club.findMany({
        where: { id: { in: [team1Id, team2Id] } },
        select: { id: true, active: true, discordRoleId: true },
      });

      await expectAtomicStaffCollision(
        memberships.map(({ id }) => id),
        originalClubs,
      );
    });

    it('CASE 8: swaps PLAYER plus staff memberships for the same user without a separate defect', async () => {
      const sharedUser = await client.leagueUser.create({
        data: { discordUserId: 'case-8-player-and-staff' },
      });
      const team1Player = await client.clubMembership.create({
        data: { guildId, clubId: team1Id, userId: sharedUser.id, membershipType: 'PLAYER' },
      });
      const team1Staff = await client.clubMembership.create({
        data: { guildId, clubId: team1Id, userId: sharedUser.id, membershipType: 'TEAM_MANAGER' },
      });
      const team2Player = await createMembership(team2Id, 'PLAYER', 'case-8-team-2-player');

      const result = await service.swap({ authorization: authInput(), team1Id, team2Id });

      expect(result).toMatchObject({ team1MovedCount: 1, team2MovedCount: 1 });
      await expect(membershipAssignments([team1Player.id, team1Staff.id, team2Player.id])).resolves.toEqual([
        { id: team1Player.id, clubId: team2Id },
        { id: team1Staff.id, clubId: team2Id },
        { id: team2Player.id, clubId: team1Id },
      ]);
      await expect(
        client.leagueTransaction.count({ where: { transactionType: 'TEAM_SWAP' } }),
      ).resolves.toBe(3);
      expect(capturedPlans.filter((plan) => plan.discordUserId === sharedUser.discordUserId)).toHaveLength(1);
    });
  });
});
