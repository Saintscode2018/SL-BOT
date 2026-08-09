import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AuthorizationError,
  BotPermissionAdminAlreadyGrantedError,
  BotPermissionAdminProtectedError,
  BotPermissionAlreadyGrantedError,
  LastBotPermissionRemovalError,
} from '../../src/domain/errors.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { AuthorizationService } from '../../src/services/authorization-service.js';
import {
  botPermissionAddedAuditEventType,
  botPermissionAdminAddedAuditEventType,
  botPermissionPromotedAuditEventType,
  botPermissionRemovedAuditEventType,
  BotPermissionService,
} from '../../src/services/bot-permission-service.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import { GuildSetupService } from '../../src/services/guild-setup-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';

const guildId = '810000000000000001';
const ownerId = '810000000000000002';
const administratorId = '810000000000000003';
const standardId = '810000000000000004';
const secondStandardId = '810000000000000005';
const adminPermissionId = '810000000000000006';
const secondAdminId = '810000000000000007';
const outsiderId = '810000000000000008';
const oldRoleId = '810000000000000009';
const botChannelId = '820000000000000001';
const staffChannelId = '820000000000000002';
const transferChannelId = '820000000000000003';
const auditChannelId = '820000000000000004';

function authorization(
  discordUserId: string,
  options: { administrator?: boolean; roles?: string[] } = {},
): AuthorizationInput {
  return {
    discordGuildId: guildId,
    discordUserId,
    guildOwnerId: ownerId,
    memberRoleIds: options.roles ?? [],
    hasAdministratorPermission: options.administrator ?? false,
  };
}

