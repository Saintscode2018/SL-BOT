import type { Club, GuildSettings } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AlreadyMemberOfClubError,
  AuthorizationError,
  BotUserNotAllowedError,
  ConflictError,
  DuplicateOfferError,
  InvalidOfferMessageError,
  MemberAlreadySignedError,
  OfferDeliveryError,
  SquadFullError,
  UnauthorizedOfferAcceptanceError,
} from '../../src/domain/errors.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { MembershipRepository } from '../../src/repositories/membership-repository.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { AuthorizationService } from '../../src/services/authorization-service.js';
import {
  clubCreatedAuditEventType,
  ClubManagementService,
} from '../../src/services/club-management-service.js';
import {
  guildConfiguredAuditEventType,
  GuildSetupService,
} from '../../src/services/guild-setup-service.js';
import {
  offerCreatedAuditEventType,
  OfferCreationService,
} from '../../src/services/offer-creation-service.js';
import { OfferDeclineService } from '../../src/services/offer-decline-service.js';
import {
  offerDeliveryFailedAuditEventType,
  OfferDeliveryService,
  type OfferMessageAdapter,
} from '../../src/services/offer-delivery-service.js';
import { OfferResponseService } from '../../src/services/offer-response-service.js';
import {
  rosterPlayerAddedAuditEventType,
  RosterManagementService,
} from '../../src/services/roster-management-service.js';
import {
  staffAppointedAuditEventType,
  StaffManagementService,
} from '../../src/services/staff-management-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  grantBotPermission,
  type TestDatabase,
} from '../helpers/database.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const guildId = '900000000000000001';
const ownerId = '900000000000000002';
const administratorId = '900000000000000003';
const outsiderId = '900000000000000004';
const playerId = '900000000000000005';

function authorization(
  discordUserId = ownerId,
  overrides: Partial<AuthorizationInput> = {},
): AuthorizationInput {
  return {
    discordGuildId: guildId,
    discordUserId,
    guildOwnerId: ownerId,
    memberRoleIds: [],
    hasAdministratorPermission: discordUserId === administratorId,
    ...overrides,
  };
}

