import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdministrativePermissionDeniedError,
  AuthorizationError,
  ModerationAuthorizationError,
  ModerationRoleAlreadyConfiguredError,
  ModerationRoleEveryoneError,
  ModerationRoleManagedError,
  ModerationRoleNotConfiguredError,
} from '../../src/domain/errors.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { AuthorizationService } from '../../src/services/authorization-service.js';
import { BotPermissionService } from '../../src/services/bot-permission-service.js';
import { ClubManagementService } from '../../src/services/club-management-service.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import { GuildSetupService } from '../../src/services/guild-setup-service.js';
import {
  moderationRoleAddedAuditEventType,
  moderationRoleRemovedAuditEventType,
  ModerationRoleService,
  type ModerationRoleInspection,
  type ModerationRoleInspector,
} from '../../src/services/moderation-role-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';

const guildId = '910000000000000001';
const secondGuildId = '910000000000000002';
const bootstrapAdminId = '910000000000000003';
const botPermId = '910000000000000004';
const botPermAdminId = '910000000000000005';
const moderatorId = '910000000000000006';
const outsiderId = '910000000000000007';
const moderationRoleId = '920000000000000001';
const secondModerationRoleId = '920000000000000002';
const sameNameDifferentRoleId = '920000000000000003';
const managedRoleId = '920000000000000004';

let managedRoleIds = new Set<string>();
const roleInspector = {
  inspectGuildRole: vi.fn((_discordGuildId: string, discordRoleId: string): Promise<ModerationRoleInspection | null> =>
    Promise.resolve(managedRoleIds.has(discordRoleId) ? { managed: true } : { managed: false }),
  ),
} satisfies ModerationRoleInspector;

function authorization(
  discordUserId: string,
  options: { guild?: string; roles?: readonly string[]; administrator?: boolean } = {},
): AuthorizationInput {
  return {
    discordGuildId: options.guild ?? guildId,
    discordUserId,
    guildOwnerId: bootstrapAdminId,
    memberRoleIds: options.roles ?? [],
    hasAdministratorPermission: options.administrator ?? false,
  };
}

