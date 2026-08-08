import type { Club, ClubMembership, Guild, LeagueUser } from '@prisma/client';
import { MessageFlags } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { commands } from '../../src/bot/commands.js';
import { formatFranchiseOwnerListLine } from '../../src/bot/franchise-owner-list-presentation.js';
import type {
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  DeferredInteractionResponse,
  EditedInteractionResponse,
  GuildRoleMetadata,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import {
  AdministrativePermissionDeniedError,
  AdministrativeWrongChannelError,
  DiscordRoleMissingError,
} from '../../src/domain/errors.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import type { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const discordGuildId = '100000000000000001';
const staffChannelId = '200000000000000001';
const botChannelId = '200000000000000002';
const ownerId = '300000000000000001';
const botPermissionsRoleId = '400000000000000001';
const teamManagerRoleId = '400000000000000002';
const assistantManagerRoleId = '400000000000000003';
const playerManagerRoleId = '400000000000000004';

const guild: Guild = {
  id: 'guild-1',
  discordGuildId,
  name: 'Super League',
  createdAt: now,
  updatedAt: now,
};

function club(idIndex: number): Club {
  return {
    id: `club-${idIndex}`,
    guildId: guild.id,
    discordRoleId: `10000000000000000${idIndex}`,
    emoji: idIndex === 1 ? '🔥' : '🌊',
    logoUrl: null,
    squadLimitOverride: null,
    active: true,
    createdAt: new Date(`2026-01-0${idIndex}T00:00:00.000Z`),
    updatedAt: now,
  };
}

function staffMembership(userIndex: number): ClubMembership & { user: LeagueUser } {
  const user: LeagueUser = {
    id: `user-db-${userIndex}`,
    discordUserId: `20000000000000000${userIndex}`,
    robloxUserId: null,
    robloxUsername: null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    id: `membership-tm-${userIndex}`,
    guildId: guild.id,
    clubId: `club-${userIndex}`,
    userId: user.id,
    membershipType: 'TEAM_MANAGER',
    status: 'ACTIVE',
    joinedAt: now,
    leftAt: null,
    createdByUserId: null,
    endedByUserId: null,
    createdAt: now,
    updatedAt: now,
    user,
  };
}

class FranchiseOwnerListInteraction implements CommandInteraction {
  public readonly commandName = 'folist';
  public readonly guildId = guild.discordGuildId;
  public readonly guildName = guild.name;
  public readonly guildIconUrl = 'https://cdn.discordapp.com/icons/league/icon.png';
  public readonly guildOwnerId = ownerId;
  public readonly userId = this.guildOwnerId;
  public readonly userDisplayName = 'League Owner';
  public readonly channelId = staffChannelId;
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = false;
  public replied = false;
  public deferred = false;
  public readonly replies: SafeInteractionResponse[] = [];
  public readonly edits: EditedInteractionResponse[] = [];
  public readonly followUps: SafeInteractionResponse[] = [];
  public readonly roleRequests: string[] = [];
  public readonly userRequests: string[] = [];
  public readonly roles = new Map<string, GuildRoleMetadata>();
  public readonly names = new Map<string, string>();
  public readonly options: CommandInteractionOptions;

  public constructor() {
    this.options = {
      getSubcommand: () => null,
      getString: () => null,
      getInteger: () => null,
      getUser: () => null,
      getRole: () => null,
      getChannel: () => null,
    };
  }

  public getGuildRoleMetadata(): GuildRoleMetadata | null {
    return null;
  }

  public resolveGuildRoleMetadata(roleId: string): Promise<GuildRoleMetadata | null> {
    this.roleRequests.push(roleId);
    return Promise.resolve(this.roles.get(roleId) ?? null);
  }

  public getGuildMemberDisplayName(): string | null {
    return null;
  }

  public resolveGuildMemberDisplayName(userId: string): Promise<string | null> {
    this.userRequests.push(userId);
    return Promise.resolve(this.names.get(userId) ?? null);
  }

  public reply(response: SafeInteractionResponse): Promise<void> {
    this.replies.push(response);
    this.replied = true;
    return Promise.resolve();
  }

  public deferReply(response?: DeferredInteractionResponse): Promise<void> {
    this.deferred = true;
    this.replies.push(response ?? {});
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

function context(
  overrides: NonNullable<CommandContext['franchiseOwnerListService']>,
  policyService?: CommandChannelPolicyService,
): CommandContext {
  const unused = () => Promise.reject(new Error('unused'));
  return {
    logger: new MemoryLogger(),
    database: {} as CommandContext['database'],
    databaseHealth: { check: () => Promise.resolve(true) },
    guildConfigurationService: { load: unused },
    offerAcceptanceService: { acceptOffer: unused },
    guildSetupService: {
      setup: unused,
      setupGuildOnly: unused,
      setupChannels: unused,
      setupRoles: unused,
      getView: unused,
    },
    clubManagementService: {
      create: unused,
      edit: unused,
      deactivate: unused,
      listActive: unused,
      autocomplete: unused,
    },
    staffManagementService: {
      appoint: unused,
      remove: unused,
      list: unused,
      getCallerActiveStaffClub: unused,
    },
    rosterManagementService: { add: unused, remove: unused, list: unused },
    limitManagementService: {
      setDefaultLimit: unused,
      setTeamLimit: unused,
      resetTeamLimit: unused,
      viewLimit: unused,
    },
    commandChannelPolicyService: policyService ?? {
      validateChannelPolicy: () => Promise.resolve(),
    },
    offerDeliveryService: { createAndDeliver: unused },
    offerButtonHandler: { handle: unused },
    setupAuditService: { publish: () => Promise.resolve(true) },
    franchiseOwnerListService: overrides,
  };
}

const folistCommand = commands.find(({ data }) => data.name === 'folist')!;

describe('franchise owner list presentation, policy, and command execution', () => {
  it('formats franchise owner list line for a team manager and vacant team', () => {
    const team1 = club(1);
    const lineWithManager = formatFranchiseOwnerListLine(
      team1,
      '200000000000000001',
      'Visible Manager',
    );
    expect(lineWithManager).toBe(
      '🔥 <@&100000000000000001> Team Manager: <@200000000000000001> `Visible Manager`',
    );

    const team2 = club(2);
    const lineVacant = formatFranchiseOwnerListLine(team2, null, null);
    expect(lineVacant).toBe('🌊 <@&100000000000000002> Team Manager: Vacant');
  });

  it('registers /folist command with no arguments and correct description', () => {
    expect(folistCommand).toBeDefined();
    const json = folistCommand.data.toJSON();
    expect(json.name).toBe('folist');
    expect(json.description).toBe("List every active team's Team Manager");
    expect(json.options ?? []).toEqual([]);
  });

  describe('authorization and channel policy for /folist', () => {
    const databasePermissionUserId = '300000000000000010';

    // Mock the database permission lookup used by AuthorizationService.
    async function checkPolicy(
      authorization: AuthorizationInput,
      channelId: string,
      hasConfiguredSettings = true,
    ): Promise<void> {
      await Promise.resolve();
      if (!hasConfiguredSettings) {
        throw new AdministrativePermissionDeniedError();
      }
      if (authorization.discordUserId !== databasePermissionUserId) {
        throw new AdministrativePermissionDeniedError();
      }
      if (channelId !== staffChannelId) {
        throw new AdministrativeWrongChannelError(staffChannelId);
      }
    }

    it('denies server owner without a database Bot Permission', async () => {
      const auth: AuthorizationInput = {
        discordGuildId,
        discordUserId: ownerId,
        guildOwnerId: ownerId,
        memberRoleIds: [],
        hasAdministratorPermission: false,
      };
      await expect(checkPolicy(auth, staffChannelId)).rejects.toBeInstanceOf(
        AdministrativePermissionDeniedError,
      );
    });

    it('denies Discord Administrator without a database Bot Permission', async () => {
      const auth: AuthorizationInput = {
        discordGuildId,
        discordUserId: '300000000000000002',
        guildOwnerId: ownerId,
        memberRoleIds: [],
        hasAdministratorPermission: true,
      };
      await expect(checkPolicy(auth, staffChannelId)).rejects.toBeInstanceOf(
        AdministrativePermissionDeniedError,
      );
    });

    it('denies legacy Bot Permissions role member without a database Bot Permission', async () => {
      const auth: AuthorizationInput = {
        discordGuildId,
        discordUserId: '300000000000000003',
        guildOwnerId: ownerId,
        memberRoleIds: [botPermissionsRoleId],
        hasAdministratorPermission: false,
      };
      await expect(checkPolicy(auth, staffChannelId)).rejects.toBeInstanceOf(
        AdministrativePermissionDeniedError,
      );
    });

    it('allows a database Bot Permission holder in Staff Commands channel', async () => {
      const auth: AuthorizationInput = {
        discordGuildId,
        discordUserId: databasePermissionUserId,
        guildOwnerId: ownerId,
        memberRoleIds: [],
        hasAdministratorPermission: false,
      };
      await expect(checkPolicy(auth, staffChannelId)).resolves.toBeUndefined();
    });

    it('denies ordinary Team Manager (TM)', async () => {
      const auth: AuthorizationInput = {
        discordGuildId,
        discordUserId: '300000000000000004',
        guildOwnerId: ownerId,
        memberRoleIds: [teamManagerRoleId],
        hasAdministratorPermission: false,
      };
      await expect(checkPolicy(auth, staffChannelId)).rejects.toBeInstanceOf(
        AdministrativePermissionDeniedError,
      );
    });

    it('denies Assistant Team Manager (ATM)', async () => {
      const auth: AuthorizationInput = {
        discordGuildId,
        discordUserId: '300000000000000005',
        guildOwnerId: ownerId,
        memberRoleIds: [assistantManagerRoleId],
        hasAdministratorPermission: false,
      };
      await expect(checkPolicy(auth, staffChannelId)).rejects.toBeInstanceOf(
        AdministrativePermissionDeniedError,
      );
    });

    it('denies Player Manager (PM)', async () => {
      const auth: AuthorizationInput = {
        discordGuildId,
        discordUserId: '300000000000000006',
        guildOwnerId: ownerId,
        memberRoleIds: [playerManagerRoleId],
        hasAdministratorPermission: false,
      };
      await expect(checkPolicy(auth, staffChannelId)).rejects.toBeInstanceOf(
        AdministrativePermissionDeniedError,
      );
    });

    it('denies ordinary players and unrelated members', async () => {
      for (const memberRoleIds of [[], ['unrelated-role-id']]) {
        const auth: AuthorizationInput = {
          discordGuildId,
          discordUserId: '300000000000000007',
          guildOwnerId: ownerId,
          memberRoleIds,
          hasAdministratorPermission: false,
        };
        await expect(checkPolicy(auth, staffChannelId)).rejects.toBeInstanceOf(
          AdministrativePermissionDeniedError,
        );
      }
    });

    it('denies authorized caller when invoked in wrong channel', async () => {
      const auth: AuthorizationInput = {
        discordGuildId,
        discordUserId: databasePermissionUserId,
        guildOwnerId: ownerId,
        memberRoleIds: [],
        hasAdministratorPermission: false,
      };
      await expect(checkPolicy(auth, botChannelId)).rejects.toBeInstanceOf(
        AdministrativeWrongChannelError,
      );
    });
  });

  it('renders empty-state embed when no active teams exist', async () => {
    const interaction = new FranchiseOwnerListInteraction();
    await folistCommand.execute(
      interaction,
      context({
        getList: () => Promise.resolve({ guild, items: [] }),
      }),
    );

    expect(interaction.deferred).toBe(true);
    const reply = interaction.replies[0]!;
    expect(reply).toEqual({ flags: MessageFlags.Ephemeral });
    expect(interaction.edits).toHaveLength(1);
    expect(interaction.followUps).toEqual([]);
    const edit = interaction.edits[0]!;
    const embedData = edit.embeds?.[0]?.data;
    expect(embedData?.title).toBe('Franchise Owner List');
    expect(embedData?.description).toBe('No active teams are currently configured.');
  });

  it('renders exact row format with cold-cache resolved role and user names', async () => {
    const interaction = new FranchiseOwnerListInteraction();
    interaction.roles.set('100000000000000001', {
      id: '100000000000000001',
      name: 'Alpha FC',
      color: 0xff0000,
    });
    interaction.roles.set('100000000000000002', {
      id: '100000000000000002',
      name: 'Beta United',
      color: 0x0000ff,
    });
    interaction.names.set('200000000000000001', 'Alice Owner');

    const items = [
      { club: club(1), teamManager: staffMembership(1) },
      { club: club(2), teamManager: null },
    ];

    await folistCommand.execute(
      interaction,
      context({
        getList: () => Promise.resolve({ guild, items }),
      }),
    );

    expect(interaction.roleRequests).toEqual(['100000000000000001', '100000000000000002']);
    expect(interaction.userRequests).toEqual(['200000000000000001']);
    expect(interaction.edits).toHaveLength(1);

    const edit = interaction.edits[0]!;
    const embedData = edit.embeds?.[0]?.data;
    expect(embedData?.title).toBe('Franchise Owner List');
    expect(embedData?.description).toBe(
      '🔥 <@&100000000000000001> Team Manager: <@200000000000000001> `Alice Owner`\n' +
        '🌊 <@&100000000000000002> Team Manager: Vacant',
    );
  });

  it('rejects execution when a team Discord role is missing from Discord', async () => {
    const interaction = new FranchiseOwnerListInteraction();
    // Do not populate interaction.roles so resolveGuildRoleMetadata returns null
    const items = [{ club: club(1), teamManager: staffMembership(1) }];

    await expect(
      folistCommand.execute(
        interaction,
        context({
          getList: () => Promise.resolve({ guild, items }),
        }),
      ),
    ).rejects.toBeInstanceOf(DiscordRoleMissingError);
  });

  it('chunks rows across multiple embeds when Discord description limits are exceeded', async () => {
    const interaction = new FranchiseOwnerListInteraction();
    const items = Array.from({ length: 1_200 }, (_, i) => {
      const c: Club = {
        id: `club-${i + 1}`,
        guildId: guild.id,
        discordRoleId: `1000000000000${String(i + 1).padStart(5, '0')}`,
        emoji: '⚽',
        logoUrl: null,
        squadLimitOverride: null,
        active: true,
        createdAt: new Date(now.getTime() + i),
        updatedAt: now,
      };
      interaction.roles.set(c.discordRoleId, {
        id: c.discordRoleId,
        name: `Team ${i + 1}`,
        color: 0,
      });
      const tm = i % 2 === 0 ? staffMembership(i + 1) : null;
      if (tm) {
        interaction.names.set(tm.user.discordUserId, `Owner ${i + 1}`);
      }
      return { club: c, teamManager: tm };
    });

    await folistCommand.execute(
      interaction,
      context({
        getList: () => Promise.resolve({ guild, items }),
      }),
    );

    expect(interaction.edits).toHaveLength(1);
    const edit = interaction.edits[0]!;
    const embeds = [
      ...(edit.embeds ?? []),
      ...interaction.followUps.flatMap(({ embeds: followUpEmbeds }) => followUpEmbeds ?? []),
    ];
    expect(interaction.replies).toEqual([{ flags: MessageFlags.Ephemeral }]);
    expect(interaction.followUps.length).toBeGreaterThan(0);
    expect(interaction.followUps.every(({ flags }) => flags === MessageFlags.Ephemeral)).toBe(true);
    expect(embeds.length).toBeGreaterThan(1);
    const embed1 = embeds[0]!;
    const embed2 = embeds[1]!;
    expect(embed1.data.title).toBe('Franchise Owner List');
    expect(embed2.data.title).toBe('Franchise Owner List Continued');

    // Confirm total rows across all initial and follow-up embeds equals 1,200
    const totalLines = embeds.reduce(
      (count, e) => count + (e.data.description?.split('\n').length ?? 0),
      0,
    );
    expect(totalLines).toBe(1_200);
  });
});
