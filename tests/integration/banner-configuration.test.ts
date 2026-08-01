import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthorizationError, InvalidBannerConfigurationError } from '../../src/domain/errors.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { ClubManagementService } from '../../src/services/club-management-service.js';
import {
  bannerConfiguredAuditEventType,
  GuildSetupService,
} from '../../src/services/guild-setup-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';

const guildId = '100000000000000001';
const ownerId = '200000000000000001';
const botPermissionsRoleId = '300000000000000001';
const teamManagerRoleId = '300000000000000002';
const assistantManagerRoleId = '300000000000000003';
const playerManagerRoleId = '300000000000000004';

function authorization(overrides: Partial<AuthorizationInput> = {}): AuthorizationInput {
  return {
    discordGuildId: guildId,
    discordUserId: ownerId,
    guildOwnerId: ownerId,
    memberRoleIds: [],
    hasAdministratorPermission: false,
    ...overrides,
  };
}

describe('team banner configuration service', () => {
  let database: TestDatabase;
  let service: GuildSetupService;

  beforeAll(() => {
    database = createTestDatabase();
    service = new GuildSetupService(database.client);
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
    await service.setupChannels({
      authorization: authorization({ hasAdministratorPermission: true }),
      guildName: 'Banner League',
      botCommandsChannelId: '400000000000000001',
      staffChannelId: '400000000000000002',
      transferChannelId: '400000000000000003',
      auditChannelId: '400000000000000004',
    });
    await service.setupRoles({
      authorization: authorization({ hasAdministratorPermission: true }),
      guildName: 'Banner League',
      botPermissionsRoleId,
      teamManagerRoleId,
      assistantManagerRoleId,
      playerManagerRoleId,
    });
  });

  it('updates all four settings together and stores before and after audit state', async () => {
    const result = await service.updateBannerConfiguration({
      authorization: authorization(),
      bannerHasEmoji: false,
      bannerHasName: true,
      bannerHasShort: false,
      bannerHasRole: true,
    });

    expect(result.before).toEqual({
      bannerHasEmoji: true,
      bannerHasName: false,
      bannerHasShort: false,
      bannerHasRole: true,
    });
    expect(result.after).toEqual({
      bannerHasEmoji: false,
      bannerHasName: true,
      bannerHasShort: false,
      bannerHasRole: true,
    });
    const audit = await database.client.auditEvent.findFirstOrThrow({
      where: { eventType: bannerConfiguredAuditEventType },
    });
    expect(audit.beforeState).toEqual(result.before);
    expect(audit.afterState).toEqual(result.after);
  });

  it('rejects all false without changing the previous configuration or publishing an audit row', async () => {
    await service.updateBannerConfiguration({
      authorization: authorization(),
      bannerHasEmoji: true,
      bannerHasName: false,
      bannerHasShort: false,
      bannerHasRole: false,
    });
    const auditCount = await database.client.auditEvent.count({
      where: { eventType: bannerConfiguredAuditEventType },
    });

    await expect(
      service.updateBannerConfiguration({
        authorization: authorization(),
        bannerHasEmoji: false,
        bannerHasName: false,
        bannerHasShort: false,
        bannerHasRole: false,
      }),
    ).rejects.toBeInstanceOf(InvalidBannerConfigurationError);

    const guild = await database.client.guild.findUniqueOrThrow({
      where: { discordGuildId: guildId },
    });
    const settings = await database.client.guildSettings.findUniqueOrThrow({
      where: { guildId: guild.id },
    });
    expect(settings).toMatchObject({
      bannerHasEmoji: true,
      bannerHasName: false,
      bannerHasShort: false,
      bannerHasRole: false,
    });
    await expect(
      database.client.auditEvent.count({ where: { eventType: bannerConfiguredAuditEventType } }),
    ).resolves.toBe(auditCount);
  });

  it('preserves banner values when unrelated setup commands update channels and roles', async () => {
    await service.updateBannerConfiguration({
      authorization: authorization(),
      bannerHasEmoji: false,
      bannerHasName: true,
      bannerHasShort: true,
      bannerHasRole: false,
    });
    await service.setupChannels({
      authorization: authorization(),
      guildName: 'Banner League',
      botCommandsChannelId: '500000000000000001',
      staffChannelId: '500000000000000002',
      transferChannelId: '500000000000000003',
      auditChannelId: '500000000000000004',
    });
    await service.setupRoles({
      authorization: authorization(),
      guildName: 'Banner League',
      botPermissionsRoleId,
      teamManagerRoleId,
      assistantManagerRoleId,
      playerManagerRoleId,
    });

    const view = await service.getView(guildId);
    expect(view.banner).toEqual({
      bannerHasEmoji: false,
      bannerHasName: true,
      bannerHasShort: true,
      bannerHasRole: false,
    });
  });

  it('allows owner administrator and bot permissions role but denies ordinary and team roles', async () => {
    await expect(
      service.updateBannerConfiguration({
        authorization: authorization(),
        bannerHasEmoji: true,
        bannerHasName: false,
        bannerHasShort: false,
        bannerHasRole: false,
      }),
    ).resolves.toBeDefined();
    await expect(
      service.updateBannerConfiguration({
        authorization: authorization({
          discordUserId: '200000000000000002',
          hasAdministratorPermission: true,
        }),
        bannerHasEmoji: false,
        bannerHasName: true,
        bannerHasShort: false,
        bannerHasRole: false,
      }),
    ).resolves.toBeDefined();
    await expect(
      service.updateBannerConfiguration({
        authorization: authorization({
          discordUserId: '200000000000000003',
          memberRoleIds: [botPermissionsRoleId],
        }),
        bannerHasEmoji: false,
        bannerHasName: false,
        bannerHasShort: true,
        bannerHasRole: false,
      }),
    ).resolves.toBeDefined();

    for (const memberRoleIds of [
      [],
      [teamManagerRoleId],
      [assistantManagerRoleId],
      [playerManagerRoleId],
    ]) {
      await expect(
        service.updateBannerConfiguration({
          authorization: authorization({
            discordUserId: '200000000000000004',
            memberRoleIds,
          }),
          bannerHasEmoji: false,
          bannerHasName: false,
          bannerHasShort: false,
          bannerHasRole: true,
        }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it('keeps autocomplete ids internal and uses readable custom emoji and role fallbacks', async () => {
    const clubs = new ClubManagementService(database.client);
    const custom = await clubs.create({
      authorization: authorization(),
      name: 'Newcastle',
      shortName: 'NEW',
      discordRoleId: '600000000000000001',
      emoji: '<:Newcastle:987654321098765432>',
    });
    const unicode = await clubs.create({
      authorization: authorization(),
      name: 'Chelsea',
      shortName: 'CHE',
      discordRoleId: '600000000000000002',
      emoji: '🔵',
    });

    const defaultChoices = await clubs.autocomplete(guildId, '', 25, {
      [custom.discordRoleId]: 'T1',
      [unicode.discordRoleId]: 'T2',
    });
    expect(defaultChoices).toEqual(
      expect.arrayContaining([
        { name: '.Newcastle. @T1', value: custom.id },
        { name: '🔵 @T2', value: unicode.id },
      ]),
    );
    const customChoice = defaultChoices.find((choice) => choice.value === custom.id);
    expect(customChoice?.name).not.toContain('987654321098765432');
    expect(customChoice?.name).not.toContain('<:');
    expect(customChoice?.name).not.toContain(':Newcastle:');

    await service.updateBannerConfiguration({
      authorization: authorization(),
      bannerHasEmoji: true,
      bannerHasName: true,
      bannerHasShort: true,
      bannerHasRole: true,
    });
    const allEnabled = await clubs.autocomplete(guildId, '', 25, {
      [custom.discordRoleId]: 'T1',
      [unicode.discordRoleId]: 'T2',
    });
    expect(allEnabled).toEqual(
      expect.arrayContaining([
        { name: '.Newcastle. Newcastle (NEW) @T1', value: custom.id },
        { name: '🔵 Chelsea (CHE) @T2', value: unicode.id },
      ]),
    );
  });
});
