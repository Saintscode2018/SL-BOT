import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ConfigurationError, ValidationError } from '../../src/domain/errors.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { ClubManagementService } from '../../src/services/club-management-service.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import { GuildSetupService } from '../../src/services/guild-setup-service.js';
import { LimitManagementService } from '../../src/services/limit-management-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';

describe('Stage 4A Services and Policies', () => {
  let context: TestDatabase;

  beforeAll(() => {
    context = createTestDatabase();
  });

  afterAll(async () => {
    await destroyTestDatabase(context);
  });

  beforeEach(async () => {
    await clearDatabase(context.client);
  });

  const ownerAuth = (discordGuildId = '100000000000000001'): AuthorizationInput => ({
    discordGuildId,
    discordUserId: '200000000000000001',
    guildOwnerId: '200000000000000001',
    memberRoleIds: [],
    hasAdministratorPermission: true,
  });

  describe('GuildSetupService Subcommands & View', () => {
    it('initializes guild configuration via setupGuildOnly', async () => {
      const setupService = new GuildSetupService(context.client);
      const result = await setupService.setupGuildOnly({
        authorization: ownerAuth(),
        guildName: 'Test Guild',
        offerTimeoutSeconds: 3600,
      });

      expect(result.guild.name).toBe('Test Guild');
      expect(result.settings.offerTimeoutSeconds).toBe(3600);
      expect(result.settings.defaultSquadLimit).toBe(17);
    });

    it('configures channels via setupChannels', async () => {
      const setupService = new GuildSetupService(context.client);
      const result = await setupService.setupChannels({
        authorization: ownerAuth(),
        guildName: 'Test Guild',
        botCommandsChannelId: '111111111111111111',
        staffChannelId: '222222222222222222',
        transferChannelId: '333333333333333333',
        auditChannelId: '444444444444444444',
      });

      expect(result.settings.botCommandsChannelId).toBe('111111111111111111');
      expect(result.settings.staffChannelId).toBe('222222222222222222');
      expect(result.settings.transferChannelId).toBe('333333333333333333');
      expect(result.settings.auditChannelId).toBe('444444444444444444');
    });

    it('configures roles via setupRoles', async () => {
      const setupService = new GuildSetupService(context.client);
      const result = await setupService.setupRoles({
        authorization: ownerAuth(),
        guildName: 'Test Guild',
        botPermissionsRoleId: '555555555555555555',
        teamManagerRoleId: '666666666666666666',
        assistantManagerRoleId: '777777777777777777',
        playerManagerRoleId: '888888888888888888',
      });

      expect(result.settings.botPermissionsRoleId).toBe('555555555555555555');
      expect(result.settings.teamManagerRoleId).toBe('666666666666666666');
      expect(result.settings.assistantManagerRoleId).toBe('777777777777777777');
      expect(result.settings.playerManagerRoleId).toBe('888888888888888888');
    });

    it('returns formatted setup view including missing items', async () => {
      const setupService = new GuildSetupService(context.client);
      await setupService.setupGuildOnly({
        authorization: ownerAuth(),
        guildName: 'Test Guild',
      });

      const view = await setupService.getView('100000000000000001');
      expect(view.guildName).toBe('Test Guild');
      expect(view.defaultSquadLimit).toBe(17);
      expect(view.missingConfigurations).toContain('Bot Commands Channel');
      expect(view.missingConfigurations).toContain('Staff Channel');
      expect(view.missingConfigurations).toContain('Bot Permissions Role');
    });
  });

  describe('CommandChannelPolicyService', () => {
    it('requires configured command channels for health', async () => {
      const policyService = new CommandChannelPolicyService(context.client);
      await expect(
        policyService.validateChannelPolicy({
          authorization: ownerAuth(),
          channelId: '999999999999999999',
          commandName: 'health',
        }),
      ).rejects.toThrow(ConfigurationError);
    });

    it('allows /setup bootstrap when staff channel is not yet configured', async () => {
      const policyService = new CommandChannelPolicyService(context.client);
      await expect(
        policyService.validateChannelPolicy({
          authorization: ownerAuth(),
          channelId: '999999999999999999',
          commandName: 'setup',
          subcommand: 'channels',
        }),
      ).resolves.toBeUndefined();
    });

    it('enforces bot commands channel for public commands', async () => {
      const setupService = new GuildSetupService(context.client);
      await setupService.setupChannels({
        authorization: ownerAuth(),
        guildName: 'Test Guild',
        botCommandsChannelId: '111111111111111111',
        staffChannelId: '222222222222222222',
        transferChannelId: '333333333333333333',
        auditChannelId: '444444444444444444',
      });

      const policyService = new CommandChannelPolicyService(context.client);

      // wrong command channel
      await expect(
        policyService.validateChannelPolicy({
          authorization: ownerAuth(),
          channelId: '999999999999999999', // arbitrary channel
          commandName: 'roster',
        }),
      ).rejects.toThrow(ConfigurationError);

      // bot commands channel
      await expect(
        policyService.validateChannelPolicy({
          authorization: ownerAuth(),
          channelId: '111111111111111111', // bot commands channel
          commandName: 'roster',
        }),
      ).resolves.toBeUndefined();

      // staff channel
      await expect(
        policyService.validateChannelPolicy({
          authorization: ownerAuth(),
          channelId: '222222222222222222', // staff channel
          commandName: 'roster',
        }),
      ).resolves.toBeUndefined();
    });

    it('enforces staff channel for administrative commands even for admins', async () => {
      const setupService = new GuildSetupService(context.client);
      await setupService.setupChannels({
        authorization: ownerAuth(),
        guildName: 'Test Guild',
        botCommandsChannelId: '111111111111111111',
        staffChannelId: '222222222222222222',
        transferChannelId: '333333333333333333',
        auditChannelId: '444444444444444444',
      });

      const policyService = new CommandChannelPolicyService(context.client);

      // wrong administrator channel
      await expect(
        policyService.validateChannelPolicy({
          authorization: ownerAuth(),
          channelId: '111111111111111111', // bot commands channel
          commandName: 'team',
          subcommand: 'add',
        }),
      ).rejects.toThrow(ConfigurationError);

      // staff channel
      await expect(
        policyService.validateChannelPolicy({
          authorization: ownerAuth(),
          channelId: '222222222222222222', // staff channel
          commandName: 'team',
          subcommand: 'add',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('LimitManagementService', () => {
    it('manages default limit and team overrides', async () => {
      const setupService = new GuildSetupService(context.client);
      await setupService.setupGuildOnly({
        authorization: ownerAuth(),
        guildName: 'Test Guild',
      });

      const clubService = new ClubManagementService(context.client);
      const club = await clubService.create({
        authorization: ownerAuth(),
        name: 'Arsenal',
        shortName: 'ARS',
        discordRoleId: '300000000000000001',
      });

      const limitService = new LimitManagementService(context.client);

      // initial default limit
      const view1 = await limitService.viewLimit('100000000000000001');
      expect(view1.defaultSquadLimit).toBe(17);
      expect(view1.clubsWithOverrides).toHaveLength(0);

      // set default limit
      await limitService.setDefaultLimit({ authorization: ownerAuth(), amount: 20 });
      const view2 = await limitService.viewLimit('100000000000000001');
      expect(view2.defaultSquadLimit).toBe(20);

      // set team override
      const overrideResult = await limitService.setTeamLimit({
        authorization: ownerAuth(),
        clubId: club.id,
        amount: 15,
      });
      expect(overrideResult.override).toBe(15);
      expect(overrideResult.effectiveLimit).toBe(15);

      const view3 = await limitService.viewLimit('100000000000000001', club.id);
      expect(view3.clubsWithOverrides).toHaveLength(1);
      expect(view3.selectedClub?.effectiveLimit).toBe(15);

      // reset team limit
      const resetResult = await limitService.resetTeamLimit({
        authorization: ownerAuth(),
        clubId: club.id,
      });
      expect(resetResult.effectiveLimit).toBe(20); // inherits default
    });

    it('rejects invalid limit values', async () => {
      const setupService = new GuildSetupService(context.client);
      await setupService.setupGuildOnly({
        authorization: ownerAuth(),
        guildName: 'Test Guild',
      });

      const limitService = new LimitManagementService(context.client);
      await expect(
        limitService.setDefaultLimit({ authorization: ownerAuth(), amount: 0 }),
      ).rejects.toThrow(ValidationError);

      await expect(
        limitService.setDefaultLimit({ authorization: ownerAuth(), amount: 101 }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('Team Add & Edit Workflows', () => {
    it('creates team with inherited limit and allows editing properties', async () => {
      const setupService = new GuildSetupService(context.client);
      await setupService.setupGuildOnly({
        authorization: ownerAuth(),
        guildName: 'Test Guild',
      });

      const clubService = new ClubManagementService(context.client);
      const club = await clubService.create({
        authorization: ownerAuth(),
        name: 'Chelsea FC',
        shortName: 'CHE',
        discordRoleId: '300000000000000002',
      });

      expect(club.squadLimitOverride).toBeNull();

      const edited = await clubService.edit({
        authorization: ownerAuth(),
        clubId: club.id,
        name: 'Chelsea Football Club',
      });

      expect(edited.name).toBe('Chelsea Football Club');
      expect(edited.shortName).toBe('CHE');
    });

    it('requires at least one edit parameter', async () => {
      const setupService = new GuildSetupService(context.client);
      await setupService.setupGuildOnly({
        authorization: ownerAuth(),
        guildName: 'Test Guild',
      });

      const clubService = new ClubManagementService(context.client);
      const club = await clubService.create({
        authorization: ownerAuth(),
        name: 'Liverpool',
        shortName: 'LIV',
        discordRoleId: '300000000000000003',
      });

      await expect(
        clubService.edit({
          authorization: ownerAuth(),
          clubId: club.id,
        }),
      ).rejects.toThrow(ValidationError);
    });
  });
});
