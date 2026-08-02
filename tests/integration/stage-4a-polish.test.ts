import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';

import { commandDefinitions } from '../../src/bot/commands.js';
import type { CommandRegistry } from '../../src/bot/command-registry.js';
import { DiscordMemberRoleAdapter } from '../../src/bot/discord-member-role-adapter.js';
import { mapDiscordError } from '../../src/bot/error-mapper.js';
import { handleInteractionCreate } from '../../src/bot/interaction-handler.js';
import type {
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  EditedInteractionResponse,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import {
  ClubInactiveError,
  StaffAlreadyAppointedError,
  TeamPositionOccupiedError,
} from '../../src/domain/errors.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { ClubManagementService } from '../../src/services/club-management-service.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import { GuildConfigurationService } from '../../src/services/guild-configuration-service.js';
import { GuildSetupService } from '../../src/services/guild-setup-service.js';
import { LimitManagementService } from '../../src/services/limit-management-service.js';
import { MemberRoleSynchronizationService } from '../../src/services/member-role-synchronization-service.js';
import { RoleSynchronizedMutationService } from '../../src/services/role-synchronized-mutation-service.js';
import { RosterManagementService } from '../../src/services/roster-management-service.js';
import { RosterMutationService } from '../../src/services/roster-mutation-service.js';
import { StaffManagementService } from '../../src/services/staff-management-service.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { GuildRepository } from '../../src/repositories/guild-repository.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

class MockCommandInteraction implements CommandInteraction {
  public replies: SafeInteractionResponse[] = [];
  public edits: EditedInteractionResponse[] = [];
  public followUps: SafeInteractionResponse[] = [];
  public replied = false;
  public deferred = false;
  public guildEmojis = [
    { id: '123456789012345678', name: 'arsenal', animated: false },
    { id: '987654321098765432', name: 'chelsea_fire', animated: true },
  ];

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
    return 'Development League';
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

  public getGuildEmojis(): typeof this.guildEmojis {
    return this.guildEmojis;
  }

  public getGuildRoleMetadata(roleId: string) {
    return { id: roleId, name: 'T1', color: 0xf97316 };
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
    this.replied = true;
    this.replies.push(response);
    return Promise.resolve();
  }

  public deferReply(): Promise<void> {
    this.deferred = true;
    return Promise.resolve();
  }

  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.edits.push(response);
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

describe('Stage 4A Polish Verification', () => {
  let context: TestDatabase;
  let logger: MemoryLogger;
  let commandContext: CommandContext;

  const guildId = '100000000000000001';
  const staffChannel = '222222222222222222';
  const botCmdChannel = '111111111111111111';
  const adminAuth: AuthorizationInput = {
    discordGuildId: guildId,
    discordUserId: '200000000000000001',
    guildOwnerId: '200000000000000001',
    memberRoleIds: [],
    hasAdministratorPermission: true,
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
    const guildConfigurationService = new GuildConfigurationService(
      new GuildRepository(context.client),
      new ClubRepository(context.client),
    );

    commandContext = {
      logger,
      database: context.client,
      databaseHealth: { check: () => Promise.resolve(true) },
      guildConfigurationService,
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
              emoji: '⚽',
              squadLimitOverride: null,
              active: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            sourceClub: null,
            leagueName: 'Development League',
            activePlayerCount: 5,
            effectiveSquadLimit: 17,
          }),
        ),
      },
      offerButtonHandler: { handle: vi.fn() },
      setupAuditService: { publish: vi.fn(() => Promise.resolve(true)) },
    };

    await guildSetupService.setupGuildOnly({
      authorization: adminAuth,
      guildName: 'Development League',
    });

    await guildSetupService.setupChannels({
      authorization: adminAuth,
      guildName: 'Development League',
      botCommandsChannelId: botCmdChannel,
      staffChannelId: staffChannel,
      transferChannelId: '333333333333333333',
      auditChannelId: '444444444444444444',
    });
    await guildSetupService.setupRoles({
      authorization: adminAuth,
      guildName: 'Development League',
      botPermissionsRoleId: '555555555555555555',
      teamManagerRoleId: '666666666666666666',
      assistantManagerRoleId: '777777777777777777',
      playerManagerRoleId: '888888888888888888',
    });
  });

  describe('1. Specific Team-Conflict Errors', () => {
    it('detects duplicate team role and identifies existing team', async () => {
      const clubService = new ClubManagementService(context.client);
      await clubService.create({
        authorization: adminAuth,
        discordRoleId: '300000000000000001',
        emoji: '⚽',
      });

      await expect(
        clubService.create({
          authorization: adminAuth,
          discordRoleId: '300000000000000001',
          emoji: '🔴',
        }),
      ).rejects.toThrow('⚽ <@&300000000000000001>');
    });
  });

  describe('2. Staff Appointment Conflict Errors', () => {
    it.each([
      ['TEAM_MANAGER', '666666666666666666'],
      ['ASSISTANT_MANAGER', '777777777777777777'],
      ['PLAYER_MANAGER', '888888888888888888'],
    ] as const)(
      'executes /staff remove through Discord synchronization for %s',
      async (staffType, globalStaffRoleId) => {
        const club = await commandContext.clubManagementService.create({
          authorization: adminAuth,
          discordRoleId: '300000000000000001',
          emoji: '⚽',
        });
        const targetDiscordUserId = '700000000000000001';
        await new StaffManagementService(context.client).appoint({
          authorization: adminAuth,
          clubId: club.id,
          staffDiscordUserId: targetDiscordUserId,
          staffType,
          staffIsBot: false,
        });

        let completeRoleRemoval: (() => void) | undefined;
        const roleRemovalPending = new Promise<void>((resolve) => {
          completeRoleRemoval = resolve;
        });
        const remove = vi.fn((roleId: string) => {
          void roleId;
          return roleRemovalPending;
        });
        const member = {
          manageable: true,
          roles: {
            cache: new Map([
              [club.discordRoleId, {}],
              [globalStaffRoleId, {}],
            ]),
            remove,
            add: vi.fn(() => Promise.resolve()),
          },
        };
        const fetchMember = vi.fn(() => Promise.resolve(member));
        const roleCache = new Map([
          [club.discordRoleId, { managed: false, position: 10 }],
          [globalStaffRoleId, { managed: false, position: 20 }],
        ]);
        const guild = {
          members: {
            fetch: fetchMember,
            fetchMe: vi.fn(),
            me: {
              permissions: { has: () => true },
              roles: { highest: { position: 100 } },
            },
          },
          roles: { cache: roleCache, fetch: vi.fn() },
        };
        const discord = {
          guilds: {
            cache: new Map([[guildId, guild]]),
            fetch: vi.fn(),
          },
        } as unknown as Client;
        const announcements = { publish: vi.fn(() => Promise.resolve(true)) };
        const synchronization = new RoleSynchronizedMutationService(
          new MemberRoleSynchronizationService(new DiscordMemberRoleAdapter(discord), logger),
          announcements,
          logger,
        );
        commandContext.staffManagementService = new StaffManagementService(
          context.client,
          new RosterMutationService(context.client, synchronization),
        );
        const interaction = new MockCommandInteraction(
          'staff',
          { subcommand: 'remove', team: club.id, staff_type: staffType },
          staffChannel,
          adminAuth,
        );
        const registry = {
          resolve: (name: string) =>
            commandDefinitions.find((candidate) => candidate.data.name === name) ?? null,
        } as unknown as CommandRegistry;

        const commandExecution = handleInteractionCreate(
          interaction,
          registry,
          commandContext,
          logger,
        );
        await vi.waitFor(() =>
          expect(remove).toHaveBeenCalledWith(globalStaffRoleId, 'SL Bot roster synchronization'),
        );
        expect(interaction.edits).toHaveLength(0);
        expect(announcements.publish).not.toHaveBeenCalled();
        await expect(
          context.client.clubMembership.findFirstOrThrow({
            where: { clubId: club.id, membershipType: staffType },
          }),
        ).resolves.toMatchObject({ status: 'ACTIVE' });

        completeRoleRemoval?.();
        await commandExecution;

        expect(fetchMember).toHaveBeenCalledWith({
          user: targetDiscordUserId,
          force: true,
        });
        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove).not.toHaveBeenCalledWith(club.discordRoleId);
        expect(announcements.publish).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'DEMOTED',
            discordUserId: targetDiscordUserId,
            actorDiscordUserId: adminAuth.discordUserId,
          }),
        );
        expect(interaction.edits).toHaveLength(1);
        await expect(
          context.client.clubMembership.findFirstOrThrow({
            where: { clubId: club.id, membershipType: 'PLAYER' },
          }),
        ).resolves.toMatchObject({ status: 'ACTIVE' });
        await expect(
          context.client.clubMembership.findFirstOrThrow({
            where: { clubId: club.id, membershipType: staffType },
          }),
        ).resolves.toMatchObject({ status: 'ENDED' });
      },
    );

    it('enforces one active staff appointment per user league-wide', async () => {
      const clubService = new ClubManagementService(context.client);
      const staffService = new StaffManagementService(context.client);

      const teamA = await clubService.create({
        authorization: adminAuth,
        discordRoleId: '300000000000000001',
        emoji: '⚽',
      });

      const teamB = await clubService.create({
        authorization: adminAuth,
        discordRoleId: '300000000000000002',
        emoji: '🦁',
      });

      const staffUserId = '700000000000000001';

      await staffService.appoint({
        authorization: adminAuth,
        clubId: teamA.id,
        staffDiscordUserId: staffUserId,
        staffType: 'TEAM_MANAGER',
        staffIsBot: false,
      });

      // appointing the same user to another team must fail
      await expect(
        staffService.appoint({
          authorization: adminAuth,
          clubId: teamB.id,
          staffDiscordUserId: staffUserId,
          staffType: 'ASSISTANT_MANAGER',
          staffIsBot: false,
        }),
      ).rejects.toBeInstanceOf(StaffAlreadyAppointedError);
    });

    it('enforces per-team position limits and allows re-appointment after removal', async () => {
      const clubService = new ClubManagementService(context.client);
      const staffService = new StaffManagementService(context.client);

      const team = await clubService.create({
        authorization: adminAuth,
        discordRoleId: '300000000000000001',
        emoji: '⚽',
      });

      const user1 = '700000000000000001';
      const user2 = '700000000000000002';

      await staffService.appoint({
        authorization: adminAuth,
        clubId: team.id,
        staffDiscordUserId: user1,
        staffType: 'TEAM_MANAGER',
        staffIsBot: false,
      });

      // a second team manager must fail
      await expect(
        staffService.appoint({
          authorization: adminAuth,
          clubId: team.id,
          staffDiscordUserId: user2,
          staffType: 'TEAM_MANAGER',
          staffIsBot: false,
        }),
      ).rejects.toBeInstanceOf(TeamPositionOccupiedError);

      // remove the first manager
      await staffService.remove(adminAuth, team.id, 'TEAM_MANAGER');

      // appoint the second manager
      const result = await staffService.appoint({
        authorization: adminAuth,
        clubId: team.id,
        staffDiscordUserId: user2,
        staffType: 'TEAM_MANAGER',
        staffIsBot: false,
      });

      expect(result.membership.userId).toBeDefined();
    });
  });

  describe('3. Team Emoji Requirements & Validation', () => {
    it('requires emoji on /team add', () => {
      const teamCmd = commandDefinitions.find((c) => c.data.name === 'team');
      expect(teamCmd).toBeDefined();

      const json = teamCmd?.data.toJSON() as {
        options?: Array<{
          name: string;
          options?: Array<{ name: string; required?: boolean }>;
        }>;
      };

      const addSubcommand = json.options?.find((o) => o.name === 'add');
      expect(addSubcommand).toBeDefined();

      const emojiOption = addSubcommand?.options?.find((o) => o.name === 'emoji');
      expect(emojiOption).toBeDefined();
      expect(emojiOption?.required).toBe(true);
    });

    it('rejects cross-server custom emojis', async () => {
      const registry = {
        resolve: (name: string) => commandDefinitions.find((c) => c.data.name === name) ?? null,
      } as unknown as CommandRegistry;

      const interaction = new MockCommandInteraction(
        'team',
        {
          subcommand: 'add',
          role: '300000000000000099',
          emoji: '<:foreign:999999999999999999>', // unavailable in this guild
        },
        staffChannel,
        adminAuth,
      );

      await handleInteractionCreate(interaction, registry, commandContext, logger);

      const response = interaction.edits[0] ?? interaction.replies[0];
      expect(response).toBeDefined();
      expect(response?.embeds?.[0]?.data?.title).toBe('❌ Invalid Team Emoji');
    });
  });

  describe('4. /offer Command Change', () => {
    it('/offer exists without create subcommand and derives caller team', () => {
      const offerCmd = commandDefinitions.find((c) => c.data.name === 'offer');
      expect(offerCmd).toBeDefined();
      const json = offerCmd?.data.toJSON() as {
        options?: Array<{ name: string; type: number }>;
      };

      // ensure options are top level
      const hasSubcommand = (json.options ?? []).some((o) => o.type === 1);
      expect(hasSubcommand).toBe(false);

      const playerOpt = (json.options ?? []).find((o) => o.name === 'player');
      expect(playerOpt).toBeDefined();

      const teamOpt = (json.options ?? []).find((o) => o.name === 'team');
      expect(teamOpt).toBeUndefined();
    });

    it('delivers an offer for the callers appointed team and uses the exact title', async () => {
      const club = await commandContext.clubManagementService.create({
        authorization: adminAuth,
        discordRoleId: '300000000000000010',
        emoji: '🟢',
      });
      await commandContext.staffManagementService.appoint({
        authorization: adminAuth,
        clubId: club.id,
        staffDiscordUserId: adminAuth.discordUserId,
        staffType: 'TEAM_MANAGER',
        staffIsBot: false,
      });
      const registry = {
        resolve: (name: string) => commandDefinitions.find((c) => c.data.name === name) ?? null,
      } as unknown as CommandRegistry;
      const interaction = new MockCommandInteraction(
        'offer',
        { player: '800000000000000001' },
        botCmdChannel,
        adminAuth,
      );

      await handleInteractionCreate(interaction, registry, commandContext, logger);

      expect(commandContext.offerDeliveryService.createAndDeliver).toHaveBeenCalledWith(
        expect.objectContaining({ destinationClubId: club.id }),
        expect.objectContaining({
          sourceTeamRoleColor: 0xf97316,
          sourceTeamRoleName: 'T1',
          guildName: 'Development League',
          guildIconUrl: null,
        }),
      );
      expect(interaction.followUps).toEqual([]);
      expect(interaction.edits[0]?.embeds?.[0]?.data.title).toBe('✅ Contract Offer Sent');
    });

    it('rejects global bot permission without an active staff appointment', async () => {
      await commandContext.guildSetupService.setupRoles({
        authorization: adminAuth,
        guildName: 'Development League',
        botPermissionsRoleId: '555555555555555555',
        teamManagerRoleId: '666666666666666666',
        assistantManagerRoleId: '777777777777777777',
        playerManagerRoleId: '888888888888888888',
      });
      const registry = {
        resolve: (name: string) => commandDefinitions.find((c) => c.data.name === name) ?? null,
      } as unknown as CommandRegistry;

      const globalBotPermissionAuth: AuthorizationInput = {
        discordGuildId: guildId,
        discordUserId: '200000000000000099',
        guildOwnerId: adminAuth.guildOwnerId,
        memberRoleIds: ['555555555555555555'],
        hasAdministratorPermission: false,
      };

      const interaction = new MockCommandInteraction(
        'offer',
        { player: '800000000000000001' },
        botCmdChannel,
        globalBotPermissionAuth,
      );

      await handleInteractionCreate(interaction, registry, commandContext, logger);

      const response = interaction.edits[0] ?? interaction.replies[0];
      expect(response).toBeDefined();
      expect(response?.embeds?.[0]?.data?.title).toBe('❌ Staff Appointment Required');
    });

    it('reports the specific inactive team error for an inactive source club', async () => {
      const club = await commandContext.clubManagementService.create({
        authorization: adminAuth,
        discordRoleId: '300000000000000011',
        emoji: '⚫',
      });
      await commandContext.staffManagementService.appoint({
        authorization: adminAuth,
        clubId: club.id,
        staffDiscordUserId: adminAuth.discordUserId,
        staffType: 'PLAYER_MANAGER',
        staffIsBot: false,
      });
      await commandContext.clubManagementService.deactivate(adminAuth, club.id);

      const error = await commandContext.staffManagementService
        .getCallerActiveStaffClub(guildId, adminAuth.discordUserId)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ClubInactiveError);
      expect(mapDiscordError(error).description).toBe(
        `Source team ⚫ <@&${club.discordRoleId}> is inactive.`,
      );
    });
  });

  describe('5. Roster Reference Formatting', () => {
    it('counts all staff while showing only non-staff members as ordinary players', async () => {
      const club = await new ClubManagementService(context.client).create({
        authorization: adminAuth,
        discordRoleId: '300000000000000001',
        emoji: '⚽',
      });
      const staffService = new StaffManagementService(context.client);
      const rosterService = new RosterManagementService(context.client);
      const staffMembers = [
        ['700000000000000001', 'TEAM_MANAGER'],
        ['700000000000000002', 'ASSISTANT_MANAGER'],
        ['700000000000000003', 'PLAYER_MANAGER'],
      ] as const;
      for (const [staffDiscordUserId, staffType] of staffMembers) {
        await staffService.appoint({
          authorization: adminAuth,
          clubId: club.id,
          staffDiscordUserId,
          staffType,
          staffIsBot: false,
        });
      }
      const ordinaryPlayerId = '800000000000000001';
      await rosterService.add({
        authorization: adminAuth,
        clubId: club.id,
        playerDiscordUserId: ordinaryPlayerId,
        playerIsBot: false,
      });

      const active = await rosterService.list(guildId, club.id);
      expect(active.allActiveMembers).toHaveLength(4);
      expect(active.activeStaffUserIds.size).toBe(3);
      expect(active.staff.map(({ membershipType }) => membershipType)).toEqual([
        'ASSISTANT_MANAGER',
        'PLAYER_MANAGER',
        'TEAM_MANAGER',
      ]);
      expect(active.ordinaryPlayers.map(({ user }) => user.discordUserId)).toEqual([
        ordinaryPlayerId,
      ]);

      await staffService.remove(adminAuth, club.id, 'ASSISTANT_MANAGER');
      const afterRemoval = await rosterService.list(guildId, club.id);
      expect(afterRemoval.allActiveMembers).toHaveLength(4);
      expect(afterRemoval.staff).toHaveLength(2);
      expect(afterRemoval.ordinaryPlayers.map(({ user }) => user.discordUserId).sort()).toEqual([
        '700000000000000002',
        ordinaryPlayerId,
      ]);
      expect(
        new Set([
          ...afterRemoval.staff.map(({ user }) => user.discordUserId),
          ...afterRemoval.ordinaryPlayers.map(({ user }) => user.discordUserId),
        ]).size,
      ).toBe(4);
    });

    it('formats roster embed to match reference structure', async () => {
      const setupService = new GuildSetupService(context.client);
      await setupService.setupChannels({
        authorization: adminAuth,
        guildName: 'Development League',
        botCommandsChannelId: botCmdChannel,
        staffChannelId: staffChannel,
        transferChannelId: '333333333333333333',
        auditChannelId: '444444444444444444',
      });

      const clubService = new ClubManagementService(context.client);
      const staffService = new StaffManagementService(context.client);
      const rosterService = new RosterManagementService(context.client);

      const club = await clubService.create({
        authorization: adminAuth,
        discordRoleId: '300000000000000001',
        emoji: '⚽',
      });

      const tmUserId = '700000000000000001';
      await staffService.appoint({
        authorization: adminAuth,
        clubId: club.id,
        staffDiscordUserId: tmUserId,
        staffType: 'TEAM_MANAGER',
        staffIsBot: false,
      });

      const playerUserId = '800000000000000001';
      await rosterService.add({
        authorization: adminAuth,
        clubId: club.id,
        playerDiscordUserId: playerUserId,
        playerIsBot: false,
      });

      const registry = {
        resolve: (name: string) => commandDefinitions.find((c) => c.data.name === name) ?? null,
      } as unknown as CommandRegistry;

      const interaction = new MockCommandInteraction(
        'roster',
        { team: club.id },
        botCmdChannel,
        adminAuth,
      );

      await handleInteractionCreate(interaction, registry, commandContext, logger);

      const response = interaction.edits[0] ?? interaction.replies[0];
      expect(response).toBeDefined();
      const embedObj = response?.embeds?.[0];
      expect(embedObj).toBeDefined();

      const embedData =
        'data' in (embedObj as object)
          ? (
              embedObj as {
                data: {
                  author?: { name?: string };
                  title?: string;
                  color?: number;
                  description?: string;
                  footer?: { text?: string };
                  fields?: Array<{ name: string; value: string }>;
                };
              }
            ).data
          : (embedObj as {
              author?: { name?: string };
              title?: string;
              color?: number;
              description?: string;
              footer?: { text?: string };
              fields?: Array<{ name: string; value: string }>;
            });

      expect(embedData.author?.name).toBe('Development League');
      expect(embedData.title).toBeUndefined();
      expect(embedData.description).toBe(`⚽ <@&${club.discordRoleId}> Roster`);
      expect(embedData.color).toBe(0xf97316);
      expect(embedData.footer?.text).toBe('Roster for ⚽ T1, Development League');

      const fields = embedData.fields ?? [];
      const fieldNames = fields.map((f) => f.name);
      const fieldByName = new Map(fields.map(({ name, value }) => [name, value]));

      expect(fieldNames).not.toContain('Team');
      expect(
        JSON.stringify(embedData).match(new RegExp(`<@&${club.discordRoleId}>`, 'g')),
      ).toHaveLength(1);
      expect(embedData.footer?.text).not.toContain(club.discordRoleId);
      expect(fieldNames).toContain('📊 Roster Count');
      expect(fieldNames).toContain('👑 Team Manager');
      expect(fieldNames).toContain('👔 Assistant Team Manager');
      expect(fieldNames).toContain('🧠 Player Manager');
      expect(fieldNames).not.toContain('👑 Franchise Owner(s)');
      expect(fieldNames).not.toContain('👔 General Manager(s)');
      expect(fieldNames).not.toContain('🧠 Head Coach(es)');
      expect(fieldNames).not.toContain('📋 Assistant Coach(es)');
      expect(fieldNames).toContain('──────── Players ────────');
      expect(fieldNames).toContain('🏃 Players');
      expect(fieldByName.get('📊 Roster Count')).toBe('2/17');
      expect(fieldByName.get('👑 Team Manager')).toContain(`<@${tmUserId}>`);
      expect(fieldByName.get('🏃 Players')).toContain(`<@${playerUserId}>`);
      expect(fieldByName.get('🏃 Players')).not.toContain(tmUserId);
    });
  });
});
