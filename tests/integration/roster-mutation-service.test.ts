import type { Club, Guild } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MemberAlreadySignedError,
  MemberNotOnTeamError,
  SquadFullError,
  StaffAlreadyAppointedError,
  StaffSlotOccupiedError,
} from '../../src/domain/errors.js';
import type { MemberRoleMutationPlan } from '../../src/domain/roster-mutation.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { GuildRepository } from '../../src/repositories/guild-repository.js';
import { MembershipRepository } from '../../src/repositories/membership-repository.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import { RosterMutationService } from '../../src/services/roster-mutation-service.js';
import { RoleSynchronizedMutationService } from '../../src/services/role-synchronized-mutation-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const discordGuildId = '100000000000000001';
const actorId = '200000000000000001';
const memberId = '200000000000000002';
const secondMemberId = '200000000000000003';

describe('roster mutation service', () => {
  let database: TestDatabase;
  let guild: Guild;
  let team: Club;
  let otherTeam: Club;
  let service: RosterMutationService;

  beforeAll(() => {
    database = createTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
    const guilds = new GuildRepository(database.client);
    guild = await guilds.create({ discordGuildId, name: 'Stage 4B League' });
    await guilds.upsertSettings(guild.id, {
      transferChannelId: '300000000000000001',
      auditChannelId: '300000000000000002',
      teamManagerRoleId: '400000000000000001',
      assistantManagerRoleId: '400000000000000002',
      playerManagerRoleId: '400000000000000003',
      defaultSquadLimit: 5,
    });
    const clubs = new ClubRepository(database.client);
    team = await clubs.create({
      guildId: guild.id,
      discordRoleId: '500000000000000001',
      emoji: '⚽',
    });
    otherTeam = await clubs.create({
      guildId: guild.id,
      discordRoleId: '500000000000000002',
      emoji: '🔵',
    });
    service = new RosterMutationService(database.client);
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  const input = (targetDiscordUserId = memberId) => ({
    discordGuildId,
    clubId: team.id,
    actorDiscordUserId: actorId,
    targetDiscordUserId,
  });

  it.each([
    ['TEAM_MANAGER', 'TM'],
    ['ASSISTANT_MANAGER', 'ATM'],
    ['PLAYER_MANAGER', 'PM'],
  ] as const)(
    'appoints a free agent as %s and also adds the roster membership',
    async (staffType, code) => {
      const result = await service.appointStaffImmediately({ ...input(), staffType });
      expect(result.playerMembership).toMatchObject({
        membershipType: 'PLAYER',
        status: 'ACTIVE',
        clubId: team.id,
      });
      expect(result.staffMembership).toMatchObject({
        membershipType: staffType,
        status: 'ACTIVE',
        clubId: team.id,
      });
      expect(result.roleMutation.addRoles[0]).toEqual({
        id: team.discordRoleId,
        purpose: 'TEAM',
      });
      expect(result.roleMutation.addRoles[1]?.purpose).toBe(code);
      expect(typeof result.roleMutation.addRoles[1]?.id).toBe('string');
      expect(result.previousStaffType).toBeNull();
      expect(result.announcement).toMatchObject({
        type: 'APPOINTED',
        staffRole: code,
        staffRoleId: result.roleMutation.addRoles[1]?.id,
      });
      expect(result.auditAnnouncement).toMatchObject({
        operation: 'STAFF_APPOINTED',
        staffRole: code,
        playerDiscordUserId: memberId,
      });
      await expect(
        database.client.clubMembership.count({
          where: { userId: result.user.id, status: 'ACTIVE' },
        }),
      ).resolves.toBe(2);
    },
  );

  it('enforces one active roster, one active staff appointment, and one holder per slot', async () => {
    const appointed = await service.appointStaffImmediately({
      ...input(),
      staffType: 'PLAYER_MANAGER',
    });
    await expect(
      service.appointStaffImmediately({
        ...input(),
        clubId: otherTeam.id,
        staffType: 'ASSISTANT_MANAGER',
      }),
    ).rejects.toBeInstanceOf(StaffAlreadyAppointedError);
    await expect(
      service.signFreeAgent({ ...input(), clubId: otherTeam.id }),
    ).rejects.toBeInstanceOf(MemberAlreadySignedError);
    await expect(
      service.appointStaffImmediately({ ...input(secondMemberId), staffType: 'PLAYER_MANAGER' }),
    ).rejects.toBeInstanceOf(StaffSlotOccupiedError);
    await expect(
      database.client.clubMembership.create({
        data: {
          guildId: guild.id,
          clubId: otherTeam.id,
          userId: appointed.user.id,
          membershipType: 'ASSISTANT_MANAGER',
          status: 'ACTIVE',
        },
      }),
    ).rejects.toThrow();
  });

  it('ends only the staff appointment while retaining the player and history', async () => {
    await service.appointStaffImmediately({
      ...input(),
      actorDiscordUserId: memberId,
      staffType: 'PLAYER_MANAGER',
    });
    const result = await service.endStaffAppointmentOnly({
      ...input(),
      actorDiscordUserId: memberId,
    });
    expect(result.playerMembership!.status).toBe('ACTIVE');
    expect(result.staffMembership).toMatchObject({
      status: 'ENDED',
      endedByUserId: result.user.id,
    });
    expect(result.roleMutation).toMatchObject({
      addRoles: [],
      removeRoles: [{ purpose: 'PM' }],
    });
  });

  it.each([
    ['TEAM_MANAGER', 'TM', '400000000000000001'],
    ['ASSISTANT_MANAGER', 'ATM', '400000000000000002'],
    ['PLAYER_MANAGER', 'PM', '400000000000000003'],
  ] as const)(
    'admin removal of %s removes only the configured global %s role',
    async (staffType, purpose, staffRoleId) => {
      const appointed = await service.appointStaffImmediately({ ...input(), staffType });
      const apply = vi.fn((rolePlan: MemberRoleMutationPlan) =>
        Promise.resolve({ addedRoles: [], removedRoles: rolePlan.removeRoles }),
      );
      const announcements = { publish: vi.fn(() => Promise.resolve(true)) };
      const synchronized = new RoleSynchronizedMutationService(
        { apply, compensate: vi.fn(() => Promise.resolve()) },
        announcements,
        { publish: () => Promise.resolve(true) },
        new MemoryLogger(),
      );
      const removalService = new RosterMutationService(database.client, synchronized);

      const removed = await removalService.removeStaffAppointmentImmediately({
        ...input(),
        staffType,
      });

      expect(removed.previousStaffType).toBe(staffType);
      expect(removed.roleMutation).toEqual({
        discordGuildId,
        discordUserId: memberId,
        addRoles: [],
        removeRoles: [{ id: staffRoleId, purpose }],
      });
      expect(apply).toHaveBeenCalledWith(removed.roleMutation);
      expect(removed.playerMembership).toMatchObject({
        id: appointed.playerMembership!.id,
        status: 'ACTIVE',
      });
      expect(removed.staffMembership).toMatchObject({
        id: appointed.staffMembership?.id,
        status: 'ENDED',
      });
      await expect(
        database.client.clubMembership.count({
          where: { userId: removed.user.id, membershipType: 'PLAYER', status: 'ACTIVE' },
        }),
      ).resolves.toBe(1);
      await expect(
        database.client.clubMembership.count({
          where: { userId: removed.user.id, membershipType: staffType, status: 'ENDED' },
        }),
      ).resolves.toBe(1);
      expect(announcements.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'DEMOTED', discordUserId: memberId }),
      );
      expect(removed.auditAnnouncement).toMatchObject({
        operation: 'STAFF_REMOVED',
        staffRole: purpose,
        playerDiscordUserId: memberId,
      });
    },
  );

  it('does not mutate or announce a staff removal when critical role synchronization fails', async () => {
    const appointed = await service.appointStaffImmediately({
      ...input(),
      staffType: 'PLAYER_MANAGER',
    });
    const announcements = { publish: vi.fn(() => Promise.resolve(true)) };
    const synchronized = new RoleSynchronizedMutationService(
      {
        apply: vi.fn(() => Promise.reject(new Error('Discord role removal failed'))),
        compensate: vi.fn(() => Promise.resolve()),
      },
      announcements,
      { publish: () => Promise.resolve(true) },
      new MemoryLogger(),
    );

    await expect(
      new RosterMutationService(database.client, synchronized).removeStaffAppointmentImmediately({
        ...input(),
        staffType: 'PLAYER_MANAGER',
      }),
    ).rejects.toThrow('Discord role removal failed');
    await expect(
      database.client.clubMembership.findUnique({ where: { id: appointed.playerMembership!.id } }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(
      database.client.clubMembership.findUnique({ where: { id: appointed.staffMembership!.id } }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(announcements.publish).not.toHaveBeenCalled();
  });

  it('full departure ends both roster and staff rows and removes both roles', async () => {
    await service.appointStaffImmediately({
      ...input(),
      actorDiscordUserId: memberId,
      staffType: 'ASSISTANT_MANAGER',
    });
    const result = await service.leaveTeamCompletely({
      ...input(),
      actorDiscordUserId: memberId,
    });
    expect(result.playerMembership!.status).toBe('ENDED');
    expect(result.staffMembership?.status).toBe('ENDED');
    expect(result.roleMutation.removeRoles).toEqual([
      { id: team.discordRoleId, purpose: 'TEAM' },
      { id: '400000000000000002', purpose: 'ATM' },
    ]);
    await expect(
      database.client.clubMembership.count({ where: { userId: result.user.id } }),
    ).resolves.toBe(2);
  });

  it('promotion swaps staff history without replacing the roster membership', async () => {
    await service.appointStaffImmediately({ ...input(actorId), staffType: 'TEAM_MANAGER' });
    const signed = await service.signFreeAgent({ ...input(memberId), actorDiscordUserId: actorId });
    const promoted = await service.promoteRosterMember({
      ...input(memberId),
      staffType: 'PLAYER_MANAGER',
    });
    const promotedAgain = await service.promoteRosterMember({
      ...input(memberId),
      staffType: 'ASSISTANT_MANAGER',
    });
    expect(promoted.playerMembership!.id).toBe(signed.playerMembership!.id);
    expect(promotedAgain.playerMembership!.id).toBe(signed.playerMembership!.id);
    expect(promotedAgain.roleMutation).toMatchObject({
      addRoles: [{ purpose: 'ATM' }],
      removeRoles: [{ purpose: 'PM' }],
    });
    await expect(
      database.client.clubMembership.count({
        where: { userId: promoted.user.id, membershipType: 'PLAYER_MANAGER', status: 'ENDED' },
      }),
    ).resolves.toBe(1);
  });

  it('TM demotion ends staff only and keeps the same roster membership', async () => {
    await service.appointStaffImmediately({ ...input(actorId), staffType: 'TEAM_MANAGER' });
    const appointed = await service.appointStaffImmediately({
      ...input(memberId),
      staffType: 'ASSISTANT_MANAGER',
    });
    const demoted = await service.demoteStaffToPlayer(input(memberId));
    expect(demoted.playerMembership!.id).toBe(appointed.playerMembership!.id);
    expect(demoted.playerMembership!.status).toBe('ACTIVE');
    expect(demoted.staffMembership?.status).toBe('ENDED');
    expect(demoted.roleMutation.removeRoles).toEqual([
      { id: '400000000000000002', purpose: 'ATM' },
    ]);
  });

  it('ranked release ends a staff target fully and preserves both historical rows', async () => {
    await service.appointStaffImmediately({ ...input(actorId), staffType: 'TEAM_MANAGER' });
    await service.appointStaffImmediately({
      ...input(memberId),
      staffType: 'PLAYER_MANAGER',
    });
    const released = await service.releaseMemberCompletely(input(memberId));
    expect(released.playerMembership!.status).toBe('ENDED');
    expect(released.staffMembership?.status).toBe('ENDED');
    expect(released.roleMutation.removeRoles.map(({ purpose }) => purpose)).toEqual(['TEAM', 'PM']);
  });

  it('enforces team scope and squad capacity inside the mutation transaction', async () => {
    await new GuildRepository(database.client).upsertSettings(guild.id, { defaultSquadLimit: 1 });
    await service.signFreeAgent(input(memberId));
    await expect(service.signFreeAgent(input(secondMemberId))).rejects.toBeInstanceOf(
      SquadFullError,
    );
    await expect(
      service.leaveTeamCompletely({
        ...input(memberId),
        clubId: otherTeam.id,
        actorDiscordUserId: memberId,
      }),
    ).rejects.toBeInstanceOf(MemberNotOnTeamError);
  });

  it('permits the same user to have an independent roster membership in another guild', async () => {
    await service.signFreeAgent(input(memberId));
    const guilds = new GuildRepository(database.client);
    const otherGuild = await guilds.create({
      discordGuildId: '100000000000000099',
      name: 'Other League',
    });
    await guilds.upsertSettings(otherGuild.id, { defaultSquadLimit: 5 });
    const otherGuildClub = await new ClubRepository(database.client).create({
      guildId: otherGuild.id,
      discordRoleId: '500000000000000099',
      emoji: '🟢',
    });
    const user = await new UserRepository(database.client).getByDiscordUserId(memberId);
    expect(user).not.toBeNull();
    await expect(
      new MembershipRepository(database.client).createActive({
        guildId: otherGuild.id,
        clubId: otherGuildClub.id,
        userId: user!.id,
        membershipType: 'PLAYER',
      }),
    ).resolves.toMatchObject({ guildId: otherGuild.id, status: 'ACTIVE' });
  });
});