describe('moderation role configuration and authorization', () => {
  let database: TestDatabase;
  let permissions: BotPermissionService;
  let roles: ModerationRoleService;
  let setup: GuildSetupService;

  beforeAll(() => {
    database = createTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
    managedRoleIds = new Set();
    roleInspector.inspectGuildRole.mockClear();
    permissions = new BotPermissionService(database.client);
    roles = new ModerationRoleService(database.client, roleInspector);
    setup = new GuildSetupService(database.client);
    await bootstrapGuild(guildId, botPermId);
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  async function bootstrapGuild(discordGuildId: string, firstBotPermId: string): Promise<void> {
    const admin = authorization(bootstrapAdminId, {
      guild: discordGuildId,
      administrator: true,
    });
    await setup.setupGuildOnly({ authorization: admin, guildName: 'Moderation League' });
    await setup.setupChannels({
      authorization: admin,
      guildName: 'Moderation League',
      botCommandsChannelId: '930000000000000001',
      staffChannelId: '930000000000000002',
      transferChannelId: '930000000000000003',
      auditChannelId: '930000000000000004',
      caseFilesChannelId: '930000000000000005',
    });
    await permissions.addStandard({
      authorization: admin,
      targetDiscordUserId: firstBotPermId,
    });
  }

  it('lets BOTPERM and BOTPERM_ADMIN configure role IDs without creating permissions', async () => {
    const baselinePermissionCount = await database.client.botPermission.count();
    const added = await roles.add({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });

    expect(added).toMatchObject({ mutation: 'added', auditChannelId: '930000000000000004' });
    const persisted = await database.client.moderationRole.findUnique({
      where: {
        guildId_discordRoleId: {
          guildId: added.guild.id,
          discordRoleId: moderationRoleId,
        },
      },
    });
    expect(persisted?.discordRoleId).toBe(moderationRoleId);
    expect(persisted?.createdByUserId).toBeTruthy();
    await expect(database.client.botPermission.count()).resolves.toBe(baselinePermissionCount);

    await permissions.addAdmin({
      authorization: authorization(botPermId),
      targetDiscordUserId: botPermAdminId,
    });
    await expect(
      roles.add({
        authorization: authorization(botPermAdminId),
        discordRoleId: secondModerationRoleId,
      }),
    ).resolves.toMatchObject({ mutation: 'added' });
  });

  it('rejects the guild @everyone role before creating a moderation role row', async () => {
    await expect(
      roles.add({
        authorization: authorization(botPermId),
        discordRoleId: guildId,
      }),
    ).rejects.toBeInstanceOf(ModerationRoleEveryoneError);

    await expect(database.client.moderationRole.count()).resolves.toBe(0);
    expect(roleInspector.inspectGuildRole).not.toHaveBeenCalled();
  });

  it('rejects a Discord-managed role before creating a moderation role row', async () => {
    managedRoleIds.add(managedRoleId);

    await expect(
      roles.add({
        authorization: authorization(botPermId),
        discordRoleId: managedRoleId,
      }),
    ).rejects.toBeInstanceOf(ModerationRoleManagedError);

    expect(roleInspector.inspectGuildRole).toHaveBeenCalledWith(guildId, managedRoleId);
    await expect(database.client.moderationRole.count()).resolves.toBe(0);
  });

  it('preserves missing-role behavior by allowing an inspector null result', async () => {
    roleInspector.inspectGuildRole.mockResolvedValueOnce(null);

    await expect(
      roles.add({
        authorization: authorization(botPermId),
        discordRoleId: moderationRoleId,
      }),
    ).resolves.toMatchObject({ mutation: 'added' });
    await expect(database.client.moderationRole.count()).resolves.toBe(1);
  });

  it('preserves setup authorization before inspecting a role', async () => {
    await expect(
      roles.add({
        authorization: authorization(outsiderId),
        discordRoleId: moderationRoleId,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(roleInspector.inspectGuildRole).not.toHaveBeenCalled();
    await expect(database.client.moderationRole.count()).resolves.toBe(0);
  });

  it('rejects duplicate additions and missing removals with typed business errors', async () => {
    await roles.add({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });
    await expect(
      roles.add({
        authorization: authorization(botPermId),
        discordRoleId: moderationRoleId,
      }),
    ).rejects.toBeInstanceOf(ModerationRoleAlreadyConfiguredError);
    await expect(
      roles.remove({
        authorization: authorization(botPermId),
        discordRoleId: secondModerationRoleId,
      }),
    ).rejects.toBeInstanceOf(ModerationRoleNotConfiguredError);
  });

  it('lists roles deterministically, handles none, and does not audit views', async () => {
    const auditCount = await database.client.auditEvent.count();
    await expect(roles.list(authorization(botPermId))).resolves.toMatchObject({
      moderationRoles: [],
    });
    await expect(database.client.auditEvent.count()).resolves.toBe(auditCount);

    await roles.add({
      authorization: authorization(botPermId),
      discordRoleId: secondModerationRoleId,
    });
    await roles.add({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });
    const afterMutations = await database.client.auditEvent.count();
    const result = await roles.list(authorization(botPermId));

    expect(result.moderationRoles.map(({ discordRoleId }) => discordRoleId)).toEqual([
      moderationRoleId,
      secondModerationRoleId,
    ]);
    await expect(database.client.auditEvent.count()).resolves.toBe(afterMutations);
  });

  it('uses the actual actor for add and remove audit events', async () => {
    await roles.add({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });
    await roles.remove({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });

    const events = await database.client.auditEvent.findMany({
      where: {
        eventType: { in: [moderationRoleAddedAuditEventType, moderationRoleRemovedAuditEventType] },
      },
      include: { actor: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(events).toHaveLength(2);
    expect(events.map(({ actor }) => actor?.discordUserId)).toEqual([botPermId, botPermId]);
    expect(events.map(({ metadata }) => metadata)).toEqual([
      expect.objectContaining({
        actorDiscordUserId: botPermId,
        discordRoleId: moderationRoleId,
      }),
      expect.objectContaining({
        actorDiscordUserId: botPermId,
        discordRoleId: moderationRoleId,
      }),
    ]);
  });

  it('authorizes a current matching role ID, including among multiple member roles', async () => {
    await roles.add({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });
    const authorizationService = new AuthorizationService(database.client);

    await expect(
      authorizationService.canModerate(
        authorization(moderatorId, {
          roles: [sameNameDifferentRoleId, moderationRoleId, secondModerationRoleId],
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      authorizationService.authorizeModeration(
        authorization(moderatorId, { roles: [moderationRoleId] }),
      ),
    ).resolves.toMatchObject({ kind: 'moderation_role' });
  });

  it('denies absent or merely same-named role IDs without resolving Discord role objects', async () => {
    await roles.add({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });
    const authorizationService = new AuthorizationService(database.client);

    await expect(authorizationService.canModerate(authorization(outsiderId))).resolves.toBe(false);
    await expect(
      authorizationService.canModerate(
        authorization(outsiderId, { roles: [sameNameDifferentRoleId] }),
      ),
    ).resolves.toBe(false);
    await expect(
      authorizationService.authorizeModeration(
        authorization(outsiderId, { roles: [sameNameDifferentRoleId] }),
      ),
    ).rejects.toBeInstanceOf(ModerationAuthorizationError);
  });

  it.each([
    ['BOTPERM', botPermId],
    ['BOTPERM_ADMIN', botPermAdminId],
  ] as const)(
    'allows the %s override without creating moderation role rows',
    async (level, userId) => {
      if (level === 'BOTPERM_ADMIN') {
        await permissions.addAdmin({
          authorization: authorization(botPermId),
          targetDiscordUserId: botPermAdminId,
        });
      }
      const authorizationService = new AuthorizationService(database.client);

      await expect(authorizationService.canModerate(authorization(userId))).resolves.toBe(true);
      await expect(
        authorizationService.authorizeModeration(authorization(userId)),
      ).resolves.toMatchObject({ kind: level });
      await expect(database.client.moderationRole.count()).resolves.toBe(0);
    },
  );

  it('isolates configured roles by guild', async () => {
    await roles.add({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });
    const secondGuildBotPermId = '910000000000000008';
    await bootstrapGuild(secondGuildId, secondGuildBotPermId);
    const authorizationService = new AuthorizationService(database.client);

    await expect(
      authorizationService.canModerate(
        authorization(moderatorId, { guild: secondGuildId, roles: [moderationRoleId] }),
      ),
    ).resolves.toBe(false);
  });

  it('revokes role-based authorization immediately when configuration is removed', async () => {
    await roles.add({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });
    const authorizationService = new AuthorizationService(database.client);
    const moderator = authorization(moderatorId, { roles: [moderationRoleId] });
    await expect(authorizationService.canModerate(moderator)).resolves.toBe(true);

    await roles.remove({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });

    await expect(authorizationService.canModerate(moderator)).resolves.toBe(false);
    await expect(database.client.moderationRole.count()).resolves.toBe(0);
  });

  it('does not let a moderation-only user manage permissions, setup, or teams', async () => {
    await roles.add({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });
    const moderator = authorization(moderatorId, { roles: [moderationRoleId] });
    const authorizationService = new AuthorizationService(database.client);
    await expect(authorizationService.canModerate(moderator)).resolves.toBe(true);

    await expect(authorizationService.assertCanSetup(moderator)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      permissions.addStandard({ authorization: moderator, targetDiscordUserId: outsiderId }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      roles.add({ authorization: moderator, discordRoleId: secondModerationRoleId }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      new ClubManagementService(database.client).create({
        authorization: moderator,
        discordRoleId: '920000000000000099',
        emoji: 'M',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('uses existing setup channel policy for moderation-role management', async () => {
    await roles.add({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });
    const policy = new CommandChannelPolicyService(database.client);
    expect(policy.getScope('setup', 'add', 'modrole')).toBe('STAFF_ONLY');
    expect(policy.getScope('setup', 'remove', 'modrole')).toBe('STAFF_ONLY');
    expect(policy.getScope('setup', 'view', 'modrole')).toBe('BOT_OR_STAFF');

    await expect(
      policy.validateChannelPolicy({
        authorization: authorization(botPermId),
        channelId: '930000000000000002',
        commandName: 'setup',
        subcommand: 'add',
        subcommandGroup: 'modrole',
      }),
    ).resolves.toBeUndefined();
    await expect(
      policy.validateChannelPolicy({
        authorization: authorization(moderatorId, { roles: [moderationRoleId] }),
        channelId: '930000000000000001',
        commandName: 'setup',
        subcommand: 'view',
        subcommandGroup: 'modrole',
      }),
    ).rejects.toBeInstanceOf(AdministrativePermissionDeniedError);
  });
});
