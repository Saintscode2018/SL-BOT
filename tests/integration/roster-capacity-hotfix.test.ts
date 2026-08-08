import type { Club, Guild } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MemberAlreadySignedError, SquadFullError } from '../../src/domain/errors.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { GuildRepository } from '../../src/repositories/guild-repository.js';
import { MembershipRepository } from '../../src/repositories/membership-repository.js';
import { OfferAcceptanceService } from '../../src/services/offer-acceptance-service.js';
import { OfferCreationService } from '../../src/services/offer-creation-service.js';
import { RosterManagementService } from '../../src/services/roster-management-service.js';
import { RosterMutationService } from '../../src/services/roster-mutation-service.js';
import { RosterPromotionDemotionService } from '../../src/services/roster-promotion-demotion-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';

const discordGuildId = '710000000000000001';
const managerDiscordId = '720000000000000001';

describe('urgent unique roster-capacity hotfix', () => {
  let database: TestDatabase;
  let guild: Guild;
  let team: Club;
  let memberships: MembershipRepository;
  let mutations: RosterMutationService;

  beforeAll(() => {
    database = createTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
    const guilds = new GuildRepository(database.client);
    guild = await guilds.create({ discordGuildId, name: 'Capacity Hotfix League' });
    await guilds.upsertSettings(guild.id, {
      defaultSquadLimit: 19,
      offerTimeoutSeconds: 86_400,
      teamManagerRoleId: '730000000000000001',
      assistantManagerRoleId: '730000000000000002',
      playerManagerRoleId: '730000000000000003',
    });
    team = await new ClubRepository(database.client).create({
      guildId: guild.id,
      discordRoleId: '740000000000000001',
      emoji: '⚽',
    });
    memberships = new MembershipRepository(database.client);
    mutations = new RosterMutationService(database.client);
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  async function seedMembership(
    discordUserId: string,
    membershipType: 'PLAYER' | 'TEAM_MANAGER' | 'ASSISTANT_MANAGER' | 'PLAYER_MANAGER',
  ) {
    const user = await database.client.leagueUser.upsert({
      where: { discordUserId },
      create: { discordUserId },
      update: {},
    });
    return database.client.clubMembership.create({
      data: {
        guildId: guild.id,
        clubId: team.id,
        userId: user.id,
        membershipType,
        status: 'ACTIVE',
      },
    });
  }

  async function seedPlayers(count: number, offset = 0): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await seedMembership(`75${String(offset + index).padStart(16, '0')}`, 'PLAYER');
    }
  }

  it.each([
    { players: 19, staff: [] as const, label: '19 PLAYER users' },
    { players: 18, staff: ['TEAM_MANAGER'] as const, label: '18 PLAYER users plus a TM' },
    {
      players: 17,
      staff: ['TEAM_MANAGER', 'ASSISTANT_MANAGER'] as const,
      label: '17 PLAYER users plus a TM and ATM',
    },
  ])('treats $label as full at 19', async ({ players, staff }) => {
    await seedPlayers(players);
    for (const [index, staffType] of staff.entries()) {
      await seedMembership(`76${String(index).padStart(16, '0')}`, staffType);
    }

    await expect(memberships.countActiveUniqueMembers(team.id)).resolves.toBe(19);
    await expect(
      mutations.signFreeAgent({
        discordGuildId,
        clubId: team.id,
        actorDiscordUserId: managerDiscordId,
        targetDiscordUserId: '770000000000000001',
      }),
    ).rejects.toBeInstanceOf(SquadFullError);
  });

  it('counts legacy PLAYER plus TM rows for one user once', async () => {
    await seedMembership(managerDiscordId, 'PLAYER');
    await seedMembership(managerDiscordId, 'TEAM_MANAGER');

    await expect(memberships.countActivePlayers(team.id)).resolves.toBe(1);
    await expect(memberships.countActiveUniqueMembers(team.id)).resolves.toBe(1);
  });

  it('reports a unique 20/19 roster without mutating existing over-limit data', async () => {
    await seedPlayers(19);
    await seedMembership(managerDiscordId, 'TEAM_MANAGER');

    const result = await new RosterManagementService(database.client).list(discordGuildId, team.id);

    expect(result.allActiveMembers).toHaveLength(20);
    expect(result.ordinaryPlayers).toHaveLength(19);
    expect(result.staff).toHaveLength(1);
    await expect(memberships.countActiveUniqueMembers(team.id)).resolves.toBe(20);
    await expect(
      mutations.signFreeAgent({
        discordGuildId,
        clubId: team.id,
        actorDiscordUserId: managerDiscordId,
        targetDiscordUserId: '770000000000000002',
      }),
    ).rejects.toBeInstanceOf(SquadFullError);
  });

  it('does not consume another slot when appointing an existing member at capacity', async () => {
    await database.client.guildSettings.update({
      where: { guildId: guild.id },
      data: { defaultSquadLimit: 1 },
    });
    const existingDiscordId = '780000000000000001';
    await seedMembership(existingDiscordId, 'PLAYER');

    await expect(
      mutations.appointStaffImmediately({
        discordGuildId,
        clubId: team.id,
        actorDiscordUserId: managerDiscordId,
        targetDiscordUserId: existingDiscordId,
        staffType: 'ASSISTANT_MANAGER',
      }),
    ).resolves.toMatchObject({ staffMembership: { membershipType: 'ASSISTANT_MANAGER' } });
    await expect(memberships.countActiveUniqueMembers(team.id)).resolves.toBe(1);

    await expect(
      mutations.appointStaffImmediately({
        discordGuildId,
        clubId: team.id,
        actorDiscordUserId: managerDiscordId,
        targetDiscordUserId: '780000000000000002',
        staffType: 'PLAYER_MANAGER',
      }),
    ).rejects.toBeInstanceOf(SquadFullError);
  });

  it('promotes and demotes a staff-only member without changing unique population', async () => {
    await database.client.guildSettings.update({
      where: { guildId: guild.id },
      data: { defaultSquadLimit: 2 },
    });
    await seedMembership(managerDiscordId, 'TEAM_MANAGER');
    const targetDiscordId = '780000000000000003';
    await seedMembership(targetDiscordId, 'PLAYER_MANAGER');
    const service = new RosterPromotionDemotionService(database.client, mutations);

    const promoted = await service.promote({
      discordGuildId,
      actorDiscordUserId: managerDiscordId,
      targetDiscordUserId: targetDiscordId,
      clubId: team.id,
      destinationStaffType: 'ASSISTANT_MANAGER',
      expectedActorStaffRole: 'TM',
      expectedTargetStaffRole: 'PM',
    });
    expect(promoted.playerMembership).toBeNull();
    await expect(memberships.countActiveUniqueMembers(team.id)).resolves.toBe(2);

    const demoted = await service.demote({
      discordGuildId,
      actorDiscordUserId: managerDiscordId,
      targetDiscordUserId: targetDiscordId,
      clubId: team.id,
      expectedActorStaffRole: 'TM',
      expectedTargetStaffRole: 'ATM',
    });
    expect(demoted.playerMembership).toMatchObject({
      membershipType: 'PLAYER',
      status: 'ACTIVE',
    });
    await expect(memberships.countActiveUniqueMembers(team.id)).resolves.toBe(2);
  });

  it('allows a same-team staff-only member to gain a PLAYER row at capacity', async () => {
    await database.client.guildSettings.update({
      where: { guildId: guild.id },
      data: { defaultSquadLimit: 2 },
    });
    await seedMembership(managerDiscordId, 'TEAM_MANAGER');
    const targetDiscordId = '780000000000000005';
    await seedMembership(targetDiscordId, 'PLAYER_MANAGER');

    await expect(
      new RosterManagementService(database.client).add({
        authorization: {
          discordGuildId,
          discordUserId: managerDiscordId,
          guildOwnerId: '799999999999999999',
          memberRoleIds: [],
          hasAdministratorPermission: false,
        },
        clubId: team.id,
        playerDiscordUserId: targetDiscordId,
        playerIsBot: false,
      }),
    ).resolves.toMatchObject({ membership: { membershipType: 'PLAYER' } });
    await expect(memberships.countActiveUniqueMembers(team.id)).resolves.toBe(2);
  });

  it('removes a staff-only appointment without requiring a PLAYER row', async () => {
    const targetDiscordId = '780000000000000004';
    await seedMembership(targetDiscordId, 'PLAYER_MANAGER');

    const result = await mutations.removeStaffAppointmentImmediately({
      discordGuildId,
      clubId: team.id,
      actorDiscordUserId: managerDiscordId,
      targetDiscordUserId: targetDiscordId,
      staffType: 'PLAYER_MANAGER',
    });

    expect(result.playerMembership).toBeNull();
    expect(result.staffMembership).toMatchObject({ status: 'ENDED' });
    expect(result.roleMutation.removeRoles.map(({ purpose }) => purpose)).toEqual(['PM', 'TEAM']);
    await expect(memberships.countActiveUniqueMembers(team.id)).resolves.toBe(0);
  });

  it('blocks offer creation when staff makes the destination uniquely full', async () => {
    await database.client.guildSettings.update({
      where: { guildId: guild.id },
      data: { defaultSquadLimit: 1 },
    });
    await seedMembership(managerDiscordId, 'TEAM_MANAGER');

    await expect(
      new OfferCreationService(database.client).createOffer({
        authorization: {
          discordGuildId,
          discordUserId: managerDiscordId,
          guildOwnerId: '799999999999999999',
          memberRoleIds: [],
          hasAdministratorPermission: false,
        },
        destinationClubId: team.id,
        playerDiscordUserId: '790000000000000001',
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(SquadFullError);
  });

  it('rechecks unique population when an offer is accepted', async () => {
    await database.client.guildSettings.update({
      where: { guildId: guild.id },
      data: { defaultSquadLimit: 2 },
    });
    await seedMembership(managerDiscordId, 'TEAM_MANAGER');
    const targetDiscordId = '790000000000000002';
    const offer = await new OfferCreationService(database.client).createOffer({
      authorization: {
        discordGuildId,
        discordUserId: managerDiscordId,
        guildOwnerId: '799999999999999999',
        memberRoleIds: [],
        hasAdministratorPermission: false,
      },
      destinationClubId: team.id,
      playerDiscordUserId: targetDiscordId,
      playerIsBot: false,
    });
    await seedMembership('790000000000000003', 'ASSISTANT_MANAGER');

    await expect(
      new OfferAcceptanceService(database.client).acceptOffer({
        offerId: offer.offer.id,
        acceptingDiscordUserId: targetDiscordId,
      }),
    ).rejects.toBeInstanceOf(SquadFullError);
  });

  it('does not let a pending offer add a PLAYER row to a newly staff-only member', async () => {
    await database.client.guildSettings.update({
      where: { guildId: guild.id },
      data: { defaultSquadLimit: 3 },
    });
    await seedMembership(managerDiscordId, 'TEAM_MANAGER');
    const targetDiscordId = '790000000000000004';
    const offer = await new OfferCreationService(database.client).createOffer({
      authorization: {
        discordGuildId,
        discordUserId: managerDiscordId,
        guildOwnerId: '799999999999999999',
        memberRoleIds: [],
        hasAdministratorPermission: false,
      },
      destinationClubId: team.id,
      playerDiscordUserId: targetDiscordId,
      playerIsBot: false,
    });
    await seedMembership(targetDiscordId, 'PLAYER_MANAGER');

    await expect(
      new OfferAcceptanceService(database.client).acceptOffer({
        offerId: offer.offer.id,
        acceptingDiscordUserId: targetDiscordId,
      }),
    ).rejects.toBeInstanceOf(MemberAlreadySignedError);
  });
});
