import type { Club, Guild, LeagueUser, Offer } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditEventRepository } from '../../src/repositories/audit-event-repository.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { GuildRepository } from '../../src/repositories/guild-repository.js';
import { MembershipRepository } from '../../src/repositories/membership-repository.js';
import { OfferRepository } from '../../src/repositories/offer-repository.js';
import { LeagueTransactionRepository } from '../../src/repositories/transaction-repository.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import {
  ConflictError,
  ConstraintViolationError,
  InvalidStateTransitionError,
} from '../../src/domain/errors.js';
import type { MembershipType } from '../../src/domain/enums.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';

interface SeedData {
  guild: Guild;
  clubA: Club;
  clubB: Club;
  player: LeagueUser;
  manager: LeagueUser;
}

describe('repositories and database constraints', () => {
  let database: TestDatabase;
  let guilds: GuildRepository;
  let clubs: ClubRepository;
  let users: UserRepository;
  let memberships: MembershipRepository;
  let offers: OfferRepository;
  let transactions: LeagueTransactionRepository;
  let auditEvents: AuditEventRepository;

  beforeAll(() => {
    database = createTestDatabase();
    guilds = new GuildRepository(database.client);
    clubs = new ClubRepository(database.client);
    users = new UserRepository(database.client);
    memberships = new MembershipRepository(database.client);
    offers = new OfferRepository(database.client);
    transactions = new LeagueTransactionRepository(database.client);
    auditEvents = new AuditEventRepository(database.client);
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  async function seed(): Promise<SeedData> {
    const guild = await guilds.create({ discordGuildId: '100000000000000001', name: 'guild one' });
    const clubA = await clubs.create({
      guildId: guild.id,
      name: 'alpha club',
      shortName: 'ALP',
      discordRoleId: '200000000000000001',
      squadLimit: 17,
    });
    const clubB = await clubs.create({
      guildId: guild.id,
      name: 'beta club',
      shortName: 'BET',
      discordRoleId: '200000000000000002',
      squadLimit: 17,
    });
    const player = await users.getOrCreateByDiscordUserId('300000000000000001');
    const manager = await users.getOrCreateByDiscordUserId('300000000000000002');
    return { guild, clubA, clubB, player, manager };
  }

  async function pendingOffer(
    data: SeedData,
    expiresAt = new Date(Date.now() + 60_000),
  ): Promise<Offer> {
    return offers.createPending({
      guildId: data.guild.id,
      clubId: data.clubA.id,
      playerUserId: data.player.id,
      offeredByUserId: data.manager.id,
      expiresAt,
    });
  }

  async function createOtherGuildClub(): Promise<{ guild: Guild; club: Club }> {
    const guild = await guilds.create({
      discordGuildId: '100000000000000099',
      name: 'other guild',
    });
    const club = await clubs.create({
      guildId: guild.id,
      name: 'other club',
      shortName: 'OTH',
      discordRoleId: '200000000000000099',
      squadLimit: 17,
    });
    return { guild, club };
  }

  describe('guilds and settings', () => {
    it('creates and retrieves a guild through both identities', async () => {
      const guild = await guilds.create({ discordGuildId: '100000000000000001', name: 'guild' });
      await expect(guilds.getById(guild.id)).resolves.toEqual(guild);
      await expect(guilds.getByDiscordGuildId(guild.discordGuildId)).resolves.toEqual(guild);
    });

    it('enforces unique discord guild ids', async () => {
      await guilds.create({ discordGuildId: '100000000000000001', name: 'guild' });
      await expect(
        guilds.create({ discordGuildId: '100000000000000001', name: 'duplicate' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('upserts one settings record per guild', async () => {
      const guild = await guilds.create({ discordGuildId: '100000000000000001', name: 'guild' });
      const first = await guilds.upsertSettings(guild.id, { offerTimeoutSeconds: 60 });
      const second = await guilds.upsertSettings(guild.id, {
        offerTimeoutSeconds: 120,
        auditChannelId: '400000000000000001',
      });
      expect(second.id).toBe(first.id);
      expect((await guilds.getSettings(guild.id))?.offerTimeoutSeconds).toBe(120);
      await expect(
        database.client.guildSettings.count({ where: { guildId: guild.id } }),
      ).resolves.toBe(1);
    });

    it('enforces a positive offer timeout', async () => {
      const guild = await guilds.create({ discordGuildId: '100000000000000001', name: 'guild' });
      await expect(
        guilds.upsertSettings(guild.id, { offerTimeoutSeconds: 0 }),
      ).rejects.toBeInstanceOf(ConstraintViolationError);
    });
  });

  describe('clubs', () => {
    it.each([
      ['name', { name: 'alpha club', shortName: 'NEW', discordRoleId: '200000000000000009' }],
      ['short name', { name: 'new club', shortName: 'ALP', discordRoleId: '200000000000000009' }],
      ['role id', { name: 'new club', shortName: 'NEW', discordRoleId: '200000000000000001' }],
    ])('enforces unique %s within a guild', async (_label, values) => {
      const data = await seed();
      await expect(
        clubs.create({ guildId: data.guild.id, squadLimit: 17, ...values }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('allows the same club name in another guild', async () => {
      const data = await seed();
      const otherGuild = await guilds.create({
        discordGuildId: '100000000000000002',
        name: 'guild two',
      });
      await expect(
        clubs.create({
          guildId: otherGuild.id,
          name: data.clubA.name,
          shortName: data.clubA.shortName,
          discordRoleId: data.clubA.discordRoleId,
          squadLimit: 17,
        }),
      ).resolves.toMatchObject({ name: data.clubA.name });
    });

    it('enforces a positive squad limit', async () => {
      const guild = await guilds.create({ discordGuildId: '100000000000000001', name: 'guild' });
      await expect(
        clubs.create({
          guildId: guild.id,
          name: 'invalid club',
          shortName: 'INV',
          discordRoleId: '200000000000000001',
          squadLimit: 0,
        }),
      ).rejects.toBeInstanceOf(ConstraintViolationError);
    });

    it('deactivates without erasing historical relations', async () => {
      const data = await seed();
      await memberships.createActive({
        guildId: data.guild.id,
        clubId: data.clubA.id,
        userId: data.player.id,
        membershipType: 'PLAYER',
      });
      await transactions.create({
        guildId: data.guild.id,
        userId: data.player.id,
        transactionType: 'SIGNING',
        destinationClubId: data.clubA.id,
        performedByUserId: data.manager.id,
      });
      expect((await clubs.deactivate(data.clubA.id)).active).toBe(false);
      await expect(memberships.listHistoryForUser(data.player.id)).resolves.toHaveLength(1);
      await expect(transactions.listForClub(data.clubA.id)).resolves.toHaveLength(1);
      await expect(clubs.listActive(data.guild.id)).resolves.toEqual([data.clubB]);
      await expect(
        clubs.getByDiscordRoleId(data.guild.id, data.clubA.discordRoleId),
      ).resolves.toMatchObject({
        id: data.clubA.id,
      });
    });
  });

  describe('users', () => {
    it('creates or retrieves one user under concurrent attempts', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => users.getOrCreateByDiscordUserId('300000000000000001')),
      );
      expect(new Set(results.map(({ id }) => id))).toHaveLength(1);
      await expect(database.client.leagueUser.count()).resolves.toBe(1);
    });

    it('enforces discord user id uniqueness at the database level', async () => {
      await database.client.leagueUser.create({ data: { discordUserId: '300000000000000001' } });
      await expect(
        database.client.leagueUser.create({ data: { discordUserId: '300000000000000001' } }),
      ).rejects.toBeDefined();
    });

    it('updates roblox identity using string ids', async () => {
      const user = await users.getOrCreateByDiscordUserId('300000000000000001');
      await expect(
        users.updateRobloxIdentity(user.id, {
          robloxUserId: '99999999999999999999',
          robloxUsername: 'league_player',
        }),
      ).resolves.toMatchObject({
        robloxUserId: '99999999999999999999',
        robloxUsername: 'league_player',
      });
    });
  });

  describe('memberships', () => {
    it('creates active players and derives roster counts', async () => {
      const data = await seed();
      await memberships.createActive({
        guildId: data.guild.id,
        clubId: data.clubA.id,
        userId: data.player.id,
        membershipType: 'PLAYER',
      });
      await expect(
        memberships.getActivePlayerMembership(data.guild.id, data.player.id),
      ).resolves.toMatchObject({
        clubId: data.clubA.id,
      });
      await expect(memberships.listActivePlayers(data.clubA.id)).resolves.toHaveLength(1);
      await expect(memberships.countActivePlayers(data.clubA.id)).resolves.toBe(1);
      await expect(clubs.countActivePlayers(data.clubA.id)).resolves.toBe(1);
    });

    it('prevents two active player memberships in one guild', async () => {
      const data = await seed();
      await memberships.createActive({
        guildId: data.guild.id,
        clubId: data.clubA.id,
        userId: data.player.id,
        membershipType: 'PLAYER',
      });
      await expect(
        memberships.createActive({
          guildId: data.guild.id,
          clubId: data.clubB.id,
          userId: data.player.id,
          membershipType: 'PLAYER',
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects a club from another guild at the database level', async () => {
      const data = await seed();
      const other = await createOtherGuildClub();
      await expect(
        database.client.clubMembership.create({
          data: {
            guildId: data.guild.id,
            clubId: other.club.id,
            userId: data.player.id,
            membershipType: 'PLAYER',
            status: 'ACTIVE',
          },
        }),
      ).rejects.toBeDefined();
    });

    it('rejects active membership with a left timestamp', async () => {
      const data = await seed();
      await expect(
        database.client.clubMembership.create({
          data: {
            guildId: data.guild.id,
            clubId: data.clubA.id,
            userId: data.player.id,
            membershipType: 'PLAYER',
            status: 'ACTIVE',
            leftAt: new Date(),
          },
        }),
      ).rejects.toBeDefined();
    });

    it('rejects ended membership without a left timestamp', async () => {
      const data = await seed();
      await expect(
        database.client.clubMembership.create({
          data: {
            guildId: data.guild.id,
            clubId: data.clubA.id,
            userId: data.player.id,
            membershipType: 'PLAYER',
            status: 'ENDED',
          },
        }),
      ).rejects.toBeDefined();
    });

    it('allows the same player to be active in different guilds', async () => {
      const data = await seed();
      const otherGuild = await guilds.create({
        discordGuildId: '100000000000000002',
        name: 'guild two',
      });
      const otherClub = await clubs.create({
        guildId: otherGuild.id,
        name: 'alpha club',
        shortName: 'ALP',
        discordRoleId: '200000000000000001',
        squadLimit: 17,
      });
      await memberships.createActive({
        guildId: data.guild.id,
        clubId: data.clubA.id,
        userId: data.player.id,
        membershipType: 'PLAYER',
      });
      await expect(
        memberships.createActive({
          guildId: otherGuild.id,
          clubId: otherClub.id,
          userId: data.player.id,
          membershipType: 'PLAYER',
        }),
      ).resolves.toBeDefined();
    });

    it('ends without deleting history and allows a new active membership', async () => {
      const data = await seed();
      const membership = await memberships.createActive({
        guildId: data.guild.id,
        clubId: data.clubA.id,
        userId: data.player.id,
        membershipType: 'PLAYER',
        createdByUserId: data.manager.id,
      });
      const ended = await memberships.end(membership.id, { endedByUserId: data.manager.id });
      expect(ended).toMatchObject({ status: 'ENDED', endedByUserId: data.manager.id });
      expect(ended.leftAt).toBeInstanceOf(Date);
      await expect(memberships.countActivePlayers(data.clubA.id)).resolves.toBe(0);
      await expect(memberships.listHistoryForUser(data.player.id)).resolves.toHaveLength(1);
      await expect(
        memberships.createActive({
          guildId: data.guild.id,
          clubId: data.clubB.id,
          userId: data.player.id,
          membershipType: 'PLAYER',
        }),
      ).resolves.toBeDefined();
    });

    it.each<MembershipType>(['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'])(
      'allows one active %s per club',
      async (membershipType) => {
        const data = await seed();
        await memberships.createActive({
          guildId: data.guild.id,
          clubId: data.clubA.id,
          userId: data.manager.id,
          membershipType,
        });
        await expect(
          memberships.createActive({
            guildId: data.guild.id,
            clubId: data.clubA.id,
            userId: data.player.id,
            membershipType,
          }),
        ).rejects.toBeInstanceOf(ConflictError);
        await expect(memberships.getActiveStaffAppointments(data.clubA.id)).resolves.toHaveLength(
          1,
        );
      },
    );
  });

  describe('offers', () => {
    it('creates and lists pending offers for players and clubs', async () => {
      const data = await seed();
      const offer = await pendingOffer(data);
      await expect(offers.getById(offer.id)).resolves.toEqual(offer);
      await expect(offers.listPendingForPlayer(data.guild.id, data.player.id)).resolves.toEqual([
        offer,
      ]);
      await expect(offers.listPendingForClub(data.clubA.id)).resolves.toEqual([offer]);
    });

    it('rejects duplicate pending offers from the same club', async () => {
      const data = await seed();
      await pendingOffer(data);
      await expect(pendingOffer(data)).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects a club from another guild at the database level', async () => {
      const data = await seed();
      const other = await createOtherGuildClub();
      await expect(
        database.client.offer.create({
          data: {
            guildId: data.guild.id,
            clubId: other.club.id,
            playerUserId: data.player.id,
            offeredByUserId: data.manager.id,
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      ).rejects.toBeDefined();
    });

    it.each([
      ['responded timestamp', { respondedAt: new Date() }],
      ['cancelled timestamp', { cancelledAt: new Date() }],
    ])('rejects pending offers with a %s', async (_label, timestamps) => {
      const data = await seed();
      await expect(
        database.client.offer.create({
          data: {
            guildId: data.guild.id,
            clubId: data.clubA.id,
            playerUserId: data.player.id,
            offeredByUserId: data.manager.id,
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 60_000),
            ...timestamps,
          },
        }),
      ).rejects.toBeDefined();
    });

    it.each([
      ['responded timestamp', { cancelledAt: new Date() }],
      ['cancelled timestamp', { respondedAt: new Date() }],
    ])('requires the %s for cancelled offers', async (_label, timestamps) => {
      const data = await seed();
      await expect(
        database.client.offer.create({
          data: {
            guildId: data.guild.id,
            clubId: data.clubA.id,
            playerUserId: data.player.id,
            offeredByUserId: data.manager.id,
            status: 'CANCELLED',
            expiresAt: new Date(Date.now() + 60_000),
            ...timestamps,
          },
        }),
      ).rejects.toBeDefined();
    });

    it.each(['ACCEPTED', 'DECLINED', 'EXPIRED', 'VOIDED'] as const)(
      'requires a response and rejects cancellation for %s offers',
      async (status) => {
        const data = await seed();
        const common = {
          guildId: data.guild.id,
          clubId: data.clubA.id,
          playerUserId: data.player.id,
          offeredByUserId: data.manager.id,
          status,
          expiresAt: new Date(Date.now() + 60_000),
        };
        await expect(database.client.offer.create({ data: common })).rejects.toBeDefined();
        await expect(
          database.client.offer.create({
            data: { ...common, respondedAt: new Date(), cancelledAt: new Date() },
          }),
        ).rejects.toBeDefined();
      },
    );

    it('allows separate clubs to offer the same player', async () => {
      const data = await seed();
      await pendingOffer(data);
      await expect(
        offers.createPending({
          guildId: data.guild.id,
          clubId: data.clubB.id,
          playerUserId: data.player.id,
          offeredByUserId: data.manager.id,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ).resolves.toBeDefined();
    });

    it.each(['ACCEPTED', 'DECLINED', 'EXPIRED', 'VOIDED'] as const)(
      'allows pending to transition to %s',
      async (status) => {
        const data = await seed();
        const offer = await pendingOffer(data);
        await expect(offers.transition(offer.id, status)).resolves.toMatchObject({ status });
      },
    );

    it('prevents a terminal offer from transitioning again', async () => {
      const data = await seed();
      const offer = await pendingOffer(data);
      await offers.transition(offer.id, 'ACCEPTED');
      await expect(offers.transition(offer.id, 'DECLINED')).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });

    it('allows exactly one concurrent transition', async () => {
      const data = await seed();
      const offer = await pendingOffer(data);
      const results = await Promise.allSettled([
        offers.transition(offer.id, 'ACCEPTED'),
        offers.transition(offer.id, 'DECLINED'),
      ]);
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    });

    it('marks only expired pending offers', async () => {
      const data = await seed();
      const offer = await pendingOffer(data, new Date(Date.now() + 10_000));
      const now = new Date(Date.now() + 20_000);
      await expect(offers.markExpiredPending(now)).resolves.toBe(1);
      await expect(offers.getById(offer.id)).resolves.toMatchObject({
        status: 'EXPIRED',
        respondedAt: now,
      });
    });

    it('records cancellation timestamps', async () => {
      const data = await seed();
      const offer = await pendingOffer(data);
      const at = new Date();
      await expect(offers.cancel(offer.id, at)).resolves.toMatchObject({
        status: 'CANCELLED',
        cancelledAt: at,
        respondedAt: at,
      });
    });

    it('enforces expiration after creation', async () => {
      const data = await seed();
      await expect(pendingOffer(data, new Date(0))).rejects.toBeInstanceOf(
        ConstraintViolationError,
      );
    });
  });

  describe('league transactions', () => {
    it.each(['sourceClubId', 'destinationClubId'] as const)(
      'rejects a %s from another guild at the database level',
      async (clubField) => {
        const data = await seed();
        const other = await createOtherGuildClub();
        await expect(
          database.client.leagueTransaction.create({
            data: {
              guildId: data.guild.id,
              userId: data.player.id,
              transactionType: 'TRANSFER',
              performedByUserId: data.manager.id,
              [clubField]: other.club.id,
            },
          }),
        ).rejects.toBeDefined();
      },
    );

    it('persists signing transfer and release shapes and queries both clubs', async () => {
      const data = await seed();
      await transactions.create({
        guildId: data.guild.id,
        userId: data.player.id,
        transactionType: 'SIGNING',
        destinationClubId: data.clubA.id,
        performedByUserId: data.manager.id,
      });
      await transactions.create({
        guildId: data.guild.id,
        userId: data.player.id,
        transactionType: 'TRANSFER',
        sourceClubId: data.clubA.id,
        destinationClubId: data.clubB.id,
        performedByUserId: data.manager.id,
      });
      await transactions.create({
        guildId: data.guild.id,
        userId: data.player.id,
        transactionType: 'RELEASE',
        sourceClubId: data.clubB.id,
        performedByUserId: data.manager.id,
      });
      await expect(transactions.listForUser(data.player.id)).resolves.toHaveLength(3);
      await expect(transactions.listForClub(data.clubA.id)).resolves.toHaveLength(2);
      await expect(transactions.listForClub(data.clubB.id)).resolves.toHaveLength(2);
    });

    it('records one reversal and rejects a duplicate', async () => {
      const data = await seed();
      const transaction = await transactions.create({
        guildId: data.guild.id,
        userId: data.player.id,
        transactionType: 'SIGNING',
        destinationClubId: data.clubA.id,
        performedByUserId: data.manager.id,
      });
      const reversed = await transactions.markReversed(transaction.id, data.manager.id);
      expect(reversed.reversedAt).toBeInstanceOf(Date);
      await expect(
        transactions.markReversed(transaction.id, data.manager.id),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });
  });

  describe('audit events', () => {
    it('persists json and supports guild entity and actor queries', async () => {
      const data = await seed();
      const event = await auditEvents.create({
        guildId: data.guild.id,
        actorUserId: data.manager.id,
        eventType: 'membership.changed',
        entityType: 'membership',
        entityId: 'entity-one',
        beforeState: { status: 'PENDING' },
        afterState: { status: 'ACTIVE' },
        metadata: { source: 'test', attempts: 1 },
      });
      expect(event).toMatchObject({
        beforeState: { status: 'PENDING' },
        afterState: { status: 'ACTIVE' },
        metadata: { source: 'test', attempts: 1 },
      });
      await expect(auditEvents.listForGuild(data.guild.id)).resolves.toEqual([event]);
      await expect(auditEvents.listForEntity('membership', 'entity-one')).resolves.toEqual([event]);
      await expect(auditEvents.listByActor(data.manager.id)).resolves.toEqual([event]);
      expect('update' in auditEvents).toBe(false);
      expect('delete' in auditEvents).toBe(false);
    });

    it('allows system events without an actor', async () => {
      const data = await seed();
      await expect(
        auditEvents.create({
          guildId: data.guild.id,
          eventType: 'offer.expired',
          entityType: 'offer',
          entityId: 'entity-two',
        }),
      ).resolves.toMatchObject({ actorUserId: null });
    });
  });

  describe('transaction compatibility', () => {
    it('rolls back all repository writes when a later operation fails', async () => {
      const data = await seed();
      const offer = await pendingOffer(data);
      await expect(
        database.client.$transaction(async (tx) => {
          const txMemberships = new MembershipRepository(tx);
          const txOffers = new OfferRepository(tx);
          const txTransactions = new LeagueTransactionRepository(tx);
          const txAudit = new AuditEventRepository(tx);
          await txMemberships.createActive({
            guildId: data.guild.id,
            clubId: data.clubA.id,
            userId: data.player.id,
            membershipType: 'PLAYER',
          });
          await txOffers.transition(offer.id, 'ACCEPTED');
          await txTransactions.create({
            guildId: data.guild.id,
            userId: data.player.id,
            transactionType: 'SIGNING',
            destinationClubId: data.clubA.id,
            performedByUserId: data.manager.id,
            offerId: offer.id,
          });
          await txAudit.create({
            guildId: data.guild.id,
            eventType: 'test.rollback',
            entityType: 'offer',
            entityId: offer.id,
          });
          await txMemberships.createActive({
            guildId: data.guild.id,
            clubId: data.clubB.id,
            userId: data.player.id,
            membershipType: 'PLAYER',
          });
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(database.client.clubMembership.count()).resolves.toBe(0);
      await expect(database.client.leagueTransaction.count()).resolves.toBe(0);
      await expect(database.client.auditEvent.count()).resolves.toBe(0);
      await expect(offers.getById(offer.id)).resolves.toMatchObject({ status: 'PENDING' });
    });
  });
});
