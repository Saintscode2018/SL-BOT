import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { mapDiscordError } from '../../src/bot/error-mapper.js';
import {
  AdministrativePermissionDeniedError,
  AdministrativeWrongChannelError,
  BotCommandsChannelNotConfiguredError,
  StaffChannelNotConfiguredError,
  WrongCommandChannelError,
} from '../../src/domain/errors.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import { GuildSetupService } from '../../src/services/guild-setup-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  grantBotPermission,
  type TestDatabase,
} from '../helpers/database.js';

describe('authorization aware channel policy', () => {
  let database: TestDatabase;

  const guildId = '100000000000000001';
  const botCommandsChannelId = '111111111111111111';
  const staffChannelId = '222222222222222222';
  const unrelatedChannelId = '999999999999999999';
  const botPermissionsRoleId = '555555555555555555';
  const administrator: AuthorizationInput = {
    discordGuildId: guildId,
    discordUserId: '200000000000000001',
    guildOwnerId: '200000000000000001',
    memberRoleIds: [],
    hasAdministratorPermission: true,
  };
  const ordinaryUser: AuthorizationInput = {
    discordGuildId: guildId,
    discordUserId: '200000000000000002',
    guildOwnerId: administrator.guildOwnerId,
    memberRoleIds: [],
    hasAdministratorPermission: false,
  };
  const botPermissionsUser: AuthorizationInput = {
    ...ordinaryUser,
    discordUserId: '200000000000000003',
    memberRoleIds: [botPermissionsRoleId],
  };

  beforeAll(() => {
    database = createTestDatabase();
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
  });

  async function configureChannelsAndRoles(): Promise<void> {
    const setup = new GuildSetupService(database.client);
    await setup.setupChannels({
      authorization: administrator,
      guildName: 'Development League',
      botCommandsChannelId,
      staffChannelId,
      transferChannelId: '333333333333333333',
      auditChannelId: '444444444444444444',
    });
    await grantBotPermission(database.client, guildId, administrator.discordUserId);
    await grantBotPermission(database.client, guildId, botPermissionsUser.discordUserId);
    await setup.setupRoles({
      authorization: administrator,
      guildName: 'Development League',
      botPermissionsRoleId,
      teamManagerRoleId: '666666666666666666',
      assistantManagerRoleId: '777777777777777777',
      playerManagerRoleId: '888888888888888888',
    });
  }

  async function policyError(input: {
    authorization: AuthorizationInput;
    commandName: string;
    subcommand?: string | null | undefined;
    channelId?: string;
  }): Promise<unknown> {
    try {
      await new CommandChannelPolicyService(database.client).validateChannelPolicy({
        authorization: input.authorization,
        commandName: input.commandName,
        ...(input.subcommand === undefined ? {} : { subcommand: input.subcommand }),
        channelId: input.channelId ?? unrelatedChannelId,
      });
      throw new Error('expected policy failure');
    } catch (error: unknown) {
      return error;
    }
  }

  it('allows ordinary informational users in Staff without disclosing its channel ID', async () => {
    await configureChannelsAndRoles();
    await expect(
      new CommandChannelPolicyService(database.client).validateChannelPolicy({
        authorization: ordinaryUser,
        commandName: 'roster',
        subcommand: 'view',
        channelId: staffChannelId,
      }),
    ).resolves.toBeUndefined();
    const error = await policyError({
      authorization: ordinaryUser,
      commandName: 'roster',
      subcommand: 'view',
    });
    expect(error).toBeInstanceOf(WrongCommandChannelError);
    const mapped = mapDiscordError(error);
    expect(mapped.title).toBe('❌ Wrong Command Channel');
    expect(mapped.description).toBe(`Use this command in <#${botCommandsChannelId}>.`);
    expect(mapped.description).not.toContain(staffChannelId);
    expect(mapped.description).not.toContain('Staff Commands');
    expect(mapped.description).not.toContain('configured Staff Commands channel');
  });

  it('guides globally authorized informational users to both configured channels', async () => {
    await configureChannelsAndRoles();
    const error = await policyError({ authorization: administrator, commandName: 'health' });
    const mapped = mapDiscordError(error);
    expect(mapped.description).toBe(
      `Use this command in <#${botCommandsChannelId}> or <#${staffChannelId}>.`,
    );
    expect(mapped.description).not.toContain('Use either');
    expect(mapped.description).not.toContain('Please use');
  });

  it('checks administrative permission before revealing the staff channel', async () => {
    await configureChannelsAndRoles();
    const error = await policyError({
      authorization: ordinaryUser,
      commandName: 'team',
      subcommand: 'add',
    });
    expect(error).toBeInstanceOf(AdministrativePermissionDeniedError);
    const mapped = mapDiscordError(error);
    expect(mapped.title).toBe('❌ Permission Denied');
    expect(mapped.description).not.toContain(staffChannelId);
    expect(mapped.description).not.toContain('Staff Commands');
  });

  it('directs authorized administrative callers only to staff commands with concise wording', async () => {
    await configureChannelsAndRoles();
    for (const authorization of [botPermissionsUser, administrator]) {
      const error = await policyError({
        authorization,
        commandName: 'limit',
        subcommand: 'team',
        channelId: botCommandsChannelId,
      });
      expect(error).toBeInstanceOf(AdministrativeWrongChannelError);
      const mapped = mapDiscordError(error);
      expect(mapped.title).toBe('❌ Wrong Command Channel');
      expect(mapped.description).toBe(`Use this command in <#${staffChannelId}>.`);
      expect(mapped.description).not.toContain('Administrative commands must be used in');
    }
  });

  it('applies the roster add/remove authorization matrix and Staff Commands policy', async () => {
    await configureChannelsAndRoles();
    const owner: AuthorizationInput = {
      ...ordinaryUser,
      discordUserId: administrator.guildOwnerId,
    };
    const discordAdministrator: AuthorizationInput = {
      ...ordinaryUser,
      discordUserId: '200000000000000004',
      hasAdministratorPermission: true,
    };
    const policy = new CommandChannelPolicyService(database.client);

    for (const subcommand of ['add', 'remove'] as const) {
      for (const authorization of [owner, botPermissionsUser]) {
        await expect(
          policy.validateChannelPolicy({
            authorization,
            commandName: 'roster',
            subcommand,
            channelId: staffChannelId,
          }),
        ).resolves.toBeUndefined();
      }
      await expect(
        policy.validateChannelPolicy({
          authorization: discordAdministrator,
          commandName: 'roster',
          subcommand,
          channelId: staffChannelId,
        }),
      ).rejects.toBeInstanceOf(AdministrativePermissionDeniedError);

      for (const memberRoleIds of [
        ['666666666666666666'],
        ['777777777777777777'],
        ['888888888888888888'],
        ['999999999999999998'],
        [],
      ]) {
        await expect(
          policy.validateChannelPolicy({
            authorization: { ...ordinaryUser, memberRoleIds },
            commandName: 'roster',
            subcommand,
            channelId: staffChannelId,
          }),
        ).rejects.toBeInstanceOf(AdministrativePermissionDeniedError);
      }

      await expect(
        policy.validateChannelPolicy({
          authorization: owner,
          commandName: 'roster',
          subcommand,
          channelId: botCommandsChannelId,
        }),
      ).rejects.toBeInstanceOf(AdministrativeWrongChannelError);
    }
  });

  it('reports a missing staff channel to an authorized administrative caller', async () => {
    await new GuildSetupService(database.client).setupGuildOnly({
      authorization: administrator,
      guildName: 'Development League',
    });
    await grantBotPermission(database.client, guildId, administrator.discordUserId);
    const error = await policyError({
      authorization: administrator,
      commandName: 'team',
      subcommand: 'add',
    });
    expect(error).toBeInstanceOf(StaffChannelNotConfiguredError);
    expect(mapDiscordError(error).title).toBe('❌ Staff Channel Not Configured');
  });

  it('does not grant setup bootstrap to the bot permissions role', async () => {
    const setup = new GuildSetupService(database.client);
    await setup.setupGuildOnly({ authorization: administrator, guildName: 'Development League' });
    await grantBotPermission(database.client, guildId, administrator.discordUserId);
    await setup.setupRoles({
      authorization: administrator,
      guildName: 'Development League',
      botPermissionsRoleId,
      teamManagerRoleId: '666666666666666666',
      assistantManagerRoleId: '777777777777777777',
      playerManagerRoleId: '888888888888888888',
    });
    const error = await policyError({
      authorization: botPermissionsUser,
      commandName: 'setup',
      subcommand: 'channels',
    });
    expect(error).toBeInstanceOf(AdministrativePermissionDeniedError);
  });

  it('handles missing and single channel configurations without leaking staff', async () => {
    await configureChannelsAndRoles();
    const guild = await database.client.guild.findUniqueOrThrow({
      where: { discordGuildId: guildId },
    });

    await database.client.guildSettings.update({
      where: { guildId: guild.id },
      data: { botCommandsChannelId: null },
    });
    const ordinaryMissingBot = await policyError({
      authorization: ordinaryUser,
      commandName: 'team',
      subcommand: 'list',
    });
    expect(ordinaryMissingBot).toBeInstanceOf(BotCommandsChannelNotConfiguredError);
    expect(mapDiscordError(ordinaryMissingBot).description).not.toContain(staffChannelId);

    const globalStaffOnly = await policyError({
      authorization: administrator,
      commandName: 'team',
      subcommand: 'list',
    });
    expect(mapDiscordError(globalStaffOnly).description).toBe(
      `Use this command in <#${staffChannelId}>.`,
    );

    await database.client.guildSettings.update({
      where: { guildId: guild.id },
      data: { botCommandsChannelId, staffChannelId: null },
    });
    const globalBotOnly = await policyError({
      authorization: administrator,
      commandName: 'team',
      subcommand: 'list',
    });
    expect(mapDiscordError(globalBotOnly).description).toBe(
      `Use this command in <#${botCommandsChannelId}>.`,
    );

    await database.client.guildSettings.update({
      where: { guildId: guild.id },
      data: { botCommandsChannelId: null, staffChannelId: null },
    });
    const neitherConfigured = await policyError({
      authorization: administrator,
      commandName: 'roster',
      subcommand: 'view',
    });
    expect(neitherConfigured).toBeInstanceOf(BotCommandsChannelNotConfiguredError);
  });

  it('uses channel guidance before checking offer staff appointment', async () => {
    await configureChannelsAndRoles();
    const ordinaryError = await policyError({
      authorization: ordinaryUser,
      commandName: 'offer',
    });
    expect(mapDiscordError(ordinaryError).description).toBe(
      `Use this command in <#${botCommandsChannelId}>.`,
    );

    const globalError = await policyError({
      authorization: administrator,
      commandName: 'offer',
    });
    expect(mapDiscordError(globalError).description).toBe(
      `Use this command in <#${botCommandsChannelId}> or <#${staffChannelId}>.`,
    );

    await expect(
      new CommandChannelPolicyService(database.client).validateChannelPolicy({
        authorization: ordinaryUser,
        commandName: 'offer',
        channelId: staffChannelId,
      }),
    ).resolves.toBeUndefined();
  });

  it('ensures every BOT_OR_STAFF command used by an ordinary user in a wrong channel mentions only Bot Commands', async () => {
    await configureChannelsAndRoles();
    const botOrStaffCommands = [
      { commandName: 'health' },
      { commandName: 'team', subcommand: 'list' },
      { commandName: 'staff', subcommand: 'list' },
      { commandName: 'limit', subcommand: 'view' },
      { commandName: 'roster', subcommand: 'view' },
      { commandName: 'offer' },
      { commandName: 'demand' },
      { commandName: 'release' },
      { commandName: 'promote' },
      { commandName: 'demote' },
    ];

    for (const item of botOrStaffCommands) {
      const error = await policyError({
        authorization: ordinaryUser,
        commandName: item.commandName,
        ...(item.subcommand === undefined ? {} : { subcommand: item.subcommand }),
        channelId: unrelatedChannelId,
      });
      expect(error).toBeInstanceOf(WrongCommandChannelError);
      const mapped = mapDiscordError(error);
      expect(mapped.title).toBe('❌ Wrong Command Channel');
      expect(mapped.description).toBe(`Use this command in <#${botCommandsChannelId}>.`);
      expect(mapped.description).not.toContain(staffChannelId);
      expect(mapped.description).not.toContain('Staff Commands');
      expect(mapped.description).not.toContain('configured Staff Commands channel');
    }
  });

  it('rejection for normal player running /demand in Transfer Market matches exact live specification', async () => {
    await configureChannelsAndRoles();
    const transferChannelId = '333333333333333333';
    const error = await policyError({
      authorization: ordinaryUser,
      commandName: 'demand',
      channelId: transferChannelId,
    });
    expect(error).toBeInstanceOf(WrongCommandChannelError);
    const mapped = mapDiscordError(error);
    expect(mapped.title).toBe('❌ Wrong Command Channel');
    expect(mapped.description).toBe(`Use this command in <#${botCommandsChannelId}>.`);
  });

  it('keeps debug reset database-authorized and staff channel restricted', async () => {
    await configureChannelsAndRoles();
    const roleOnlyError = await policyError({
      authorization: { ...ordinaryUser, memberRoleIds: [botPermissionsRoleId] },
      commandName: 'debugreset',
      channelId: staffChannelId,
    });
    expect(mapDiscordError(roleOnlyError).title).toBe('❌ Permission Denied');

    const wrongChannelError = await policyError({
      authorization: administrator,
      commandName: 'debugreset',
      channelId: botCommandsChannelId,
    });
    expect(wrongChannelError).toBeInstanceOf(AdministrativeWrongChannelError);
    expect(mapDiscordError(wrongChannelError).description).toBe(
      `Use this command in <#${staffChannelId}>.`,
    );
  });

  it('classifies grouped command subcommands with explicit final scopes', () => {
    const policy = new CommandChannelPolicyService(database.client);
    for (const [commandName, subcommand] of [
      ['demand', null],
      ['release', null],
      ['promote', null],
      ['demote', null],
      ['offer', null],
      ['roster', 'view'],
      ['team', 'list'],
      ['staff', 'list'],
      ['limit', 'view'],
    ] as const) {
      expect(policy.getScope(commandName, subcommand)).toBe('BOT_OR_STAFF');
    }
    for (const [commandName, subcommand] of [
      ['setup', 'league'],
      ['setup', 'channels'],
      ['setup', 'roles'],
      ['setup', 'view'],
      ['team', 'add'],
      ['team', 'edit'],
      ['team', 'disband'],
      ['staff', 'appoint'],
      ['staff', 'remove'],
      ['roster', 'add'],
      ['roster', 'remove'],
      ['limit', 'default'],
      ['limit', 'team'],
      ['limit', 'reset'],
      ['debugreset', null],
    ] as const) {
      expect(policy.getScope(commandName, subcommand)).toBe('STAFF_ONLY');
    }
  });
});
