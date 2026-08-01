import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { commandDefinitions } from '../../src/bot/commands.js';
import type { CommandRegistry } from '../../src/bot/command-registry.js';
import { handleInteractionCreate } from '../../src/bot/interaction-handler.js';
import type {
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  EditedInteractionResponse,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import { AuthorizationError, ConfigurationError } from '../../src/domain/errors.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { GuildRepository } from '../../src/repositories/guild-repository.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { AuthorizationService } from '../../src/services/authorization-service.js';
import { ClubManagementService } from '../../src/services/club-management-service.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import { GuildSetupService } from '../../src/services/guild-setup-service.js';
import { GuildConfigurationService } from '../../src/services/guild-configuration-service.js';
import { LimitManagementService } from '../../src/services/limit-management-service.js';
import { RosterManagementService } from '../../src/services/roster-management-service.js';
import { StaffManagementService } from '../../src/services/staff-management-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

class MockCommandInteraction implements CommandInteraction {
  public readonly replies: SafeInteractionResponse[] = [];
  public readonly edits: EditedInteractionResponse[] = [];
  public readonly followUps: SafeInteractionResponse[] = [];
  public replied = false;
  public deferred = false;

  public constructor(
    public readonly commandName: string,
    public readonly optionsData: Record<string, string | number | null>,
    public readonly channelId: string,
    public readonly authorization: AuthorizationInput,
  ) {}

  public get guildId(): string | undefined {
    return this.authorization.discordGuildId;
  }

  public get guildName(): string | undefined {
    return 'Test Guild';
  }

  public get guildOwnerId(): string | undefined {
    return this.authorization.guildOwnerId;
  }

  public get userId(): string {
    return this.authorization.discordUserId;
  }

  public get memberRoleIds(): readonly string[] {
    return this.authorization.memberRoleIds;
  }

  public get hasAdministratorPermission(): boolean {
    return this.authorization.hasAdministratorPermission;
  }

  public get options(): CommandInteractionOptions {
    return {
      getSubcommand: () => {
        const val = this.optionsData['subcommand'];
        return typeof val === 'string' ? val : null;
      },
      getString: (name: string) => {
        const val = this.optionsData[name];
        return typeof val === 'string' ? val : null;
      },
      getInteger: (name: string) => {
        const val = this.optionsData[name];
        return typeof val === 'number' ? val : null;
      },
      getUser: (name: string) => {
        const val = this.optionsData[name];
        return typeof val === 'string' ? { id: val, bot: false } : null;
      },
      getRole: (name: string) => {
        const val = this.optionsData[name];
        return typeof val === 'string' ? { id: val } : null;
      },
      getChannel: (name: string) => {
        const val = this.optionsData[name];
        return typeof val === 'string' ? { id: val, type: 0 } : null;
      },
    };
  }

  public reply(response: SafeInteractionResponse): Promise<void> {
    this.replies.push(response);
    this.replied = true;
    return Promise.resolve();
  }

  public deferReply(): Promise<void> {
    this.deferred = true;
    return Promise.resolve();
  }

  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.edits.push(response);
    this.replied = true;
    return Promise.resolve();
  }

  public followUp(response: SafeInteractionResponse): Promise<void> {
    this.followUps.push(response);
    return Promise.resolve();
  }

  public deleteReply(): Promise<void> {
    return Promise.resolve();
  }
}

