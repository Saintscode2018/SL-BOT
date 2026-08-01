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
    subcommand?: string;
    channelId?: string;
  }): Promise<unknown> {
    try {
      await new CommandChannelPolicyService(database.client).validateChannelPolicy({
        authorization: input.authorization,
        commandName: input.commandName,
        subcommand: input.subcommand,
        channelId: input.channelId ?? unrelatedChannelId,
      });
      throw new Error('expected policy failure');
    } catch (error: unknown) {
      return error;
    }
  }

  it('guides ordinary informational users only to bot commands', async () => {
    await configureChannelsAndRoles();
    const error = await policyError({ authorization: ordinaryUser, commandName: 'roster' });
    expect(error).toBeInstanceOf(WrongCommandChannelError);
    const mapped = mapDiscordError(error);
    expect(mapped.title).toBe('❌ Wrong Command Channel');
    expect(mapped.description).toBe(`Please use <#${botCommandsChannelId}> for bot commands.`);
    expect(mapped.description).not.toContain(staffChannelId);
  });

  it('guides globally authorized informational users to both configured channels', async () => {
    await configureChannelsAndRoles();
    const error = await policyError({ authorization: administrator, commandName: 'health' });
    const mapped = mapDiscordError(error);
    expect(mapped.description).toBe(
      `Use either <#${botCommandsChannelId}> or <#${staffChannelId}> for this command.`,
    );
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
  });

  it('directs authorized administrative callers only to staff commands', async () => {
    await configureChannelsAndRoles();
    for (const authorization of [botPermissionsUser, administrator]) {
      const error = await policyError({
        authorization,
        commandName: 'limit',
        subcommand: 'team',
        channelId: botCommandsChannelId,
      });
      expect(error).toBeInstanceOf(AdministrativeWrongChannelError);
      expect(mapDiscordError(error).description).toContain(`<#${staffChannelId}>`);
    }
  });

  it('classifies banner configuration as a protected staff channel mutation', async () => {
    await configureChannelsAndRoles();
    const unauthorized = await policyError({
      authorization: ordinaryUser,
      commandName: 'bannerconfig',
      channelId: botCommandsChannelId,
    });
    expect(unauthorized).toBeInstanceOf(AdministrativePermissionDeniedError);
    expect(mapDiscordError(unauthorized).description).not.toContain(staffChannelId);

    for (const authorization of [administrator, botPermissionsUser]) {
      await expect(
        new CommandChannelPolicyService(database.client).validateChannelPolicy({
          authorization,
          commandName: 'bannerconfig',
          channelId: staffChannelId,
        }),
      ).resolves.toBeUndefined();
      const wrongChannel = await policyError({
        authorization,
        commandName: 'bannerconfig',
        channelId: botCommandsChannelId,
      });
      expect(wrongChannel).toBeInstanceOf(AdministrativeWrongChannelError);
    }
  });

  it('reports a missing staff channel to an authorized administrative caller', async () => {
    await new GuildSetupService(database.client).setupGuildOnly({
      authorization: administrator,
      guildName: 'Development League',
    });
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
      `Please use <#${staffChannelId}> for this command.`,
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
      `Please use <#${botCommandsChannelId}> for this command.`,
    );

    await database.client.guildSettings.update({
      where: { guildId: guild.id },
      data: { botCommandsChannelId: null, staffChannelId: null },
    });
    const neitherConfigured = await policyError({
      authorization: administrator,
      commandName: 'roster',
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
      `Please use <#${botCommandsChannelId}> for bot commands.`,
    );

    const globalError = await policyError({
      authorization: administrator,
      commandName: 'offer',
    });
    expect(mapDiscordError(globalError).description).toBe(
      `Use either <#${botCommandsChannelId}> or <#${staffChannelId}> for this command.`,
    );

    await expect(
      new CommandChannelPolicyService(database.client).validateChannelPolicy({
        authorization: ordinaryUser,
        commandName: 'offer',
        channelId: staffChannelId,
      }),
    ).resolves.toBeUndefined();
  });

  it('keeps debug reset administrator only and staff channel restricted', async () => {
    await configureChannelsAndRoles();
    const roleOnlyError = await policyError({
      authorization: botPermissionsUser,
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
  });
});
