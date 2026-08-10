import type { Club, GuildSettings, Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AlreadyMemberOfClubError,
  AuthorizationError,
  BotUserNotAllowedError,
  ConfigurationError,
  ConflictError,
  DomainError,
  DuplicateOfferError,
  GuildChannelCollisionError,
  InvalidOfferMessageError,
  MemberAlreadySignedError,
  OfferDeliveryError,
  SquadFullError,
  UnauthorizedOfferAcceptanceError,
} from '../../src/domain/errors.js';
import type { MembershipType } from '../../src/domain/enums.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { MembershipRepository } from '../../src/repositories/membership-repository.js';
import { OfferRepository } from '../../src/repositories/offer-repository.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { AuthorizationService } from '../../src/services/authorization-service.js';
import {
  clubCreatedAuditEventType,
  clubEditedAuditEventType,
  ClubManagementService,
} from '../../src/services/club-management-service.js';
import {
  guildConfiguredAuditEventType,
  GuildSetupService,
  type SetupChannelsInput,
  type SetupRolesInput,
} from '../../src/services/guild-setup-service.js';
import {
  offerCreatedAuditEventType,
  OfferCreationService,
} from '../../src/services/offer-creation-service.js';
import {
  offerDeclinedAuditEventType,
  offerExpiredAuditEventType,
  OfferDeclineService,
} from '../../src/services/offer-decline-service.js';
import { OfferExpirationService } from '../../src/services/offer-expiration-service.js';
import { OfferExpirationScheduler } from '../../src/services/offer-expiration-scheduler.js';
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
type StaffMembershipType = Exclude<MembershipType, 'PLAYER'>;

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
    const setTerminalState = vi.fn(() => Promise.resolve());
    const adapter: OfferMessageAdapter = {
      sendOffer: vi.fn(() =>
        Promise.resolve({
          channelId: '910000000000000001',
          messageId: '940000000000000001',
        }),
      ),
      setTerminalState,
      cleanupOrphan: vi.fn(() => Promise.resolve()),
    };
    return new OfferDeliveryService(database.client, adapter, new MemoryLogger()).createAndDeliver({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: offeredPlayerDiscordId,
      playerIsBot: false,
    });
  }

  function setupRoles(
    overrides: Partial<Omit<SetupRolesInput, 'authorization' | 'guildName'>> = {},
  ) {
    return new GuildSetupService(database.client).setupRoles({
      authorization: authorization(ownerId),
      guildName: 'Renamed League',
      botPermissionsRoleId: '920000000000000001',
      teamManagerRoleId: '920000000000000002',
      assistantManagerRoleId: '920000000000000003',
      playerManagerRoleId: '920000000000000004',
      ...overrides,
    });
  }

  function setupChannels(
    overrides: Partial<Omit<SetupChannelsInput, 'authorization' | 'guildName'>> = {},
  ) {
    return new GuildSetupService(database.client).setupChannels({
      authorization: authorization(ownerId),
      guildName: 'Development League',
      botCommandsChannelId: '910000000000000020',
      staffChannelId: '910000000000000021',
      transferChannelId: '910000000000000022',
      auditChannelId: '910000000000000023',
      caseFilesChannelId: '910000000000000024',
      ...overrides,
    });
  }

  async function seedActiveMemberships(...membershipTypes: MembershipType[]): Promise<Club> {
    const club = await createClub();
    const memberships = new MembershipRepository(database.client);
    const users = new UserRepository(database.client);
    for (const [index, membershipType] of membershipTypes.entries()) {
      const user = await users.getOrCreateByDiscordUserId(`95000000000000000${index + 1}`);
      await memberships.createActive({
        guildId: settings.guildId,
        clubId: club.id,
        userId: user.id,
        membershipType,
      });
    }
    return club;
  }

  async function seedActiveStaffMemberships(...staffTypes: StaffMembershipType[]): Promise<void> {
    await seedActiveMemberships(...staffTypes);
  }

  function replacementFor(
    staffType: StaffMembershipType,
    roleId: string,
  ): Partial<Omit<SetupRolesInput, 'authorization' | 'guildName'>> {
    switch (staffType) {
      case 'TEAM_MANAGER':
        return { teamManagerRoleId: roleId };
      case 'ASSISTANT_MANAGER':
        return { assistantManagerRoleId: roleId };
      case 'PLAYER_MANAGER':
        return { playerManagerRoleId: roleId };
    }
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

  it.each([
    ['TM and ATM', '930000000000000001', '930000000000000001', '930000000000000002'],
    ['TM and PM', '930000000000000001', '930000000000000002', '930000000000000001'],
    ['ATM and PM', '930000000000000001', '930000000000000002', '930000000000000002'],
    ['all three', '930000000000000001', '930000000000000001', '930000000000000001'],
  ] as const)('rejects a management role collision between %s', async (_, tm, atm, pm) => {
    await expect(
      new GuildSetupService(database.client).setupRoles({
        authorization: authorization(ownerId),
        guildName: 'Renamed League',
        botPermissionsRoleId: '920000000000000010',
        teamManagerRoleId: tm,
        assistantManagerRoleId: atm,
        playerManagerRoleId: pm,
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('does not partially overwrite existing role settings after rejecting a collision', async () => {
    const beforeSettings = await database.client.guildSettings.findUniqueOrThrow({
      where: { guildId: settings.guildId },
    });
    const beforeGuild = await database.client.guild.findUniqueOrThrow({
      where: { id: settings.guildId },
    });

    await expect(
      new GuildSetupService(database.client).setupRoles({
        authorization: authorization(ownerId),
        guildName: 'Renamed League',
        botPermissionsRoleId: '920000000000000010',
        teamManagerRoleId: '930000000000000001',
        assistantManagerRoleId: '930000000000000001',
        playerManagerRoleId: '930000000000000002',
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);

    await expect(
      database.client.guildSettings.findUniqueOrThrow({ where: { guildId: settings.guildId } }),
    ).resolves.toEqual(beforeSettings);
    await expect(
      database.client.guild.findUniqueOrThrow({ where: { id: settings.guildId } }),
    ).resolves.toEqual(beforeGuild);
  });

  it.each([
    ['TEAM_MANAGER', 'teamManagerRoleId', 'Team Manager', '920000000000000012'],
    ['ASSISTANT_MANAGER', 'assistantManagerRoleId', 'Assistant Team Manager', '920000000000000013'],
    ['PLAYER_MANAGER', 'playerManagerRoleId', 'Player Manager', '920000000000000014'],
  ] as const)(
    'rejects replacing an in-use %s role without changing settings or auditing success',
    async (staffType, roleSetting, positionName, replacementRoleId) => {
      await seedActiveStaffMemberships(staffType);

      await expect(setupRoles(replacementFor(staffType, replacementRoleId))).rejects.toThrow(
        `${positionName} role cannot be replaced`,
      );

      const persisted = await database.client.guildSettings.findUniqueOrThrow({
        where: { guildId: settings.guildId },
      });
      expect(persisted[roleSetting]).toBe(settings[roleSetting]);
      await expect(
        database.client.auditEvent.count({ where: { eventType: 'guild.roles_configured' } }),
      ).resolves.toBe(0);
    },
  );

  it.each([
    ['TEAM_MANAGER', 'teamManagerRoleId', '920000000000000012'],
    ['ASSISTANT_MANAGER', 'assistantManagerRoleId', '920000000000000013'],
    ['PLAYER_MANAGER', 'playerManagerRoleId', '920000000000000014'],
  ] as const)('allows replacing a %s role with no active membership', async (staffType, roleSetting, roleId) => {
    await expect(setupRoles(replacementFor(staffType, roleId))).resolves.toMatchObject({
      settings: { [roleSetting]: roleId },
    });
  });

  it('allows initial role configuration despite historical active staff memberships', async () => {
    await clearDatabase(database.client);
    const setupService = new GuildSetupService(database.client);
    const initial = await setupService.setupGuildOnly({
      authorization: authorization(administratorId),
      guildName: 'Development League',
    });
    await grantBotPermission(database.client, guildId, ownerId);
    const club = await database.client.club.create({
      data: {
        guildId: initial.guild.id,
        discordRoleId: '930000000000000001',
        emoji: 'ðŸ¦',
      },
    });
    const user = await new UserRepository(database.client).getOrCreateByDiscordUserId(outsiderId);
    await new MembershipRepository(database.client).createActive({
      guildId: initial.guild.id,
      clubId: club.id,
      userId: user.id,
      membershipType: 'TEAM_MANAGER',
    });

    await expect(setupRoles()).resolves.toMatchObject({
      settings: { teamManagerRoleId: '920000000000000002' },
    });
  });

  it.each(['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] as const)(
    'allows unchanged %s role configuration while that position is active',
    async (staffType) => {
      await seedActiveStaffMemberships(staffType);
      await expect(setupRoles()).resolves.toMatchObject({
        settings: {
          teamManagerRoleId: settings.teamManagerRoleId,
          assistantManagerRoleId: settings.assistantManagerRoleId,
          playerManagerRoleId: settings.playerManagerRoleId,
        },
      });
    },
  );

  it.each([
    ['TEAM_MANAGER', ['ASSISTANT_MANAGER', 'PLAYER_MANAGER'], '920000000000000012'],
    ['ASSISTANT_MANAGER', ['TEAM_MANAGER', 'PLAYER_MANAGER'], '920000000000000013'],
    ['PLAYER_MANAGER', ['TEAM_MANAGER', 'ASSISTANT_MANAGER'], '920000000000000014'],
  ] as const)(
    'allows replacing %s while only other management positions are active',
    async (changedStaffType, activeStaffTypes, replacementRoleId) => {
      await seedActiveStaffMemberships(...activeStaffTypes);
      await expect(
        setupRoles(replacementFor(changedStaffType, replacementRoleId)),
      ).resolves.toMatchObject({ settings: replacementFor(changedStaffType, replacementRoleId) });
    },
  );

  it('keeps all proposed role and guild metadata changes atomic when one replacement is in use', async () => {
    await seedActiveStaffMemberships('PLAYER_MANAGER');
    const beforeSettings = await database.client.guildSettings.findUniqueOrThrow({
      where: { guildId: settings.guildId },
    });
    const beforeGuild = await database.client.guild.findUniqueOrThrow({
      where: { id: settings.guildId },
    });

    await expect(
      setupRoles({
        botPermissionsRoleId: '920000000000000010',
        teamManagerRoleId: '920000000000000012',
        assistantManagerRoleId: '920000000000000013',
        playerManagerRoleId: '920000000000000014',
      }),
    ).rejects.toThrow('Player Manager role cannot be replaced');

    await expect(
      database.client.guildSettings.findUniqueOrThrow({ where: { guildId: settings.guildId } }),
    ).resolves.toEqual(beforeSettings);
    await expect(
      database.client.guild.findUniqueOrThrow({ where: { id: settings.guildId } }),
    ).resolves.toEqual(beforeGuild);
    await expect(
      database.client.auditEvent.count({ where: { eventType: 'guild.roles_configured' } }),
    ).resolves.toBe(0);
  });

  it.each([
    ['TM', '930000000000000010', '930000000000000011', '930000000000000012'],
    ['ATM', '930000000000000011', '930000000000000010', '930000000000000012'],
    ['PM', '930000000000000011', '930000000000000012', '930000000000000010'],
  ] as const)(
    'rejects a %s management role that collides with an active team without changing settings or auditing success',
    async (_, tm, atm, pm) => {
      await createClub('930000000000000010');
      const beforeSettings = await database.client.guildSettings.findUniqueOrThrow({
        where: { guildId: settings.guildId },
      });
      const beforeGuild = await database.client.guild.findUniqueOrThrow({
        where: { id: settings.guildId },
      });

      await expect(
        new GuildSetupService(database.client).setupRoles({
          authorization: authorization(ownerId),
          guildName: 'Renamed League',
          botPermissionsRoleId: '920000000000000010',
          teamManagerRoleId: tm,
          assistantManagerRoleId: atm,
          playerManagerRoleId: pm,
        }),
      ).rejects.toBeInstanceOf(ConfigurationError);

      await expect(
        database.client.guildSettings.findUniqueOrThrow({ where: { guildId: settings.guildId } }),
      ).resolves.toEqual(beforeSettings);
      await expect(
        database.client.guild.findUniqueOrThrow({ where: { id: settings.guildId } }),
      ).resolves.toEqual(beforeGuild);
      await expect(
        database.client.auditEvent.count({ where: { eventType: 'guild.roles_configured' } }),
      ).resolves.toBe(0);
    },
  );

  it('allows a management role to reuse an inactive team role', async () => {
    const club = await createClub('930000000000000010');
    await new ClubManagementService(database.client).deactivate(authorization(), club.id);

    await expect(
      new GuildSetupService(database.client).setupRoles({
        authorization: authorization(ownerId),
        guildName: 'Renamed League',
        botPermissionsRoleId: '920000000000000010',
        teamManagerRoleId: '930000000000000010',
        assistantManagerRoleId: '930000000000000011',
        playerManagerRoleId: '930000000000000012',
      }),
    ).resolves.toMatchObject({
      settings: { teamManagerRoleId: '930000000000000010' },
    });
  });

  it('persists three distinct management role IDs', async () => {
    await createClub('930000000000000010');
    const result = await new GuildSetupService(database.client).setupRoles({
      authorization: authorization(ownerId),
      guildName: 'Renamed League',
      botPermissionsRoleId: '920000000000000010',
      teamManagerRoleId: '930000000000000001',
      assistantManagerRoleId: '930000000000000002',
      playerManagerRoleId: '930000000000000003',
    });

    expect(result.settings).toMatchObject({
      botPermissionsRoleId: '920000000000000010',
      teamManagerRoleId: '930000000000000001',
      assistantManagerRoleId: '930000000000000002',
      playerManagerRoleId: '930000000000000003',
    });
  });

  it('preserves authorization behavior before validating management role IDs', async () => {
    await expect(
      new GuildSetupService(database.client).setupRoles({
        authorization: authorization(outsiderId),
        guildName: 'No Access',
        botPermissionsRoleId: '920000000000000010',
        teamManagerRoleId: '930000000000000001',
        assistantManagerRoleId: '930000000000000001',
        playerManagerRoleId: '930000000000000002',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('persists and presents the Case Files channel through the existing channels setup flow', async () => {
    const result = await setupChannels();
    expect(result.settings.caseFilesChannelId).toBe('910000000000000024');
    await expect(
      database.client.guildSettings.findUnique({ where: { guildId: result.guild.id } }),
    ).resolves.toMatchObject({ caseFilesChannelId: '910000000000000024' });
    const view = await new GuildSetupService(database.client).getView(guildId);
    expect(view.channels.caseFilesChannelId).toBe('910000000000000024');
    expect(view.missingConfigurations).not.toContain('Case Files Channel');
  });

  it.each([
    ['Bot Commands', { auditChannelId: '910000000000000020' }],
    ['Bot Commands', { caseFilesChannelId: '910000000000000020' }],
    ['Staff Commands', { transferChannelId: '910000000000000021' }],
    ['Staff Commands', { auditChannelId: '910000000000000021' }],
    ['Staff Commands', { caseFilesChannelId: '910000000000000021' }],
    ['Transfer Market', { auditChannelId: '910000000000000022' }],
    ['Transfer Market', { caseFilesChannelId: '910000000000000022' }],
  ] as const)('rejects the incompatible %s channel collision atomically', async (_, collision) => {
    const beforeSettings = await database.client.guildSettings.findUniqueOrThrow({
      where: { guildId: settings.guildId },
    });
    const beforeGuild = await database.client.guild.findUniqueOrThrow({
      where: { id: settings.guildId },
    });

    await expect(setupChannels(collision)).rejects.toBeInstanceOf(GuildChannelCollisionError);

    await expect(
      database.client.guildSettings.findUniqueOrThrow({ where: { guildId: settings.guildId } }),
    ).resolves.toEqual(beforeSettings);
    await expect(
      database.client.guild.findUniqueOrThrow({ where: { id: settings.guildId } }),
    ).resolves.toEqual(beforeGuild);
    await expect(
      database.client.auditEvent.count({ where: { eventType: 'guild.channels_configured' } }),
    ).resolves.toBe(0);
  });

  it.each([
    ['Bot Commands + Staff Commands', { staffChannelId: '910000000000000020' }],
    ['Bot Commands + Transfer Market', { transferChannelId: '910000000000000020' }],
    ['Audit + Case Files', { caseFilesChannelId: '910000000000000023' }],
  ] as const)('allows the intentionally compatible %s channel sharing', async (_, shared) => {
    await expect(setupChannels(shared)).resolves.toMatchObject({ settings: shared });
  });

  it('rejects a partial replacement that collides with an unchanged channel', async () => {
    const beforeSettings = await database.client.guildSettings.findUniqueOrThrow({
      where: { guildId: settings.guildId },
    });
    const beforeGuild = await database.client.guild.findUniqueOrThrow({
      where: { id: settings.guildId },
    });

    await expect(
      new GuildSetupService(database.client).setup({
        authorization: authorization(ownerId),
        guildName: 'Renamed League',
        transferChannelId: '910000000000000030',
        auditChannelId: '910000000000000030',
        botPermissionsRoleId: '920000000000000010',
      }),
    ).rejects.toBeInstanceOf(GuildChannelCollisionError);

    await expect(
      database.client.guildSettings.findUniqueOrThrow({ where: { guildId: settings.guildId } }),
    ).resolves.toEqual(beforeSettings);
    await expect(
      database.client.guild.findUniqueOrThrow({ where: { id: settings.guildId } }),
    ).resolves.toEqual(beforeGuild);
    await expect(
      database.client.auditEvent.count({ where: { eventType: guildConfiguredAuditEventType } }),
    ).resolves.toBe(2);
  });

  it('uses the same collision policy for initial channel setup', async () => {
    await clearDatabase(database.client);

    await expect(
      new GuildSetupService(database.client).setupChannels({
        authorization: authorization(administratorId),
        guildName: 'Development League',
        botCommandsChannelId: '910000000000000020',
        staffChannelId: '910000000000000021',
        transferChannelId: '910000000000000020',
        auditChannelId: '910000000000000020',
        caseFilesChannelId: '910000000000000024',
      }),
    ).rejects.toBeInstanceOf(GuildChannelCollisionError);

    await expect(database.client.guild.count()).resolves.toBe(0);
    await expect(database.client.guildSettings.count()).resolves.toBe(0);
    await expect(database.client.auditEvent.count()).resolves.toBe(0);
  });

  it('allows unchanged valid channel values to be submitted again', async () => {
    await expect(setupChannels()).resolves.toMatchObject({
      settings: {
        botCommandsChannelId: '910000000000000020',
        staffChannelId: '910000000000000021',
        transferChannelId: '910000000000000022',
        auditChannelId: '910000000000000023',
        caseFilesChannelId: '910000000000000024',
      },
    });
    await expect(setupChannels()).resolves.toMatchObject({
      settings: {
        botCommandsChannelId: '910000000000000020',
        staffChannelId: '910000000000000021',
        transferChannelId: '910000000000000022',
        auditChannelId: '910000000000000023',
        caseFilesChannelId: '910000000000000024',
      },
    });
  });

  it('does not validate historical channel collisions on unrelated league setup updates', async () => {
    await database.client.guildSettings.update({
      where: { guildId: settings.guildId },
      data: { auditChannelId: settings.transferChannelId },
    });

    await expect(
      new GuildSetupService(database.client).setupGuildOnly({
        authorization: authorization(ownerId),
        guildName: 'Renamed League',
        offerTimeoutSeconds: 7200,
      }),
    ).resolves.toMatchObject({ settings: { offerTimeoutSeconds: 7200 } });
  });

  it('creates teams and rejects a duplicate Discord role', async () => {
    const club = await createClub();
    expect(club).toMatchObject({ discordRoleId: '930000000000000001', emoji: '🦁' });
    await expect(createClub('930000000000000001')).rejects.toBeInstanceOf(ConflictError);
    await expect(
      database.client.auditEvent.count({ where: { eventType: clubCreatedAuditEventType } }),
    ).resolves.toBe(1);
  });

  it.each([
    ['TM', '920000000000000002'],
    ['ATM', '920000000000000003'],
    ['PM', '920000000000000004'],
  ] as const)(
    'rejects a new team role that collides with configured %s without creating or auditing the team',
    async (_, roleId) => {
      await expect(createClub(roleId)).rejects.toBeInstanceOf(ConfigurationError);
      await expect(database.client.club.count()).resolves.toBe(0);
      await expect(
        database.client.auditEvent.count({ where: { eventType: clubCreatedAuditEventType } }),
      ).resolves.toBe(0);
    },
  );

  it.each([
    ['TM', '920000000000000002'],
    ['ATM', '920000000000000003'],
    ['PM', '920000000000000004'],
  ] as const)(
    'rejects changing a team role to configured %s without changing or auditing the team',
    async (_, roleId) => {
      const club = await createClub();

      await expect(
        new ClubManagementService(database.client).edit({
          authorization: authorization(),
          clubId: club.id,
          discordRoleId: roleId,
        }),
      ).rejects.toBeInstanceOf(ConfigurationError);

      await expect(database.client.club.findUniqueOrThrow({ where: { id: club.id } })).resolves.toEqual(
        club,
      );
      await expect(
        database.client.auditEvent.count({ where: { eventType: clubEditedAuditEventType } }),
      ).resolves.toBe(0);
    },
  );

  it('allows an emoji-only edit for a legacy management-role collision', async () => {
    const legacyClub = await database.client.club.create({
      data: {
        guildId: settings.guildId,
        discordRoleId: settings.teamManagerRoleId ?? '',
        emoji: '🦁',
      },
    });

    await expect(
      new ClubManagementService(database.client).edit({
        authorization: authorization(),
        clubId: legacyClub.id,
        emoji: '🐯',
      }),
    ).resolves.toMatchObject({
      discordRoleId: legacyClub.discordRoleId,
      emoji: '🐯',
    });
  });

  it('allows a non-colliding team role change with no active memberships', async () => {
    const club = await createClub();

    await expect(
      new ClubManagementService(database.client).edit({
        authorization: authorization(),
        clubId: club.id,
        discordRoleId: '930000000000000002',
      }),
    ).resolves.toMatchObject({ discordRoleId: '930000000000000002' });
    await expect(
      database.client.auditEvent.count({ where: { eventType: clubEditedAuditEventType } }),
    ).resolves.toBe(1);
  });

  it.each(['PLAYER', 'TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] as const)(
    'rejects replacing a team role with an active %s membership without changing or auditing the team',
    async (membershipType) => {
      const club = await seedActiveMemberships(membershipType);

      await expect(
        new ClubManagementService(database.client).edit({
          authorization: authorization(),
          clubId: club.id,
          discordRoleId: '930000000000000002',
          emoji: 'ðŸ¯',
        }),
      ).rejects.toThrow('team Discord role cannot be changed while active memberships exist');

      await expect(database.client.club.findUniqueOrThrow({ where: { id: club.id } })).resolves.toEqual(
        club,
      );
      await expect(
        database.client.auditEvent.count({ where: { eventType: clubEditedAuditEventType } }),
      ).resolves.toBe(0);
    },
  );

  it('rejects replacing a team role with mixed active memberships', async () => {
    const club = await seedActiveMemberships(
      'PLAYER',
      'TEAM_MANAGER',
      'ASSISTANT_MANAGER',
      'PLAYER_MANAGER',
    );

    await expect(
      new ClubManagementService(database.client).edit({
        authorization: authorization(),
        clubId: club.id,
        discordRoleId: '930000000000000002',
      }),
    ).rejects.toThrow('team Discord role cannot be changed while active memberships exist');

    await expect(database.client.club.findUniqueOrThrow({ where: { id: club.id } })).resolves.toEqual(
      club,
    );
  });

  it('allows an emoji edit and an explicitly unchanged team role with active memberships', async () => {
    const club = await seedActiveMemberships('PLAYER');

    await expect(
      new ClubManagementService(database.client).edit({
        authorization: authorization(),
        clubId: club.id,
        emoji: 'ðŸ¯',
      }),
    ).resolves.toMatchObject({ discordRoleId: club.discordRoleId, emoji: 'ðŸ¯' });

    await expect(
      new ClubManagementService(database.client).edit({
        authorization: authorization(),
        clubId: club.id,
        discordRoleId: club.discordRoleId,
      }),
    ).resolves.toMatchObject({ discordRoleId: club.discordRoleId, emoji: 'ðŸ¯' });
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

  it('preserves exact configured offer expiry arithmetic', async () => {
    const destination = await createClub();
    const createdAt = new Date('2030-08-10T12:00:00.000Z');
    const offer = await new OfferCreationService(database.client, () => createdAt).createOffer({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });

    expect(offer.offer.expiresAt).toEqual(
      new Date(createdAt.getTime() + settings.offerTimeoutSeconds * 1000),
    );
  });

  it.each([
    ['before the workflow time', 1],
    ['exactly at the workflow time', 0],
  ] as const)(
    'self-heals a pending offer expiring %s and preserves both audit lifecycles',
    async (_label, elapsedMilliseconds) => {
      const destination = await createClub();
      const initial = await new OfferCreationService(database.client).createOffer({
        authorization: authorization(),
        destinationClubId: destination.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const now = new Date(initial.offer.expiresAt.getTime() + elapsedMilliseconds);

      const replacement = await new OfferCreationService(database.client, () => now).createOffer({
        authorization: authorization(),
        destinationClubId: destination.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      });

      await expect(
        database.client.offer.findUniqueOrThrow({ where: { id: initial.offer.id } }),
      ).resolves.toMatchObject({
        id: initial.offer.id,
        status: 'EXPIRED',
        respondedAt: now,
      });
      await expect(
        database.client.offer.findUniqueOrThrow({ where: { id: replacement.offer.id } }),
      ).resolves.toMatchObject({
        status: 'PENDING',
        respondedAt: null,
      });
      await expect(
        database.client.offer.findMany({
          where: { clubId: destination.id, playerUserId: initial.player.id },
          orderBy: { createdAt: 'asc' },
        }),
      ).resolves.toMatchObject([
        { id: initial.offer.id, status: 'EXPIRED' },
        { id: replacement.offer.id, status: 'PENDING' },
      ]);

      const expirationAudits = await database.client.auditEvent.findMany({
        where: { eventType: offerExpiredAuditEventType, entityId: initial.offer.id },
      });
      expect(expirationAudits).toHaveLength(1);
      expect(expirationAudits[0]).toMatchObject({
        actorUserId: null,
        beforeState: { status: 'PENDING' },
        afterState: { status: 'EXPIRED' },
      });
      const replacementCreationAudit = await database.client.auditEvent.findFirstOrThrow({
        where: { eventType: offerCreatedAuditEventType, entityId: replacement.offer.id },
      });
      expect(replacementCreationAudit.actorUserId).toBe(replacement.offeredBy.id);
      expect(replacement.offeredBy.discordUserId).toBe(ownerId);
      expect(replacement.expiredAuditAnnouncement).toMatchObject({
        operation: 'OFFER_EXPIRED',
        occurredAt: now,
        playerDiscordUserId: playerId,
      });
      expect(replacement.expiredAuditAnnouncement).not.toHaveProperty('actorDiscordUserId');
    },
  );

  it.each(['ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'VOIDED'] as const)(
    'does not let a historical %s offer block a new pending offer',
    async (status) => {
      const destination = await createClub();
      const initial = await new OfferCreationService(database.client).createOffer({
        authorization: authorization(),
        destinationClubId: destination.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      });
      await new OfferRepository(database.client).transition(initial.offer.id, status);

      await expect(
        new OfferCreationService(database.client).createOffer({
          authorization: authorization(),
          destinationClubId: destination.id,
          playerDiscordUserId: playerId,
          playerIsBot: false,
        }),
      ).resolves.toMatchObject({ offer: { status: 'PENDING' } });
    },
  );

  it('allows a different team to retain its own active offer for the same player', async () => {
    const firstDestination = await createClub();
    const secondDestination = await createClub('930000000000000002');
    await new OfferCreationService(database.client).createOffer({
      authorization: authorization(),
      destinationClubId: firstDestination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });

    await expect(
      new OfferCreationService(database.client).createOffer({
        authorization: authorization(),
        destinationClubId: secondDestination.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).resolves.toMatchObject({
      offer: { clubId: secondDestination.id, status: 'PENDING' },
    });
    await expect(
      database.client.offer.count({ where: { player: { discordUserId: playerId } } }),
    ).resolves.toBe(2);
  });

  it('expires one stale offer once when two replacement attempts race', async () => {
    const destination = await createClub();
    const initial = await new OfferCreationService(database.client).createOffer({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const now = new Date(initial.offer.expiresAt.getTime() + 1);
    const createReplacement = () =>
      new OfferCreationService(database.client, () => now).createOffer({
        authorization: authorization(),
        destinationClubId: destination.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      });

    const results = await Promise.allSettled([createReplacement(), createReplacement()]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(DomainError);
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: initial.offer.id } }),
    ).resolves.toMatchObject({ status: 'EXPIRED' });
    await expect(
      database.client.offer.count({
        where: {
          clubId: destination.id,
          playerUserId: initial.player.id,
          status: 'PENDING',
        },
      }),
    ).resolves.toBe(1);
    await expect(
      database.client.auditEvent.count({
        where: { eventType: offerExpiredAuditEventType, entityId: initial.offer.id },
      }),
    ).resolves.toBe(1);
  });

  it('attributes offer creation to the persisted sender rather than the current TM or player', async () => {
    const destination = await createClub('930000000000000001', 5);
    const staff = new StaffManagementService(database.client);
    await staff.appoint({
      authorization: authorization(),
      clubId: destination.id,
      staffDiscordUserId: ownerId,
      staffType: 'TEAM_MANAGER',
      staffIsBot: false,
    });
    await staff.appoint({
      authorization: authorization(),
      clubId: destination.id,
      staffDiscordUserId: outsiderId,
      staffType: 'PLAYER_MANAGER',
      staffIsBot: false,
    });

    const result = await new OfferCreationService(database.client).createOffer({
      authorization: authorization(outsiderId),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    const sender = await database.client.leagueUser.findUniqueOrThrow({
      where: { discordUserId: outsiderId },
    });
    const audit = await database.client.auditEvent.findFirstOrThrow({
      where: { eventType: offerCreatedAuditEventType, entityId: result.offer.id },
    });

    expect(result.offer.offeredByUserId).toBe(sender.id);
    expect(audit.actorUserId).toBe(sender.id);
    expect(result.auditAnnouncement).toMatchObject({
      operation: 'OFFER_CREATED',
      actorDiscordUserId: outsiderId,
      playerDiscordUserId: playerId,
    });
    expect(result.auditAnnouncement?.actorDiscordUserId).not.toBe(ownerId);
    expect(result.auditAnnouncement?.actorDiscordUserId).not.toBe(playerId);
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
    const declined = await service.declineOffer({
      offerId: result.offer.id,
      decliningDiscordUserId: playerId,
    });
    expect(declined).toMatchObject({
      status: 'DECLINED',
      auditAnnouncement: {
        operation: 'OFFER_DECLINED',
        actorDiscordUserId: playerId,
        playerDiscordUserId: playerId,
      },
    });
    const declineAudit = await database.client.auditEvent.findFirstOrThrow({
      where: { eventType: offerDeclinedAuditEventType, entityId: result.offer.id },
    });
    expect(declineAudit.actorUserId).toBe(result.player.id);
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
    const staleExpiryAudit = await database.client.auditEvent.findFirstOrThrow({
      where: { eventType: offerExpiredAuditEventType, entityId: stale.offer.id },
    });
    expect(staleExpiryAudit.actorUserId).toBeNull();

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

  it('keeps scheduled offer expiration attributed to System with no human actor', async () => {
    const destination = await createClub();
    const expiresAt = new Date(Date.now() + 60_000);
    const created = await new OfferCreationService(database.client).createOffer({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
      expiresAt,
    });
    const publish = vi.fn((plan: unknown) => {
      void plan;
      return Promise.resolve(true);
    });
    const terminalizeOffer = vi.fn(() => Promise.resolve());

    await expect(
      new OfferExpirationService(database.client, { publish }, { terminalizeOffer }).expire(
        new Date(expiresAt.getTime() + 1),
      ),
    ).resolves.toMatchObject([{ id: created.offer.id, status: 'EXPIRED' }]);
    const event = await database.client.auditEvent.findFirstOrThrow({
      where: { eventType: offerExpiredAuditEventType, entityId: created.offer.id },
    });
    const plan = publish.mock.calls[0]?.[0] as Record<string, unknown> | undefined;

    expect(event.actorUserId).toBeNull();
    expect(plan).toMatchObject({
      operation: 'OFFER_EXPIRED',
      playerDiscordUserId: playerId,
    });
    expect(plan).not.toHaveProperty('actorDiscordUserId');
    expect(terminalizeOffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.offer.id, status: 'EXPIRED' }),
      'EXPIRED',
    );
  });

  it('uses the canonical expiry lifecycle for the initial scheduled sweep', async () => {
    const destination = await createClub();
    const sweepTime = new Date(Date.now() + 60_000);
    const creation = new OfferCreationService(database.client);
    const [stale, exact, future] = await Promise.all([
      creation.createOffer({
        authorization: authorization(),
        destinationClubId: destination.id,
        playerDiscordUserId: '900000000000000006',
        playerIsBot: false,
        expiresAt: new Date(sweepTime.getTime() - 1),
      }),
      creation.createOffer({
        authorization: authorization(),
        destinationClubId: destination.id,
        playerDiscordUserId: '900000000000000007',
        playerIsBot: false,
        expiresAt: sweepTime,
      }),
      creation.createOffer({
        authorization: authorization(),
        destinationClubId: destination.id,
        playerDiscordUserId: '900000000000000008',
        playerIsBot: false,
        expiresAt: new Date(sweepTime.getTime() + 1),
      }),
    ]);
    const terminalizeOffer = vi.fn(() => Promise.resolve());
    const expiration = new OfferExpirationService(database.client, undefined, { terminalizeOffer });
    let complete!: () => void;
    const completed = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const scheduler = new OfferExpirationScheduler(
      {
        expire: async (now) => {
          try {
            return await expiration.expire(now);
          } finally {
            complete();
          }
        },
      },
      new MemoryLogger(),
      { now: () => sweepTime },
    );

    scheduler.start();
    await completed;
    scheduler.stop();

    await expect(
      database.client.offer.findMany({ orderBy: { expiresAt: 'asc' } }),
    ).resolves.toMatchObject([
      { id: stale.offer.id, status: 'EXPIRED', respondedAt: sweepTime },
      { id: exact.offer.id, status: 'EXPIRED', respondedAt: sweepTime },
      { id: future.offer.id, status: 'PENDING', respondedAt: null },
    ]);
    expect(terminalizeOffer).toHaveBeenCalledTimes(2);
    expect(terminalizeOffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: stale.offer.id, status: 'EXPIRED' }),
      'EXPIRED',
    );
    expect(terminalizeOffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: exact.offer.id, status: 'EXPIRED' }),
      'EXPIRED',
    );

    await expiration.expire(sweepTime);
    await expect(
      database.client.auditEvent.count({
        where: {
          eventType: offerExpiredAuditEventType,
          entityId: { in: [stale.offer.id, exact.offer.id] },
        },
      }),
    ).resolves.toBe(2);
  });

  it('publishes stale expiration and replacement creation audit announcements outside creation', async () => {
    const destination = await createClub();
    const initial = await new OfferCreationService(database.client).createOffer({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const now = new Date(initial.offer.expiresAt.getTime() + 1);
    await new OfferRepository(database.client).setMessageReference(
      initial.offer.id,
      '910000000000000009',
      '940000000000000009',
    );
    const publish = vi.fn((plan: unknown) => {
      void plan;
      return Promise.resolve(true);
    });
    const setTerminalState = vi.fn(() => Promise.resolve());
    const adapter: OfferMessageAdapter = {
      sendOffer: vi.fn(() =>
        Promise.resolve({ channelId: '910000000000000001', messageId: '940000000000000001' }),
      ),
      setTerminalState,
      cleanupOrphan: vi.fn(() => Promise.resolve()),
    };

    const result = await new OfferDeliveryService(
      database.client,
      adapter,
      new MemoryLogger(),
      new OfferCreationService(database.client, () => now),
      { publish },
    ).createAndDeliver({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0]?.[0]).toMatchObject({
      operation: 'OFFER_EXPIRED',
      occurredAt: now,
      playerDiscordUserId: playerId,
    });
    expect(publish.mock.calls[0]?.[0]).not.toHaveProperty('actorDiscordUserId');
    expect(publish.mock.calls[1]?.[0]).toMatchObject({
      operation: 'OFFER_CREATED',
      actorDiscordUserId: ownerId,
      playerDiscordUserId: playerId,
    });
    expect(result).toMatchObject({
      expiredAuditAnnouncementDelivered: true,
      auditAnnouncementDelivered: true,
    });
    expect(setTerminalState).toHaveBeenCalledWith(
      { channelId: '910000000000000009', messageId: '940000000000000009' },
      'EXPIRED',
      undefined,
    );
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

  it('best-effort terminalizes a referenced offer without affecting its committed terminal state', async () => {
    const destination = await createClub();
    const created = await new OfferCreationService(database.client).createOffer({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    const offer = await new OfferRepository(database.client).setMessageReference(
      created.offer.id,
      '910000000000000001',
      '940000000000000001',
    );
    const expiredOffer = await new OfferRepository(database.client).transition(offer.id, 'EXPIRED');
    const setTerminalState = vi.fn(() => Promise.reject(new Error('network failure')));
    const logger = new MemoryLogger();
    const delivery = new OfferDeliveryService(
      database.client,
      {
        sendOffer: vi.fn(),
        setTerminalState,
        cleanupOrphan: vi.fn(),
      },
      logger,
    );

    await expect(delivery.terminalizeOffer(expiredOffer, 'EXPIRED')).resolves.toBeUndefined();
    expect(setTerminalState).toHaveBeenCalledWith(
      { channelId: '910000000000000001', messageId: '940000000000000001' },
      'EXPIRED',
      undefined,
    );
    await expect(
      database.client.offer.findUniqueOrThrow({ where: { id: offer.id } }),
    ).resolves.toMatchObject({ status: 'EXPIRED' });
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: 'error', message: 'offer terminal message update failed' }),
    );
  });

  it('skips missing references and treats deleted Discord messages as non-fatal', async () => {
    const destination = await createClub();
    const created = await new OfferCreationService(database.client).createOffer({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    const logger = new MemoryLogger();
    const missingMessageError = Object.assign(new Error('Unknown Message'), { code: 10008 });
    const setTerminalState = vi.fn(() => Promise.reject(missingMessageError));
    const delivery = new OfferDeliveryService(
      database.client,
      {
        sendOffer: vi.fn(),
        setTerminalState,
        cleanupOrphan: vi.fn(),
      },
      logger,
    );

    const voidedWithoutReference = await new OfferRepository(database.client).transition(
      created.offer.id,
      'VOIDED',
    );
    await delivery.terminalizeOffer(voidedWithoutReference, 'VOIDED');
    expect(setTerminalState).not.toHaveBeenCalled();
    const replacement = await new OfferCreationService(database.client).createOffer({
      authorization: authorization(),
      destinationClubId: destination.id,
      playerDiscordUserId: playerId,
      playerIsBot: false,
    });
    const referencedOffer = await new OfferRepository(database.client).setMessageReference(
      replacement.offer.id,
      '910000000000000001',
      '940000000000000001',
    );
    const voidedOffer = await new OfferRepository(database.client).transition(
      referencedOffer.id,
      'VOIDED',
    );
    await delivery.terminalizeOffer(voidedOffer, 'VOIDED');
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: 'warn', message: 'offer terminal message is no longer available' }),
    );
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

  it('rejects an administrative write when BotPerm is revoked after preflight', async () => {
    let revoked = false;
    const trackedClient = new Proxy(database.client, {
      get(target, property) {
        if (property === '$transaction') {
          return async (callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) => {
            if (!revoked) {
              revoked = true;
              await target.botPermission.deleteMany({});
            }
            return target.$transaction(callback);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function'
          ? (...args: unknown[]): unknown => Reflect.apply(value, target, args) as unknown
          : value;
      },
    });

    await expect(
      new ClubManagementService(trackedClient).create({
        authorization: authorization(),
        discordRoleId: '930000000000000099',
        emoji: 'ðŸ¦',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(database.client.club.count()).resolves.toBe(0);
    await expect(
      database.client.auditEvent.count({ where: { eventType: clubCreatedAuditEventType } }),
    ).resolves.toBe(0);
  });

  it('rejects a team-staff roster write when membership is revoked after preflight', async () => {
    const club = await createClub();
    await new StaffManagementService(database.client).appoint({
      authorization: authorization(),
      clubId: club.id,
      staffDiscordUserId: outsiderId,
      staffType: 'TEAM_MANAGER',
      staffIsBot: false,
    });
    let revoked = false;
    const trackedClient = new Proxy(database.client, {
      get(target, property) {
        if (property === '$transaction') {
          return async (callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) => {
            if (!revoked) {
              revoked = true;
              await target.clubMembership.updateMany({
                where: {
                  clubId: club.id,
                  membershipType: 'TEAM_MANAGER',
                  user: { discordUserId: outsiderId },
                  status: 'ACTIVE',
                },
                data: { status: 'ENDED', leftAt: new Date() },
              });
            }
            return target.$transaction(callback);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function'
          ? (...args: unknown[]): unknown => Reflect.apply(value, target, args) as unknown
          : value;
      },
    });

    await expect(
      new RosterManagementService(trackedClient).add({
        authorization: authorization(outsiderId),
        clubId: club.id,
        playerDiscordUserId: playerId,
        playerIsBot: false,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      database.client.clubMembership.count({
        where: { clubId: club.id, membershipType: 'PLAYER', user: { discordUserId: playerId } },
      }),
    ).resolves.toBe(0);
    await expect(
      database.client.auditEvent.count({ where: { eventType: rosterPlayerAddedAuditEventType } }),
    ).resolves.toBe(0);
  });
});
