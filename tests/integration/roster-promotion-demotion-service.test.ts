import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscordRoleCompensationFailedError } from '../../src/domain/errors.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';
import { MemoryLogger } from '../helpers/memory-logger.js';
import type { MemberRoleSynchronizationService } from '../../src/services/member-role-synchronization-service.js';
import { RoleSynchronizedMutationService } from '../../src/services/role-synchronized-mutation-service.js';
import { RosterMutationService } from '../../src/services/roster-mutation-service.js';
import { RosterPromotionDemotionService } from '../../src/services/roster-promotion-demotion-service.js';

const discordGuildId = '100000000000000001';
const tmDiscordId = '200000000000000001';
const playerDiscordId = '200000000000000002';
const atmDiscordId = '200000000000000003';

describe('Stage 4B.3 Roster promotion and demotion integration', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;

  beforeAll(() => {
    db = createTestDatabase();
    prisma = db.client;
  });

  afterAll(async () => {
    await destroyTestDatabase(db);
  });

  beforeEach(async () => {
    await clearDatabase(prisma);

    const guild = await prisma.guild.create({
      data: { discordGuildId, name: 'Stage 4B3 Guild' },
    });
    await prisma.guildSettings.create({
      data: {
        guildId: guild.id,
        teamManagerRoleId: '400000000000000001',
        assistantManagerRoleId: '400000000000000002',
        playerManagerRoleId: '400000000000000003',
        transferChannelId: '300000000000000001',
      },
    });
  });

  it('promotes Player to PM and PM to ATM while keeping membership, history, and roster count', async () => {
    const guild = await prisma.guild.findUniqueOrThrow({
      where: { discordGuildId },
    });
    const tmUser = await prisma.leagueUser.create({
      data: { discordUserId: tmDiscordId },
    });
    const playerUser = await prisma.leagueUser.create({
      data: { discordUserId: playerDiscordId },
    });

    const club = await prisma.club.create({
      data: {
        guildId: guild.id,
        discordRoleId: '400000000000000010',
        emoji: '🔥',
        active: true,
      },
    });

    await prisma.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: club.id,
        userId: tmUser.id,
        membershipType: 'PLAYER',
        status: 'ACTIVE',
      },
    });
    await prisma.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: club.id,
        userId: tmUser.id,
        membershipType: 'TEAM_MANAGER',
        status: 'ACTIVE',
      },
    });

    await prisma.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: club.id,
        userId: playerUser.id,
        membershipType: 'PLAYER',
        status: 'ACTIVE',
      },
    });

    const synchronizedMutations = new RoleSynchronizedMutationService(
      {
        apply: vi.fn().mockResolvedValue({ compensationFailedPurposes: [] }),
        compensate: vi.fn().mockResolvedValue({ compensationFailedPurposes: [] }),
      },
      { publish: vi.fn().mockResolvedValue(true) },
      { publish: vi.fn().mockResolvedValue(true) },
      new MemoryLogger(),
    );

    const mutations = new RosterMutationService(prisma, synchronizedMutations);
    const promotionService = new RosterPromotionDemotionService(prisma, mutations);

    // Promote Player -> PM
    const pmResult = await promotionService.promote({
      discordGuildId,
      actorDiscordUserId: tmDiscordId,
      targetDiscordUserId: playerDiscordId,
      clubId: club.id,
      destinationStaffType: 'PLAYER_MANAGER',
      expectedActorStaffRole: 'TM',
      expectedTargetStaffRole: null,
    });

    expect(pmResult.staffMembership?.membershipType).toBe('PLAYER_MANAGER');
    expect(pmResult.roleMutation.addRoles).toContainEqual({
      id: '400000000000000003',
      purpose: 'PM',
    });

    // Roster count check
    const countAfterPM = await prisma.clubMembership.count({
      where: { clubId: club.id, membershipType: 'PLAYER', status: 'ACTIVE' },
    });
    expect(countAfterPM).toBe(2); // TM player + target player

    // Promote PM -> ATM
    const atmResult = await promotionService.promote({
      discordGuildId,
      actorDiscordUserId: tmDiscordId,
      targetDiscordUserId: playerDiscordId,
      clubId: club.id,
      destinationStaffType: 'ASSISTANT_MANAGER',
      expectedActorStaffRole: 'TM',
      expectedTargetStaffRole: 'PM',
    });

    expect(atmResult.staffMembership?.membershipType).toBe('ASSISTANT_MANAGER');
    expect(atmResult.roleMutation.removeRoles).toContainEqual({
      id: '400000000000000003',
      purpose: 'PM',
    });
    expect(atmResult.roleMutation.addRoles).toContainEqual({
      id: '400000000000000002',
      purpose: 'ATM',
    });

    // Historical memberships preserved
    const pmHistory = await prisma.clubMembership.findMany({
      where: { userId: playerUser.id, membershipType: 'PLAYER_MANAGER' },
    });
    expect(pmHistory).toHaveLength(1);
    expect(pmHistory[0]?.status).toBe('ENDED');
    expect(pmHistory[0]?.leftAt).not.toBeNull();
  });

  it('demotes ATM to Player, removing global staff role while leaving team membership intact', async () => {
    const guild = await prisma.guild.findUniqueOrThrow({
      where: { discordGuildId },
    });
    const tmUser = await prisma.leagueUser.create({
      data: { discordUserId: tmDiscordId },
    });
    const atmUser = await prisma.leagueUser.create({
      data: { discordUserId: atmDiscordId },
    });

    const club = await prisma.club.create({
      data: {
        guildId: guild.id,
        discordRoleId: '400000000000000010',
        emoji: '⚡',
        active: true,
      },
    });

    await prisma.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: club.id,
        userId: tmUser.id,
        membershipType: 'PLAYER',
        status: 'ACTIVE',
      },
    });
    await prisma.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: club.id,
        userId: tmUser.id,
        membershipType: 'TEAM_MANAGER',
        status: 'ACTIVE',
      },
    });

    await prisma.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: club.id,
        userId: atmUser.id,
        membershipType: 'PLAYER',
        status: 'ACTIVE',
      },
    });
    await prisma.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: club.id,
        userId: atmUser.id,
        membershipType: 'ASSISTANT_MANAGER',
        status: 'ACTIVE',
      },
    });

    const synchronizedMutations = new RoleSynchronizedMutationService(
      {
        apply: vi.fn().mockResolvedValue({ compensationFailedPurposes: [] }),
        compensate: vi.fn().mockResolvedValue({ compensationFailedPurposes: [] }),
      },
      { publish: vi.fn().mockResolvedValue(true) },
      { publish: vi.fn().mockResolvedValue(true) },
      new MemoryLogger(),
    );

    const mutations = new RosterMutationService(prisma, synchronizedMutations);
    const promotionService = new RosterPromotionDemotionService(prisma, mutations);

    const demoteResult = await promotionService.demote({
      discordGuildId,
      actorDiscordUserId: tmDiscordId,
      targetDiscordUserId: atmDiscordId,
      clubId: club.id,
      expectedActorStaffRole: 'TM',
      expectedTargetStaffRole: 'ATM',
    });

    expect(demoteResult.staffMembership?.status).toBe('ENDED');
    expect(demoteResult.roleMutation.removeRoles).toContainEqual({
      id: '400000000000000002',
      purpose: 'ATM',
    });
    expect(demoteResult.roleMutation.addRoles).toHaveLength(0);

    // Verify active player membership remains
    const activePlayer = await prisma.clubMembership.findFirst({
      where: { userId: atmUser.id, membershipType: 'PLAYER', status: 'ACTIVE' },
    });
    expect(activePlayer).not.toBeNull();
  });

  it('blocks database mutation when Discord role synchronization fails', async () => {
    const guild = await prisma.guild.findUniqueOrThrow({
      where: { discordGuildId },
    });
    const tmUser = await prisma.leagueUser.create({
      data: { discordUserId: tmDiscordId },
    });
    const targetUser = await prisma.leagueUser.create({
      data: { discordUserId: playerDiscordId },
    });

    const club = await prisma.club.create({
      data: {
        guildId: guild.id,
        discordRoleId: '400000000000000010',
        emoji: '🔥',
        active: true,
      },
    });

    await prisma.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: club.id,
        userId: tmUser.id,
        membershipType: 'TEAM_MANAGER',
        status: 'ACTIVE',
      },
    });
    await prisma.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: club.id,
        userId: tmUser.id,
        membershipType: 'PLAYER',
        status: 'ACTIVE',
      },
    });

    await prisma.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: club.id,
        userId: targetUser.id,
        membershipType: 'PLAYER',
        status: 'ACTIVE',
      },
    });

    const failingRoleSync: Pick<MemberRoleSynchronizationService, 'apply' | 'compensate'> = {
      apply: vi.fn().mockRejectedValue(new DiscordRoleCompensationFailedError(['PM'])),
      compensate: vi.fn().mockResolvedValue(undefined),
    };

    const synchronizedMutations = new RoleSynchronizedMutationService(
      failingRoleSync,
      { publish: vi.fn().mockResolvedValue(undefined) },
      { publish: vi.fn().mockResolvedValue(undefined) },
      new MemoryLogger(),
    );

    const mutations = new RosterMutationService(prisma, synchronizedMutations);
    const promotionService = new RosterPromotionDemotionService(prisma, mutations);

    await expect(
      promotionService.promote({
        discordGuildId,
        actorDiscordUserId: tmDiscordId,
        targetDiscordUserId: playerDiscordId,
        clubId: club.id,
        destinationStaffType: 'PLAYER_MANAGER',
        expectedActorStaffRole: 'TM',
        expectedTargetStaffRole: null,
      }),
    ).rejects.toThrow(DiscordRoleCompensationFailedError);

    // Verify DB was NOT modified
    const activeStaff = await prisma.clubMembership.findFirst({
      where: { userId: targetUser.id, membershipType: 'PLAYER_MANAGER' },
    });
    expect(activeStaff).toBeNull();
  });
});
