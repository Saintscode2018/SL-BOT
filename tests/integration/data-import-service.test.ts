import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthorizationError, ConfigurationError } from '../../src/domain/errors.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import {
  dataImportAuditEventType,
  DataImportService,
} from '../../src/services/data-import-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  grantBotPermission,
  type TestDatabase,
} from '../helpers/database.js';

const guildDiscordId = '910000000000000001';
const ownerId = '910000000000000002';
const botPermissionId = '910000000000000003';
const botPermissionAdminId = '910000000000000004';
const outsiderId = '910000000000000005';
const discordAdministratorId = '910000000000000006';
const teamRoleOne = '920000000000000001';
const teamRoleTwo = '920000000000000002';
const inactiveTeamRole = '920000000000000003';
const unregisteredTeamRole = '920000000000000004';
const legacyBotPermissionRole = '930000000000000001';
const teamManagerRole = '930000000000000002';
const assistantManagerRole = '930000000000000003';
const playerManagerRole = '930000000000000004';

function authorization(
  discordUserId: string,
  options: { administrator?: boolean; roles?: string[] } = {},
): AuthorizationInput {
  return {
    discordGuildId: guildDiscordId,
    discordUserId,
    guildOwnerId: ownerId,
    memberRoleIds: options.roles ?? [],
    hasAdministratorPermission: options.administrator ?? false,
  };
}

function member(
  discordUserId: string,
  roleIds: readonly string[],
  options: { bot?: boolean; displayName?: string } = {},
) {
  return {
    discordUserId,
    displayName: options.displayName ?? `Member ${discordUserId.slice(-3)}`,
    roleIds,
    bot: options.bot ?? false,
  };
}

