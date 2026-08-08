import { ApplicationCommandOptionType, MessageFlags, type Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { commandDefinitions } from '../../src/bot/commands.js';
import type { CommandRegistry } from '../../src/bot/command-registry.js';
import { EMBED_COLORS } from '../../src/bot/embeds.js';
import { DiscordSetupAuditMessageAdapter } from '../../src/bot/setup-audit-message-adapter.js';
import { mapDiscordError } from '../../src/bot/error-mapper.js';
import { handleInteractionCreate } from '../../src/bot/interaction-handler.js';
import type {
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  DeferredInteractionResponse,
  EditedInteractionResponse,
  GuildRoleMetadata,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import {
  DiscordRoleUpdateFailedError,
  DuplicateTeamRoleError,
  NoTeamChangesProvidedError,
  StaffMemberCannotReceiveOffersError,
} from '../../src/domain/errors.js';
import type { GuildSetupResult } from '../../src/services/guild-setup-service.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const authorization: AuthorizationInput = {
  discordGuildId: '100000000000000001',
  discordUserId: '200000000000000001',
  guildOwnerId: '200000000000000001',
  memberRoleIds: [],
  hasAdministratorPermission: true,
};

const team = {
  id: 'club-1',
  guildId: 'guild-1',
  discordRoleId: '300000000000000001',
  logoUrl: null,
  emoji: '🔵',
  squadLimitOverride: null,
  active: true,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
};

function setupResult(auditChannelId: string | null = 'audit-channel'): GuildSetupResult {
  return {
    guild: {
      id: 'guild-1',
      discordGuildId: authorization.discordGuildId,
      name: 'Development League',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
    settings: {
      id: 'settings-1',
      guildId: 'guild-1',
      botCommandsChannelId: 'bot-channel',
      staffChannelId: 'staff-channel',
      transferChannelId: 'transfer-channel',
      auditChannelId,
      botPermissionsRoleId: 'bot-role',
      teamManagerRoleId: 'tm-role',
      assistantManagerRoleId: 'atm-role',
      playerManagerRoleId: 'pm-role',
      defaultSquadLimit: 17,
      offerTimeoutSeconds: 3600,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
    created: false,
  };
}

class TestInteraction implements CommandInteraction {
  public replied = false;
  public deferred = false;
  public readonly replies: SafeInteractionResponse[] = [];
  public readonly deferrals: Array<DeferredInteractionResponse | undefined> = [];
  public readonly edits: EditedInteractionResponse[] = [];
  public readonly followUps: SafeInteractionResponse[] = [];
  public readonly guildId = authorization.discordGuildId;
  public readonly guildName = 'Development League';
  public readonly guildOwnerId = authorization.guildOwnerId;
  public readonly userId = authorization.discordUserId;
  public readonly memberRoleIds = authorization.memberRoleIds;
  public readonly hasAdministratorPermission = authorization.hasAdministratorPermission;
  public readonly resolvedDisplayNames = new Map<string, string>();
  public readonly resolvedDisplayNameRequests: string[] = [];

  public constructor(
    public readonly commandName: string,
    private readonly values: Record<string, string | number | null>,
    public readonly channelId = 'staff-channel',
    private readonly roleMetadata: GuildRoleMetadata | null = {
      id: team.discordRoleId,
      name: 'T1',
      color: 0xf97316,
    },
  ) {}

  public get options(): CommandInteractionOptions {
    return {
      getSubcommand: () => {
        const value = this.values['subcommand'];
        return typeof value === 'string' ? value : null;
      },
      getString: (name) => {
        const value = this.values[name];
        return typeof value === 'string' ? value : null;
      },
      getInteger: (name) => {
        const value = this.values[name];
        return typeof value === 'number' ? value : null;
      },
      getUser: (name) => {
        const value = this.values[name];
        return typeof value === 'string' ? { id: value, bot: false } : null;
      },
      getRole: (name) => {
        const value = this.values[name];
        return typeof value === 'string' ? { id: value } : null;
      },
      getChannel: (name) => {
        const value = this.values[name];
        return typeof value === 'string' ? { id: value, type: 0 } : null;
      },
    };
  }

  public getGuildEmojis(): Array<{ id: string; name: string; animated: boolean }> {
    return [{ id: '987654321098765432', name: 'Newcastle', animated: false }];
  }

  public getGuildRoleMetadata(roleId: string): GuildRoleMetadata | null {
    return this.roleMetadata?.id === roleId ? this.roleMetadata : null;
  }

  public resolveGuildRoleMetadata(roleId: string): Promise<GuildRoleMetadata | null> {
    return Promise.resolve(this.getGuildRoleMetadata(roleId));
  }

  public resolveGuildMemberDisplayName(userId: string): Promise<string | null> {
    this.resolvedDisplayNameRequests.push(userId);
    return Promise.resolve(this.resolvedDisplayNames.get(userId) ?? null);
  }

  public reply(response: SafeInteractionResponse): Promise<void> {
    this.replied = true;
    this.replies.push(response);
    return Promise.resolve();
  }

  public deferReply(response?: DeferredInteractionResponse): Promise<void> {
    this.deferred = true;
    this.deferrals.push(response);
    return Promise.resolve();
  }

  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.replied = true;
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

function createContext(): CommandContext {
  const result = setupResult();
  return {
    logger: new MemoryLogger(),
    database: {} as CommandContext['database'],
    databaseHealth: { check: () => Promise.resolve(true) },
    guildConfigurationService: {
      load: () =>
        Promise.resolve({ guild: result.guild, settings: result.settings, activeClubs: [team] }),
    },
    offerAcceptanceService: { acceptOffer: () => Promise.reject(new Error('unused')) },
    guildSetupService: {
      setup: () => Promise.resolve(result),
      setupGuildOnly: () => Promise.resolve(result),
      setupChannels: () => Promise.resolve(result),
      setupRoles: () => Promise.resolve(result),
      getView: () =>
        Promise.resolve({
          guildName: result.guild.name,
          channels: {
            botCommandsChannelId: result.settings.botCommandsChannelId,
            staffChannelId: result.settings.staffChannelId,
            transferChannelId: result.settings.transferChannelId,
            auditChannelId: result.settings.auditChannelId,
          },
          roles: {
            botPermissionsRoleId: result.settings.botPermissionsRoleId,
            teamManagerRoleId: result.settings.teamManagerRoleId,
            assistantManagerRoleId: result.settings.assistantManagerRoleId,
            playerManagerRoleId: result.settings.playerManagerRoleId,
          },
          defaultSquadLimit: 17,
          offerTimeoutMinutes: 60,
          missingConfigurations: [],
        }),
    },
    clubManagementService: {
      create: () => Promise.resolve(team),
      edit: () => Promise.resolve(team),
      deactivate: () => Promise.resolve({ ...team, active: false }),
      listActive: () => Promise.resolve([{ club: team, activePlayerCount: 4, effectiveLimit: 17 }]),
      autocomplete: () => Promise.resolve([]),
    },
    staffManagementService: {
      appoint: () =>
        Promise.resolve({
          membership: { membershipType: 'TEAM_MANAGER' },
          user: { discordUserId: 'player-1' },
          club: team,
        } as never),
      remove: () =>
        Promise.resolve({
          membership: { membershipType: 'TEAM_MANAGER' },
          user: { discordUserId: 'player-1' },
          club: team,
        } as never),
      list: () => Promise.resolve([]),
      getCallerActiveStaffClub: () => Promise.resolve(team),
    },
    rosterManagementService: {
      add: () => Promise.reject(new Error('unused')),
      remove: () => Promise.reject(new Error('unused')),
      list: () =>
        Promise.resolve({
          club: team,
          allActiveMembers: [],
          activeStaffUserIds: new Set<string>(),
          ordinaryPlayers: [],
          staff: [],
        }),
    },
    limitManagementService: {
      setDefaultLimit: () => Promise.resolve({ defaultSquadLimit: 20 }),
      setTeamLimit: () => Promise.resolve({ club: team, override: 20, effectiveLimit: 20 }),
      resetTeamLimit: () => Promise.resolve({ club: team, effectiveLimit: 17 }),
      viewLimit: () =>
        Promise.resolve({
          defaultSquadLimit: 17,
          clubsWithOverrides: [],
          selectedClub: { club: team, override: null, effectiveLimit: 17 },
        }),
    },
    commandChannelPolicyService: { validateChannelPolicy: () => Promise.resolve() },
    offerDeliveryService: {
      createAndDeliver: () =>
        Promise.resolve({
          destinationClub: team,
          sourceClub: null,
          player: { discordUserId: 'player-1' },
          offeredBy: { discordUserId: authorization.discordUserId },
          offer: { id: 'offer-1', expiresAt: new Date() },
          leagueName: result.guild.name,
          activePlayerCount: 0,
          effectiveSquadLimit: 17,
        } as never),
    },
    offerButtonHandler: { handle: () => Promise.resolve(false) },
    setupAuditService: { publish: () => Promise.resolve(true) },
  };
}

function command(name: string) {
  const found = commandDefinitions.find((candidate) => candidate.data.name === name);
  if (found === undefined) throw new Error(`missing command ${name}`);
  return found;
}

function responseText(interaction: TestInteraction): string {
  return JSON.stringify(interaction.edits[0] ?? interaction.replies[0]);
}

describe('final Stage 4A command UI', () => {
  it('removes bannerconfig and registers the final team add/edit options', () => {
    expect(commandDefinitions.map(({ data }) => data.name)).not.toContain('bannerconfig');
    const teamJson = command('team').data.toJSON() as {
      options?: Array<{
        name: string;
        options?: Array<{ name: string; type: number; required?: boolean }>;
      }>;
    };
    const add = teamJson.options?.find((option) => option.name === 'add');
    const edit = teamJson.options?.find((option) => option.name === 'edit');

    expect(add?.options?.map(({ name, type, required }) => ({ name, type, required }))).toEqual([
      { name: 'role', type: ApplicationCommandOptionType.Role, required: true },
      { name: 'emoji', type: ApplicationCommandOptionType.String, required: true },
    ]);
    expect(edit?.options?.map(({ name, type, required }) => ({ name, type, required }))).toEqual([
      { name: 'team', type: ApplicationCommandOptionType.String, required: true },
      { name: 'role', type: ApplicationCommandOptionType.Role, required: false },
      { name: 'emoji', type: ApplicationCommandOptionType.String, required: false },
    ]);
    expect(JSON.stringify(teamJson)).not.toMatch(/short_name|logo_url|"name":"name"/);
  });

  it('rejects a stale bannerconfig interaction ephemerally', async () => {
    const interaction = new TestInteraction('bannerconfig', {});
    const registry = { resolve: () => null } as unknown as CommandRegistry;
    await handleInteractionCreate(interaction, registry, createContext(), new MemoryLogger());
    expect(interaction.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(responseText(interaction)).toContain('Command Unavailable');
  });

  it('maps an empty team edit to the exact no-changes error', () => {
    const mapped = mapDiscordError(new NoTeamChangesProvidedError());
    expect(mapped.title).toBe('❌ No Team Changes Provided');
    expect(mapped.description).toBe('Choose a new team role or team emoji to update.');
  });

  it('maps Discord role synchronization failures with the correctly encoded title', () => {
    const mapped = mapDiscordError(new DiscordRoleUpdateFailedError());
    expect(mapped.title).toBe('❌ Discord Role Synchronization Failed');
  });

  it('maps a duplicate role to the exact identity-only error', () => {
    const identity = `🔵 <@&${team.discordRoleId}>`;
    const mapped = mapDiscordError(new DuplicateTeamRoleError(team.discordRoleId, identity));
    expect(mapped.title).toBe('❌ Team Role Already in Use');
    expect(mapped.description).toBe(
      `The role <@&${team.discordRoleId}> is already assigned to ${identity}.\n\nChoose a different Discord role.`,
    );
  });

  it('keeps a known-team staff-target offer rejection on the standard error color', () => {
    const mapped = mapDiscordError(
      new StaffMemberCannotReceiveOffersError(
        'player-1',
        'Team Manager',
        `🔵 <@&${team.discordRoleId}>`,
      ),
    );
    expect(mapped.embed.data.color).toBe(EMBED_COLORS.ERROR);
  });

  it('adds a role-and-emoji team with the exact private identity response', async () => {
    const context = createContext();
    const create = vi.fn(context.clubManagementService.create);
    context.clubManagementService.create = create;
    const interaction = new TestInteraction('team', {
      subcommand: 'add',
      role: team.discordRoleId,
      emoji: '🔵',
    });

    await command('team').execute(interaction, context);

    expect(create).toHaveBeenCalledWith({
      authorization,
      discordRoleId: team.discordRoleId,
      emoji: '🔵',
    });
    expect(interaction.deferrals[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(responseText(interaction)).toContain(`Successfully added 🔵 <@&${team.discordRoleId}>.`);
    expect(interaction.edits[0]?.embeds?.[0]?.data.color).toBe(0xf97316);
    expect(responseText(interaction)).toContain('"name":"Role"');
    expect(responseText(interaction)).toContain('"name":"Emoji"');
  });

  it('uses the updated Discord role color for team edits', async () => {
    const updatedRole = {
      id: '300000000000000099',
      name: 'T2',
      color: 0x3498db,
    };
    const updatedTeam = { ...team, discordRoleId: updatedRole.id };
    const context = createContext();
    context.clubManagementService.edit = () => Promise.resolve(updatedTeam);

    const edit = new TestInteraction(
      'team',
      { subcommand: 'edit', team: team.id, role: updatedRole.id },
      'staff-channel',
      updatedRole,
    );
    await command('team').execute(edit, context);
    expect(edit.edits[0]?.embeds?.[0]?.data.color).toBe(0x3498db);
    expect(responseText(edit)).toContain(`<@&${updatedRole.id}>`);
  });

  it('lists one identity and capacity per line publicly', async () => {
    const context = createContext();
    context.clubManagementService.listActive = () =>
      Promise.resolve([
        { club: team, activePlayerCount: 4, effectiveLimit: 17 },
        {
          club: {
            ...team,
            id: 'club-2',
            discordRoleId: '300000000000000002',
            emoji: '<:Newcastle:987654321098765432>',
          },
          activePlayerCount: 0,
          effectiveLimit: 17,
        },
      ]);
    const interaction = new TestInteraction('team', { subcommand: 'list' }, 'bot-channel');

    await command('team').execute(interaction, context);

    expect(interaction.replies).toHaveLength(1);
    expect(interaction.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(interaction.deferrals).toEqual([]);
    expect(interaction.edits).toEqual([]);
    expect(interaction.followUps).toEqual([]);
    expect(responseText(interaction)).toContain(
      `🔵 <@&${team.discordRoleId}> — 4/17\\n<:Newcastle:987654321098765432> <@&300000000000000002> — 0/17`,
    );
  });

  it.each([
    ['appoint', 'appointed', 'Appointed'],
    ['remove', 'removed', 'Removed'],
  ] as const)(
    'uses identity-only staff %s wording with actor last',
    async (action, verb, actor) => {
      const interaction = new TestInteraction('staff', {
        subcommand: action,
        team: team.id,
        user: 'player-1',
        staff_type: 'TEAM_MANAGER',
      });

      await command('staff').execute(interaction, createContext());

      expect(interaction.deferrals[0]?.flags).toBe(MessageFlags.Ephemeral);
      expect(responseText(interaction)).toContain(
        `Successfully ${verb} <@player-1> \`Unknown User\` as the Team Manager of 🔵 <@&${team.discordRoleId}>.`,
      );
      const fields = interaction.edits[0]?.embeds?.[0]?.data.fields;
      expect(interaction.edits[0]?.embeds?.[0]?.data.color).toBe(0xf97316);
      expect(fields?.at(-1)?.name).toBe(`${actor} by`);
    },
  );

  it('renders staff blocks vertically with vacant positions and normal mentions', async () => {
    const interaction = new TestInteraction(
      'staff',
      { subcommand: 'list', team: team.id },
      'bot-channel',
    );

    await command('staff').execute(interaction, createContext());

    const text = responseText(interaction);
    expect(interaction.replies).toHaveLength(1);
    expect(interaction.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(interaction.deferrals).toEqual([]);
    expect(interaction.edits).toEqual([]);
    expect(interaction.followUps).toEqual([]);
    expect(text).toContain(`🔵 <@&${team.discordRoleId}>\\n> 👑 Team Manager: Vacant`);
    expect(text).toContain('> 👔 Assistant Team Manager: Vacant');
    expect(text).toContain('> 🧠 Player Manager: Vacant');
    expect(text).not.toContain('**🔵');
  });

  it('renders fetched TM, ATM, and PM names in staff list without Unknown User', async () => {
    const interaction = new TestInteraction(
      'staff',
      { subcommand: 'list', team: team.id },
      'bot-channel',
    );
    interaction.resolvedDisplayNames.set('tm-user', 'Fetched TM');
    interaction.resolvedDisplayNames.set('atm-user', 'Fetched ATM');
    interaction.resolvedDisplayNames.set('pm-user', 'Fetched PM');
    const context = createContext();
    context.staffManagementService.list = () =>
      Promise.resolve([
        { membershipType: 'TEAM_MANAGER', user: { discordUserId: 'tm-user' } },
        { membershipType: 'ASSISTANT_MANAGER', user: { discordUserId: 'atm-user' } },
        { membershipType: 'PLAYER_MANAGER', user: { discordUserId: 'pm-user' } },
      ] as never);

    await command('staff').execute(interaction, context);

    const text = responseText(interaction);
    expect(text).toContain('<@tm-user> `Fetched TM`');
    expect(text).toContain('<@atm-user> `Fetched ATM`');
    expect(text).toContain('<@pm-user> `Fetched PM`');
    expect(text).not.toContain('Unknown User');
    expect(interaction.resolvedDisplayNameRequests.sort()).toEqual([
      'atm-user',
      'pm-user',
      'tm-user',
    ]);
  });

  it('keeps every chunked staff list response private', async () => {
    const interaction = new TestInteraction('staff', { subcommand: 'list' }, 'bot-channel');
    const context = createContext();
    context.clubManagementService.listActive = () =>
      Promise.resolve(
        Array.from({ length: 26 }, (_, index) => ({
          club: {
            ...team,
            id: `club-${index + 1}`,
            discordRoleId: `3000000000000000${String(index + 1).padStart(2, '0')}`,
          },
          activePlayerCount: 0,
          effectiveLimit: 17,
        })),
      );

    await command('staff').execute(interaction, context);

    expect(interaction.replies).toHaveLength(1);
    expect(interaction.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(interaction.followUps).toHaveLength(1);
    expect(interaction.followUps[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(interaction.deferrals).toEqual([]);
    expect(interaction.edits).toEqual([]);
  });

  it('uses the message-mode roster description and removes title and team field', async () => {
    const interaction = new TestInteraction(
      'roster',
      { subcommand: 'view', team: team.id },
      'bot-channel',
    );

    await command('roster').execute(interaction, createContext());

    const embed = interaction.replies[0]?.embeds?.[0]?.data;
    const text = responseText(interaction);
    expect(embed?.title).toBeUndefined();
    expect(embed?.description).toBe(`🔵 <@&${team.discordRoleId}> Roster`);
    expect(embed?.color).toBe(0xf97316);
    expect(embed?.footer?.text).toBe('Roster for T1, Development League');
    expect(interaction.replies).toHaveLength(1);
    expect(interaction.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(interaction.deferrals).toEqual([]);
    expect(interaction.edits).toEqual([]);
    expect(interaction.followUps).toEqual([]);
    expect(embed?.fields?.map(({ name }) => name)).toEqual([
      '📊 Roster Count',
      '👑 Team Manager',
      '👔 Assistant Team Manager',
      '🧠 Player Manager',
      '──────── Players ────────',
      '🏃 Players',
    ]);
    expect(text.match(new RegExp(`<@&${team.discordRoleId}>`, 'g'))).toHaveLength(1);
    expect(text).not.toContain('Assistant Coach');
  });

  it('resolves each roster staff member and player once before formatting', async () => {
    const interaction = new TestInteraction(
      'roster',
      { subcommand: 'view', team: team.id },
      'bot-channel',
    );
    for (const [id, name] of [
      ['tm-user', 'Fetched TM'],
      ['atm-user', 'Fetched ATM'],
      ['pm-user', 'Fetched PM'],
      ['player-user', 'Fetched Player'],
    ] as const) {
      interaction.resolvedDisplayNames.set(id, name);
    }
    const context = createContext();
    context.rosterManagementService.list = () =>
      Promise.resolve({
        club: team,
        allActiveMembers: [{}, {}, {}, {}],
        activeStaffUserIds: new Set(['tm-user', 'atm-user', 'pm-user']),
        ordinaryPlayers: [{ user: { discordUserId: 'player-user' } }],
        staff: [
          { membershipType: 'TEAM_MANAGER', user: { discordUserId: 'tm-user' } },
          { membershipType: 'ASSISTANT_MANAGER', user: { discordUserId: 'atm-user' } },
          { membershipType: 'PLAYER_MANAGER', user: { discordUserId: 'pm-user' } },
        ],
      } as never);

    await command('roster').execute(interaction, context);

    const text = responseText(interaction);
    expect(text).toContain('<@tm-user> `Fetched TM`');
    expect(text).toContain('<@atm-user> `Fetched ATM`');
    expect(text).toContain('<@pm-user> `Fetched PM`');
    expect(text).toContain('<@player-user> `Fetched Player`');
    expect(text).not.toContain('Unknown User');
    expect(interaction.resolvedDisplayNameRequests.sort()).toEqual([
      'atm-user',
      'player-user',
      'pm-user',
      'tm-user',
    ]);
  });

  it('keeps every chunked roster-view follow-up private and preserves player order', async () => {
    const interaction = new TestInteraction(
      'roster',
      { subcommand: 'view', team: team.id },
      'bot-channel',
    );
    const players = Array.from({ length: 40 }, (_, index) => {
      const discordUserId = `player-${index.toString().padStart(2, '0')}`;
      interaction.resolvedDisplayNames.set(discordUserId, `Player ${index} ${'x'.repeat(24)}`);
      return { user: { discordUserId } };
    });
    const context = createContext();
    context.rosterManagementService.list = () =>
      Promise.resolve({
        club: team,
        allActiveMembers: players,
        activeStaffUserIds: new Set<string>(),
        ordinaryPlayers: players,
        staff: [],
      } as never);

    await command('roster').execute(interaction, context);

    expect(interaction.followUps.length).toBeGreaterThan(0);
    expect(interaction.followUps.every(({ flags }) => flags === MessageFlags.Ephemeral)).toBe(true);
    const output = [interaction.replies[0], ...interaction.followUps]
      .flatMap((response) => response?.embeds ?? [])
      .map((embed) => JSON.stringify(embed.data))
      .join('\n');
    expect(output.indexOf('<@player-00>')).toBeLessThan(output.indexOf('<@player-39>'));
  });

  it('renders a custom-emoji roster description/footer safely with a blue role', async () => {
    const customTeam = {
      ...team,
      discordRoleId: '300000000000000002',
      emoji: '<:Newcastle:987654321098765432>',
    };
    const context = createContext();
    context.rosterManagementService.list = () =>
      Promise.resolve({
        club: customTeam,
        allActiveMembers: [],
        activeStaffUserIds: new Set<string>(),
        ordinaryPlayers: [],
        staff: [],
      });
    const interaction = new TestInteraction(
      'roster',
      { subcommand: 'view', team: customTeam.id },
      'bot-channel',
      {
        id: customTeam.discordRoleId,
        name: 'T2',
        color: 0x3498db,
      },
    );

    await command('roster').execute(interaction, context);

    const embed = interaction.replies[0]?.embeds?.[0]?.data;
    expect(embed?.title).toBeUndefined();
    expect(embed?.description).toBe(
      '<:Newcastle:987654321098765432> <@&300000000000000002> Roster',
    );
    expect(embed?.color).toBe(0x3498db);
    expect(embed?.footer?.text).toBe('Roster for T2, Development League');
    expect(embed?.footer?.text).not.toMatch(/<:|<@&|\d{17,20}/u);
  });

  it.each([
    ['zero-color role', { id: team.discordRoleId, name: 'T1', color: 0 }],
    ['missing role', null],
  ] as const)('uses safe roster fallbacks for a %s', async (_, roleMetadata) => {
    const interaction = new TestInteraction(
      'roster',
      { subcommand: 'view', team: team.id },
      'bot-channel',
      roleMetadata,
    );

    await command('roster').execute(interaction, createContext());

    const embed = interaction.replies[0]?.embeds?.[0]?.data;
    expect(embed?.color).toBe(EMBED_COLORS.INFO);
    if (roleMetadata === null) {
      expect(embed?.title).toBeUndefined();
      expect(embed?.description).toBe(`🔵 <@&${team.discordRoleId}> Roster`);
      expect(embed?.footer?.text).toBe('Roster for Team, Development League');
      expect(
        JSON.stringify(embed).match(new RegExp(`<@&${team.discordRoleId}>`, 'g')),
      ).toHaveLength(1);
    }
  });

  it('uses identity in limit mutations and source-team offer acknowledgement', async () => {
    const limit = new TestInteraction('limit', {
      subcommand: 'team',
      team: team.id,
      amount: 20,
    });
    await command('limit').execute(limit, createContext());
    expect(responseText(limit)).toContain(
      `Updated squad limit for 🔵 <@&${team.discordRoleId}> to **20** players.`,
    );
    expect(limit.edits[0]?.embeds?.[0]?.data.color).toBe(0xf97316);

    const reset = new TestInteraction('limit', {
      subcommand: 'reset',
      team: team.id,
    });
    await command('limit').execute(reset, createContext());
    expect(reset.edits[0]?.embeds?.[0]?.data.color).toBe(0xf97316);

    const view = new TestInteraction('limit', { subcommand: 'view', team: team.id }, 'bot-channel');
    await command('limit').execute(view, createContext());
    expect(view.replies[0]?.embeds?.[0]?.data.color).toBe(0xf97316);
    expect(view.replies).toHaveLength(1);
    expect(view.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(view.deferrals).toEqual([]);
    expect(view.edits).toEqual([]);
    expect(view.followUps).toEqual([]);

    const offer = new TestInteraction('offer', { player: 'player-1' }, 'bot-channel');
    await command('offer').execute(offer, createContext());
    expect(offer.deferrals[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(offer.followUps).toEqual([]);
    expect(offer.edits[0]?.embeds?.[0]?.data.color).toBe(0xf97316);
    expect(offer.edits[0]?.embeds?.[0]?.data.description).toBe(
      `A private contract offer has been sent to <@player-1> \`Unknown User\` by <@${authorization.discordUserId}> \`Unknown User\` on behalf of 🔵 <@&${team.discordRoleId}>.`,
    );
    expect(responseText(offer)).not.toMatch(/Destination Team|Destination Club/);
  });

  it('keeps setup view private read-only and free of banner content', async () => {
    const context = createContext();
    const publish = vi.fn(context.setupAuditService.publish);
    context.setupAuditService.publish = publish;
    const interaction = new TestInteraction('setup', { subcommand: 'view' });

    await command('setup').execute(interaction, context);

    expect(interaction.deferrals).toEqual([{ flags: MessageFlags.Ephemeral }]);
    expect(interaction.replies).toEqual([]);
    expect(interaction.edits).toHaveLength(1);
    expect(interaction.followUps).toEqual([]);
    expect(responseText(interaction)).not.toMatch(/banner|preview/i);
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps setup mutation audit publishing and actor-last adapter output', async () => {
    const send = vi.fn((payload: unknown) => {
      void payload;
      return Promise.resolve();
    });
    const client = {
      channels: { fetch: vi.fn(() => Promise.resolve({ isSendable: () => true, send })) },
    } as unknown as Client;
    const adapter = new DiscordSetupAuditMessageAdapter(client);

    await adapter.send({
      channelId: 'audit-channel',
      title: '✅ League Settings Updated',
      description: 'Saved.',
      fields: [{ name: 'Settings', value: 'Offer lifetime: 60 minutes' }],
      actorDiscordUserId: authorization.discordUserId,
      timestamp: new Date('2026-08-01T00:00:00.000Z'),
    });

    const payload = send.mock.calls[0]?.[0] as {
      embeds: Array<{ data: Record<string, unknown> }>;
    };
    const embed = payload.embeds[0]?.data as {
      fields?: Array<{ name: string }>;
      timestamp?: string;
    };
    expect(embed.fields?.at(-1)?.name).toBe('Configured by');
    expect(embed.timestamp).toBe('2026-08-01T00:00:00.000Z');
  });

  describe('Team and Limit command Audit publishing', () => {
    it.each([
      ['team', { subcommand: 'add', role: team.discordRoleId, emoji: '🔵' }, 'Added', 'Team Added'],
      [
        'team',
        { subcommand: 'edit', team: team.id, role: team.discordRoleId, emoji: '🔴' },
        'Edited',
        'Team Updated',
      ],
      ['limit', { subcommand: 'default', amount: 25 }, 'Updated', 'Squad Limit Updated'],
      [
        'limit',
        { subcommand: 'team', team: team.id, amount: 22 },
        'Updated',
        'Team Squad Limit Updated',
      ],
      ['limit', { subcommand: 'reset', team: team.id }, 'Reset', 'Team Squad Limit Reset'],
    ])(
      'publishes post-commit audit message for /%s %s with actorVerb=%s',
      async (commandName, options, expectedVerb, expectedTitle) => {
        const context = createContext();
        const publish = vi.fn<CommandContext['setupAuditService']['publish']>(() =>
          Promise.resolve(true),
        );
        context.setupAuditService.publish = publish;

        const interaction = new TestInteraction(commandName, options);
        await command(commandName).execute(interaction, context);

        expect(publish).toHaveBeenCalledOnce();
        const lastCall = publish.mock.calls[0]?.[0];
        expect(lastCall?.channelId).toBe('audit-channel');
        expect(lastCall?.title).toContain(expectedTitle);
        expect(lastCall?.actorDiscordUserId).toBe(authorization.discordUserId);
        expect(lastCall?.actorVerb).toBe(expectedVerb);
        expect(responseText(interaction)).not.toContain('could not be delivered');
      },
    );

    it.each([
      ['team', { subcommand: 'add', role: team.discordRoleId, emoji: '🔵' }],
      ['team', { subcommand: 'edit', team: team.id, emoji: '🟢' }],
      ['limit', { subcommand: 'default', amount: 30 }],
      ['limit', { subcommand: 'team', team: team.id, amount: 15 }],
      ['limit', { subcommand: 'reset', team: team.id }],
    ])(
      'appends audit delivery warning when audit delivery fails for /%s %s',
      async (commandName, options) => {
        const context = createContext();
        context.setupAuditService.publish = () => Promise.resolve(false);

        const interaction = new TestInteraction(commandName, options);
        await command(commandName).execute(interaction, context);

        expect(responseText(interaction)).toContain(
          'Configuration was saved, but the audit message could not be delivered.',
        );
      },
    );

    it.each([
      ['team', { subcommand: 'add', role: team.discordRoleId, emoji: '🔵' }],
      ['team', { subcommand: 'edit', team: team.id, emoji: '🟢' }],
      ['limit', { subcommand: 'default', amount: 30 }],
      ['limit', { subcommand: 'team', team: team.id, amount: 15 }],
      ['limit', { subcommand: 'reset', team: team.id }],
    ])(
      'skips audit publication and appends no warning when audit channel is unconfigured for /%s %s',
      async (commandName, options) => {
        const context = createContext();
        const publish = vi.fn(() => Promise.resolve(true));
        context.setupAuditService.publish = publish;
        const unconfigResult = setupResult(null);
        context.guildConfigurationService.load = () =>
          Promise.resolve({
            guild: unconfigResult.guild,
            settings: unconfigResult.settings,
            activeClubs: [],
          });

        const interaction = new TestInteraction(commandName, options);
        await command(commandName).execute(interaction, context);

        expect(publish).not.toHaveBeenCalled();
        expect(responseText(interaction)).not.toContain('could not be delivered');
      },
    );
  });
});