describe('Stage 4A Hotfix Verification', () => {
  let context: TestDatabase;
  let logger: MemoryLogger;
  let commandContext: CommandContext;

  const guildId = '100000000000000001';
  const botCmdChannel = '111111111111111111';
  const staffChannel = '222222222222222222';
  const botPermsRoleId = '555555555555555555';

  const adminAuth: AuthorizationInput = {
    discordGuildId: guildId,
    discordUserId: '200000000000000001',
    guildOwnerId: '200000000000000001',
    memberRoleIds: [],
    hasAdministratorPermission: true,
  };

  const botPermsUserAuth: AuthorizationInput = {
    discordGuildId: guildId,
    discordUserId: '200000000000000002',
    guildOwnerId: '200000000000000001',
    memberRoleIds: [botPermsRoleId],
    hasAdministratorPermission: false,
  };

  const normalUserAuth: AuthorizationInput = {
    discordGuildId: guildId,
    discordUserId: '200000000000000003',
    guildOwnerId: '200000000000000001',
    memberRoleIds: [],
    hasAdministratorPermission: false,
  };

  beforeAll(() => {
    context = createTestDatabase();
  });

  afterAll(async () => {
    await destroyTestDatabase(context);
  });

  beforeEach(async () => {
    await clearDatabase(context.client);
    logger = new MemoryLogger();

    const guildSetupService = new GuildSetupService(context.client);
    const clubManagementService = new ClubManagementService(context.client);
    const staffManagementService = new StaffManagementService(context.client);
    const rosterManagementService = new RosterManagementService(context.client);
    const limitManagementService = new LimitManagementService(context.client);
    const commandChannelPolicyService = new CommandChannelPolicyService(context.client);

    commandContext = {
      logger,
      database: context.client,
      databaseHealth: { check: () => Promise.resolve(true) },
      guildConfigurationService: new GuildConfigurationService(
        new GuildRepository(context.client),
        new ClubRepository(context.client),
      ),
      offerAcceptanceService: { acceptOffer: vi.fn() },
      guildSetupService,
      clubManagementService,
      staffManagementService,
      rosterManagementService,
      limitManagementService,
      commandChannelPolicyService,
      offerDeliveryService: {
        createAndDeliver: vi.fn(() =>
          Promise.resolve({
            offer: {
              id: 'offer-1',
              guildId,
              clubId: 'club-1',
              playerUserId: 'user-1',
              offeredByUserId: 'offered-by',
              messageChannelId: null,
              messageId: null,
              discordChannelId: null,
              discordMessageId: null,
              status: 'PENDING' as const,
              expiresAt: new Date(),
              respondedAt: null,
              cancelledAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            player: {
              id: 'player-1',
              guildId,
              discordUserId: '300000000000000001',
              robloxUserId: null,
              robloxUsername: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            offeredBy: {
              id: 'offered-by',
              discordUserId: '200000000000000001',
              robloxUserId: null,
              robloxUsername: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            destinationClub: {
              id: 'club-1',
              guildId,
              discordRoleId: 'role-1',
              logoUrl: null,
              emoji: '<:ars:123456789012345678>',
              squadLimitOverride: null,
              active: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            sourceClub: null,
            leagueName: 'Test League',
            activePlayerCount: 5,
            effectiveSquadLimit: 17,
          }),
        ),
      },
      offerButtonHandler: { handle: vi.fn() },
      setupAuditService: { publish: vi.fn(() => Promise.resolve(true)) },
    };
  });

  async function setupLeagueAndChannels(): Promise<void> {
    await commandContext.guildSetupService.setupChannels({
      authorization: adminAuth,
      guildName: 'Test League',
      botCommandsChannelId: botCmdChannel,
      staffChannelId: staffChannel,
      transferChannelId: '333333333333333333',
      auditChannelId: '444444444444444444',
    });
    await commandContext.guildSetupService.setupRoles({
      authorization: adminAuth,
      guildName: 'Test League',
      botPermissionsRoleId: botPermsRoleId,
      teamManagerRoleId: '666666666666666666',
      assistantManagerRoleId: '777777777777777777',
      playerManagerRoleId: '888888888888888888',
    });
  }

  describe('Authorization Rules', () => {
    it('grants global access to user with botPermissionsRoleId or Discord Administrator', async () => {
      await setupLeagueAndChannels();
      const authService = new AuthorizationService(context.client);

      await expect(authService.authorizeLeagueAdministration(adminAuth)).resolves.toBeDefined();
      await expect(
        authService.authorizeLeagueAdministration(botPermsUserAuth),
      ).resolves.toBeDefined();
      await expect(authService.authorizeLeagueAdministration(normalUserAuth)).rejects.toThrow(
        AuthorizationError,
      );
    });

    it('does not allow TM/ATM/PM alone to grant global administration access', async () => {
      await setupLeagueAndChannels();

      const club = await commandContext.clubManagementService.create({
        authorization: adminAuth,
        discordRoleId: '300000000000000001',
        emoji: '🔵',
      });

      const tmUserId = '700000000000000001';
      await commandContext.staffManagementService.appoint({
        authorization: adminAuth,
        clubId: club.id,
        staffDiscordUserId: tmUserId,
        staffIsBot: false,
        staffType: 'TEAM_MANAGER',
      });

      const tmAuth: AuthorizationInput = {
        discordGuildId: guildId,
        discordUserId: tmUserId,
        guildOwnerId: adminAuth.guildOwnerId,
        memberRoleIds: ['666666666666666666'], // team role without bot permissions
        hasAdministratorPermission: false,
      };

      const authService = new AuthorizationService(context.client);
      await expect(authService.authorizeLeagueAdministration(tmAuth)).rejects.toThrow(
        AuthorizationError,
      );
    });
  });

  describe('Channel Policy Matrix', () => {
    it('/health works in bot commands and staff channels, fails elsewhere', async () => {
      await setupLeagueAndChannels();
      const policyService = new CommandChannelPolicyService(context.client);

      await expect(
        policyService.validateChannelPolicy({
          authorization: adminAuth,
          channelId: botCmdChannel,
          commandName: 'health',
        }),
      ).resolves.toBeUndefined();

      await expect(
        policyService.validateChannelPolicy({
          authorization: adminAuth,
          channelId: staffChannel,
          commandName: 'health',
        }),
      ).resolves.toBeUndefined();

      await expect(
        policyService.validateChannelPolicy({
          authorization: adminAuth,
          channelId: '999999999999999999',
          commandName: 'health',
        }),
      ).rejects.toThrow(ConfigurationError);
    });

    it('mutations work only in staff channel', async () => {
      await setupLeagueAndChannels();
      const policyService = new CommandChannelPolicyService(context.client);

      await expect(
        policyService.validateChannelPolicy({
          authorization: adminAuth,
          channelId: botCmdChannel,
          commandName: 'team',
          subcommand: 'add',
        }),
      ).rejects.toThrow(ConfigurationError);

      await expect(
        policyService.validateChannelPolicy({
          authorization: adminAuth,
          channelId: staffChannel,
          commandName: 'team',
          subcommand: 'add',
        }),
      ).resolves.toBeUndefined();
    });

    it('bootstrap exception allows setup for Discord Administrator in unconfigured channel before setup', async () => {
      const policyService = new CommandChannelPolicyService(context.client);

      // administrator bootstrap in any channel
      await expect(
        policyService.validateChannelPolicy({
          authorization: {
            ...adminAuth,
            discordGuildId: '990000000000000099',
          },
          channelId: '990000000000000088',
          commandName: 'setup',
          subcommand: 'channels',
        }),
      ).resolves.toBeUndefined();

      // non administrator bootstrap attempt
      await expect(
        policyService.validateChannelPolicy({
          authorization: {
            ...normalUserAuth,
            discordGuildId: '990000000000000099',
          },
          channelId: '990000000000000088',
          commandName: 'setup',
          subcommand: 'channels',
        }),
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe('Command Naming and Subcommands', () => {
    it('contains /setup league and does not contain /setup guild', () => {
      const registry = {
        resolve: (name: string) => commandDefinitions.find((c) => c.data.name === name) ?? null,
      };
      const setupCmd = registry.resolve('setup');
      expect(setupCmd).not.toBeNull();
      const json = setupCmd?.data.toJSON() as {
        options?: Array<{ name: string; options?: Array<{ name: string }> }>;
      };
      const subcommands = (json.options ?? []).map((o) => o.name);

      expect(subcommands).toContain('league');
      expect(subcommands).not.toContain('guild');

      const rolesSub = (json.options ?? []).find((o) => o.name === 'roles');
      const roleOptions = (rolesSub?.options ?? []).map((o) => o.name);
      expect(roleOptions).toContain('bot_permissions');
      expect(roleOptions).not.toContain('league_admin');
    });

    it('exposes safe /team remove subcommand', () => {
      const teamCmd = commandDefinitions.find((c) => c.data.name === 'team');
      expect(teamCmd).not.toBeNull();
      const json = teamCmd?.data.toJSON() as { options?: Array<{ name: string }> };
      const subcommands = (json.options ?? []).map((o) => o.name);

      expect(subcommands).toContain('remove');
    });
  });

  describe('Embed Responses & Error Handling', () => {
    it('returns ephemeral embed when command throws a known or unknown error', async () => {
      await setupLeagueAndChannels();

      const registry = {
        resolve: (name: string) => commandDefinitions.find((c) => c.data.name === name) ?? null,
      } as unknown as CommandRegistry;

      const interaction = new MockCommandInteraction(
        'team',
        {
          subcommand: 'add',
          role: '300000000000000001',
          emoji: '⚽',
        },
        botCmdChannel, // wrong channel for mutation
        adminAuth,
      );

      await handleInteractionCreate(interaction, registry, commandContext, logger);

      expect(interaction.replies).toHaveLength(1);
      const reply = interaction.replies[0];
      expect(reply?.flags).toBe(64); // ephemeral message flag
      expect(reply?.embeds).toBeDefined();
      expect(reply?.embeds?.[0]?.data.title).toBe('❌ Wrong Command Channel');
    });

    it('returns an ephemeral embed for a successful mutation in the staff channel', async () => {
      await setupLeagueAndChannels();

      const registry = {
        resolve: (name: string) => commandDefinitions.find((c) => c.data.name === name) ?? null,
      } as unknown as CommandRegistry;

      const interaction = new MockCommandInteraction(
        'team',
        {
          subcommand: 'add',
          role: '300000000000000010',
          emoji: '⚽',
        },
        staffChannel,
        adminAuth,
      );

      await handleInteractionCreate(interaction, registry, commandContext, logger);

      expect(interaction.edits).toHaveLength(1);
      const edit = interaction.edits[0];
      expect(edit?.embeds).toBeDefined();
      expect(edit?.embeds?.[0]?.data.title).toBe('✅ Team Added');
    });

    it('/team remove deactivates the team while preserving database history', async () => {
      await setupLeagueAndChannels();

      const club = await commandContext.clubManagementService.create({
        authorization: adminAuth,
        discordRoleId: '300000000000000099',
        emoji: '🔴',
      });

      const registry = {
        resolve: (name: string) => commandDefinitions.find((c) => c.data.name === name) ?? null,
      } as unknown as CommandRegistry;

      const interaction = new MockCommandInteraction(
        'team',
        { subcommand: 'remove', team: club.id },
        staffChannel,
        adminAuth,
      );

      await handleInteractionCreate(interaction, registry, commandContext, logger);

      expect(interaction.edits).toHaveLength(1);
      const edit = interaction.edits[0];
      expect(edit?.embeds?.[0]?.data.title).toBe('✅ Team Removed');
      expect(edit?.embeds?.[0]?.data.description).toContain('The team is now inactive.');

      // verify the team remains stored and inactive
      const dbClub = await context.client.club.findUnique({ where: { id: club.id } });
      expect(dbClub).not.toBeNull();
      expect(dbClub?.active).toBe(false);
    });
  });
});
