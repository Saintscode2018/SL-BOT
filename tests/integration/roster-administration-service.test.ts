import type { Club, Guild } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ActiveStaffRosterConflictError,
  AmbiguousActivePlayerMembershipError,
  ClubInactiveError,
  MemberAlreadySignedError,
  MemberIsFreeAgentError,
  SquadFullError,
  TeamNotFoundError,
} from '../../src/domain/errors.js';
import type {
  AuditAnnouncementPlan,
  MemberRoleMutationPlan,
} from '../../src/domain/roster-mutation.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { GuildRepository } from '../../src/repositories/guild-repository.js';
import { MembershipRepository } from '../../src/repositories/membership-repository.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import {
  AuditAnnouncementService,
  type AuditAnnouncementAdapter,
} from '../../src/services/audit-announcement-service.js';
import { RosterAdministrationService } from '../../src/services/roster-administration-service.js';
import { RoleSynchronizedMutationService } from '../../src/services/role-synchronized-mutation-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  grantBotPermission,
  type TestDatabase,
} from '../helpers/database.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const discordGuildId = '810000000000000001';
const ownerId = '810000000000000002';
const playerId = '810000000000000003';

describe('administrative roster service', () => {
  let database: TestDatabase;
  let guild: Guild;
  let team: Club;
  let otherTeam: Club;
  let apply: ReturnType<typeof vi.fn>;
  let compensate: ReturnType<typeof vi.fn>;
  let publish: ReturnType<typeof vi.fn>;
  let publishAudit: ReturnType<typeof vi.fn>;
  let service: RosterAdministrationService;

  const authorization = (overrides: Partial<AuthorizationInput> = {}): AuthorizationInput => ({
    discordGuildId,
    discordUserId: ownerId,
    guildOwnerId: ownerId,
    memberRoleIds: [],
    hasAdministratorPermission: false,
    ...overrides,
  });

  const makeService = (
    applyImplementation: (plan: MemberRoleMutationPlan) => Promise<{
      addedRoles: MemberRoleMutationPlan['addRoles'];
      removedRoles: MemberRoleMutationPlan['removeRoles'];
    }> = (plan) => Promise.resolve({ addedRoles: plan.addRoles, removedRoles: plan.removeRoles }),
    publishImplementation = () => Promise.resolve(true),
    publishAuditImplementation = () => Promise.resolve(true),
    logger = new MemoryLogger(),
  ): RosterAdministrationService => {
    apply = vi.fn(applyImplementation);
    compensate = vi.fn(() => Promise.resolve());
    publish = vi.fn(publishImplementation);
    publishAudit = vi.fn(publishAuditImplementation);
    return new RosterAdministrationService(
      database.client,
      new RoleSynchronizedMutationService(
        { apply, compensate },
        { publish },
        { publish: publishAudit },
        logger,
      ),
    );
  };

  beforeAll(() => {
    database = createTestDatabase();
  }, 30_000);

  beforeEach(async () => {
    await clearDatabase(database.client);
    const guilds = new GuildRepository(database.client);
    guild = await guilds.create({ discordGuildId, name: 'Roster Administration League' });
    await guilds.upsertSettings(guild.id, {
      staffChannelId: '810000000000000010',
      botPermissionsRoleId: '810000000000000011',
      defaultSquadLimit: 2,
    });
    await grantBotPermission(database.client, discordGuildId, ownerId);
    const clubs = new ClubRepository(database.client);
    team = await clubs.create({
      guildId: guild.id,
      discordRoleId: '810000000000000020',
      emoji: '⚽',
    });
    otherTeam = await clubs.create({
      guildId: guild.id,
      discordRoleId: '810000000000000021',
      emoji: '🔵',
    });
    service = makeService();
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  it('adds and removes an ordinary player with only the team role and preserves history', async () => {
    const added = await service.add({
      authorization: authorization(),
      clubId: team.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });

    expect(added.membership).toMatchObject({
      clubId: team.id,
      membershipType: 'PLAYER',
      status: 'ACTIVE',
    });
    expect(added.roleMutation).toEqual({
      discordGuildId,
      discordUserId: playerId,
      addRoles: [{ id: team.discordRoleId, purpose: 'TEAM' }],
      removeRoles: [],
    });
    expect(added.announcement).toBeNull();
    expect(added.announcementDelivered).toBeNull();
    expect(publish).not.toHaveBeenCalled();

    const removed = await service.remove({
      authorization: authorization(),
      playerDiscordUserId: playerId,
    });

    expect(removed.club.id).toBe(team.id);
    expect(removed.membership.status).toBe('ENDED');
    expect(removed.roleMutation).toEqual({
      discordGuildId,
      discordUserId: playerId,
      addRoles: [],
      removeRoles: [{ id: team.discordRoleId, purpose: 'TEAM' }],
    });
    await expect(
      database.client.clubMembership.count({ where: { userId: added.player.id } }),
    ).resolves.toBe(1);
    await expect(
      database.client.leagueTransaction.findMany({
        where: { userId: added.player.id },
        orderBy: { createdAt: 'asc' },
      }),
    ).resolves.toMatchObject([
      { transactionType: 'SIGNING', destinationClubId: team.id },
      { transactionType: 'RELEASE', sourceClubId: team.id },
    ]);
    await expect(
      database.client.auditEvent.count({ where: { entityId: added.membership.id } }),
    ).resolves.toBe(2);
  });

  it('rejects same-team and other-team roster conflicts', async () => {
    await service.add({
      authorization: authorization(),
      clubId: team.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    await expect(
      service.add({
        authorization: authorization(),
        clubId: team.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(MemberAlreadySignedError);
    await expect(
      service.add({
        authorization: authorization(),
        clubId: otherTeam.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(MemberAlreadySignedError);
  });

  it('rejects staff conflicts for both add and remove without ending staff roles', async () => {
    const users = new UserRepository(database.client);
    const player = await users.getOrCreateByDiscordUserId(playerId);
    const memberships = new MembershipRepository(database.client);
    await memberships.createActive({
      guildId: guild.id,
      clubId: team.id,
      userId: player.id,
      membershipType: 'TEAM_MANAGER',
    });
    await expect(
      service.add({
        authorization: authorization(),
        clubId: team.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(ActiveStaffRosterConflictError);
    await expect(
      service.remove({ authorization: authorization(), playerDiscordUserId: playerId }),
    ).rejects.toBeInstanceOf(ActiveStaffRosterConflictError);
    await expect(
      database.client.clubMembership.count({
        where: { userId: player.id, membershipType: 'TEAM_MANAGER', status: 'ACTIVE' },
      }),
    ).resolves.toBe(1);
  });

  it('enforces inactive, foreign-guild, and effective squad-limit validation', async () => {
    await new ClubRepository(database.client).deactivate(team.id);
    await expect(
      service.add({
        authorization: authorization(),
        clubId: team.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(ClubInactiveError);

    const foreignGuild = await new GuildRepository(database.client).create({
      discordGuildId: '820000000000000001',
      name: 'Foreign League',
    });
    const foreignTeam = await new ClubRepository(database.client).create({
      guildId: foreignGuild.id,
      discordRoleId: '820000000000000002',
      emoji: '🟣',
    });
    await expect(
      service.add({
        authorization: authorization(),
        clubId: foreignTeam.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(TeamNotFoundError);

    await new ClubRepository(database.client).update(team.id, {
      active: true,
      squadLimitOverride: 1,
    });
    const existing = await new UserRepository(database.client).getOrCreateByDiscordUserId(
      '810000000000000099',
    );
    await new MembershipRepository(database.client).createActive({
      guildId: guild.id,
      clubId: team.id,
      userId: existing.id,
      membershipType: 'TEAM_MANAGER',
    });
    await expect(
      service.add({
        authorization: authorization(),
        clubId: team.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(SquadFullError);
  });

  it('leaves the database unchanged when Discord role application fails', async () => {
    service = makeService(() => Promise.reject(new Error('role unavailable')));
    await expect(
      service.add({
        authorization: authorization(),
        clubId: team.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toThrow('role unavailable');
    await expect(database.client.clubMembership.count()).resolves.toBe(0);
    await expect(database.client.leagueTransaction.count()).resolves.toBe(0);
  });

  it('compensates a role addition when repeated database validation fails', async () => {
    service = makeService(async (plan) => {
      await new ClubRepository(database.client).deactivate(team.id);
      return { addedRoles: plan.addRoles, removedRoles: plan.removeRoles };
    });
    await expect(
      service.add({
        authorization: authorization(),
        clubId: team.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(ClubInactiveError);
    expect(compensate).toHaveBeenCalledWith(
      expect.objectContaining({ addRoles: [{ id: team.discordRoleId, purpose: 'TEAM' }] }),
      expect.objectContaining({ addedRoles: [{ id: team.discordRoleId, purpose: 'TEAM' }] }),
    );
    await expect(database.client.clubMembership.count()).resolves.toBe(0);
  });

  it('keeps an active membership when Discord role removal fails', async () => {
    const added = await service.add({
      authorization: authorization(),
      clubId: team.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    service = makeService(() => Promise.reject(new Error('role removal unavailable')));

    await expect(
      service.remove({ authorization: authorization(), playerDiscordUserId: playerId }),
    ).rejects.toThrow('role removal unavailable');
    await expect(
      database.client.clubMembership.findUnique({ where: { id: added.membership.id } }),
    ).resolves.toMatchObject({ status: 'ACTIVE', leftAt: null });
  });

  it('compensates a role removal when repeated database validation fails', async () => {
    const added = await service.add({
      authorization: authorization(),
      clubId: team.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    service = makeService(async (plan) => {
      await database.client.clubMembership.update({
        where: { id: added.membership.id },
        data: { status: 'ENDED', leftAt: new Date() },
      });
      return { addedRoles: plan.addRoles, removedRoles: plan.removeRoles };
    });

    await expect(
      service.remove({ authorization: authorization(), playerDiscordUserId: playerId }),
    ).rejects.toBeInstanceOf(MemberIsFreeAgentError);
    expect(compensate).toHaveBeenCalledWith(
      expect.objectContaining({
        removeRoles: [{ id: team.discordRoleId, purpose: 'TEAM' }],
      }),
      expect.objectContaining({
        removedRoles: [{ id: team.discordRoleId, purpose: 'TEAM' }],
      }),
    );
  });

  it('rejects a free agent and safely rejects corrupted multiple active player memberships', async () => {
    await expect(
      service.remove({ authorization: authorization(), playerDiscordUserId: playerId }),
    ).rejects.toBeInstanceOf(MemberIsFreeAgentError);

    const player = await new UserRepository(database.client).getOrCreateByDiscordUserId(playerId);
    await database.client.$executeRawUnsafe(
      'DROP INDEX "ClubMembership_one_active_player_per_guild"',
    );
    try {
      const memberships = new MembershipRepository(database.client);
      await memberships.createActive({
        guildId: guild.id,
        clubId: team.id,
        userId: player.id,
        membershipType: 'PLAYER',
      });
      await memberships.createActive({
        guildId: guild.id,
        clubId: otherTeam.id,
        userId: player.id,
        membershipType: 'PLAYER',
      });
      await expect(
        service.remove({ authorization: authorization(), playerDiscordUserId: playerId }),
      ).rejects.toBeInstanceOf(AmbiguousActivePlayerMembershipError);
      expect(apply).not.toHaveBeenCalled();
    } finally {
      await database.client.clubMembership.deleteMany({ where: { userId: player.id } });
      await database.client.$executeRawUnsafe(
        `CREATE UNIQUE INDEX "ClubMembership_one_active_player_per_guild"
         ON "ClubMembership"("guildId", "userId")
         WHERE "membershipType" = 'PLAYER' AND "status" = 'ACTIVE'`,
      );
    }
  });

  it('publishes both Transfer Market and Audit announcements post-commit when channels are configured', async () => {
    const guilds = new GuildRepository(database.client);
    await guilds.upsertSettings(guild.id, {
      transferChannelId: '810000000000000030',
      auditChannelId: '810000000000000040',
    });

    let addMemberStatusDuringPublish: string | null = null;
    let addTxCountDuringPublish: number = 0;
    let addAuditEventCountDuringPublish: number = 0;

    const customService = makeService(
      (plan) => Promise.resolve({ addedRoles: plan.addRoles, removedRoles: plan.removeRoles }),
      async () => {
        const mem = await database.client.clubMembership.findFirst({
          where: { clubId: team.id, status: 'ACTIVE' },
        });
        addMemberStatusDuringPublish = mem?.status ?? null;
        addTxCountDuringPublish = await database.client.leagueTransaction.count();
        addAuditEventCountDuringPublish = await database.client.auditEvent.count();
        return true;
      },
      () => Promise.resolve(true),
    );

    const added = await customService.add({
      authorization: authorization(),
      clubId: team.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });

    expect(added.announcementDelivered).toBe(true);
    expect(added.auditAnnouncementDelivered).toBe(true);
    expect(addMemberStatusDuringPublish).toBe('ACTIVE');
    expect(addTxCountDuringPublish).toBe(1);
    expect(addAuditEventCountDuringPublish).toBe(1);
    expect(added.announcement).toMatchObject({
      type: 'SIGNED',
      discordGuildId,
      channelId: '810000000000000030',
      discordUserId: playerId,
      actorDiscordUserId: ownerId,
      teamIdentity: { id: team.id },
    });
    expect(added.auditAnnouncement).toMatchObject({
      operation: 'ROSTER_PLAYER_ADDED',
      discordGuildId,
      channelId: '810000000000000040',
      playerDiscordUserId: playerId,
      actorDiscordUserId: ownerId,
      teamIdentity: { id: team.id },
    });

    let removeMemberStatusDuringPublish: string | null = null;
    const customServiceRemove = makeService(
      (plan) => Promise.resolve({ addedRoles: plan.addRoles, removedRoles: plan.removeRoles }),
      async () => {
        const mem = await database.client.clubMembership.findFirst({
          where: { clubId: team.id, userId: added.player.id },
        });
        removeMemberStatusDuringPublish = mem?.status ?? null;
        return true;
      },
      () => Promise.resolve(true),
    );

    const removed = await customServiceRemove.remove({
      authorization: authorization(),
      playerDiscordUserId: playerId,
    });

    expect(removed.announcementDelivered).toBe(true);
    expect(removed.auditAnnouncementDelivered).toBe(true);
    expect(removeMemberStatusDuringPublish).toBe('ENDED');
    expect(removed.announcement).toMatchObject({
      type: 'RELEASED',
      discordGuildId,
      channelId: '810000000000000030',
      discordUserId: playerId,
      teamIdentity: { id: team.id },
    });
    expect(
      removed.announcement && 'actorDiscordUserId' in removed.announcement
        ? removed.announcement.actorDiscordUserId
        : undefined,
    ).toBeUndefined();
    expect(removed.auditAnnouncement).toMatchObject({
      operation: 'ROSTER_PLAYER_REMOVED',
      discordGuildId,
      channelId: '810000000000000040',
      playerDiscordUserId: playerId,
      actorDiscordUserId: ownerId,
      teamIdentity: { id: team.id },
    });
  });

  it('handles partial and both delivery failures without rolling back roster state', async () => {
    const guilds = new GuildRepository(database.client);
    await guilds.upsertSettings(guild.id, {
      transferChannelId: '810000000000000030',
      auditChannelId: '810000000000000040',
    });

    // Transfer fails, Audit succeeds
    const s1 = makeService(
      (plan) => Promise.resolve({ addedRoles: plan.addRoles, removedRoles: plan.removeRoles }),
      () => Promise.resolve(false),
      () => Promise.resolve(true),
    );
    const added1 = await s1.add({
      authorization: authorization(),
      clubId: team.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    expect(added1.announcementDelivered).toBe(false);
    expect(added1.auditAnnouncementDelivered).toBe(true);
    expect(added1.membership.status).toBe('ACTIVE');

    // Audit fails, Transfer succeeds
    const s2 = makeService(
      (plan) => Promise.resolve({ addedRoles: plan.addRoles, removedRoles: plan.removeRoles }),
      () => Promise.resolve(true),
      () => Promise.resolve(false),
    );
    const removed1 = await s2.remove({
      authorization: authorization(),
      playerDiscordUserId: playerId,
    });
    expect(removed1.announcementDelivered).toBe(true);
    expect(removed1.auditAnnouncementDelivered).toBe(false);
    expect(removed1.membership.status).toBe('ENDED');

    // Both fail
    const s3 = makeService(
      (plan) => Promise.resolve({ addedRoles: plan.addRoles, removedRoles: plan.removeRoles }),
      () => Promise.resolve(false),
      () => Promise.resolve(false),
    );
    const added2 = await s3.add({
      authorization: authorization(),
      clubId: team.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    expect(added2.announcementDelivered).toBe(false);
    expect(added2.auditAnnouncementDelivered).toBe(false);
    expect(added2.membership.status).toBe('ACTIVE');
  });

  it('logs structured metadata when AuditAnnouncementService delivery fails', async () => {
    const logger = new MemoryLogger();
    const failingAdapter: AuditAnnouncementAdapter = {
      send: () => Promise.reject(new Error('Discord channel unreachable')),
    };
    const auditService = new AuditAnnouncementService(failingAdapter, logger);

    const plan: AuditAnnouncementPlan = {
      discordGuildId,
      channelId: '810000000000000040',
      operation: 'ROSTER_PLAYER_ADDED',
      actorDiscordUserId: ownerId,
      playerDiscordUserId: playerId,
      teamIdentity: team,
      occurredAt: new Date(),
    };

    const result = await auditService.publish(plan);
    expect(result).toBe(false);
    const entry = logger.entries.find((e) => e.message === 'audit announcement delivery failed');
    expect(entry).toBeDefined();
    expect(entry?.context).toMatchObject({
      discordGuildId,
      operation: 'ROSTER_PLAYER_ADDED',
      actorDiscordUserId: ownerId,
      playerDiscordUserId: playerId,
      teamRoleId: team.discordRoleId,
      channelId: '810000000000000040',
    });
  });
});
