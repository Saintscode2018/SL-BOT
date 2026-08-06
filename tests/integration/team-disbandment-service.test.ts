import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AdministrativePermissionDeniedError,
  AdministrativeWrongChannelError,
  ClubInactiveError,
  TeamNotFoundError,
} from '../../src/domain/errors.js';
import type { MemberRoleMutationPlan } from '../../src/domain/roster-mutation.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import {
  TeamDisbandmentService,
  teamDisbandedAuditEventType,
} from '../../src/services/team-disbandment-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';

const discordGuildId = '100000000000000001';
const foreignDiscordGuildId = '100000000000000002';
const ownerId = '200000000000000001';
const teamRoleId = '300000000000000001';
const otherTeamRoleId = '300000000000000002';
const tmRoleId = '400000000000000001';
const atmRoleId = '400000000000000002';
const pmRoleId = '400000000000000003';
const botPermissionsRoleId = '400000000000000004';
const staffChannelId = '500000000000000001';

function authorization(guildId = discordGuildId): AuthorizationInput {
  return {
    discordGuildId: guildId,
    discordUserId: ownerId,
    guildOwnerId: ownerId,
    memberRoleIds: [],
    hasAdministratorPermission: false,
  };
}

describe('TeamDisbandmentService', () => {
  let database: TestDatabase;
  let client: PrismaClient;
  let guildId: string;
  let teamId: string;
  let otherTeamId: string;
  let capturedPlans: MemberRoleMutationPlan[];
  let service: TeamDisbandmentService;

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
            staffChannelId,
            botPermissionsRoleId,
            teamManagerRoleId: tmRoleId,
            assistantManagerRoleId: atmRoleId,
            playerManagerRoleId: pmRoleId,
          },
        },
      },
    });
    guildId = guild.id;
    const team = await client.club.create({
      data: { guildId, discordRoleId: teamRoleId, emoji: '🦁' },
    });
    teamId = team.id;
    const otherTeam = await client.club.create({
      data: { guildId, discordRoleId: otherTeamRoleId, emoji: '🐯' },
    });
    otherTeamId = otherTeam.id;
    service = new TeamDisbandmentService(client, {
      executeMany: async <T>(
        plans: readonly MemberRoleMutationPlan[],
        mutate: () => Promise<T>,
      ) => {
        capturedPlans = [...plans];
        return mutate();
      },
    });
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  async function user(discordUserId: string) {
    return client.leagueUser.create({ data: { discordUserId } });
  }

  async function membership(
    userId: string,
    membershipType: 'PLAYER' | 'TEAM_MANAGER' | 'ASSISTANT_MANAGER' | 'PLAYER_MANAGER',
    status = 'ACTIVE',
  ) {
    return client.clubMembership.create({
      data: {
        guildId,
        clubId: teamId,
        userId,
        membershipType,
        status,
        ...(status === 'ENDED' ? { leftAt: new Date('2025-01-01T00:00:00Z') } : {}),
      },
    });
  }

  it('ends all active memberships, expires related offers, preserves history, and audits', async () => {
    const actor = await user(ownerId);
    const ordinary = await user('200000000000000002');
    const tm = await user('200000000000000003');
    const assistantManager = await user('200000000000000004');
    const playerManager = await user('200000000000000005');
    const freeAgent = await user('200000000000000006');
    const unrelated = await user('200000000000000007');
    const historical = await membership(ordinary.id, 'PLAYER', 'ENDED');
    await membership(ordinary.id, 'PLAYER');
    await membership(tm.id, 'PLAYER');
    await membership(tm.id, 'TEAM_MANAGER');
    await membership(assistantManager.id, 'PLAYER');
    await membership(assistantManager.id, 'ASSISTANT_MANAGER');
    await membership(playerManager.id, 'PLAYER');
    await membership(playerManager.id, 'PLAYER_MANAGER');

    const pendingDestination = await client.offer.create({
      data: {
        guildId,
        clubId: teamId,
        playerUserId: freeAgent.id,
        offeredByUserId: actor.id,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    });
    const pendingSource = await client.offer.create({
      data: {
        guildId,
        clubId: otherTeamId,
        playerUserId: ordinary.id,
        offeredByUserId: actor.id,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    });
    const unrelatedPending = await client.offer.create({
      data: {
        guildId,
        clubId: otherTeamId,
        playerUserId: unrelated.id,
        offeredByUserId: actor.id,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    });
    const terminalOffers = await Promise.all(
      ['ACCEPTED', 'DECLINED', 'EXPIRED'].map((status) =>
        client.offer.create({
          data: {
            guildId,
            clubId: teamId,
            playerUserId: freeAgent.id,
            offeredByUserId: actor.id,
            status,
            expiresAt: new Date('2030-01-01T00:00:00Z'),
            respondedAt: new Date('2026-01-01T00:00:00Z'),
          },
        }),
      ),
    );
    const completedTransaction = await client.leagueTransaction.create({
      data: {
        guildId,
        userId: ordinary.id,
        transactionType: 'SIGNING',
        destinationClubId: teamId,
        performedByUserId: actor.id,
      },
    });
    const priorAudit = await client.auditEvent.create({
      data: {
        guildId,
        actorUserId: actor.id,
        eventType: 'historic.event',
        entityType: 'club',
        entityId: teamId,
      },
    });
    const occurredAt = new Date('2026-08-06T12:00:00Z');

    const result = await service.disband({
      authorization: authorization(),
      teamId,
      teamName: 'T1',
      occurredAt,
    });

    expect(result).toMatchObject({
      endedMembershipCount: 7,
      affectedUserCount: 4,
      expiredOfferCount: 2,
      team: { id: teamId, active: false, discordRoleId: teamRoleId, emoji: '🦁' },
    });
    await expect(client.club.count({ where: { id: teamId } })).resolves.toBe(1);
    await expect(
      client.clubMembership.count({ where: { clubId: teamId, status: 'ACTIVE' } }),
    ).resolves.toBe(0);
    await expect(
      client.clubMembership.findUniqueOrThrow({ where: { id: historical.id } }),
    ).resolves.toMatchObject({ status: 'ENDED', leftAt: new Date('2025-01-01T00:00:00Z') });
    await expect(client.leagueUser.count()).resolves.toBe(7);
    await expect(
      client.offer.findMany({ where: { id: { in: [pendingDestination.id, pendingSource.id] } } }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pendingDestination.id, status: 'EXPIRED' }),
        expect.objectContaining({ id: pendingSource.id, status: 'EXPIRED' }),
      ]),
    );
    await expect(
      client.offer.findUniqueOrThrow({ where: { id: unrelatedPending.id } }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    for (const offer of terminalOffers) {
      await expect(
        client.offer.findUniqueOrThrow({ where: { id: offer.id } }),
      ).resolves.toMatchObject({ status: offer.status });
    }
    await expect(
      client.leagueTransaction.findUniqueOrThrow({ where: { id: completedTransaction.id } }),
    ).resolves.toBeDefined();
    await expect(
      client.auditEvent.findUniqueOrThrow({ where: { id: priorAudit.id } }),
    ).resolves.toBeDefined();

    expect(capturedPlans).toHaveLength(4);
    const plansByUser = new Map(capturedPlans.map((plan) => [plan.discordUserId, plan]));
    expect(plansByUser.get(ordinary.discordUserId)?.removeRoles).toEqual([
      { id: teamRoleId, purpose: 'TEAM' },
    ]);
    expect(plansByUser.get(tm.discordUserId)?.removeRoles).toEqual([
      { id: teamRoleId, purpose: 'TEAM' },
      { id: tmRoleId, purpose: 'TM' },
    ]);
    expect(plansByUser.get(assistantManager.discordUserId)?.removeRoles).toEqual([
      { id: teamRoleId, purpose: 'TEAM' },
      { id: atmRoleId, purpose: 'ATM' },
    ]);
    expect(plansByUser.get(playerManager.discordUserId)?.removeRoles).toEqual([
      { id: teamRoleId, purpose: 'TEAM' },
      { id: pmRoleId, purpose: 'PM' },
    ]);

    const audit = await client.auditEvent.findFirstOrThrow({
      where: { eventType: teamDisbandedAuditEventType },
    });
    expect(audit).toMatchObject({ guildId, actorUserId: actor.id, entityId: teamId });
    expect(audit.metadata).toMatchObject({
      discordGuildId,
      teamId,
      teamName: 'T1',
      teamDiscordRoleId: teamRoleId,
      actorDiscordUserId: ownerId,
      endedMembershipCount: 7,
      affectedUserCount: 4,
      expiredOfferCount: 2,
      timestamp: occurredAt.toISOString(),
    });
  });

  it('rejects an inactive, foreign-guild, or repeated team without mutation', async () => {
    await client.club.update({ where: { id: teamId }, data: { active: false } });
    await expect(
      service.disband({ authorization: authorization(), teamId, teamName: 'T1' }),
    ).rejects.toBeInstanceOf(ClubInactiveError);

    const foreignGuild = await client.guild.create({
      data: {
        discordGuildId: foreignDiscordGuildId,
        name: 'Foreign',
        settings: { create: {} },
      },
    });
    const foreignTeam = await client.club.create({
      data: {
        guildId: foreignGuild.id,
        discordRoleId: '300000000000000099',
        emoji: '⚪',
      },
    });
    await expect(
      service.disband({
        authorization: authorization(),
        teamId: foreignTeam.id,
        teamName: 'Foreign',
      }),
    ).rejects.toBeInstanceOf(TeamNotFoundError);
    await expect(
      client.auditEvent.count({ where: { eventType: teamDisbandedAuditEventType } }),
    ).resolves.toBe(0);
  });

  it('deduplicates a role ID shared by the team and a configured staff role', async () => {
    await client.guildSettings.update({
      where: { guildId },
      data: { playerManagerRoleId: teamRoleId },
    });
    const manager = await user('200000000000000008');
    await membership(manager.id, 'PLAYER');
    await membership(manager.id, 'PLAYER_MANAGER');

    await service.disband({
      authorization: authorization(),
      teamId,
      teamName: 'T1',
    });

    expect(capturedPlans).toHaveLength(1);
    expect(capturedPlans[0]?.discordUserId).toBe(manager.discordUserId);
    expect(capturedPlans[0]?.removeRoles).toEqual([{ id: teamRoleId, purpose: 'TEAM' }]);
  });

  it('allows only global administrators in Staff Commands', async () => {
    const policy = new CommandChannelPolicyService(client);
    const inputs: AuthorizationInput[] = [
      authorization(),
      {
        ...authorization(),
        discordUserId: '200000000000000010',
        hasAdministratorPermission: true,
      },
      {
        ...authorization(),
        discordUserId: '200000000000000011',
        memberRoleIds: [botPermissionsRoleId],
      },
    ];
    for (const input of inputs) {
      await expect(
        policy.validateChannelPolicy({
          authorization: input,
          channelId: staffChannelId,
          commandName: 'team',
          subcommand: 'disband',
        }),
      ).resolves.toBeUndefined();
    }

    for (const memberRoleIds of [[tmRoleId], [atmRoleId], [pmRoleId], [], ['unrelated-role']]) {
      await expect(
        policy.validateChannelPolicy({
          authorization: {
            ...authorization(),
            discordUserId: `20000000000000002${memberRoleIds.length}`,
            memberRoleIds,
          },
          channelId: staffChannelId,
          commandName: 'team',
          subcommand: 'disband',
        }),
      ).rejects.toBeInstanceOf(AdministrativePermissionDeniedError);
    }

    await expect(
      policy.validateChannelPolicy({
        authorization: authorization(),
        channelId: '500000000000000099',
        commandName: 'team',
        subcommand: 'disband',
      }),
    ).rejects.toBeInstanceOf(AdministrativeWrongChannelError);
  });
});
