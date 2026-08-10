import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdministrativePermissionDeniedError,
  AdministrativeWrongChannelError,
  ClubInactiveError,
  TeamNotFoundError,
} from '../../src/domain/errors.js';
import type { MemberRoleMutationPlan } from '../../src/domain/roster-mutation.js';
import { AuditEventRepository } from '../../src/repositories/audit-event-repository.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import { OfferAcceptanceService } from '../../src/services/offer-acceptance-service.js';
import {
  TeamDisbandmentService,
  offerVoidedForTeamDisbandmentAuditEventType,
  teamDisbandedAuditEventType,
} from '../../src/services/team-disbandment-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  grantBotPermission,
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
    await grantBotPermission(client, discordGuildId, ownerId);
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
        const res = await mutate();
        return {
          ...res,
          announcementDelivered: null,
          auditAnnouncementDelivered: null,
        };
      },
    });
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  async function user(discordUserId: string) {
    return client.leagueUser.upsert({
      where: { discordUserId },
      create: { discordUserId },
      update: {},
    });
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

  it('ends all active memberships, voids source-team offers, preserves external offers, and audits', async () => {
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
    const externalOfferToDisbandedPlayer = await client.offer.create({
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
      ['ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'VOIDED'].map((status) =>
        client.offer.create({
          data: {
            guildId,
            clubId: teamId,
            playerUserId: freeAgent.id,
            offeredByUserId: actor.id,
            status,
            expiresAt: new Date('2030-01-01T00:00:00Z'),
            respondedAt: new Date('2026-01-01T00:00:00Z'),
            ...(status === 'CANCELLED' ? { cancelledAt: new Date('2026-01-01T00:00:00Z') } : {}),
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
      voidedOfferCount: 1,
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
      client.offer.findMany({
        where: { id: { in: [pendingDestination.id, externalOfferToDisbandedPlayer.id] } },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pendingDestination.id, status: 'VOIDED' }),
        expect.objectContaining({
          id: externalOfferToDisbandedPlayer.id,
          status: 'PENDING',
        }),
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
      voidedOfferCount: 1,
      timestamp: occurredAt.toISOString(),
    });
    const voidAudit = await client.auditEvent.findFirstOrThrow({
      where: {
        eventType: offerVoidedForTeamDisbandmentAuditEventType,
        entityId: pendingDestination.id,
      },
    });
    expect(voidAudit).toMatchObject({ guildId, actorUserId: null, entityType: 'offer' });
    expect(voidAudit.beforeState).toEqual({ status: 'PENDING' });
    expect(voidAudit.afterState).toEqual({
      status: 'VOIDED',
      respondedAt: occurredAt.toISOString(),
    });
    await expect(
      client.auditEvent.count({
        where: {
          eventType: offerVoidedForTeamDisbandmentAuditEventType,
          entityId: externalOfferToDisbandedPlayer.id,
        },
      }),
    ).resolves.toBe(0);
  });

  it('terminalizes each voided source-team offer after commit and continues after a failure', async () => {
    const actor = await user(ownerId);
    const player = await user('200000000000000008');
    const secondPlayer = await user('200000000000000009');
    const thirdPlayer = await user('200000000000000010');
    const first = await client.offer.create({
      data: {
        guildId,
        clubId: teamId,
        playerUserId: secondPlayer.id,
        offeredByUserId: actor.id,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
        discordChannelId: '600000000000000001',
        discordMessageId: '700000000000000001',
      },
    });
    const second = await client.offer.create({
      data: {
        guildId,
        clubId: teamId,
        playerUserId: thirdPlayer.id,
        offeredByUserId: actor.id,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
        discordChannelId: '600000000000000002',
        discordMessageId: '700000000000000002',
      },
    });
    const withoutReference = await client.offer.create({
      data: {
        guildId,
        clubId: teamId,
        playerUserId: player.id,
        offeredByUserId: actor.id,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    });
    const terminalizeOffer = vi.fn(async (offer: { id: string }) => {
      await expect(client.club.findUniqueOrThrow({ where: { id: teamId } })).resolves.toMatchObject(
        {
          active: false,
        },
      );
      if (offer.id === first.id) throw new Error('Discord message update failed');
    });
    const serviceWithTerminalizer = new TeamDisbandmentService(
      client,
      {
        executeMany: async <T>(
          plans: readonly MemberRoleMutationPlan[],
          mutate: () => Promise<T>,
        ) => {
          capturedPlans = [...plans];
          return {
            ...(await mutate()),
            announcementDelivered: null,
            auditAnnouncementDelivered: null,
          };
        },
      },
      { terminalizeOffer },
    );

    await expect(
      serviceWithTerminalizer.disband({
        authorization: authorization(),
        teamId,
        teamName: 'T1',
      }),
    ).resolves.toMatchObject({ voidedOfferCount: 3 });

    expect(terminalizeOffer).toHaveBeenCalledTimes(3);
    expect(terminalizeOffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: first.id }),
      'VOIDED',
    );
    expect(terminalizeOffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: second.id }),
      'VOIDED',
    );
    expect(terminalizeOffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: withoutReference.id }),
      'VOIDED',
    );
    await expect(client.offer.count({ where: { clubId: teamId, status: 'VOIDED' } })).resolves.toBe(
      3,
    );
    await expect(client.leagueTransaction.count()).resolves.toBe(0);
  });

  it('preserves an external offer so a newly freed player can accept it', async () => {
    const actor = await user(ownerId);
    const player = await user('200000000000000011');
    await membership(player.id, 'PLAYER');
    const externalOffer = await client.offer.create({
      data: {
        guildId,
        clubId: otherTeamId,
        playerUserId: player.id,
        offeredByUserId: actor.id,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    });

    await service.disband({ authorization: authorization(), teamId, teamName: 'T1' });
    await expect(
      client.offer.findUniqueOrThrow({ where: { id: externalOffer.id } }),
    ).resolves.toMatchObject({
      status: 'PENDING',
    });
    await new OfferAcceptanceService(client).acceptOffer({
      offerId: externalOffer.id,
      acceptingDiscordUserId: player.discordUserId,
    });

    await expect(
      client.offer.findUniqueOrThrow({ where: { id: externalOffer.id } }),
    ).resolves.toMatchObject({
      status: 'ACCEPTED',
    });
    await expect(
      client.clubMembership.findFirstOrThrow({
        where: { guildId, clubId: otherTeamId, userId: player.id, status: 'ACTIVE' },
      }),
    ).resolves.toBeDefined();
  });

  it('leaves cross-guild offers untouched', async () => {
    const actor = await user(ownerId);
    const player = await user('200000000000000009');
    const foreignGuild = await client.guild.create({
      data: { discordGuildId: foreignDiscordGuildId, name: 'Foreign', settings: { create: {} } },
    });
    const foreignClub = await client.club.create({
      data: { guildId: foreignGuild.id, discordRoleId: '300000000000000099', emoji: '⚪' },
    });
    const foreignOffer = await client.offer.create({
      data: {
        guildId: foreignGuild.id,
        clubId: foreignClub.id,
        playerUserId: player.id,
        offeredByUserId: actor.id,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    });

    await service.disband({ authorization: authorization(), teamId, teamName: 'T1' });

    await expect(
      client.offer.findUniqueOrThrow({ where: { id: foreignOffer.id } }),
    ).resolves.toMatchObject({
      status: 'PENDING',
    });
  });

  it('rolls back memberships, source-team offers, and audits when a void audit write fails', async () => {
    const actor = await user(ownerId);
    const player = await user('200000000000000010');
    await membership(player.id, 'PLAYER');
    const offer = await client.offer.create({
      data: {
        guildId,
        clubId: teamId,
        playerUserId: player.id,
        offeredByUserId: actor.id,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    });
    const createAudit = vi
      .spyOn(AuditEventRepository.prototype, 'create')
      .mockRejectedValueOnce(new Error('void audit write failed'));

    try {
      await expect(
        service.disband({ authorization: authorization(), teamId, teamName: 'T1' }),
      ).rejects.toThrow('void audit write failed');
    } finally {
      createAudit.mockRestore();
    }

    await expect(client.club.findUniqueOrThrow({ where: { id: teamId } })).resolves.toMatchObject({
      active: true,
    });
    await expect(
      client.clubMembership.findFirstOrThrow({ where: { clubId: teamId, userId: player.id } }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(
      client.offer.findUniqueOrThrow({ where: { id: offer.id } }),
    ).resolves.toMatchObject({
      status: 'PENDING',
    });
    await expect(
      client.auditEvent.count({
        where: {
          eventType: {
            in: [teamDisbandedAuditEventType, offerVoidedForTeamDisbandmentAuditEventType],
          },
        },
      }),
    ).resolves.toBe(0);
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
    const inputs: AuthorizationInput[] = [authorization()];
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

  it('produces Audit and Transfer announcement plans and publishes post-commit when channels are configured', async () => {
    const auditChannelId = '500000000000000088';
    const transferChannelId = '500000000000000099';
    const currentTeamManager = await user('200000000000000009');
    await membership(currentTeamManager.id, 'TEAM_MANAGER');
    await client.guildSettings.update({
      where: { guildId },
      data: { auditChannelId, transferChannelId },
    });

    let publishedAudit = false;
    let publishedTransfer = false;
    let capturedAuditAnnouncement: unknown;
    const synchronizedMutations = {
      executeMany: async <T>(
        plans: readonly MemberRoleMutationPlan[],
        mutate: () => Promise<T>,
      ) => {
        capturedPlans = [...plans];
        const res = await mutate();
        const payload = res as { announcement?: unknown; auditAnnouncement?: unknown };
        publishedTransfer = payload.announcement !== null && payload.announcement !== undefined;
        publishedAudit =
          payload.auditAnnouncement !== null && payload.auditAnnouncement !== undefined;
        capturedAuditAnnouncement = payload.auditAnnouncement;
        return {
          ...res,
          announcementDelivered: publishedTransfer ? true : null,
          auditAnnouncementDelivered: publishedAudit ? true : null,
        };
      },
    };

    const serviceWithAnnouncements = new TeamDisbandmentService(client, synchronizedMutations);
    const result = await serviceWithAnnouncements.disband({
      authorization: authorization(),
      teamId,
      teamName: 'Lions',
    });

    expect(publishedAudit).toBe(true);
    expect(publishedTransfer).toBe(true);
    expect(result.announcementDelivered).toBe(true);
    expect(result.auditAnnouncementDelivered).toBe(true);
    expect(capturedAuditAnnouncement).toMatchObject({
      operation: 'TEAM_DISBANDED',
      actorDiscordUserId: ownerId,
      channelId: auditChannelId,
    });
    expect(capturedAuditAnnouncement).not.toMatchObject({
      actorDiscordUserId: currentTeamManager.discordUserId,
    });
  });

  it('returns null delivery status when announcement channels are not configured', async () => {
    await client.guildSettings.update({
      where: { guildId },
      data: { auditChannelId: null, transferChannelId: null },
    });

    const synchronizedMutations = {
      executeMany: async <T>(
        plans: readonly MemberRoleMutationPlan[],
        mutate: () => Promise<T>,
      ) => {
        capturedPlans = [...plans];
        const res = await mutate();
        const payload = res as { announcement?: unknown; auditAnnouncement?: unknown };
        return {
          ...res,
          announcementDelivered: payload.announcement ? true : null,
          auditAnnouncementDelivered: payload.auditAnnouncement ? true : null,
        };
      },
    };

    const serviceWithAnnouncements = new TeamDisbandmentService(client, synchronizedMutations);
    const result = await serviceWithAnnouncements.disband({
      authorization: authorization(),
      teamId,
      teamName: 'Lions',
    });

    expect(result.announcementDelivered).toBeNull();
    expect(result.auditAnnouncementDelivered).toBeNull();
  });

  it('ensures announcement delivery failures do not roll back disbandment or trigger compensation', async () => {
    const auditChannelId = '500000000000000088';
    const transferChannelId = '500000000000000099';
    await client.guildSettings.update({
      where: { guildId },
      data: { auditChannelId, transferChannelId },
    });

    const roleCompensationTriggered = false;
    const synchronizedMutations = {
      executeMany: async <T>(
        plans: readonly MemberRoleMutationPlan[],
        mutate: () => Promise<T>,
      ) => {
        capturedPlans = [...plans];
        const res = await mutate();
        // Simulate delivery failure for Audit and Transfer post-commit without throwing
        return {
          ...res,
          announcementDelivered: false,
          auditAnnouncementDelivered: false,
        };
      },
    };

    const serviceWithFailingAnnouncements = new TeamDisbandmentService(
      client,
      synchronizedMutations,
    );
    const result = await serviceWithFailingAnnouncements.disband({
      authorization: authorization(),
      teamId,
      teamName: 'Lions',
    });

    expect(result.announcementDelivered).toBe(false);
    expect(result.auditAnnouncementDelivered).toBe(false);
    expect(roleCompensationTriggered).toBe(false);

    // Verify team is still inactive in DB
    const disbandedTeam = await client.club.findUniqueOrThrow({ where: { id: teamId } });
    expect(disbandedTeam.active).toBe(false);
  });
});
