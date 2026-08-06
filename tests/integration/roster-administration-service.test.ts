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
import type { MemberRoleMutationPlan } from '../../src/domain/roster-mutation.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { GuildRepository } from '../../src/repositories/guild-repository.js';
import { MembershipRepository } from '../../src/repositories/membership-repository.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { RosterAdministrationService } from '../../src/services/roster-administration-service.js';
import { RoleSynchronizedMutationService } from '../../src/services/role-synchronized-mutation-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
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
  ): RosterAdministrationService => {
    apply = vi.fn(applyImplementation);
    compensate = vi.fn(() => Promise.resolve());
    publish = vi.fn(() => Promise.resolve(true));
    return new RosterAdministrationService(
      database.client,
      new RoleSynchronizedMutationService({ apply, compensate }, { publish }, new MemoryLogger()),
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
      membershipType: 'PLAYER',
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
});
