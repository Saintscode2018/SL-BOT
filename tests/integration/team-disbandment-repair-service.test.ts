import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthorizationError } from '../../src/domain/errors.js';
import type { MemberRoleMutationPlan } from '../../src/domain/roster-mutation.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { TeamDisbandmentRepairService } from '../../src/services/team-disbandment-repair-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  grantBotPermission,
  type TestDatabase,
} from '../helpers/database.js';

const discordGuildId = '810000000000000001';
const ownerId = '820000000000000001';
const roleId = '830000000000000001';
const tmRoleId = '840000000000000001';
const atmRoleId = '840000000000000002';
const pmRoleId = '840000000000000003';

function authorization(discordUserId = ownerId): AuthorizationInput {
  return {
    discordGuildId,
    discordUserId,
    guildOwnerId: ownerId,
    memberRoleIds: [],
    hasAdministratorPermission: false,
  };
}

describe('TeamDisbandmentRepairService', () => {
  let database: TestDatabase;
  let client: PrismaClient;
  let guildId: string;
  let capturedPlans: MemberRoleMutationPlan[];
  let service: TeamDisbandmentRepairService;

  beforeAll(() => {
    database = createTestDatabase();
    client = database.client;
  }, 60_000);

  beforeEach(async () => {
    await clearDatabase(client);
    capturedPlans = [];
    const guild = await client.guild.create({
      data: {
        discordGuildId,
        name: 'Super League',
        settings: {
          create: {
            teamManagerRoleId: tmRoleId,
            assistantManagerRoleId: atmRoleId,
            playerManagerRoleId: pmRoleId,
          },
        },
      },
    });
    guildId = guild.id;
    await grantBotPermission(client, discordGuildId, ownerId, 'BOTPERM_ADMIN');
    service = new TeamDisbandmentRepairService(client, {
      executeMany: async <T>(plans: readonly MemberRoleMutationPlan[], mutate: () => Promise<T>) => {
        capturedPlans = [...plans];
        return {
          ...(await mutate()),
          announcementDelivered: null,
          auditAnnouncementDelivered: null,
          roleMutationsApplied: plans.reduce(
            (count, plan) => count + plan.addRoles.length + plan.removeRoles.length,
            0,
          ),
        };
      },
    });
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  async function inactiveClub(discordRoleId = roleId) {
    return client.club.create({
      data: { guildId, discordRoleId, emoji: 'L', active: false },
    });
  }

  async function user(discordUserId: string) {
    return client.leagueUser.upsert({
      where: { discordUserId },
      create: { discordUserId },
      update: {},
    });
  }

  async function membership(
    clubId: string,
    userId: string,
    membershipType: 'PLAYER' | 'TEAM_MANAGER' | 'ASSISTANT_MANAGER' | 'PLAYER_MANAGER',
    status: 'ACTIVE' | 'ENDED' = 'ENDED',
  ) {
    return client.clubMembership.create({
      data: {
        guildId,
        clubId,
        userId,
        membershipType,
        status,
        ...(status === 'ENDED' ? { leftAt: new Date('2026-08-01T00:00:00Z') } : {}),
      },
    });
  }

  it('repairs ended historical memberships without deleting history and is DB-idempotent', async () => {
    const club = await inactiveClub();
    const formerPlayer = await user('820000000000000002');
    const historicalMembership = await membership(club.id, formerPlayer.id, 'PLAYER');
    const transaction = await client.leagueTransaction.create({
      data: {
        guildId,
        userId: formerPlayer.id,
        transactionType: 'SIGNING',
        destinationClubId: club.id,
        performedByUserId: (await user(ownerId)).id,
      },
    });
    const audit = await client.auditEvent.create({
      data: { guildId, eventType: 'historic.event', entityType: 'club', entityId: club.id },
    });

    await expect(service.repair({ authorization: authorization(), teamId: club.id })).resolves.toMatchObject({
      historicalMembershipCount: 1,
      candidateUserCount: 1,
      endedMembershipCount: 0,
      discordRoleMutationsApplied: 1,
    });
    expect(capturedPlans).toEqual([
      expect.objectContaining({
        discordUserId: formerPlayer.discordUserId,
        removeRoles: [{ id: roleId, purpose: 'TEAM' }],
      }),
    ]);
    await expect(client.club.findUniqueOrThrow({ where: { id: club.id } })).resolves.toMatchObject({
      active: false,
      discordRoleId: roleId,
    });
    await expect(
      client.clubMembership.findUniqueOrThrow({ where: { id: historicalMembership.id } }),
    ).resolves.toMatchObject({ status: 'ENDED' });
    await expect(client.leagueTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).resolves.toBeDefined();
    await expect(client.auditEvent.findUniqueOrThrow({ where: { id: audit.id } })).resolves.toBeDefined();

    await expect(service.repair({ authorization: authorization(), teamId: club.id })).resolves.toMatchObject({
      endedMembershipCount: 0,
    });
    await expect(client.clubMembership.count({ where: { clubId: club.id } })).resolves.toBe(1);
    await expect(client.auditEvent.count({ where: { entityId: club.id } })).resolves.toBe(1);
  });

  it('preserves a reused team role when the former member is currently entitled through an active club', async () => {
    const historicalClub = await inactiveClub();
    const activeClub = await client.club.create({
      data: { guildId, discordRoleId: roleId, emoji: 'N', active: true },
    });
    const player = await user('820000000000000003');
    await membership(historicalClub.id, player.id, 'PLAYER');
    await membership(activeClub.id, player.id, 'PLAYER', 'ACTIVE');

    await expect(
      service.repair({ authorization: authorization(), teamId: historicalClub.id }),
    ).resolves.toMatchObject({ discordRoleMutationsApplied: 0 });
    expect(capturedPlans).toEqual([]);
    await expect(
      client.clubMembership.findFirstOrThrow({
        where: { clubId: activeClub.id, userId: player.id, status: 'ACTIVE' },
      }),
    ).resolves.toBeDefined();
  });

  it('ends inconsistent active memberships on an inactive club using canonical ended fields', async () => {
    const club = await inactiveClub();
    const formerManager = await user('820000000000000004');
    const inconsistent = await membership(club.id, formerManager.id, 'TEAM_MANAGER', 'ACTIVE');
    const occurredAt = new Date('2026-08-10T13:00:00Z');

    await expect(
      service.repair({ authorization: authorization(), teamId: club.id, occurredAt }),
    ).resolves.toMatchObject({ endedMembershipCount: 1, discordRoleMutationsApplied: 2 });
    await expect(
      client.clubMembership.findUniqueOrThrow({
        where: { id: inconsistent.id },
        include: { endedBy: { select: { discordUserId: true } } },
      }),
    ).resolves.toMatchObject({
      status: 'ENDED',
      leftAt: occurredAt,
      endedBy: { discordUserId: ownerId },
    });
    expect(capturedPlans[0]?.removeRoles).toEqual([
      { id: roleId, purpose: 'TEAM' },
      { id: tmRoleId, purpose: 'TM' },
    ]);
  });

  it('requires BOTPERM_ADMIN rather than a standard Bot Permission', async () => {
    const club = await inactiveClub();
    const standard = await user('820000000000000005');
    await grantBotPermission(client, discordGuildId, standard.discordUserId, 'BOTPERM');

    await expect(
      service.repair({ authorization: authorization(standard.discordUserId), teamId: club.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
