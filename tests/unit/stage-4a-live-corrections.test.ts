import { MessageFlags, type Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { commandDefinitions, debugResetCommand } from '../../src/bot/commands.js';
import { createSuccessEmbed } from '../../src/bot/embeds.js';
import { handleInteractionCreate } from '../../src/bot/interaction-handler.js';
import { DiscordSetupAuditMessageAdapter } from '../../src/bot/setup-audit-message-adapter.js';
import type { CommandRegistry } from '../../src/bot/command-registry.js';
import type {
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  DeferredInteractionResponse,
  EditedInteractionResponse,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import type { GuildSetupResult } from '../../src/services/guild-setup-service.js';
import {
  SetupAuditService,
  type SetupAuditMessage,
} from '../../src/services/setup-audit-service.js';
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
  name: 'Chelsea',
  shortName: 'CHE',
  discordRoleId: 'role-1',
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
  public deletedReply = false;
  public readonly guildId = authorization.discordGuildId;
  public readonly guildName = 'Development League';
  public readonly guildOwnerId = authorization.guildOwnerId;
  public readonly userId = authorization.discordUserId;
  public readonly memberRoleIds = authorization.memberRoleIds;
  public readonly hasAdministratorPermission = authorization.hasAdministratorPermission;

  public constructor(
    public readonly commandName: string,
    private readonly values: Record<string, string | number | null>,
    public readonly channelId = 'staff-channel',
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
    return [
      { id: '123456789012345678', name: 'chelsea', animated: false },
      { id: '987654321098765432', name: 'chelsea_fire', animated: true },
    ];
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
    this.deletedReply = true;
    return Promise.resolve();
  }

  public executeDebugReset(): Promise<void> {
    return this.reply({
      embeds: [
        createSuccessEmbed({
          title: '✅ Debug Data Reset',
          description: 'Test reset completed.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

function createContext(input?: {
  auditChannelId?: string | null;
  auditPublish?: CommandContext['setupAuditService'];
}): CommandContext {
  const result = setupResult(input?.auditChannelId ?? 'audit-channel');
  return {
    logger: new MemoryLogger(),
    database: {} as CommandContext['database'],
    databaseHealth: { check: () => Promise.resolve(true) },
    guildConfigurationService: {
      load: () =>
        Promise.resolve({
          guild: result.guild,
          settings: result.settings,
          activeClubs: [team],
        }),
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
          defaultSquadLimit: result.settings.defaultSquadLimit,
          offerTimeoutMinutes: 60,
          missingConfigurations: [],
        }),
    },
    clubManagementService: {
      create: () => Promise.resolve(team),
      edit: () => Promise.resolve(team),
      deactivate: () => Promise.resolve({ ...team, active: false }),
      listActive: () => Promise.resolve([]),
      autocomplete: () => Promise.resolve([]),
    },
    staffManagementService: {
      appoint: () =>
        Promise.resolve({
          membership: { membershipType: 'TEAM_MANAGER' },
          user: { discordUserId: 'player-1' },
        } as never),
      remove: () => Promise.resolve({ membershipType: 'TEAM_MANAGER' } as never),
      list: () => Promise.resolve([]),
      getCallerActiveStaffClub: () => Promise.resolve(team),
    },
    rosterManagementService: {
      add: () => Promise.reject(new Error('unused')),
      remove: () => Promise.reject(new Error('unused')),
      list: () => Promise.resolve({ club: team, players: [] }),
    },
    limitManagementService: {
      setDefaultLimit: () => Promise.resolve({ defaultSquadLimit: 20 }),
      setTeamLimit: () =>
        Promise.resolve({ club: team, clubName: team.name, override: 20, effectiveLimit: 20 }),
      resetTeamLimit: () =>
        Promise.resolve({ club: team, clubName: team.name, effectiveLimit: 17 }),
      viewLimit: () =>
        Promise.resolve({
          defaultSquadLimit: 17,
          clubsWithOverrides: [],
          selectedClub: {
            clubId: team.id,
            name: team.name,
            shortName: team.shortName,
            emoji: team.emoji,
            logoUrl: team.logoUrl,
            override: null,
            effectiveLimit: 17,
          },
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
    setupAuditService: input?.auditPublish ?? ({ publish: () => Promise.resolve(true) } as const),
  };
}

function resolveCommand(name: string) {
  if (name === 'debugreset') return debugResetCommand;
  const command = commandDefinitions.find((candidate) => candidate.data.name === name);
  if (!command) throw new Error(`missing command ${name}`);
  return command;
}

const administrativeCases = [
  ['setup league', 'setup', { subcommand: 'league', offer_timeout_minutes: 60 }],
  [
    'setup channels',
    'setup',
    {
      subcommand: 'channels',
      bot_commands: 'bot-channel',
      staff: 'staff-channel',
      transfer: 'transfer-channel',
      audit: 'audit-channel',
    },
  ],
  [
    'setup roles',
    'setup',
    {
      subcommand: 'roles',
      bot_permissions: 'bot-role',
      team_manager: 'tm-role',
      assistant_manager: 'atm-role',
      player_manager: 'pm-role',
    },
  ],
  ['setup view', 'setup', { subcommand: 'view' }],
  [
    'team add',
    'team',
    {
      subcommand: 'add',
      name: 'Chelsea',
      short_name: 'CHE',
      role: 'role-1',
      emoji: 'chelsea',
    },
  ],
  ['team edit', 'team', { subcommand: 'edit', team: team.id, name: 'Chelsea FC' }],
  ['team remove', 'team', { subcommand: 'remove', team: team.id }],
  ['limit default', 'limit', { subcommand: 'default', amount: 20 }],
  ['limit team', 'limit', { subcommand: 'team', team: team.id, amount: 20 }],
  ['limit reset', 'limit', { subcommand: 'reset', team: team.id }],
  [
    'staff appoint',
    'staff',
    { subcommand: 'appoint', team: team.id, user: 'player-1', staff_type: 'TEAM_MANAGER' },
  ],
  ['staff remove', 'staff', { subcommand: 'remove', team: team.id, staff_type: 'TEAM_MANAGER' }],
] as const;

describe('command visibility', () => {
  it.each(administrativeCases)('%s succeeds ephemerally', async (_, commandName, values) => {
    const interaction = new TestInteraction(commandName, values);
    await resolveCommand(commandName).execute(interaction, createContext());
    expect(interaction.deferrals[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(interaction.edits[0]?.embeds?.[0]?.data.title).toMatch(/^✅/);
  });

  it('keeps debug reset success ephemeral', async () => {
    const interaction = new TestInteraction('debugreset', {});
    await debugResetCommand.execute(interaction, createContext());
    expect(interaction.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(interaction.replies[0]?.embeds?.[0]?.data.title).toMatch(/^✅/);
  });

  it.each([
    ['team', { subcommand: 'list' }],
    ['staff', { subcommand: 'list' }],
    ['limit', { subcommand: 'view', team: team.id }],
    ['roster', { team: team.id }],
  ])('keeps %s informational success public', async (commandName, values) => {
    const interaction = new TestInteraction(commandName, values, 'bot-channel');
    await resolveCommand(commandName).execute(interaction, createContext());
    expect(interaction.replies[0]?.flags).toBeUndefined();
  });

  it('keeps health ephemeral', async () => {
    const interaction = new TestInteraction('health', {}, 'bot-channel');
    await resolveCommand('health').execute(interaction, createContext());
    expect(interaction.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
  });

  it('keeps offer acknowledgement public while failures inherit an ephemeral defer', async () => {
    const success = new TestInteraction('offer', { player: 'player-1' }, 'bot-channel');
    await resolveCommand('offer').execute(success, createContext());
    expect(success.deferrals[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(success.deletedReply).toBe(true);
    expect(success.followUps[0]?.flags).toBeUndefined();

    const failure = new TestInteraction('offer', { player: 'player-1' }, 'bot-channel');
    const logger = new MemoryLogger();
    const context = createContext();
    context.logger = logger;
    context.offerDeliveryService = {
      createAndDeliver: () => Promise.reject(new Error('private failure detail')),
    };
    const registry = {
      resolve: (name: string) => (name === 'offer' ? resolveCommand('offer') : null),
    } as CommandRegistry;
    await handleInteractionCreate(failure, registry, context, logger);
    expect(failure.deferrals[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(failure.edits[0]?.embeds?.[0]?.data.title).toBe('❌ Command Failed');
  });
});

describe('command team branding', () => {
  it.each([
    ['<:typed:123456789012345678>', '<:chelsea:123456789012345678>'],
    ['<a:typed:987654321098765432>', '<a:chelsea_fire:987654321098765432>'],
    [':chelsea:', '<:chelsea:123456789012345678>'],
    ['chelsea', '<:chelsea:123456789012345678>'],
    ['CHELSEA', '<:chelsea:123456789012345678>'],
    ['🦁', '🦁'],
  ])('canonicalizes %s through team add', async (inputEmoji, expectedEmoji) => {
    const context = createContext();
    const create = vi.fn((input: { emoji?: string | null }) =>
      Promise.resolve({ ...team, emoji: input.emoji ?? null }),
    );
    context.clubManagementService.create = create;
    const interaction = new TestInteraction('team', {
      subcommand: 'add',
      name: team.name,
      short_name: team.shortName,
      role: team.discordRoleId,
      emoji: inputEmoji,
    });
    await resolveCommand('team').execute(interaction, context);
    expect(create.mock.calls[0]?.[0].emoji).toBe(expectedEmoji);
  });

  it('uses the standard label in team add edit remove and list output', async () => {
    for (const [subcommand, values] of [
      [
        'add',
        {
          subcommand: 'add',
          name: team.name,
          short_name: team.shortName,
          role: team.discordRoleId,
          emoji: '🔵',
        },
      ],
      ['edit', { subcommand: 'edit', team: team.id, name: team.name }],
      ['remove', { subcommand: 'remove', team: team.id }],
    ] as const) {
      const interaction = new TestInteraction('team', values);
      await resolveCommand('team').execute(interaction, createContext());
      expect(interaction.edits[0]?.embeds?.[0]?.data.description).toContain('🔵 Chelsea (CHE)');
      expect(subcommand).toBeTruthy();
    }

    const context = createContext();
    context.clubManagementService.listActive = () =>
      Promise.resolve([
        { club: team, activePlayerCount: 4, effectiveLimit: 17, remainingSpaces: 13 },
      ]);
    const list = new TestInteraction('team', { subcommand: 'list' }, 'bot-channel');
    await resolveCommand('team').execute(list, context);
    expect(list.replies[0]?.embeds?.[0]?.data.description).toContain('🔵 Chelsea (CHE)');
  });

  it('uses the standard label in staff roster offer and limit output', async () => {
    const context = createContext();
    context.clubManagementService.listActive = () =>
      Promise.resolve([
        { club: team, activePlayerCount: 0, effectiveLimit: 17, remainingSpaces: 17 },
      ]);

    const staff = new TestInteraction(
      'staff',
      { subcommand: 'list', team: team.id },
      'bot-channel',
    );
    await resolveCommand('staff').execute(staff, context);
    expect(staff.replies[0]?.embeds?.[0]?.data.title).toContain('🔵 Chelsea (CHE)');

    const roster = new TestInteraction('roster', { team: team.id }, 'bot-channel');
    await resolveCommand('roster').execute(roster, context);
    expect(roster.replies[0]?.embeds?.[0]?.data.title).toBe('🔵 Chelsea (CHE) Roster');

    const offer = new TestInteraction('offer', { player: 'player-1' }, 'bot-channel');
    await resolveCommand('offer').execute(offer, context);
    expect(offer.followUps[0]?.embeds?.[0]?.data.description).toContain('🔵 Chelsea (CHE)');

    const limitMutation = new TestInteraction('limit', {
      subcommand: 'team',
      team: team.id,
      amount: 20,
    });
    await resolveCommand('limit').execute(limitMutation, context);
    expect(limitMutation.edits[0]?.embeds?.[0]?.data.description).toContain('🔵 Chelsea (CHE)');

    const limitView = new TestInteraction(
      'limit',
      { subcommand: 'view', team: team.id },
      'bot-channel',
    );
    await resolveCommand('limit').execute(limitView, context);
    expect(limitView.replies[0]?.embeds?.[0]?.data.title).toContain('🔵 Chelsea (CHE)');
  });
});

describe('setup audit publishing', () => {
  it('publishes setup mutations using the saved audit channel and never publishes setup view', async () => {
    const publish = vi.fn((message: SetupAuditMessage) => {
      void message;
      return Promise.resolve(true);
    });
    const context = createContext({ auditPublish: { publish } });

    for (const [subcommand, values] of [
      ['league', { subcommand: 'league' }],
      [
        'channels',
        {
          subcommand: 'channels',
          bot_commands: 'bot-channel',
          staff: 'staff-channel',
          transfer: 'transfer-channel',
          audit: 'new-audit-channel',
        },
      ],
      [
        'roles',
        {
          subcommand: 'roles',
          bot_permissions: 'bot-role',
          team_manager: 'tm-role',
          assistant_manager: 'atm-role',
          player_manager: 'pm-role',
        },
      ],
    ] as const) {
      await resolveCommand('setup').execute(new TestInteraction('setup', values), context);
      expect(publish.mock.lastCall?.[0].title).toContain(
        subcommand === 'channels' ? 'Channels' : subcommand === 'roles' ? 'Roles' : 'League',
      );
    }

    expect(publish).toHaveBeenCalledTimes(3);
    const auditMessage = publish.mock.calls[0]?.[0];
    expect(auditMessage?.channelId).toBe('audit-channel');
    expect(auditMessage?.actorDiscordUserId).toBe(authorization.discordUserId);
    expect(auditMessage?.timestamp).toBeInstanceOf(Date);
    expect(JSON.stringify(auditMessage)).not.toContain('guild-1');
    expect(JSON.stringify(auditMessage)).not.toContain('settings-1');

    await resolveCommand('setup').execute(
      new TestInteraction('setup', { subcommand: 'view' }),
      context,
    );
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('saves setup channels before publishing to the newly configured audit channel', async () => {
    const order: string[] = [];
    const context = createContext({
      auditPublish: {
        publish: (message) => {
          order.push(`publish ${message.channelId}`);
          return Promise.resolve(true);
        },
      },
    });
    context.guildSetupService.setupChannels = () => {
      order.push('save');
      return Promise.resolve(setupResult('new-audit-channel'));
    };

    await resolveCommand('setup').execute(
      new TestInteraction('setup', {
        subcommand: 'channels',
        bot_commands: 'bot-channel',
        staff: 'staff-channel',
        transfer: 'transfer-channel',
        audit: 'new-audit-channel',
      }),
      context,
    );

    expect(order).toEqual(['save', 'publish new-audit-channel']);
  });

  it('allows setup league without an audit channel', async () => {
    const publish = vi.fn((message: SetupAuditMessage) => {
      void message;
      return Promise.resolve(true);
    });
    const context = createContext({ auditChannelId: null, auditPublish: { publish } });
    context.guildSetupService.setupGuildOnly = () => Promise.resolve(setupResult(null));
    const interaction = new TestInteraction('setup', { subcommand: 'league' });
    await resolveCommand('setup').execute(interaction, context);
    expect(publish).not.toHaveBeenCalled();
    expect(interaction.edits[0]?.embeds?.[0]?.data.description).not.toContain('could not');
  });

  it('keeps a saved setup mutation when audit delivery fails', async () => {
    const order: string[] = [];
    const context = createContext({
      auditPublish: {
        publish: () => {
          order.push('publish failed');
          return Promise.resolve(false);
        },
      },
    });
    context.guildSetupService.setupRoles = () => {
      order.push('saved');
      return Promise.resolve(setupResult());
    };
    const interaction = new TestInteraction('setup', {
      subcommand: 'roles',
      bot_permissions: 'bot-role',
      team_manager: 'tm-role',
      assistant_manager: 'atm-role',
      player_manager: 'pm-role',
    });

    await resolveCommand('setup').execute(interaction, context);
    expect(order).toEqual(['saved', 'publish failed']);
    expect(interaction.edits[0]?.embeds?.[0]?.data.description).toContain(
      'Configuration was saved',
    );
  });

  it('logs adapter failure and returns a nonfatal result', async () => {
    const logger = new MemoryLogger();
    const service = new SetupAuditService(
      { send: () => Promise.reject(new Error('discord unavailable')) },
      logger,
    );
    await expect(
      service.publish({
        channelId: 'audit-channel',
        title: '✅ League Settings Updated',
        description: 'Saved.',
        fields: [],
        actorDiscordUserId: authorization.discordUserId,
        timestamp: new Date(),
      }),
    ).resolves.toBe(false);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: 'warn', message: 'setup audit message delivery failed' }),
    );
  });

  it('sends an embed only audit message with actor last and a timestamp', async () => {
    const send = vi.fn(
      (_payload: {
        embeds: Array<{
          toJSON(): {
            timestamp?: string;
            fields?: Array<{ name: string; value: string; inline?: boolean }>;
          };
        }>;
      }) => {
        void _payload;
        return Promise.resolve();
      },
    );
    const client = {
      channels: {
        fetch: () =>
          Promise.resolve({
            isSendable: () => true,
            send,
          }),
      },
    } as unknown as Client;
    const adapter = new DiscordSetupAuditMessageAdapter(client);
    await adapter.send({
      channelId: 'audit-channel',
      title: '✅ System Channels Configured',
      description: 'Successfully updated channel configuration for the league.',
      fields: [{ name: 'Channels', value: 'Bot Commands: <#bot-channel>' }],
      actorDiscordUserId: authorization.discordUserId,
      timestamp: new Date('2026-08-01T12:00:00.000Z'),
    });

    const payload = send.mock.calls[0]?.[0];
    expect(payload).toEqual({ embeds: [expect.anything()] });
    const embed = payload?.embeds[0]?.toJSON();
    expect(embed?.timestamp).toBe('2026-08-01T12:00:00.000Z');
    expect(embed?.fields?.at(-1)).toEqual({
      name: 'Configured by',
      value: `<@${authorization.discordUserId}>`,
      inline: false,
    });
    expect(JSON.stringify(embed)).not.toContain('guild-1');
    expect(JSON.stringify(embed)).not.toContain('settings-1');
  });
});
