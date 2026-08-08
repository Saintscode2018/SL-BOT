import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AdministrativePermissionDeniedError,
  AdministrativeWrongChannelError,
  ClubInactiveError,
  TeamNotFoundError,
} from '../../src/domain/errors.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import { TeamHealthService } from '../../src/services/team-health-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  grantBotPermission,
  type TestDatabase,
} from '../helpers/database.js';

const discordGuildId = '100000000000000001';
const foreignDiscordGuildId = '100000000000000002';
const staffChannelId = '200000000000000001';
const botChannelId = '200000000000000002';
const ownerId = '300000000000000001';
const botPermissionsRoleId = '400000000000000001';
const teamManagerRoleId = '400000000000000002';

describe('team health service and policy', () => {
  let database: TestDatabase;
  let client: PrismaClient;
  let activeClubId: string;
  let inactiveClubId: string;
  let foreignClubId: string;

  beforeAll(() => {
    database = createTestDatabase();
    client = database.client;
  });

  beforeEach(async () => {
    await clearDatabase(client);
    const guild = await client.guild.create({
      data: {
        discordGuildId,
        name: 'Super League',
        settings: {
          create: {
            staffChannelId,
            botCommandsChannelId: botChannelId,
            botPermissionsRoleId,
            teamManagerRoleId,
            defaultSquadLimit: 21,
          },
        },
      },
    });
    const foreignGuild = await client.guild.create({
      data: { discordGuildId: foreignDiscordGuildId, name: 'Foreign League' },
    });
    await grantBotPermission(client, discordGuildId, ownerId);
    const firstActive = await client.club.create({
      data: {
        guildId: guild.id,
        discordRoleId: '500000000000000001',
        emoji: '🔥',
        squadLimitOverride: 19,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const secondActive = await client.club.create({
      data: {
        guildId: guild.id,
        discordRoleId: '500000000000000002',
        emoji: '🌊',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    });
    const inactive = await client.club.create({
      data: {
        guildId: guild.id,
        discordRoleId: '500000000000000003',
        emoji: '⚡',
        active: false,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    });
    const foreign = await client.club.create({
      data: {
        guildId: foreignGuild.id,
        discordRoleId: '500000000000000004',
        emoji: '💜',
      },
    });
    activeClubId = firstActive.id;
    inactiveClubId = inactive.id;
    foreignClubId = foreign.id;

    const playerOne = await client.leagueUser.create({
      data: { discordUserId: '600000000000000001' },
    });
    const playerTwo = await client.leagueUser.create({
      data: { discordUserId: '600000000000000002' },
    });
    const endedPlayer = await client.leagueUser.create({
      data: { discordUserId: '600000000000000003' },
    });
    const staffOnly = await client.leagueUser.create({
      data: { discordUserId: '600000000000000004' },
    });
    await client.clubMembership.createMany({
      data: [
        {
          guildId: guild.id,
          clubId: firstActive.id,
          userId: playerOne.id,
          membershipType: 'PLAYER',
          status: 'ACTIVE',
        },
        {
          guildId: guild.id,
          clubId: firstActive.id,
          userId: playerTwo.id,
          membershipType: 'PLAYER',
          status: 'ACTIVE',
        },
        {
          guildId: guild.id,
          clubId: firstActive.id,
          userId: endedPlayer.id,
          membershipType: 'PLAYER',
          status: 'ENDED',
          leftAt: new Date('2026-02-01T00:00:00.000Z'),
        },
        {
          guildId: guild.id,
          clubId: firstActive.id,
          userId: playerOne.id,
          membershipType: 'TEAM_MANAGER',
          status: 'ACTIVE',
        },
        {
          guildId: guild.id,
          clubId: firstActive.id,
          userId: staffOnly.id,
          membershipType: 'ASSISTANT_MANAGER',
          status: 'ACTIVE',
        },
        {
          guildId: guild.id,
          clubId: secondActive.id,
          userId: endedPlayer.id,
          membershipType: 'PLAYER',
          status: 'ACTIVE',
        },
      ],
    });
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  it('returns active teams only in creation order with unique active-member counts', async () => {
    const result = await new TeamHealthService(client).getOverview(discordGuildId);
    expect(result.guild.name).toBe('Super League');
    expect(result.teams.map(({ club }) => club.discordRoleId)).toEqual([
      '500000000000000001',
      '500000000000000002',
    ]);
    expect(result.teams.map(({ activePlayerCount }) => activePlayerCount)).toEqual([3, 1]);
    expect(result.teams.some(({ club }) => club.id === inactiveClubId)).toBe(false);
  });

  it('returns detailed active staff, unique active-member count, and effective override', async () => {
    const result = await new TeamHealthService(client).getDetail(discordGuildId, activeClubId);
    expect(result.team.activePlayerCount).toBe(3);
    expect(result.team.effectiveSquadLimit).toBe(19);
    expect(result.team.staff).toHaveLength(2);
    expect(
      result.team.staff.map(({ membershipType, user }) => ({
        membershipType,
        discordUserId: user.discordUserId,
      })),
    ).toEqual([
      {
        membershipType: 'ASSISTANT_MANAGER',
        discordUserId: '600000000000000004',
      },
      { membershipType: 'TEAM_MANAGER', discordUserId: '600000000000000001' },
    ]);
  });

  it('uses the guild default when a team has no override', async () => {
    const overview = await new TeamHealthService(client).getOverview(discordGuildId);
    const secondClubId = overview.teams[1]!.club.id;
    const result = await new TeamHealthService(client).getDetail(discordGuildId, secondClubId);
    expect(result.team.effectiveSquadLimit).toBe(21);
  });

  it('rejects inactive, foreign, and unknown selected teams', async () => {
    const service = new TeamHealthService(client);
    await expect(service.getDetail(discordGuildId, inactiveClubId)).rejects.toBeInstanceOf(
      ClubInactiveError,
    );
    await expect(service.getDetail(discordGuildId, foreignClubId)).rejects.toBeInstanceOf(
      TeamNotFoundError,
    );
    await expect(service.getDetail(discordGuildId, 'missing-team')).rejects.toBeInstanceOf(
      TeamNotFoundError,
    );
  });

  it('allows database Bot Permission callers in Staff Commands', async () => {
    const policy = new CommandChannelPolicyService(client);
    const inputs: AuthorizationInput[] = [
      {
        discordGuildId,
        discordUserId: ownerId,
        guildOwnerId: ownerId,
        memberRoleIds: [],
        hasAdministratorPermission: false,
      },
    ];
    for (const authorization of inputs) {
      await expect(
        policy.validateChannelPolicy({
          authorization,
          channelId: staffChannelId,
          commandName: 'teamhealth',
        }),
      ).resolves.toBeUndefined();
    }
  });

  it('denies ordinary managers and players without revealing Staff Commands', async () => {
    const policy = new CommandChannelPolicyService(client);
    for (const memberRoleIds of [[teamManagerRoleId], []]) {
      await expect(
        policy.validateChannelPolicy({
          authorization: {
            discordGuildId,
            discordUserId: '300000000000000004',
            guildOwnerId: ownerId,
            memberRoleIds,
            hasAdministratorPermission: false,
          },
          channelId: staffChannelId,
          commandName: 'teamhealth',
        }),
      ).rejects.toBeInstanceOf(AdministrativePermissionDeniedError);
    }
  });

  it('restricts authorized callers to Staff Commands and classifies the command STAFF_ONLY', async () => {
    const policy = new CommandChannelPolicyService(client);
    expect(policy.getScope('teamhealth')).toBe('STAFF_ONLY');
    await expect(
      policy.validateChannelPolicy({
        authorization: {
          discordGuildId,
          discordUserId: ownerId,
          guildOwnerId: ownerId,
          memberRoleIds: [],
          hasAdministratorPermission: false,
        },
        channelId: botChannelId,
        commandName: 'teamhealth',
      }),
    ).rejects.toBeInstanceOf(AdministrativeWrongChannelError);
  });
});
