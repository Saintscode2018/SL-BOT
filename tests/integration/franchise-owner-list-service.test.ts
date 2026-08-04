import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EntityNotFoundError } from '../../src/domain/errors.js';
import { FranchiseOwnerListService } from '../../src/services/franchise-owner-list-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';

const discordGuildId = '100000000000000001';
const foreignDiscordGuildId = '100000000000000002';

describe('franchise owner list service', () => {
  let database: TestDatabase;
  let client: PrismaClient;
  let firstClubId: string;
  let secondClubId: string;

  beforeAll(() => {
    database = createTestDatabase();
    client = database.client;
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  beforeEach(async () => {
    await clearDatabase(client);
    const guild = await client.guild.create({
      data: {
        discordGuildId,
        name: 'Super League',
        settings: {
          create: {
            staffChannelId: '200000000000000001',
            botCommandsChannelId: '200000000000000002',
            botPermissionsRoleId: '400000000000000001',
            teamManagerRoleId: '400000000000000002',
          },
        },
      },
    });
    const foreignGuild = await client.guild.create({
      data: { discordGuildId: foreignDiscordGuildId, name: 'Foreign League' },
    });

    const firstActive = await client.club.create({
      data: {
        guildId: guild.id,
        discordRoleId: '500000000000000001',
        emoji: '🔥',
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
    await client.club.create({
      data: {
        guildId: guild.id,
        discordRoleId: '500000000000000003',
        emoji: '⚡',
        active: false,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    });
    await client.club.create({
      data: {
        guildId: foreignGuild.id,
        discordRoleId: '500000000000000004',
        emoji: '💜',
      },
    });

    firstClubId = firstActive.id;
    secondClubId = secondActive.id;

    const tmUser = await client.leagueUser.create({
      data: { discordUserId: '600000000000000001' },
    });
    const inactiveTmUser = await client.leagueUser.create({
      data: { discordUserId: '600000000000000005' },
    });
    const atmUser = await client.leagueUser.create({
      data: { discordUserId: '600000000000000002' },
    });
    const pmUser = await client.leagueUser.create({
      data: { discordUserId: '600000000000000003' },
    });
    const playerUser = await client.leagueUser.create({
      data: { discordUserId: '600000000000000004' },
    });

    // Add inactive TM membership (ended)
    await client.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: firstClubId,
        userId: inactiveTmUser.id,
        membershipType: 'TEAM_MANAGER',
        status: 'ENDED',
        leftAt: new Date('2026-01-05T00:00:00.000Z'),
      },
    });
    // Add active TM, ATM, PM, and Player to first active club
    await client.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: firstClubId,
        userId: tmUser.id,
        membershipType: 'TEAM_MANAGER',
        status: 'ACTIVE',
      },
    });
    await client.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: firstClubId,
        userId: atmUser.id,
        membershipType: 'ASSISTANT_MANAGER',
        status: 'ACTIVE',
      },
    });
    await client.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: firstClubId,
        userId: pmUser.id,
        membershipType: 'PLAYER_MANAGER',
        status: 'ACTIVE',
      },
    });
    await client.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: firstClubId,
        userId: playerUser.id,
        membershipType: 'PLAYER',
        status: 'ACTIVE',
      },
    });
    // Second active club is vacant (no active Team Manager)
  });

  it('queries configured guild and returns active teams in deterministic order with structured result', async () => {
    const service = new FranchiseOwnerListService(client);
    const result = await service.getList(discordGuildId);

    expect(result.guild.discordGuildId).toBe(discordGuildId);
    expect(result.items).toHaveLength(2);
    const item1 = result.items[0]!;
    const item2 = result.items[1]!;

    expect(item1.club.id).toBe(firstClubId);
    expect(item1.teamManager?.user.discordUserId).toBe('600000000000000001');

    expect(item2.club.id).toBe(secondClubId);
    expect(item2.teamManager).toBeNull();
  });

  it('excludes inactive teams, foreign teams, ended TM memberships, ATM, PM, and players', async () => {
    const service = new FranchiseOwnerListService(client);
    const result = await service.getList(discordGuildId);

    const clubIds = result.items.map((i) => i.club.id);
    expect(clubIds).not.toContain('500000000000000003');
    expect(clubIds).not.toContain('500000000000000004');

    const item1 = result.items[0]!;
    expect(item1.teamManager?.user.discordUserId).toBe('600000000000000001');
  });

  it('throws EntityNotFoundError for unconfigured server', async () => {
    const service = new FranchiseOwnerListService(client);
    await expect(service.getList('999999999999999999')).rejects.toBeInstanceOf(EntityNotFoundError);
  });
});