describe('administration services', () => {
  let database: TestDatabase;
  let settings: GuildSettings;

  beforeAll(() => {
    database = createTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
    const setupService = new GuildSetupService(database.client);
    await setupService.setupGuildOnly({
      authorization: authorization(administratorId),
      guildName: 'Development League',
    });
    await grantBotPermission(database.client, guildId, ownerId);
    const result = await setupService.setup({
      authorization: authorization(ownerId),
      guildName: 'Development League',
      transferChannelId: '910000000000000001',
      auditChannelId: '910000000000000002',
      botPermissionsRoleId: '920000000000000001',
      teamManagerRoleId: '920000000000000002',
      assistantManagerRoleId: '920000000000000003',
      playerManagerRoleId: '920000000000000004',
      offerTimeoutSeconds: 3600,
    });
    settings = result.settings;
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  async function createClub(
    roleId = '930000000000000001',
    squadLimit = 5,
    emoji = '🦁',
  ): Promise<Club> {
    return new ClubManagementService(database.client).create({
      authorization: authorization(),
      discordRoleId: roleId,
      emoji,
      squadLimitOverride: squadLimit,
    });
  }

  async function createDeliveredOffer(destination: Club, offeredPlayerDiscordId = playerId) {
    const adapter: OfferMessageAdapter = {
      sendOffer: vi.fn(() =>
        Promise.resolve({
          channelId: '910000000000000001',
          messageId: '940000000000000001',
        }),
      ),
      setTerminalState: vi.fn(() => Promise.resolve()),
      cleanupOrphan: vi.fn(() => Promise.resolve()),
    };
    return new OfferDeliveryService(database.client, adapter, new MemoryLogger()).createAndDeliver({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: offeredPlayerDiscordId,
      playerIsBot: false,
    });
  }

  it('allows database Bot Permissions to configure while rejecting Discord administrators and other users', async () => {
    await expect(
      new AuthorizationService(database.client).authorizeLeagueAdministration(
        authorization(ownerId),
      ),
    ).resolves.toMatchObject({ kind: 'BOTPERM' });
    await expect(
      new AuthorizationService(database.client).authorizeLeagueAdministration(
        authorization(administratorId),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      new GuildSetupService(database.client).setup({
        authorization: authorization(outsiderId),
        guildName: 'No Access',
        transferChannelId: settings.transferChannelId ?? '',
        auditChannelId: settings.auditChannelId ?? '',
        botPermissionsRoleId: settings.botPermissionsRoleId ?? '',
        teamManagerRoleId: settings.teamManagerRoleId ?? '',
        assistantManagerRoleId: settings.assistantManagerRoleId ?? '',
        playerManagerRoleId: settings.playerManagerRoleId ?? '',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('reruns guild setup as an update and writes an audit event', async () => {
    const result = await new GuildSetupService(database.client).setup({
      authorization: authorization(ownerId),
      guildName: 'Renamed League',
      transferChannelId: '910000000000000010',
      auditChannelId: '910000000000000011',
      botPermissionsRoleId: settings.botPermissionsRoleId ?? '',
      teamManagerRoleId: settings.teamManagerRoleId ?? '',
      assistantManagerRoleId: settings.assistantManagerRoleId ?? '',
      playerManagerRoleId: settings.playerManagerRoleId ?? '',
    });
    expect(result).toMatchObject({ created: false, guild: { name: 'Renamed League' } });
    await expect(
      database.client.auditEvent.count({ where: { eventType: guildConfiguredAuditEventType } }),
    ).resolves.toBe(3);
  });

  it('creates teams and rejects a duplicate Discord role', async () => {
    const club = await createClub();
    expect(club).toMatchObject({ discordRoleId: '930000000000000001', emoji: '🦁' });
    await expect(createClub('930000000000000001')).rejects.toBeInstanceOf(ConflictError);
    await expect(
      database.client.auditEvent.count({ where: { eventType: clubCreatedAuditEventType } }),
    ).resolves.toBe(1);
  });

  it('deactivates clubs without deleting history and excludes them from autocomplete', async () => {
    const club = await createClub();
    const service = new ClubManagementService(database.client);
    await service.deactivate(authorization(), club.id);
    await expect(service.autocomplete(guildId, 'lion')).resolves.toEqual([]);
    await expect(database.client.club.count({ where: { id: club.id } })).resolves.toBe(1);
  });

  it('filters role-only autocomplete by cached role name and caps results', async () => {
    const service = new ClubManagementService(database.client);
    const unicodeClub = await createClub('930000000000000001', 5, '🦁');
    const customClub = await createClub('930000000000000002', 5, '<:ankara:123456789012345678>');
    const unknownRoleClub = await createClub('930000000000000003', 5, '⚪');
    const roleNames = {
      [unicodeClub.discordRoleId]: 'Istanbul Lions',
      [customClub.discordRoleId]: 'Ankara United',
    };
    await expect(service.autocomplete(guildId, 'lion', 25, roleNames)).resolves.toEqual([
      { name: '@Istanbul Lions', value: unicodeClub.id },
    ]);
    await expect(service.autocomplete(guildId, 'ank', 25, roleNames)).resolves.toEqual([
      { name: '@Ankara United', value: customClub.id },
    ]);
    await expect(service.autocomplete(guildId, 'unknown', 25, roleNames)).resolves.toEqual([
      { name: 'Unknown Team Role', value: unknownRoleClub.id },
    ]);
    await expect(service.autocomplete(guildId, '', 1)).resolves.toHaveLength(1);
    await expect(service.autocomplete('999999999999999999', '')).resolves.toEqual([]);
  });

  it.each(['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] as const)(
    'appoints and removes %s while preserving history',
    async (staffType) => {
      const club = await createClub();
      const service = new StaffManagementService(database.client);
      const appointed = await service.appoint({
        authorization: authorization(),
        clubId: club.id,
        staffDiscordUserId: outsiderId,
        staffType,
        staffIsBot: false,
      });
      expect(appointed.membership.createdByUserId).not.toBeNull();
      const removed = await service.remove(authorization(), club.id, staffType);
      expect(removed.membership).toMatchObject({
        status: 'ENDED',
        endedByUserId: appointed.membership.createdByUserId,
      });
      expect(removed.user.discordUserId).toBe(appointed.user.discordUserId);
      expect(removed.club.id).toBe(club.id);
      await expect(database.client.clubMembership.count()).resolves.toBe(2);
      await expect(
        database.client.clubMembership.findFirstOrThrow({
          where: { userId: appointed.user.id, membershipType: 'PLAYER' },
        }),
      ).resolves.toMatchObject({ status: 'ACTIVE', clubId: club.id });
      await expect(
        database.client.auditEvent.count({ where: { eventType: staffAppointedAuditEventType } }),
      ).resolves.toBe(1);
    },
  );

  it('rejects bot staff and enforces one active holder per staff type', async () => {
    const club = await createClub();
    const service = new StaffManagementService(database.client);
    await expect(
      service.appoint({
        authorization: authorization(),
        clubId: club.id,
        staffDiscordUserId: outsiderId,
        staffType: 'TEAM_MANAGER',
        staffIsBot: true,
      }),
    ).rejects.toBeInstanceOf(BotUserNotAllowedError);
    await service.appoint({
      authorization: authorization(),
      clubId: club.id,
      staffDiscordUserId: outsiderId,
      staffType: 'TEAM_MANAGER',
      staffIsBot: false,
    });
    await expect(
      service.appoint({
        authorization: authorization(),
        clubId: club.id,
        staffDiscordUserId: playerId,
        staffType: 'TEAM_MANAGER',
        staffIsBot: false,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows active club staff to add and remove players atomically', async () => {
    const club = await createClub();
    await new StaffManagementService(database.client).appoint({
      authorization: authorization(),
      clubId: club.id,
      staffDiscordUserId: outsiderId,
      staffType: 'ASSISTANT_MANAGER',
      staffIsBot: false,
    });
    const staffAuthorization = authorization(outsiderId);
    const service = new RosterManagementService(database.client);
    const added = await service.add({
      authorization: staffAuthorization,
      clubId: club.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
      robloxUsername: 'PlayerOne',
      robloxUserId: '12345',
    });
    expect(added).toMatchObject({
      membership: { status: 'ACTIVE' },
      transaction: { transactionType: 'SIGNING' },
    });
    const removed = await service.remove(
      staffAuthorization,
      club.id,
      playerId,
      'manual correction',
    );
    expect(removed).toMatchObject({
      membership: { status: 'ENDED' },
      transaction: { transactionType: 'RELEASE' },
    });
    await expect(
      database.client.auditEvent.count({ where: { eventType: rosterPlayerAddedAuditEventType } }),
    ).resolves.toBe(1);
  });

  it('rejects unauthorized roster staff and duplicate active guild membership', async () => {
    const club = await createClub();
    const service = new RosterManagementService(database.client);
    await expect(
      service.add({
        authorization: authorization(outsiderId),
        clubId: club.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await service.add({
      authorization: authorization(),
      clubId: club.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    await expect(
      service.add({
        authorization: authorization(),
        clubId: club.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(AlreadyMemberOfClubError);
  });

  it('derives capacity from active players and ignores ended memberships', async () => {
    const club = await createClub('930000000000000001', 1);
    const service = new RosterManagementService(database.client);
    await service.add({
      authorization: authorization(),
      clubId: club.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    await expect(
      service.add({
        authorization: authorization(),
        clubId: club.id,
        playerDiscordUserId: outsiderId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(SquadFullError);
    await service.remove(authorization(), club.id, playerId);
    await expect(
      service.add({
        authorization: authorization(),
        clubId: club.id,
        playerDiscordUserId: outsiderId,
        playerIsBot: false,
      }),
    ).resolves.toMatchObject({ membership: { status: 'ACTIVE' } });
  });

  it('rolls back roster membership and transaction when its audit write fails', async () => {
    const club = await createClub();
    await database.client.$executeRawUnsafe(`
      CREATE TRIGGER fail_roster_audit
      BEFORE INSERT ON AuditEvent
      WHEN NEW.eventType = '${rosterPlayerAddedAuditEventType}'
      BEGIN
        SELECT RAISE(ABORT, 'audit failure');
      END
    `);
    try {
      await expect(
        new RosterManagementService(database.client).add({
          authorization: authorization(),
          clubId: club.id,
          playerDiscordUserId: playerId,
          playerIsBot: false,
        }),
      ).rejects.toThrow();
      await expect(database.client.clubMembership.count()).resolves.toBe(0);
      await expect(database.client.leagueTransaction.count()).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_roster_audit');
    }
  });

  it('allows a player membership in another guild', async () => {
    const club = await createClub();
    const otherGuild = await database.client.guild.create({
      data: { discordGuildId: '900000000000000099', name: 'Other' },
    });
    const otherClub = await new ClubRepository(database.client).create({
      guildId: otherGuild.id,
      discordRoleId: '930000000000000099',
      emoji: '🟢',
      squadLimitOverride: 5,
    });
    const player = await new UserRepository(database.client).getOrCreateByDiscordUserId(playerId);
    await new MembershipRepository(database.client).createActive({
      guildId: otherGuild.id,
      clubId: otherClub.id,
      userId: player.id,
      membershipType: 'PLAYER',
    });
    await expect(
      new RosterManagementService(database.client).add({
        authorization: authorization(),
        clubId: club.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).resolves.toMatchObject({ club: { id: club.id } });
  });

  it('rejects creating an offer for a player already signed to a source club', async () => {
    const destination = await createClub();
    const source = await createClub('930000000000000002');
    await new RosterManagementService(database.client).add({
      authorization: authorization(),
      clubId: source.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    await expect(
      new OfferCreationService(database.client).createOffer({
        authorization: authorization(),
        destinationClubId: destination.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(MemberAlreadySignedError);
    await expect(
      database.client.auditEvent.count({ where: { eventType: offerCreatedAuditEventType } }),
    ).resolves.toBe(0);
  });

  it('authorizes team staff offers and rejects duplicates and full destinations', async () => {
    const destination = await createClub('930000000000000001', 2);
    await new StaffManagementService(database.client).appoint({
      authorization: authorization(),
      clubId: destination.id,
      staffDiscordUserId: outsiderId,
      staffType: 'PLAYER_MANAGER',
      staffIsBot: false,
    });
    const service = new OfferCreationService(database.client);
    await service.createOffer({
      authorization: authorization(outsiderId),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    await expect(
      service.createOffer({
        authorization: authorization(outsiderId),
        destinationClubId: destination.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(DuplicateOfferError);
    await new RosterManagementService(database.client).add({
      authorization: authorization(),
      clubId: destination.id,
      playerDiscordUserId: administratorId,
      playerIsBot: false,
    });
    await expect(
      service.createOffer({
        authorization: authorization(outsiderId),
        destinationClubId: destination.id,
        playerDiscordUserId: ownerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(SquadFullError);
  });

  it.each([
    ['source', 'TEAM_MANAGER', 'ASSISTANT_MANAGER'],
    ['source', 'ASSISTANT_MANAGER', 'TEAM_MANAGER'],
    ['source', 'PLAYER_MANAGER', 'TEAM_MANAGER'],
    ['other', 'TEAM_MANAGER', 'TEAM_MANAGER'],
    ['other', 'ASSISTANT_MANAGER', 'TEAM_MANAGER'],
    ['other', 'PLAYER_MANAGER', 'TEAM_MANAGER'],
  ] as const)(
    'blocks a target with an active %s team %s appointment before delivery',
    async (targetTeam, targetType, callerType) => {
      const source = await createClub('930000000000000010', 5, '⚽');
      const other = await createClub('930000000000000011', 5, '<:Other:987654321098765432>');
      const targetClub = targetTeam === 'source' ? source : other;
      const staff = new StaffManagementService(database.client);
      await staff.appoint({
        authorization: authorization(),
        clubId: source.id,
        staffDiscordUserId: outsiderId,
        staffType: callerType,
        staffIsBot: false,
      });
      await staff.appoint({
        authorization: authorization(),
        clubId: targetClub.id,
        staffDiscordUserId: playerId,
        staffType: targetType,
        staffIsBot: false,
      });
      const sendOffer = vi.fn(() =>
        Promise.resolve({
          channelId: '910000000000000010',
          messageId: '940000000000000010',
        }),
      );
      const adapter: OfferMessageAdapter = {
        sendOffer,
        setTerminalState: vi.fn(() => Promise.resolve()),
        cleanupOrphan: vi.fn(() => Promise.resolve()),
      };
      const beforeAuditCount = await database.client.auditEvent.count();
      const beforeTransactionCount = await database.client.leagueTransaction.count();

      const failure = new OfferDeliveryService(
        database.client,
        adapter,
        new MemoryLogger(),
      ).createAndDeliver({
        authorization: authorization(outsiderId),
        destinationClubId: source.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      });

      await expect(failure).rejects.toBeInstanceOf(MemberAlreadySignedError);
      expect(sendOffer).not.toHaveBeenCalled();
      await expect(database.client.offer.count()).resolves.toBe(0);
      await expect(database.client.auditEvent.count()).resolves.toBe(beforeAuditCount);
      await expect(database.client.leagueTransaction.count()).resolves.toBe(beforeTransactionCount);
    },
  );

  it('keeps removed former staff rostered and unable to receive an offer', async () => {
    const source = await createClub('930000000000000010', 5, '⚽');
    const formerTeam = await createClub('930000000000000011', 5, '🔵');
    const staff = new StaffManagementService(database.client);
    await staff.appoint({
      authorization: authorization(),
      clubId: source.id,
      staffDiscordUserId: outsiderId,
      staffType: 'TEAM_MANAGER',
      staffIsBot: false,
    });
    await staff.appoint({
      authorization: authorization(),
      clubId: formerTeam.id,
      staffDiscordUserId: playerId,
      staffType: 'PLAYER_MANAGER',
      staffIsBot: false,
    });
    await staff.remove(authorization(), formerTeam.id, 'PLAYER_MANAGER');
    const sendOffer = vi.fn(() =>
      Promise.resolve({
        channelId: '910000000000000010',
        messageId: '940000000000000010',
      }),
    );
    const adapter: OfferMessageAdapter = {
      sendOffer,
      setTerminalState: vi.fn(() => Promise.resolve()),
      cleanupOrphan: vi.fn(() => Promise.resolve()),
    };

    await expect(
      new OfferDeliveryService(database.client, adapter, new MemoryLogger()).createAndDeliver({
        authorization: authorization(outsiderId),
        destinationClubId: source.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(MemberAlreadySignedError);
    expect(sendOffer).not.toHaveBeenCalled();
    await expect(database.client.offer.count({ where: { status: 'PENDING' } })).resolves.toBe(0);
  });

  it('declines atomically without membership or league transaction writes', async () => {
    const destination = await createClub();
    const result = await new OfferCreationService(database.client).createOffer({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    const service = new OfferDeclineService(database.client);
    await expect(
      service.declineOffer({ offerId: result.offer.id, decliningDiscordUserId: outsiderId }),
    ).rejects.toBeInstanceOf(UnauthorizedOfferAcceptanceError);
    await expect(
      service.declineOffer({ offerId: result.offer.id, decliningDiscordUserId: playerId }),
    ).resolves.toMatchObject({ status: 'DECLINED' });
    await expect(database.client.clubMembership.count()).resolves.toBe(0);
    await expect(database.client.leagueTransaction.count()).resolves.toBe(0);
  });

  it('expires stale declines and permits exactly one concurrent terminal response', async () => {
    const destination = await createClub();
    const creation = new OfferCreationService(database.client);
    const stale = await creation.createOffer({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const decline = new OfferDeclineService(database.client);
    await expect(
      decline.declineOffer({
        offerId: stale.offer.id,
        decliningDiscordUserId: playerId,
        declinedAt: new Date(stale.offer.expiresAt.getTime() + 1),
      }),
    ).rejects.toMatchObject({ name: 'OfferExpiredError' });
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: stale.offer.id } }),
    ).resolves.toMatchObject({ status: 'EXPIRED' });

    const concurrent = await creation.createOffer({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: outsiderId,
      playerIsBot: false,
    });
    const results = await Promise.allSettled([
      decline.declineOffer({ offerId: concurrent.offer.id, decliningDiscordUserId: outsiderId }),
      decline.declineOffer({ offerId: concurrent.offer.id, decliningDiscordUserId: outsiderId }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  });

  it('saves offer message references after delivery', async () => {
    const destination = await createClub();
    const adapter: OfferMessageAdapter = {
      sendOffer: vi.fn(() =>
        Promise.resolve({ channelId: '910000000000000001', messageId: '940000000000000001' }),
      ),
      setTerminalState: vi.fn(() => Promise.resolve()),
      cleanupOrphan: vi.fn(() => Promise.resolve()),
    };
    const result = await new OfferDeliveryService(
      database.client,
      adapter,
      new MemoryLogger(),
    ).createAndDeliver({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    expect(result.offer).toMatchObject({
      discordChannelId: '910000000000000001',
      discordMessageId: '940000000000000001',
    });
  });

  it('accepts only from the saved offer channel and message', async () => {
    const destination = await createClub();
    const delivered = await createDeliveredOffer(destination);
    await expect(
      new OfferResponseService(database.client).acceptOffer({
        offerId: delivered.offer.id,
        respondingDiscordUserId: playerId,
        discordChannelId: delivered.offer.discordChannelId ?? '',
        discordMessageId: delivered.offer.discordMessageId ?? '',
      }),
    ).resolves.toMatchObject({ offer: { status: 'ACCEPTED' } });
    await expect(database.client.clubMembership.count()).resolves.toBe(1);
    await expect(database.client.leagueTransaction.count()).resolves.toBe(1);
  });

  it('declines only from the saved offer channel and message', async () => {
    const destination = await createClub();
    const delivered = await createDeliveredOffer(destination);
    await expect(
      new OfferResponseService(database.client).declineOffer({
        offerId: delivered.offer.id,
        respondingDiscordUserId: playerId,
        discordChannelId: delivered.offer.discordChannelId ?? '',
        discordMessageId: delivered.offer.discordMessageId ?? '',
      }),
    ).resolves.toMatchObject({ status: 'DECLINED' });
    await expect(database.client.clubMembership.count()).resolves.toBe(0);
    await expect(database.client.leagueTransaction.count()).resolves.toBe(0);
  });

  it.each([
    {
      name: 'wrong channel',
      channelId: '910000000000000099',
      messageId: '940000000000000001',
    },
    {
      name: 'wrong message',
      channelId: '910000000000000001',
      messageId: '940000000000000099',
    },
    {
      name: 'copied valid custom id on another message',
      channelId: '910000000000000099',
      messageId: '940000000000000099',
    },
  ])('rejects $name without changing offer or roster state', async ({ channelId, messageId }) => {
    const destination = await createClub();
    const delivered = await createDeliveredOffer(destination);
    await expect(
      new OfferResponseService(database.client).acceptOffer({
        offerId: delivered.offer.id,
        respondingDiscordUserId: playerId,
        discordChannelId: channelId,
        discordMessageId: messageId,
      }),
    ).rejects.toBeInstanceOf(InvalidOfferMessageError);
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: delivered.offer.id } }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await expect(database.client.clubMembership.count()).resolves.toBe(0);
    await expect(database.client.leagueTransaction.count()).resolves.toBe(0);
  });

  it('rejects offers with no stored Discord message reference', async () => {
    const destination = await createClub();
    const created = await new OfferCreationService(database.client).createOffer({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    await expect(
      new OfferResponseService(database.client).declineOffer({
        offerId: created.offer.id,
        respondingDiscordUserId: playerId,
        discordChannelId: '910000000000000001',
        discordMessageId: '940000000000000001',
      }),
    ).rejects.toBeInstanceOf(InvalidOfferMessageError);
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: created.offer.id } }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('voids and audits exactly once when the player cannot be DMed', async () => {
    const destination = await createClub();
    const sendOffer = vi.fn(() => Promise.reject(new Error('cannot message this user')));
    const adapter: OfferMessageAdapter = {
      sendOffer,
      setTerminalState: vi.fn(() => Promise.resolve()),
      cleanupOrphan: vi.fn(() => Promise.resolve()),
    };
    await expect(
      new OfferDeliveryService(database.client, adapter, new MemoryLogger()).createAndDeliver({
        authorization: authorization(),
        destinationClubId: destination.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(OfferDeliveryError);
    expect(sendOffer).toHaveBeenCalledOnce();
    await expect(database.client.offer.findFirstOrThrow()).resolves.toMatchObject({
      status: 'VOIDED',
    });
    await expect(
      database.client.auditEvent.count({ where: { eventType: offerDeliveryFailedAuditEventType } }),
    ).resolves.toBe(1);
  });

  it('rolls back voiding when the delivery failure audit cannot be created', async () => {
    const destination = await createClub();
    await database.client.$executeRawUnsafe(`
      CREATE TRIGGER fail_delivery_audit
      BEFORE INSERT ON AuditEvent
      WHEN NEW.eventType = '${offerDeliveryFailedAuditEventType}'
      BEGIN
        SELECT RAISE(ABORT, 'delivery audit failure');
      END
    `);
    const adapter: OfferMessageAdapter = {
      sendOffer: vi.fn(() => Promise.reject(new Error('discord unavailable'))),
      setTerminalState: vi.fn(() => Promise.resolve()),
      cleanupOrphan: vi.fn(() => Promise.resolve()),
    };
    try {
      const error = await new OfferDeliveryService(database.client, adapter, new MemoryLogger())
        .createAndDeliver({
          authorization: authorization(),
          destinationClubId: destination.id,
          playerDiscordUserId: playerId,
          playerIsBot: false,
        })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(OfferDeliveryError);
      expect((error as OfferDeliveryError).message).toContain('recovery');
      expect((error as OfferDeliveryError).cause).toBeInstanceOf(AggregateError);
      await expect(database.client.offer.findFirstOrThrow()).resolves.toMatchObject({
        status: 'PENDING',
      });
      await expect(
        database.client.auditEvent.count({
          where: { eventType: offerDeliveryFailedAuditEventType },
        }),
      ).resolves.toBe(0);
    } finally {
      await database.client.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_delivery_audit');
    }
  });

  it('cleans up an orphan and voids when message reference validation fails', async () => {
    const destination = await createClub();
    const cleanup = vi.fn(() => Promise.resolve());
    const adapter: OfferMessageAdapter = {
      sendOffer: vi.fn(() => Promise.resolve({ channelId: 'invalid', messageId: 'invalid' })),
      setTerminalState: vi.fn(() => Promise.resolve()),
      cleanupOrphan: cleanup,
    };
    await expect(
      new OfferDeliveryService(database.client, adapter, new MemoryLogger()).createAndDeliver({
        authorization: authorization(),
        destinationClubId: destination.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(OfferDeliveryError);
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(database.client.offer.findFirstOrThrow()).resolves.toMatchObject({
      status: 'VOIDED',
    });
  });

  it('reports orphan cleanup failures while retaining transactional void recovery', async () => {
    const destination = await createClub();
    const logger = new MemoryLogger();
    const adapter: OfferMessageAdapter = {
      sendOffer: vi.fn(() => Promise.resolve({ channelId: 'invalid', messageId: 'invalid' })),
      setTerminalState: vi.fn(() => Promise.resolve()),
      cleanupOrphan: vi.fn(() => Promise.reject(new Error('cleanup failed'))),
    };
    const error = await new OfferDeliveryService(database.client, adapter, logger)
      .createAndDeliver({
        authorization: authorization(),
        destinationClubId: destination.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OfferDeliveryError);
    expect((error as OfferDeliveryError).message).toContain('orphan Discord message');
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: 'error', message: 'offer orphan cleanup failed' }),
    );
    await expect(database.client.offer.findFirstOrThrow()).resolves.toMatchObject({
      status: 'VOIDED',
    });
    await expect(
      database.client.auditEvent.count({ where: { eventType: offerDeliveryFailedAuditEventType } }),
    ).resolves.toBe(1);
  });
});
