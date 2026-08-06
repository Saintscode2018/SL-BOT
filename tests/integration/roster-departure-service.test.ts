import type { Club, Guild } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CallerHasNoStaffAppointmentError,
  NotCurrentlySignedError,
  ReleaseTargetIsFreeAgentError,
  SelfReleaseForbiddenError,
  TargetNotOnCallerTeamError,
  TargetRankNotManageableError,
  TeamManagerCannotBeReleasedError,
  TeamManagerCannotDemandError,
  WrongCommandChannelError,
} from '../../src/domain/errors.js';
import type { MemberRoleMutationPlan } from '../../src/domain/roster-mutation.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { GuildRepository } from '../../src/repositories/guild-repository.js';
import { RosterDepartureService } from '../../src/services/roster-departure-service.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import { RoleSynchronizedMutationService } from '../../src/services/role-synchronized-mutation-service.js';
import { RosterMutationService } from '../../src/services/roster-mutation-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const discordGuildId = '100000000000000001';
const tmId = '200000000000000001';
const atmId = '200000000000000002';
const pmId = '200000000000000003';
const playerId = '200000000000000004';
const otherPlayerId = '200000000000000005';
const secondAtmId = '200000000000000006';
const freeAgentId = '200000000000000099';

describe('Stage 4B.2 roster departure service', () => {
  let database: TestDatabase;
  let guild: Guild;
  let team: Club;
  let otherTeam: Club;
  let mutations: RosterMutationService;
  let service: RosterDepartureService;

  beforeAll(() => {
    database = createTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
    const guilds = new GuildRepository(database.client);
    guild = await guilds.create({ discordGuildId, name: 'Stage 4B.2 League' });
    await guilds.upsertSettings(guild.id, {
      botCommandsChannelId: '300000000000000010',
      staffChannelId: '300000000000000011',
      transferChannelId: '300000000000000001',
      auditChannelId: '300000000000000002',
      teamManagerRoleId: '400000000000000001',
      assistantManagerRoleId: '400000000000000002',
      playerManagerRoleId: '400000000000000003',
      defaultSquadLimit: 17,
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
    mutations = new RosterMutationService(database.client);
    service = new RosterDepartureService(database.client, mutations);
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  async function sign(discordUserId: string, club = team, actorDiscordUserId = tmId) {
    return mutations.signFreeAgent({
      discordGuildId,
      clubId: club.id,
      actorDiscordUserId,
      targetDiscordUserId: discordUserId,
    });
  }

  async function appoint(
    discordUserId: string,
    staffType: 'TEAM_MANAGER' | 'ASSISTANT_MANAGER' | 'PLAYER_MANAGER',
    club = team,
  ) {
    return mutations.appointStaffImmediately({
      discordGuildId,
      clubId: club.id,
      actorDiscordUserId: discordUserId,
      targetDiscordUserId: discordUserId,
      staffType,
    });
  }

  describe('/demand eligibility', () => {
    it('allows an ordinary player, ATM, and PM while preserving the bound rank', async () => {
      await sign(playerId);
      await appoint(atmId, 'ASSISTANT_MANAGER');
      await appoint(pmId, 'PLAYER_MANAGER');
      await expect(service.getDemandEligibility(discordGuildId, playerId)).resolves.toMatchObject({
        club: { id: team.id },
        staffRole: null,
      });
      await expect(service.getDemandEligibility(discordGuildId, atmId)).resolves.toMatchObject({
        club: { id: team.id },
        staffRole: 'ATM',
      });
      await expect(service.getDemandEligibility(discordGuildId, pmId)).resolves.toMatchObject({
        club: { id: team.id },
        staffRole: 'PM',
      });
    });

    it('blocks the TM and a free agent with precise errors', async () => {
      await appoint(tmId, 'TEAM_MANAGER');
      await expect(service.getDemandEligibility(discordGuildId, tmId)).rejects.toBeInstanceOf(
        TeamManagerCannotDemandError,
      );
      await expect(
        service.getDemandEligibility(discordGuildId, freeAgentId),
      ).rejects.toBeInstanceOf(NotCurrentlySignedError);
    });
  });

  describe('departure channel policies', () => {
    const authorization = {
      discordGuildId,
      discordUserId: playerId,
      guildOwnerId: tmId,
      memberRoleIds: [] as string[],
      hasAdministratorPermission: true,
    };

    it('allows /demand in Bot Commands and Staff and blocks output/arbitrary channels', async () => {
      const policy = new CommandChannelPolicyService(database.client);
      for (const channelId of ['300000000000000010', '300000000000000011']) {
        await expect(
          policy.validateChannelPolicy({ authorization, channelId, commandName: 'demand' }),
        ).resolves.toBeUndefined();
      }
      for (const channelId of ['300000000000000001', '300000000000000099']) {
        await expect(
          policy.validateChannelPolicy({ authorization, channelId, commandName: 'demand' }),
        ).rejects.toBeInstanceOf(WrongCommandChannelError);
      }
    });

    it('allows /release in Bot Commands and Staff and blocks Transfer, Audit, and arbitrary channels', async () => {
      const policy = new CommandChannelPolicyService(database.client);
      const caller = { ...authorization, hasAdministratorPermission: false };
      for (const channelId of ['300000000000000010', '300000000000000011']) {
        await expect(
          policy.validateChannelPolicy({
            authorization: caller,
            channelId,
            commandName: 'release',
          }),
        ).resolves.toBeUndefined();
      }
      for (const channelId of ['300000000000000001', '300000000000000002', '300000000000000099']) {
        await expect(
          policy.validateChannelPolicy({
            authorization: caller,
            channelId,
            commandName: 'release',
          }),
        ).rejects.toBeInstanceOf(WrongCommandChannelError);
      }
    });
  });

  describe('/demand mutations', () => {
    it('fully departs an ordinary player, preserves history, and announces the post-roster count', async () => {
      const signed = await sign(playerId, team, playerId);
      const result = await service.demandFullDeparture({
        discordGuildId,
        discordUserId: playerId,
        clubId: team.id,
        expectedStaffRole: null,
      });
      expect(result.playerMembership).toMatchObject({
        id: signed.playerMembership.id,
        status: 'ENDED',
        endedByUserId: signed.user.id,
      });
      expect(result.staffMembership).toBeNull();
      expect(result.transaction).toMatchObject({
        transactionType: 'DEMAND_RELEASE',
        performedByUserId: signed.user.id,
        sourceClubId: team.id,
      });
      expect(result.roleMutation.removeRoles).toEqual([
        { id: team.discordRoleId, purpose: 'TEAM' },
      ]);
      expect(result.announcement).toMatchObject({
        type: 'DEMANDED',
        departureMode: 'FULL',
        roster: { currentSize: 0, maximumSize: 17 },
      });
      await expect(
        database.client.clubMembership.count({ where: { userId: signed.user.id } }),
      ).resolves.toBe(1);
    });

    it.each([
      ['ASSISTANT_MANAGER', 'ATM', '400000000000000002'],
      ['PLAYER_MANAGER', 'PM', '400000000000000003'],
    ] as const)(
      'lets %s step down while keeping the roster and team role',
      async (staffType, staffRole, staffRoleId) => {
        const appointed = await appoint(atmId, staffType);
        const auditCountBefore = await database.client.auditEvent.count();
        const result = await service.leaveStaffPosition({
          discordGuildId,
          discordUserId: atmId,
          clubId: team.id,
          expectedStaffRole: staffRole,
        });
        expect(result.playerMembership).toMatchObject({
          id: appointed.playerMembership.id,
          status: 'ACTIVE',
        });
        expect(result.staffMembership).toMatchObject({ status: 'ENDED' });
        expect(result.roleMutation.removeRoles).toEqual([{ id: staffRoleId, purpose: staffRole }]);
        expect(result.roleMutation.removeRoles).not.toContainEqual(
          expect.objectContaining({ purpose: 'TEAM' }),
        );
        expect(result.announcement).toMatchObject({
          type: 'DEMOTED',
          departureMode: 'STAFF_ONLY',
          roster: { currentSize: 1 },
        });
        await expect(database.client.auditEvent.count()).resolves.toBe(auditCountBefore);
      },
    );

    it('fully departs ATM/PM staff and removes only the team and matching staff roles', async () => {
      const appointed = await appoint(pmId, 'PLAYER_MANAGER');
      const result = await service.demandFullDeparture({
        discordGuildId,
        discordUserId: pmId,
        clubId: team.id,
        expectedStaffRole: 'PM',
      });
      expect(result.playerMembership.status).toBe('ENDED');
      expect(result.staffMembership).toMatchObject({
        id: appointed.staffMembership?.id,
        status: 'ENDED',
      });
      expect(result.roleMutation.removeRoles).toEqual([
        { id: team.discordRoleId, purpose: 'TEAM' },
        { id: '400000000000000003', purpose: 'PM' },
      ]);
    });
  });

  describe('/release validation and mutation', () => {
    it('requires an active staff caller and blocks self release', async () => {
      await sign(playerId);
      await expect(
        service.getReleaseEligibility(discordGuildId, otherPlayerId, playerId),
      ).rejects.toBeInstanceOf(CallerHasNoStaffAppointmentError);
      await appoint(tmId, 'TEAM_MANAGER');
      await expect(
        service.getReleaseEligibility(discordGuildId, tmId, tmId),
      ).rejects.toBeInstanceOf(SelfReleaseForbiddenError);
    });

    it('rejects free agents, other-team players, TMs, and unmanageable ranks', async () => {
      await appoint(tmId, 'TEAM_MANAGER');
      await expect(
        service.getReleaseEligibility(discordGuildId, tmId, freeAgentId),
      ).rejects.toBeInstanceOf(ReleaseTargetIsFreeAgentError);
      await sign(otherPlayerId, otherTeam);
      await expect(
        service.getReleaseEligibility(discordGuildId, tmId, otherPlayerId),
      ).rejects.toBeInstanceOf(TargetNotOnCallerTeamError);
      await appoint(atmId, 'ASSISTANT_MANAGER', otherTeam);
      await expect(
        service.getReleaseEligibility(discordGuildId, atmId, tmId),
      ).rejects.toBeInstanceOf(TargetNotOnCallerTeamError);
      await appoint(pmId, 'PLAYER_MANAGER');
      await appoint(secondAtmId, 'ASSISTANT_MANAGER');
      await expect(
        service.getReleaseEligibility(discordGuildId, pmId, secondAtmId),
      ).rejects.toBeInstanceOf(TargetRankNotManageableError);
      await expect(
        service.getReleaseEligibility(discordGuildId, pmId, tmId),
      ).rejects.toBeInstanceOf(TeamManagerCannotBeReleasedError);
    });

    it('releases an ordinary player completely without changing the TM', async () => {
      const manager = await appoint(tmId, 'TEAM_MANAGER');
      const signed = await sign(playerId);
      const eligibility = await service.getReleaseEligibility(discordGuildId, tmId, playerId);
      const result = await service.release({
        discordGuildId,
        actorDiscordUserId: tmId,
        targetDiscordUserId: playerId,
        clubId: team.id,
        expectedActorStaffRole: eligibility.callerStaffRole,
        expectedTargetStaffRole: eligibility.targetStaffRole,
      });
      expect(result.playerMembership).toMatchObject({
        id: signed.playerMembership.id,
        status: 'ENDED',
        endedByUserId: manager.user.id,
      });
      expect(result.roleMutation.removeRoles).toEqual([
        { id: team.discordRoleId, purpose: 'TEAM' },
      ]);
      expect(result.announcement).toMatchObject({
        type: 'RELEASED',
        roster: {
          currentSize: 1,
          maximumSize: 17,
          teamManagerDiscordUserId: tmId,
        },
      });
      await expect(
        database.client.clubMembership.findUnique({
          where: { id: manager.staffMembership!.id },
        }),
      ).resolves.toMatchObject({ status: 'ACTIVE' });
    });

    it('releases ATM/PM staff, vacates the staff slot, and retains unrelated roles in the plan', async () => {
      await appoint(tmId, 'TEAM_MANAGER');
      const appointed = await appoint(pmId, 'PLAYER_MANAGER');
      const eligibility = await service.getReleaseEligibility(discordGuildId, tmId, pmId);
      const result = await service.release({
        discordGuildId,
        actorDiscordUserId: tmId,
        targetDiscordUserId: pmId,
        clubId: team.id,
        expectedActorStaffRole: 'TM',
        expectedTargetStaffRole: 'PM',
      });
      expect(result.playerMembership.status).toBe('ENDED');
      expect(result.staffMembership).toMatchObject({
        id: appointed.staffMembership!.id,
        status: 'ENDED',
      });
      expect(result.roleMutation.removeRoles.map(({ purpose }) => purpose)).toEqual(['TEAM', 'PM']);
      expect(eligibility.targetStaffRole).toBe('PM');
      await expect(
        database.client.clubMembership.count({
          where: {
            clubId: team.id,
            membershipType: 'PLAYER_MANAGER',
            status: 'ACTIVE',
          },
        }),
      ).resolves.toBe(0);
    });

    it('synchronizes roles before database mutation and keeps success on announcement failure', async () => {
      await appoint(tmId, 'TEAM_MANAGER');
      await sign(playerId);
      const order: string[] = [];
      const apply = vi.fn((plan: MemberRoleMutationPlan) => {
        order.push('roles');
        return Promise.resolve({ addedRoles: [], removedRoles: plan.removeRoles });
      });
      const publisher = {
        publish: vi.fn(() => {
          order.push('announcement');
          return Promise.resolve(false);
        }),
      };
      const synchronized = new RoleSynchronizedMutationService(
        { apply, compensate: vi.fn(() => Promise.resolve()) },
        publisher,
        { publish: () => Promise.resolve(true) },
        new MemoryLogger(),
      );
      const synchronizedService = new RosterDepartureService(
        database.client,
        new RosterMutationService(database.client, synchronized),
      );
      const result = await synchronizedService.release({
        discordGuildId,
        actorDiscordUserId: tmId,
        targetDiscordUserId: playerId,
        clubId: team.id,
        expectedActorStaffRole: 'TM',
        expectedTargetStaffRole: null,
      });
      expect(order).toEqual(['roles', 'announcement']);
      expect(result.playerMembership.status).toBe('ENDED');
      expect(result.announcementDelivered).toBe(false);
    });
  });
});
