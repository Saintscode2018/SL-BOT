import type { Club, Guild, LeagueUser, Offer } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  EntityNotFoundError,
  InvalidStateTransitionError,
  MemberAlreadySignedError,
  OfferExpiredError,
  SquadFullError,
  UnauthorizedOfferAcceptanceError,
} from '../../src/domain/errors.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { GuildRepository } from '../../src/repositories/guild-repository.js';
import { MembershipRepository } from '../../src/repositories/membership-repository.js';
import { OfferRepository } from '../../src/repositories/offer-repository.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import {
  createOfferAcceptanceRepositories,
  OfferAcceptanceService,
  offerAcceptedAuditEventType,
  type OfferAcceptanceRepositoryFactory,
} from '../../src/services/offer-acceptance-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';

interface AcceptanceSeed {
  guild: Guild;
  destination: Club;
  source: Club;
  player: LeagueUser;
  manager: LeagueUser;
  offer: Offer;
}

describe('offer acceptance service', () => {
  let database: TestDatabase;
  let guilds: GuildRepository;
  let clubs: ClubRepository;
  let users: UserRepository;
  let memberships: MembershipRepository;
  let offers: OfferRepository;
  let service: OfferAcceptanceService;

  beforeAll(() => {
    database = createTestDatabase();
    guilds = new GuildRepository(database.client);
    clubs = new ClubRepository(database.client);
    users = new UserRepository(database.client);
    memberships = new MembershipRepository(database.client);
    offers = new OfferRepository(database.client);
    service = new OfferAcceptanceService(database.client);
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  async function seed(squadLimit = 17): Promise<AcceptanceSeed> {
    const guild = await guilds.create({
      discordGuildId: '810000000000000001',
      name: 'acceptance guild',
    });
    await guilds.upsertSettings(guild.id, {
      transferChannelId: '840000000000000001',
      defaultSquadLimit: 17,
    });
    const destination = await clubs.create({
      guildId: guild.id,
      discordRoleId: '820000000000000001',
      emoji: '🔵',
      ...(squadLimit === 17 ? {} : { squadLimitOverride: squadLimit }),
    });
    const source = await clubs.create({
      guildId: guild.id,
      discordRoleId: '820000000000000002',
      emoji: '🔴',
    });
    const player = await users.getOrCreateByDiscordUserId('830000000000000001');
    const manager = await users.getOrCreateByDiscordUserId('830000000000000002');
    const offer = await offers.createPending({
      guildId: guild.id,
      clubId: destination.id,
      playerUserId: player.id,
      offeredByUserId: manager.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    return { guild, destination, source, player, manager, offer };
  }

  async function accept(data: AcceptanceSeed, acceptedAt?: Date) {
    return service.acceptOffer({
      offerId: data.offer.id,
      acceptingDiscordUserId: data.player.discordUserId,
      ...(acceptedAt === undefined ? {} : { acceptedAt }),
    });
  }

  it('accepts a free agent signing and persists every record', async () => {
    const data = await seed();
    const result = await accept(data);
    expect(result).toMatchObject({
      transactionType: 'SIGNING',
      sourceClub: null,
      destinationClub: { id: data.destination.id },
      player: { id: data.player.id },
      offer: { status: 'ACCEPTED' },
      newMembership: {
        status: 'ACTIVE',
        membershipType: 'PLAYER',
        createdByUserId: data.manager.id,
      },
      transaction: {
        transactionType: 'SIGNING',
        performedByUserId: data.manager.id,
      },
      roleMutation: {
        discordGuildId: data.guild.discordGuildId,
        discordUserId: data.player.discordUserId,
        addRoles: [{ id: data.destination.discordRoleId, purpose: 'TEAM' }],
        removeRoles: [],
      },
      announcement: {
        channelId: '840000000000000001',
        type: 'SIGNED',
      },
    });
    await expect(database.client.clubMembership.count()).resolves.toBe(1);
    await expect(database.client.leagueTransaction.count()).resolves.toBe(1);
    const audit = await database.client.auditEvent.findFirstOrThrow();
    expect(audit).toMatchObject({
      eventType: offerAcceptedAuditEventType,
      actorUserId: data.player.id,
      entityId: data.offer.id,
      metadata: {
        acceptingPlayerUserId: data.player.id,
        offeredByUserId: data.manager.id,
        sourceClubId: null,
        destinationClubId: data.destination.id,
        transactionId: result.transaction.id,
        transactionType: 'SIGNING',
      },
    });
  });

  it('carries the accepted roster size, limit, current TM, and timestamp into the signing announcement', async () => {
    const data = await seed();
    await memberships.createActive({
      guildId: data.guild.id,
      clubId: data.destination.id,
      userId: data.manager.id,
      membershipType: 'PLAYER',
    });
    await memberships.createActive({
      guildId: data.guild.id,
      clubId: data.destination.id,
      userId: data.manager.id,
      membershipType: 'TEAM_MANAGER',
    });
    const acceptedAt = new Date('2026-08-02T12:00:00.000Z');

    const result = await accept(data, acceptedAt);

    expect(result.announcement).toMatchObject({
      type: 'SIGNED',
      occurredAt: acceptedAt,
      roster: {
        currentSize: 2,
        maximumSize: 17,
        teamManagerDiscordUserId: data.manager.discordUserId,
      },
    });
  });

  it('requires role synchronization before committing a signing', async () => {
    const data = await seed();
    const synchronization = {
      execute: () => Promise.reject(new Error('role feasibility failed')),
    };
    const synchronizedService = new OfferAcceptanceService(
      database.client,
      undefined,
      synchronization,
    );
    await expect(
      synchronizedService.acceptOffer({
        offerId: data.offer.id,
        acceptingDiscordUserId: data.player.discordUserId,
      }),
    ).rejects.toThrow('role feasibility failed');
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: data.offer.id } }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await expect(database.client.clubMembership.count()).resolves.toBe(0);
  });

  it('allows only one of two competing team offers to be accepted', async () => {
    const data = await seed();
    const competingClub = await clubs.create({
      guildId: data.guild.id,
      discordRoleId: '820000000000000003',
      emoji: '🟢',
    });
    const competingOffer = await offers.createPending({
      guildId: data.guild.id,
      clubId: competingClub.id,
      playerUserId: data.player.id,
      offeredByUserId: data.manager.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(accept(data)).resolves.toMatchObject({ offer: { status: 'ACCEPTED' } });
    await expect(
      service.acceptOffer({
        offerId: competingOffer.id,
        acceptingDiscordUserId: data.player.discordUserId,
      }),
    ).rejects.toBeInstanceOf(MemberAlreadySignedError);
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: competingOffer.id } }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await expect(
      database.client.clubMembership.count({ where: { status: 'ACTIVE' } }),
    ).resolves.toBe(1);
  });

  it('rejects an old offer after the player signs elsewhere and preserves that membership', async () => {
    const data = await seed();
    const previous = await memberships.createActive({
      guildId: data.guild.id,
      clubId: data.source.id,
      userId: data.player.id,
      membershipType: 'PLAYER',
      createdByUserId: data.manager.id,
    });
    await expect(accept(data)).rejects.toBeInstanceOf(MemberAlreadySignedError);
    const history = await memberships.listHistoryForUser(data.player.id);
    expect(history).toHaveLength(1);
    expect(history.find(({ id }) => id === previous.id)).toMatchObject({
      status: 'ACTIVE',
      clubId: data.source.id,
    });
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: data.offer.id } }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('rejects acceptance when the derived active roster is full', async () => {
    const data = await seed(1);
    const occupant = await users.getOrCreateByDiscordUserId('830000000000000003');
    await memberships.createActive({
      guildId: data.guild.id,
      clubId: data.destination.id,
      userId: occupant.id,
      membershipType: 'PLAYER',
    });
    await expect(accept(data)).rejects.toBeInstanceOf(SquadFullError);
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: data.offer.id } }),
    ).resolves.toMatchObject({
      status: 'PENDING',
    });
    await expect(database.client.leagueTransaction.count()).resolves.toBe(0);
  });

  it('does not count ended memberships toward capacity', async () => {
    const data = await seed(1);
    const former = await users.getOrCreateByDiscordUserId('830000000000000003');
    const membership = await memberships.createActive({
      guildId: data.guild.id,
      clubId: data.destination.id,
      userId: former.id,
      membershipType: 'PLAYER',
    });
    await memberships.end(membership.id);
    await expect(accept(data)).resolves.toMatchObject({ transactionType: 'SIGNING' });
  });

  it('counts staff roster memberships toward capacity', async () => {
    const data = await seed(1);
    await memberships.createActive({
      guildId: data.guild.id,
      clubId: data.destination.id,
      userId: data.manager.id,
      membershipType: 'PLAYER',
    });
    await memberships.createActive({
      guildId: data.guild.id,
      clubId: data.destination.id,
      userId: data.manager.id,
      membershipType: 'TEAM_MANAGER',
    });
    await expect(accept(data)).rejects.toBeInstanceOf(SquadFullError);
  });

  it('expires a stale pending offer without membership or transaction writes', async () => {
    const data = await seed();
    const acceptedAt = new Date(data.offer.expiresAt.getTime() + 1);
    await expect(accept(data, acceptedAt)).rejects.toBeInstanceOf(OfferExpiredError);
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: data.offer.id } }),
    ).resolves.toMatchObject({
      status: 'EXPIRED',
      respondedAt: acceptedAt,
    });
    await expect(database.client.clubMembership.count()).resolves.toBe(0);
    await expect(database.client.leagueTransaction.count()).resolves.toBe(0);
  });

  it('rejects the wrong discord user without changing the offer', async () => {
    const data = await seed();
    await expect(
      service.acceptOffer({
        offerId: data.offer.id,
        acceptingDiscordUserId: data.manager.discordUserId,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedOfferAcceptanceError);
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: data.offer.id } }),
    ).resolves.toMatchObject({
      status: 'PENDING',
    });
  });

  it('rejects a player already active in the destination club', async () => {
    const data = await seed();
    await memberships.createActive({
      guildId: data.guild.id,
      clubId: data.destination.id,
      userId: data.player.id,
      membershipType: 'PLAYER',
    });
    await expect(accept(data)).rejects.toBeInstanceOf(MemberAlreadySignedError);
  });

  it('rejects an inactive destination club', async () => {
    const data = await seed();
    await clubs.deactivate(data.destination.id);
    await expect(accept(data)).rejects.toBeInstanceOf(InvalidStateTransitionError);
    await expect(database.client.clubMembership.count()).resolves.toBe(0);
  });

  it('rejects a terminal offer', async () => {
    const data = await seed();
    await offers.transition(data.offer.id, 'DECLINED');
    await expect(accept(data)).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('rejects a missing offer', async () => {
    await expect(
      service.acceptOffer({
        offerId: '00000000-0000-0000-0000-000000000000',
        acceptingDiscordUserId: '830000000000000001',
      }),
    ).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('ignores the player membership in another guild', async () => {
    const data = await seed();
    const otherGuild = await guilds.create({
      discordGuildId: '810000000000000002',
      name: 'other guild',
    });
    const otherClub = await clubs.create({
      guildId: otherGuild.id,
      discordRoleId: '820000000000000003',
      emoji: '🟢',
    });
    await memberships.createActive({
      guildId: otherGuild.id,
      clubId: otherClub.id,
      userId: data.player.id,
      membershipType: 'PLAYER',
    });
    await expect(accept(data)).resolves.toMatchObject({ transactionType: 'SIGNING' });
    await expect(
      database.client.clubMembership.count({
        where: { userId: data.player.id, status: 'ACTIVE', membershipType: 'PLAYER' },
      }),
    ).resolves.toBe(2);
  });

  it('rolls back all writes when transaction record creation fails', async () => {
    const data = await seed();
    const factory: OfferAcceptanceRepositoryFactory = (transactionClient) => ({
      ...createOfferAcceptanceRepositories(transactionClient),
      transactions: {
        create: () => Promise.reject(new Error('transaction write failed')),
      },
    });
    const failingService = new OfferAcceptanceService(database.client, factory);
    await expect(
      failingService.acceptOffer({
        offerId: data.offer.id,
        acceptingDiscordUserId: data.player.discordUserId,
      }),
    ).rejects.toThrow('transaction write failed');
    await expect(database.client.clubMembership.count()).resolves.toBe(0);
    await expect(database.client.leagueTransaction.count()).resolves.toBe(0);
    await expect(database.client.auditEvent.count()).resolves.toBe(0);
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: data.offer.id } }),
    ).resolves.toMatchObject({
      status: 'PENDING',
    });
  });

  it('rolls back all writes when audit creation fails', async () => {
    const data = await seed();
    const factory: OfferAcceptanceRepositoryFactory = (transactionClient) => ({
      ...createOfferAcceptanceRepositories(transactionClient),
      auditEvents: {
        create: () => Promise.reject(new Error('audit write failed')),
      },
    });
    const failingService = new OfferAcceptanceService(database.client, factory);
    await expect(
      failingService.acceptOffer({
        offerId: data.offer.id,
        acceptingDiscordUserId: data.player.discordUserId,
      }),
    ).rejects.toThrow('audit write failed');
    await expect(database.client.clubMembership.count()).resolves.toBe(0);
    await expect(database.client.leagueTransaction.count()).resolves.toBe(0);
    await expect(database.client.auditEvent.count()).resolves.toBe(0);
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: data.offer.id } }),
    ).resolves.toMatchObject({
      status: 'PENDING',
    });
  });

  it('allows exactly one concurrent acceptance without partial state', async () => {
    const data = await seed();
    const results = await Promise.allSettled([accept(data), accept(data)]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    await expect(
      database.client.clubMembership.count({
        where: { clubId: data.destination.id, membershipType: 'PLAYER', status: 'ACTIVE' },
      }),
    ).resolves.toBe(1);
    await expect(database.client.leagueTransaction.count()).resolves.toBe(1);
    await expect(
      database.client.auditEvent.count({ where: { eventType: offerAcceptedAuditEventType } }),
    ).resolves.toBe(1);
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: data.offer.id } }),
    ).resolves.toMatchObject({
      status: 'ACCEPTED',
    });
  });
});