describe('database Bot Permissions', () => {
  let database: TestDatabase;
  let permissions: BotPermissionService;
  let setup: GuildSetupService;

  beforeAll(() => {
    database = createTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
    permissions = new BotPermissionService(database.client);
    setup = new GuildSetupService(database.client);
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  async function bootstrapGuild(): Promise<void> {
    const admin = authorization(administratorId, { administrator: true });
    await setup.setupGuildOnly({ authorization: admin, guildName: 'Permission League' });
    await setup.setupChannels({
      authorization: admin,
      guildName: 'Permission League',
      botCommandsChannelId: botChannelId,
      staffChannelId,
      transferChannelId,
      auditChannelId,
      caseFilesChannelId: '820000000000000005',
    });
  }

  async function bootstrapStandard(): Promise<void> {
    await bootstrapGuild();
    await permissions.addStandard({
      authorization: authorization(administratorId, { administrator: true }),
      targetDiscordUserId: standardId,
    });
  }

  it('starts with zero records and permits only the minimal Administrator setup bootstrap', async () => {
    await expect(
      setup.setupGuildOnly({
        authorization: authorization(ownerId),
        guildName: 'Denied Owner League',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const admin = authorization(administratorId, { administrator: true });
    await expect(
      setup.setupGuildOnly({ authorization: admin, guildName: 'Permission League' }),
    ).resolves.toMatchObject({ created: true });
    await expect(database.client.botPermission.count()).resolves.toBe(0);
    await expect(
      setup.setupChannels({
        authorization: admin,
        guildName: 'Permission League',
        botCommandsChannelId: botChannelId,
        staffChannelId,
        transferChannelId,
        auditChannelId,
        caseFilesChannelId: '820000000000000005',
      }),
    ).resolves.toBeDefined();
    await expect(
      setup.setupRoles({
        authorization: admin,
        guildName: 'Permission League',
        botPermissionsRoleId: oldRoleId,
        teamManagerRoleId: '830000000000000001',
        assistantManagerRoleId: '830000000000000002',
        playerManagerRoleId: '830000000000000003',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('allows only a Discord Administrator to create the first standard permission', async () => {
    await bootstrapGuild();
    await expect(
      permissions.addStandard({
        authorization: authorization(outsiderId),
        targetDiscordUserId: standardId,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      permissions.addStandard({
        authorization: authorization(ownerId),
        targetDiscordUserId: standardId,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      permissions.addStandard({
        authorization: authorization(administratorId, { administrator: true }),
        targetDiscordUserId: standardId,
      }),
    ).resolves.toMatchObject({ afterLevel: 'BOTPERM', mutation: 'added' });
    await expect(database.client.botPermission.count()).resolves.toBe(1);
  });

  it('uses only BOTPERM and BOTPERM_ADMIN for global authorization after bootstrap', async () => {
    await bootstrapStandard();
    const authorizationService = new AuthorizationService(database.client);

    await expect(
      authorizationService.getGlobalAuthorizationKind(
        authorization(administratorId, { administrator: true }),
      ),
    ).resolves.toBeNull();
    await expect(
      authorizationService.getGlobalAuthorizationKind(authorization(ownerId)),
    ).resolves.toBeNull();
    await expect(
      authorizationService.getGlobalAuthorizationKind(
        authorization(outsiderId, { roles: [oldRoleId] }),
      ),
    ).resolves.toBeNull();
    await expect(
      authorizationService.getGlobalAuthorizationKind(authorization(standardId)),
    ).resolves.toBe('BOTPERM');

    await permissions.addAdmin({
      authorization: authorization(standardId),
      targetDiscordUserId: adminPermissionId,
    });
    await expect(
      authorizationService.getGlobalAuthorizationKind(authorization(adminPermissionId)),
    ).resolves.toBe('BOTPERM_ADMIN');
  });

  it('lets either permission level grant standards and add or promote admins', async () => {
    await bootstrapStandard();
    await expect(
      permissions.addStandard({
        authorization: authorization(standardId),
        targetDiscordUserId: secondStandardId,
      }),
    ).resolves.toMatchObject({ afterLevel: 'BOTPERM' });
    await expect(
      permissions.addAdmin({
        authorization: authorization(standardId),
        targetDiscordUserId: secondStandardId,
      }),
    ).resolves.toMatchObject({
      beforeLevel: 'BOTPERM',
      afterLevel: 'BOTPERM_ADMIN',
      mutation: 'promoted',
    });
    await expect(
      permissions.addStandard({
        authorization: authorization(standardId),
        targetDiscordUserId: secondStandardId,
      }),
    ).rejects.toBeInstanceOf(BotPermissionAdminAlreadyGrantedError);

    await permissions.addAdmin({
      authorization: authorization(standardId),
      targetDiscordUserId: adminPermissionId,
    });
    await expect(
      permissions.addStandard({
        authorization: authorization(adminPermissionId),
        targetDiscordUserId: outsiderId,
      }),
    ).resolves.toMatchObject({ afterLevel: 'BOTPERM' });
    await expect(
      permissions.addAdmin({
        authorization: authorization(adminPermissionId),
        targetDiscordUserId: outsiderId,
      }),
    ).resolves.toMatchObject({
      beforeLevel: 'BOTPERM',
      afterLevel: 'BOTPERM_ADMIN',
      mutation: 'promoted',
    });
    await expect(
      permissions.addAdmin({
        authorization: authorization(adminPermissionId),
        targetDiscordUserId: secondAdminId,
      }),
    ).resolves.toMatchObject({ afterLevel: 'BOTPERM_ADMIN', mutation: 'added' });
    await expect(
      permissions.addStandard({
        authorization: authorization(standardId),
        targetDiscordUserId: standardId,
      }),
    ).rejects.toBeInstanceOf(BotPermissionAlreadyGrantedError);
  });

  it('removes standards but protects admins and the final permission', async () => {
    await bootstrapStandard();
    await permissions.addStandard({
      authorization: authorization(standardId),
      targetDiscordUserId: secondStandardId,
    });
    await permissions.addAdmin({
      authorization: authorization(standardId),
      targetDiscordUserId: adminPermissionId,
    });

    await expect(
      permissions.removeStandard({
        authorization: authorization(standardId),
        targetDiscordUserId: adminPermissionId,
      }),
    ).rejects.toBeInstanceOf(BotPermissionAdminProtectedError);
    await expect(
      permissions.removeStandard({
        authorization: authorization(standardId),
        targetDiscordUserId: secondStandardId,
      }),
    ).resolves.toMatchObject({ beforeLevel: 'BOTPERM', afterLevel: null });

    await database.client.botPermission.deleteMany({
      where: { user: { discordUserId: adminPermissionId } },
    });
    await expect(
      permissions.removeStandard({
        authorization: authorization(standardId),
        targetDiscordUserId: standardId,
      }),
    ).rejects.toBeInstanceOf(LastBotPermissionRemovalError);
    await expect(database.client.botPermission.count()).resolves.toBe(1);
  });

  it('lists both levels deterministically without creating audit events', async () => {
    await bootstrapStandard();
    await permissions.addStandard({
      authorization: authorization(standardId),
      targetDiscordUserId: secondStandardId,
    });
    await permissions.addAdmin({
      authorization: authorization(standardId),
      targetDiscordUserId: adminPermissionId,
    });
    const beforeAuditCount = await database.client.auditEvent.count();

    const result = await permissions.list(authorization(standardId));

    expect(result.permissions.map(({ level, user }) => [level, user.discordUserId])).toEqual([
      ['BOTPERM', standardId],
      ['BOTPERM', secondStandardId],
      ['BOTPERM_ADMIN', adminPermissionId],
    ]);
    await expect(database.client.auditEvent.count()).resolves.toBe(beforeAuditCount);
  });

  it('writes actor, target, guild, and before/after states for every mutation', async () => {
    await bootstrapStandard();
    await permissions.addStandard({
      authorization: authorization(standardId),
      targetDiscordUserId: secondStandardId,
    });
    await permissions.addAdmin({
      authorization: authorization(standardId),
      targetDiscordUserId: secondStandardId,
    });
    await permissions.addAdmin({
      authorization: authorization(standardId),
      targetDiscordUserId: adminPermissionId,
    });
    await permissions.removeStandard({
      authorization: authorization(adminPermissionId),
      targetDiscordUserId: standardId,
    });

    const events = await database.client.auditEvent.findMany({
      where: {
        eventType: {
          in: [
            botPermissionAddedAuditEventType,
            botPermissionPromotedAuditEventType,
            botPermissionAdminAddedAuditEventType,
            botPermissionRemovedAuditEventType,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(events).toHaveLength(5);
    expect(events[2]).toMatchObject({
      eventType: botPermissionPromotedAuditEventType,
      beforeState: { permissionLevel: 'BOTPERM' },
      afterState: { permissionLevel: 'BOTPERM_ADMIN' },
      metadata: {
        discordGuildId: guildId,
        actorDiscordUserId: standardId,
        targetDiscordUserId: secondStandardId,
      },
    });
    expect(events[4]).toMatchObject({
      eventType: botPermissionRemovedAuditEventType,
      beforeState: { permissionLevel: 'BOTPERM' },
      afterState: { permissionLevel: null },
      metadata: {
        discordGuildId: guildId,
        actorDiscordUserId: adminPermissionId,
        targetDiscordUserId: standardId,
      },
    });
    expect(
      events.every(({ guildId: eventGuildId, actorUserId }) => eventGuildId && actorUserId),
    ).toBe(true);
  });

  it('requires database permission for setup mutations immediately after the first grant', async () => {
    await bootstrapStandard();
    const discordAdmin = authorization(administratorId, { administrator: true });
    await expect(
      setup.setupChannels({
        authorization: discordAdmin,
        guildName: 'Denied Rename',
        botCommandsChannelId: botChannelId,
        staffChannelId,
        transferChannelId,
        auditChannelId,
        caseFilesChannelId: '820000000000000005',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      setup.setupRoles({
        authorization: authorization(standardId),
        guildName: 'Permission League',
        botPermissionsRoleId: oldRoleId,
        teamManagerRoleId: '830000000000000001',
        assistantManagerRoleId: '830000000000000002',
        playerManagerRoleId: '830000000000000003',
      }),
    ).resolves.toBeDefined();
  });

  it('enforces the fresh and post-bootstrap channel authorization policy', async () => {
    const policy = new CommandChannelPolicyService(database.client);
    const discordAdmin = authorization(administratorId, { administrator: true });
    await expect(
      policy.validateChannelPolicy({
        authorization: discordAdmin,
        channelId: '899999999999999999',
        commandName: 'setup',
        subcommand: 'league',
      }),
    ).resolves.toBeUndefined();
    await bootstrapGuild();
    await expect(
      policy.validateChannelPolicy({
        authorization: discordAdmin,
        channelId: staffChannelId,
        commandName: 'setup',
        subcommandGroup: 'botperm',
        subcommand: 'add',
      }),
    ).resolves.toBeUndefined();
    await permissions.addStandard({
      authorization: discordAdmin,
      targetDiscordUserId: standardId,
    });
    await expect(
      policy.validateChannelPolicy({
        authorization: discordAdmin,
        channelId: staffChannelId,
        commandName: 'setup',
        subcommand: 'channels',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('serializes concurrent removals so the guild cannot reach zero permissions', async () => {
    await bootstrapStandard();
    await permissions.addStandard({
      authorization: authorization(standardId),
      targetDiscordUserId: secondStandardId,
    });

    const results = await Promise.allSettled([
      permissions.removeStandard({
        authorization: authorization(standardId),
        targetDiscordUserId: secondStandardId,
      }),
      permissions.removeStandard({
        authorization: authorization(secondStandardId),
        targetDiscordUserId: standardId,
      }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    await expect(database.client.botPermission.count()).resolves.toBe(1);
  });
});