describe('DataImportService', () => {
  let database: TestDatabase;
  let service: DataImportService;
  let guild: { id: string };
  let clubOne: { id: string };
  let clubTwo: { id: string };

  beforeAll(() => {
    database = createTestDatabase();
  }, 60_000);

  beforeEach(async () => {
    await clearDatabase(database.client);
    guild = await database.client.guild.create({
      data: { discordGuildId: guildDiscordId, name: 'Import League' },
    });
    await database.client.guildSettings.create({
      data: {
        guildId: guild.id,
        botCommandsChannelId: '940000000000000001',
        staffChannelId: '940000000000000002',
        transferChannelId: '940000000000000003',
        auditChannelId: '940000000000000004',
        botPermissionsRoleId: legacyBotPermissionRole,
        teamManagerRoleId: teamManagerRole,
        assistantManagerRoleId: assistantManagerRole,
        playerManagerRoleId: playerManagerRole,
      },
    });
    clubOne = await database.client.club.create({
      data: { guildId: guild.id, discordRoleId: teamRoleOne, emoji: '1\uFE0F\u20E3' },
    });
    clubTwo = await database.client.club.create({
      data: { guildId: guild.id, discordRoleId: teamRoleTwo, emoji: '2\uFE0F\u20E3' },
    });
    await database.client.club.create({
      data: {
        guildId: guild.id,
        discordRoleId: inactiveTeamRole,
        emoji: '3\uFE0F\u20E3',
        active: false,
      },
    });
    await grantBotPermission(database.client, guildDiscordId, botPermissionId, 'BOTPERM');
    await grantBotPermission(
      database.client,
      guildDiscordId,
      botPermissionAdminId,
      'BOTPERM_ADMIN',
    );
    service = new DataImportService(database.client);
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  async function run(
    members: readonly ReturnType<typeof member>[],
    actor: AuthorizationInput = authorization(botPermissionId),
  ) {
    const fetchMembers = vi.fn(() => Promise.resolve(members));
    const result = await service.importGuild({ authorization: actor, fetchMembers });
    expect(fetchMembers).toHaveBeenCalledOnce();
    return result;
  }

  it.each([
    ['BOTPERM', botPermissionId],
    ['BOTPERM_ADMIN', botPermissionAdminId],
  ])('allows database-backed %s authorization', async (_level, discordUserId) => {
    await expect(run([], authorization(discordUserId))).resolves.toMatchObject({
      imported: { players: 0, teamManagers: 0, assistantManagers: 0, playerManagers: 0 },
    });
  });

  it.each([
    ['Discord Administrator', authorization(discordAdministratorId, { administrator: true })],
    ['guild owner', authorization(ownerId)],
    [
      'legacy Bot Permissions role',
      authorization(outsiderId, { roles: [legacyBotPermissionRole] }),
    ],
    ['TM role', authorization(outsiderId, { roles: [teamManagerRole] })],
    ['ATM role', authorization(outsiderId, { roles: [assistantManagerRole] })],
    ['PM role', authorization(outsiderId, { roles: [playerManagerRole] })],
  ])('denies %s without a database Bot Permission', async (_kind, deniedAuthorization) => {
    const fetchMembers = vi.fn(() => Promise.resolve([]));
    await expect(
      service.importGuild({ authorization: deniedAuthorization, fetchMembers }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(fetchMembers).not.toHaveBeenCalled();
  });

  it('classifies team-only and management members without importing staff as players', async () => {
    const playerId = '950000000000000001';
    const managerId = '950000000000000002';
    const assistantId = '950000000000000003';
    const playerManagerId = '950000000000000004';
    const botId = '950000000000000005';
    const inactiveId = '950000000000000006';
    const unregisteredId = '950000000000000007';

    const result = await run([
      member(playerId, [teamRoleOne]),
      member(managerId, [teamRoleOne, teamManagerRole]),
      member(assistantId, [teamRoleOne, assistantManagerRole]),
      member(playerManagerId, [teamRoleOne, playerManagerRole]),
      member(botId, [teamRoleOne], { bot: true }),
      member(inactiveId, [inactiveTeamRole]),
      member(unregisteredId, [unregisteredTeamRole]),
    ]);

    expect(result.imported).toEqual({
      players: 1,
      teamManagers: 1,
      assistantManagers: 1,
      playerManagers: 1,
    });
    expect(result.ignoredBots).toBe(1);
    expect(result.issues).toEqual([]);
    const memberships = await database.client.clubMembership.findMany({
      include: { user: true },
      orderBy: { membershipType: 'asc' },
    });
    expect(
      memberships.map(({ user, membershipType }) => [user.discordUserId, membershipType]),
    ).toEqual(
      expect.arrayContaining([
        [playerId, 'PLAYER'],
        [managerId, 'TEAM_MANAGER'],
        [assistantId, 'ASSISTANT_MANAGER'],
        [playerManagerId, 'PLAYER_MANAGER'],
      ]),
    );
    expect(
      memberships.filter(
        ({ user, membershipType }) =>
          [managerId, assistantId, playerManagerId].includes(user.discordUserId) &&
          membershipType === 'PLAYER',
      ),
    ).toHaveLength(0);
    await expect(
      database.client.leagueUser.count({
        where: { discordUserId: { in: [botId, inactiveId, unregisteredId] } },
      }),
    ).resolves.toBe(0);
  });

  it('skips and reports ambiguous team/rank data and management without a team', async () => {
    const result = await run([
      member('951000000000000001', [teamRoleOne, teamRoleTwo]),
      member('951000000000000002', [teamRoleOne, teamManagerRole, assistantManagerRole]),
      member('951000000000000003', [playerManagerRole]),
    ]);

    expect(result.imported).toEqual({
      players: 0,
      teamManagers: 0,
      assistantManagers: 0,
      playerManagers: 0,
    });
    expect(result.issues.map(({ code }) => code)).toEqual([
      'MULTIPLE_TEAM_ROLES',
      'MULTIPLE_MANAGEMENT_ROLES',
      'MANAGEMENT_WITHOUT_TEAM',
    ]);
    await expect(database.client.clubMembership.count()).resolves.toBe(0);
  });

  it('counts an exact active membership as unchanged and skips conflicting membership data', async () => {
    const exactId = '952000000000000001';
    const conflictId = '952000000000000002';
    const exactUser = await database.client.leagueUser.create({ data: { discordUserId: exactId } });
    const conflictUser = await database.client.leagueUser.create({
      data: { discordUserId: conflictId },
    });
    await database.client.clubMembership.createMany({
      data: [
        {
          guildId: guild.id,
          clubId: clubOne.id,
          userId: exactUser.id,
          membershipType: 'PLAYER',
        },
        {
          guildId: guild.id,
          clubId: clubTwo.id,
          userId: conflictUser.id,
          membershipType: 'PLAYER',
        },
      ],
    });

    const result = await run([member(exactId, [teamRoleOne]), member(conflictId, [teamRoleOne])]);

    expect(result.unchanged).toBe(1);
    expect(result.issues).toMatchObject([
      { discordUserId: conflictId, code: 'CONFLICTING_MEMBERSHIP' },
    ]);
    await expect(database.client.clubMembership.count()).resolves.toBe(2);
    await expect(
      database.client.clubMembership.findFirstOrThrow({ where: { userId: conflictUser.id } }),
    ).resolves.toMatchObject({ clubId: clubTwo.id, membershipType: 'PLAYER', status: 'ACTIVE' });
  });

  it.each([
    ['TM', teamManagerRole, 'TEAM_MANAGER', '956000000000000001'],
    ['ATM', assistantManagerRole, 'ASSISTANT_MANAGER', '956000000000000002'],
    ['PM', playerManagerRole, 'PLAYER_MANAGER', '956000000000000003'],
  ] as const)(
    'treats an existing same-team PLAYER plus Discord %s as a conflict',
    async (_rank, managementRoleId, inferredMembershipType, discordUserId) => {
      const user = await database.client.leagueUser.create({ data: { discordUserId } });
      await database.client.clubMembership.create({
        data: {
          guildId: guild.id,
          clubId: clubOne.id,
          userId: user.id,
          membershipType: 'PLAYER',
        },
      });

      const result = await run([member(discordUserId, [teamRoleOne, managementRoleId])]);

      expect(result.unchanged).toBe(0);
      expect(result.issues).toMatchObject([{ discordUserId, code: 'CONFLICTING_MEMBERSHIP' }]);
      await expect(
        database.client.clubMembership.findMany({
          where: { userId: user.id },
          select: { membershipType: true, clubId: true },
        }),
      ).resolves.toEqual([{ membershipType: 'PLAYER', clubId: clubOne.id }]);
      await expect(
        database.client.clubMembership.count({
          where: { userId: user.id, membershipType: inferredMembershipType },
        }),
      ).resolves.toBe(0);
    },
  );

  it('counts an exact staff-only membership as unchanged', async () => {
    const discordUserId = '957000000000000001';
    const user = await database.client.leagueUser.create({ data: { discordUserId } });
    await database.client.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: clubOne.id,
        userId: user.id,
        membershipType: 'TEAM_MANAGER',
      },
    });

    const result = await run([member(discordUserId, [teamRoleOne, teamManagerRole])]);

    expect(result.unchanged).toBe(1);
    expect(result.issues).toEqual([]);
    await expect(
      database.client.clubMembership.count({ where: { userId: user.id } }),
    ).resolves.toBe(1);
  });

  it.each([
    [
      'same-team PLAYER',
      '957000000000000002',
      'TEAM_MANAGER' as const,
      'PLAYER' as const,
      'SAME_CLUB' as const,
    ],
    [
      'any other active membership (different club)',
      '957000000000000003',
      'ASSISTANT_MANAGER' as const,
      'PLAYER' as const,
      'OTHER_CLUB' as const,
    ],
  ] as const)(
    'treats an exact staff membership plus %s as a conflict',
    async (_label, discordUserId, staffType, secondType, secondClubKey) => {
      const secondClub = secondClubKey === 'SAME_CLUB' ? clubOne : clubTwo;
      const user = await database.client.leagueUser.create({ data: { discordUserId } });
      await database.client.clubMembership.createMany({
        data: [
          {
            guildId: guild.id,
            clubId: clubOne.id,
            userId: user.id,
            membershipType: staffType,
          },
          {
            guildId: guild.id,
            clubId: secondClub.id,
            userId: user.id,
            membershipType: secondType,
          },
        ],
      });

      const result = await run([member(discordUserId, [teamRoleOne, teamManagerRole])]);

      expect(result.unchanged).toBe(0);
      expect(result.issues).toMatchObject([{ discordUserId, code: 'CONFLICTING_MEMBERSHIP' }]);
      await expect(
        database.client.clubMembership.count({ where: { userId: user.id } }),
      ).resolves.toBe(2);
    },
  );

  it('keeps a staff-only import idempotent on rerun', async () => {
    const discordUserId = '957000000000000004';
    const snapshot = member(discordUserId, [teamRoleOne, playerManagerRole]);

    const first = await run([snapshot]);
    const second = await run([snapshot]);

    expect(first.imported.playerManagers).toBe(1);
    expect(second.imported.playerManagers).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(second.issues).toEqual([]);
    await expect(
      database.client.clubMembership.count({ where: { user: { discordUserId } } }),
    ).resolves.toBe(1);
  });

  it('is idempotent and reuses LeagueUser identity without transactions or duplicate memberships', async () => {
    const playerId = '953000000000000001';
    const first = await run([member(playerId, [teamRoleOne])]);
    const second = await run([member(playerId, [teamRoleOne])]);

    expect(first.imported.players).toBe(1);
    expect(second.imported.players).toBe(0);
    expect(second.unchanged).toBe(1);
    await expect(
      database.client.leagueUser.count({ where: { discordUserId: playerId } }),
    ).resolves.toBe(1);
    await expect(
      database.client.clubMembership.count({ where: { user: { discordUserId: playerId } } }),
    ).resolves.toBe(1);
    await expect(database.client.leagueTransaction.count()).resolves.toBe(0);
  });

  it('counts staff-only imports toward unique-member capacity', async () => {
    await database.client.guildSettings.update({
      where: { guildId: guild.id },
      data: { defaultSquadLimit: 1 },
    });
    const managerId = '954000000000000001';
    const firstPlayerId = '954000000000000002';
    const overflowPlayerId = '954000000000000003';

    const result = await run([
      member(managerId, [teamRoleOne, teamManagerRole]),
      member(firstPlayerId, [teamRoleOne]),
      member(overflowPlayerId, [teamRoleOne]),
    ]);

    expect(result.imported).toMatchObject({ players: 0, teamManagers: 1 });
    expect(result.issues).toMatchObject([
      { discordUserId: firstPlayerId, code: 'SQUAD_LIMIT_REACHED' },
      { discordUserId: overflowPlayerId, code: 'SQUAD_LIMIT_REACHED' },
    ]);
    await expect(
      database.client.clubMembership.count({
        where: { clubId: clubOne.id, membershipType: 'PLAYER', status: 'ACTIVE' },
      }),
    ).resolves.toBe(0);
    await expect(
      database.client.clubMembership.count({
        where: { clubId: clubOne.id, membershipType: 'TEAM_MANAGER', status: 'ACTIVE' },
      }),
    ).resolves.toBe(1);
  });

  it('creates one aggregate audit row and no transfer-market transaction rows', async () => {
    const result = await run([
      member('955000000000000001', [teamRoleOne]),
      member('955000000000000002', [teamManagerRole]),
    ]);

    expect(result.imported.players).toBe(1);
    await expect(
      database.client.auditEvent.count({ where: { eventType: dataImportAuditEventType } }),
    ).resolves.toBe(1);
    const audit = await database.client.auditEvent.findFirstOrThrow({
      where: { eventType: dataImportAuditEventType },
    });
    expect(audit).toMatchObject({
      guildId: guild.id,
      entityType: 'guild',
      entityId: guild.id,
      afterState: {
        imported: { players: 1, teamManagers: 0, assistantManagers: 0, playerManagers: 0 },
        unchanged: 0,
        skipped: 1,
      },
    });
    await expect(database.client.leagueTransaction.count()).resolves.toBe(0);
  });

  it('classifies a large member snapshot in memory after one fetch', async () => {
    const members = Array.from({ length: 1_000 }, (_, index) =>
      member(`98${String(index).padStart(16, '0')}`, []),
    );
    const fetchMembers = vi.fn(() => Promise.resolve(members));

    const result = await service.importGuild({
      authorization: authorization(botPermissionId),
      fetchMembers,
    });

    expect(result.scannedMembers).toBe(1_000);
    expect(result.imported.players).toBe(0);
    expect(fetchMembers).toHaveBeenCalledOnce();
    await expect(database.client.clubMembership.count()).resolves.toBe(0);
  });

  it.each([
    ['channels', { auditChannelId: null }],
    ['management roles', { assistantManagerRoleId: null }],
  ])('fails for missing %s before fetching guild members', async (_kind, data) => {
    await database.client.guildSettings.update({ where: { guildId: guild.id }, data });
    const fetchMembers = vi.fn(() => Promise.resolve([member(outsiderId, [teamRoleOne])]));

    await expect(
      service.importGuild({ authorization: authorization(botPermissionId), fetchMembers }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(fetchMembers).not.toHaveBeenCalled();
  });

  it('fails when no active registered teams exist before fetching guild members', async () => {
    await database.client.club.updateMany({ data: { active: false } });
    const fetchMembers = vi.fn(() => Promise.resolve([]));

    await expect(
      service.importGuild({ authorization: authorization(botPermissionId), fetchMembers }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(fetchMembers).not.toHaveBeenCalled();
  });
});
