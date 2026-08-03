import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
  type DMChannel,
  type User,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { loadCommands } from '../../src/bot/command-loader.js';
import { commandDefinitions } from '../../src/bot/commands.js';
import {
  deployGuildCommands,
  type GuildCommandDeploymentAdapter,
} from '../../src/bot/deploy-commands.js';
import { mapDiscordError } from '../../src/bot/error-mapper.js';
import { handleInteractionCreate } from '../../src/bot/interaction-handler.js';
import {
  OfferButtonHandler,
  type OfferButtonInteraction,
} from '../../src/bot/offer-button-handler.js';
import { createOfferCustomId, parseOfferCustomId } from '../../src/bot/offer-custom-id.js';
import {
  createOfferMessagePayload,
  DiscordOfferMessageAdapter,
} from '../../src/bot/offer-message-adapter.js';
import type {
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  EditedInteractionResponse,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import { parseCommandDeploymentEnvironment } from '../../src/config/env.js';
import {
  AuthorizationError,
  ConfigurationError,
  InvalidOfferMessageError,
  OfferDeliveryError,
  StaffMemberCannotReceiveOffersError,
} from '../../src/domain/errors.js';
import type { OfferAcceptanceResult } from '../../src/services/offer-acceptance-service.js';
import type { OfferCreationResult } from '../../src/services/offer-creation-service.js';
import type { OfferMessageAdapter } from '../../src/services/offer-delivery-service.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const offerId = '123e4567-e89b-42d3-a456-426614174000';

function offerCreationResult(): OfferCreationResult {
  const now = new Date();
  return {
    offer: {
      id: offerId,
      guildId: '1',
      clubId: '2',
      playerUserId: '3',
      offeredByUserId: '4',
      status: 'PENDING',
      discordChannelId: '100000000000000005',
      discordMessageId: '100000000000000006',
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      respondedAt: null,
      cancelledAt: null,
      updatedAt: now,
    },
    destinationClub: {
      id: '2',
      guildId: '1',
      discordRoleId: '100000000000000007',
      logoUrl: null,
      emoji: '🔵',
      squadLimitOverride: 10,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    sourceClub: null,
    player: {
      id: '3',
      discordUserId: '100000000000000003',
      robloxUserId: null,
      robloxUsername: null,
      createdAt: now,
      updatedAt: now,
    },
    offeredBy: {
      id: '4',
      discordUserId: '100000000000000004',
      robloxUserId: null,
      robloxUsername: null,
      createdAt: now,
      updatedAt: now,
    },
    leagueName: 'Test League',
    activePlayerCount: 4,
    effectiveSquadLimit: 10,
  };
}

function commandContext(
  logger: MemoryLogger,
  databaseHealth: () => Promise<boolean> = () => Promise.resolve(true),
): CommandContext {
  return {
    logger,
    database: {} as CommandContext['database'],
    databaseHealth: { check: databaseHealth },
    guildConfigurationService: { load: () => Promise.reject(new Error('unused')) },
    offerAcceptanceService: { acceptOffer: () => Promise.reject(new Error('unused')) },
    guildSetupService: {
      setup: () => Promise.reject(new Error('unused')),
      setupGuildOnly: () => Promise.reject(new Error('unused')),
      setupChannels: () => Promise.reject(new Error('unused')),
      setupRoles: () => Promise.reject(new Error('unused')),
      getView: () => Promise.reject(new Error('unused')),
    },
    clubManagementService: {
      create: () => Promise.reject(new Error('unused')),
      edit: () => Promise.reject(new Error('unused')),
      deactivate: () => Promise.reject(new Error('unused')),
      listActive: () => Promise.reject(new Error('unused')),
      autocomplete: () => Promise.resolve([]),
    },
    staffManagementService: {
      appoint: () => Promise.reject(new Error('unused')),
      remove: () => Promise.reject(new Error('unused')),
      list: () => Promise.resolve([]),
      getCallerActiveStaffClub: () =>
        Promise.resolve({
          id: 'club-1',
          guildId: 'guild-1',
          discordRoleId: '100000000000000007',
          emoji: '⚽',
          logoUrl: null,
          squadLimitOverride: null,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
    },

    rosterManagementService: {
      add: () => Promise.reject(new Error('unused')),
      remove: () => Promise.reject(new Error('unused')),
      list: () => Promise.reject(new Error('unused')),
    },
    limitManagementService: {
      setDefaultLimit: () => Promise.reject(new Error('unused')),
      setTeamLimit: () => Promise.reject(new Error('unused')),
      resetTeamLimit: () => Promise.reject(new Error('unused')),
      viewLimit: () => Promise.reject(new Error('unused')),
    },
    commandChannelPolicyService: {
      validateChannelPolicy: () => Promise.resolve(),
    },
    offerDeliveryService: { createAndDeliver: () => Promise.reject(new Error('unused')) },
    offerButtonHandler: { handle: () => Promise.resolve(false) },
    setupAuditService: { publish: () => Promise.resolve(true) },
  };
}

class ReplyInteraction implements CommandInteraction {
  public readonly commandName = 'health';
  public readonly guildId = '100000000000000001';
  public readonly guildName = 'Test Guild';
  public readonly guildOwnerId = '100000000000000002';
  public readonly userId = '100000000000000002';
  public readonly channelId = '100000000000000003';
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = true;
  public readonly options: CommandInteractionOptions = {
    getSubcommand: () => null,
    getString: () => null,
    getInteger: () => null,
    getUser: () => null,
    getRole: () => null,
    getChannel: () => null,
  };
  public replied = false;
  public deferred = false;
  public readonly replies: SafeInteractionResponse[] = [];
  public readonly edits: EditedInteractionResponse[] = [];

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
    this.replies.push(response);
    return Promise.resolve();
  }

  public deleteReply(): Promise<void> {
    return Promise.resolve();
  }
}

class OfferCommandInteraction implements CommandInteraction {
  public readonly commandName = 'offer';
  public readonly guildId = '100000000000000001';
  public readonly guildName = 'Test Guild';
  public readonly guildIconUrl = 'https://cdn.discordapp.com/icons/guild/icon.png';
  public readonly guildOwnerId = '100000000000000002';
  public readonly userId = '100000000000000002';
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = true;
  public readonly channelId = '100000000000000003';
  public replied = false;
  public deferred = false;
  public readonly replies: SafeInteractionResponse[] = [];
  public readonly followUps: SafeInteractionResponse[] = [];
  public readonly edits: EditedInteractionResponse[] = [];
  public readonly order: string[] = [];
  public readonly options: CommandInteractionOptions = {
    getSubcommand: () => 'create',
    getString: (name) => (name === 'team' ? '2' : null),
    getInteger: () => null,
    getUser: (name) => (name === 'player' ? { id: '100000000000000003', bot: false } : null),
    getRole: () => null,
    getChannel: () => null,
  };

  public getGuildRoleMetadata(roleId: string) {
    return roleId === '100000000000000007' ? { id: roleId, name: 'T2', color: 0xf97316 } : null;
  }

  public reply(response: SafeInteractionResponse): Promise<void> {
    this.order.push('reply');
    this.replies.push(response);
    this.replied = true;
    return Promise.resolve();
  }

  public deferReply(): Promise<void> {
    this.order.push('defer');
    this.deferred = true;
    return Promise.resolve();
  }

  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.order.push('edit');
    this.edits.push(response);
    this.replied = true;
    return Promise.resolve();
  }

  public followUp(response: SafeInteractionResponse): Promise<void> {
    this.order.push('follow_up');
    this.followUps.push(response);
    return Promise.resolve();
  }

  public deleteReply(): Promise<void> {
    this.order.push('delete_reply');
    return Promise.resolve();
  }
}

class RosterCommandInteraction implements CommandInteraction {
  public readonly commandName = 'roster';
  public readonly guildId = '100000000000000001';
  public readonly guildName = 'Test Guild';
  public readonly guildOwnerId = '100000000000000002';
  public readonly userId = '100000000000000002';
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = true;
  public readonly channelId = '100000000000000003';
  public replied = false;
  public deferred = false;
  public readonly replies: SafeInteractionResponse[] = [];
  public readonly followUps: SafeInteractionResponse[] = [];
  public readonly edits: EditedInteractionResponse[] = [];
  public readonly options: CommandInteractionOptions = {
    getSubcommand: () => null,
    getString: (name) => (name === 'team' ? 'club-1' : null),
    getInteger: () => null,
    getUser: () => null,
    getRole: () => null,
    getChannel: () => null,
  };

  public getGuildRoleMetadata(roleId: string) {
    return roleId === 'r-1' ? { id: roleId, name: 'T1', color: 0x3498db } : null;
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

describe('stage three command registry and deployment', () => {
  it('exports every visible command as exact deployment JSON', () => {
    const registry = loadCommands(commandDefinitions);
    const expectedNames = [
      'health',
      'setup',
      'team',
      'limit',
      'staff',
      'roster',
      'teamhealth',
      'offer',
      'demand',
      'release',
      'promote',
      'demote',
    ];
    if (process.env['SLBOT_ENABLE_DEBUG_COMMANDS'] === 'true') expectedNames.push('debugreset');
    expect(registry.toJSON().map(({ name }) => name)).toEqual(expectedNames);
    expect(registry.toJSON().find(({ name }) => name === 'offer')).toMatchObject({
      options: [expect.objectContaining({ name: 'player' })],
    });
  });

  it('rejects incomplete deployment configuration', () => {
    expect(() =>
      parseCommandDeploymentEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'file:./dev.db',
        DISCORD_TOKEN: 'secret-token',
      }),
    ).toThrow(ConfigurationError);
  });

  it('passes application guild and registry JSON to the deployment adapter without logging tokens', async () => {
    const deploy = vi.fn(() => Promise.resolve());
    const adapter: GuildCommandDeploymentAdapter = { deploy };
    const logger = new MemoryLogger();
    const commands = [
      new SlashCommandBuilder().setName('health').setDescription('health').toJSON(),
    ];
    await deployGuildCommands({
      applicationId: '100000000000000001',
      guildId: '100000000000000002',
      commands,
      adapter,
      logger,
    });
    expect(deploy).toHaveBeenCalledWith('100000000000000001', '100000000000000002', commands);
    expect(JSON.stringify(logger.entries)).not.toContain('secret-token');
  });

  it('reports health safely even when the database check fails', async () => {
    const command = loadCommands(commandDefinitions).resolve('health');
    const interaction = new ReplyInteraction();
    await command?.execute(
      interaction,
      commandContext(new MemoryLogger(), () => Promise.reject(new Error('database secret'))),
    );
    expect(interaction.replies).toHaveLength(1);
    expect(interaction.replies[0]?.embeds?.[0]?.data?.title).toBe('SL Bot System Health');
    expect(JSON.stringify(interaction.replies)).not.toContain('database secret');
  });

  it('formats roster using effective squad limit from guild settings', async () => {
    const command = loadCommands(commandDefinitions).resolve('roster');
    const interaction = new RosterCommandInteraction();
    const context = commandContext(new MemoryLogger());
    const now = new Date();
    context.rosterManagementService = {
      add: () => Promise.reject(new Error('unused')),
      remove: () => Promise.reject(new Error('unused')),
      list: () =>
        Promise.resolve({
          club: {
            id: 'club-1',
            guildId: 'g-1',
            discordRoleId: 'r-1',
            logoUrl: null,
            emoji: '🔴',
            squadLimitOverride: null,
            active: true,
            createdAt: now,
            updatedAt: now,
          },
          allActiveMembers: [],
          activeStaffUserIds: new Set<string>(),
          ordinaryPlayers: [],
          staff: [],
        }),
    };
    context.guildConfigurationService = {
      load: () =>
        Promise.resolve({
          guild: {
            id: 'g-1',
            discordGuildId: '100000000000000001',
            name: 'Test Guild',
            createdAt: now,
            updatedAt: now,
          },
          settings: {
            id: 's-1',
            guildId: 'g-1',
            botCommandsChannelId: null,
            staffChannelId: null,
            transferChannelId: null,
            auditChannelId: null,
            botPermissionsRoleId: null,
            teamManagerRoleId: null,
            assistantManagerRoleId: null,
            playerManagerRoleId: null,
            defaultSquadLimit: 22,
            offerTimeoutSeconds: 86400,
            createdAt: now,
            updatedAt: now,
          },
          activeClubs: [],
        }),
    };
    await command?.execute(interaction, context);
    const embed = interaction.replies[0]?.embeds?.[0]?.data;
    expect(embed?.title).toBeUndefined();
    expect(embed?.description).toBe('🔴 <@&r-1> Roster');
    expect(embed?.color).toBe(0x3498db);
    expect(embed?.fields?.some(({ name }) => name === 'Team')).toBe(false);
    expect(embed?.footer?.text).toBe('Roster for T1, Test Guild');
  });

  it('defers and edits the same private response after successful offer delivery', async () => {
    const interaction = new OfferCommandInteraction();
    const context = commandContext(new MemoryLogger());
    const delivery = vi.fn(() => {
      interaction.order.push('delivery');
      return Promise.resolve(offerCreationResult());
    });
    context.offerDeliveryService = { createAndDeliver: delivery };
    await loadCommands(commandDefinitions).resolve('offer')?.execute(interaction, context);
    expect(interaction.order).toEqual(['defer', 'delivery', 'edit']);
    expect(interaction.replies).toEqual([]);
    expect(interaction.followUps).toEqual([]);
    expect(interaction.edits).toHaveLength(1);
    expect(interaction.edits[0]?.embeds?.[0]?.data?.title).toBe('✅ Contract Offer Sent');
    expect(interaction.edits[0]?.embeds?.[0]?.data?.description).toBe(
      'A private contract offer has been sent to <@100000000000000003> `Unknown User` by <@100000000000000002> `Unknown User` on behalf of 🔵 <@&100000000000000007>.',
    );
    expect(interaction.edits[0]?.embeds?.[0]?.data?.color).toBe(0xf97316);
    expect(delivery).toHaveBeenCalledWith(expect.any(Object), {
      sourceTeamRoleColor: 0xf97316,
      sourceTeamRoleName: 'T2',
      guildName: 'Test Guild',
      guildIconUrl: 'https://cdn.discordapp.com/icons/guild/icon.png',
      offeredByUsername: 'Unknown User',
    });
    expect(JSON.stringify(interaction.edits[0])).not.toContain('Destination Team');
    expect(JSON.stringify(interaction.edits[0])).not.toContain('**<@&');
  });

  it('edits a deferred command with a safe failure and never sends a second initial reply', async () => {
    const interaction = new OfferCommandInteraction();
    const logger = new MemoryLogger();
    const context = commandContext(logger);
    context.offerDeliveryService = {
      createAndDeliver: () => {
        interaction.order.push('delivery');
        return Promise.reject(new Error('private delivery detail'));
      },
    };
    await handleInteractionCreate(interaction, loadCommands(commandDefinitions), context, logger);
    expect(interaction.order).toEqual(['defer', 'delivery', 'edit']);
    expect(interaction.replies).toEqual([]);
    expect(interaction.followUps).toEqual([]);
    expect(JSON.stringify(interaction.edits)).not.toContain('private delivery detail');
  });

  it('builds the exact private contract card with readable team metadata and persistent buttons', () => {
    const payload = createOfferMessagePayload(offerCreationResult(), {
      sourceTeamRoleColor: 0xf97316,
      sourceTeamRoleName: 'T2',
      guildName: 'Test Guild',
      guildIconUrl: 'https://cdn.discordapp.com/icons/guild/icon.png',
    });
    expect(payload.content).toBeUndefined();
    const serialized = JSON.parse(JSON.stringify(payload)) as {
      allowedMentions: {
        parse: string[];
        users: string[];
        roles: string[];
        repliedUser: boolean;
      };
      embeds: Array<{
        title: string;
        description?: string;
        author?: { name: string; icon_url?: string };
        color: number;
        fields: Array<{ name: string; value: string }>;
        thumbnail?: { url: string };
      }>;
      components: Array<{
        components: Array<{
          custom_id: string;
          emoji: { name: string };
          label: string;
          style: number;
          disabled: boolean;
        }>;
      }>;
    };
    expect(serialized.allowedMentions).toEqual({
      parse: [],
      users: [],
      roles: [],
      repliedUser: false,
    });
    expect(serialized.embeds[0]).toMatchObject({
      author: {
        name: 'Test Guild',
        icon_url: 'https://cdn.discordapp.com/icons/guild/icon.png',
      },
      title: 'Contract Offer',
      color: 0xf97316,
    });
    expect(serialized.embeds[0]?.description).toContain(
      '> 👑 Team Manager: <@100000000000000004> `Unknown User`',
    );
    expect(serialized.embeds[0]?.description).toContain('> 📊 Roster: 4/10');
    expect(serialized.embeds[0]?.description).toContain('> ⏰ Expires: <t:');
    expect(serialized.embeds[0]?.thumbnail?.url).toContain('twemoji');
    expect(serialized.embeds[0]?.fields.map(({ name }) => name)).toEqual(['Source Team']);
    expect(serialized.embeds[0]?.fields[0]?.value).toBe('🔵 @T2');
    expect(JSON.stringify(serialized.embeds[0])).not.toMatch(
      /Professional First Team|Offered Player|Offering Manager|Remaining Spots|<@&|@unknown-role|<t:\d+:F>/,
    );
    expect(serialized.components[0]?.components).toEqual([
      {
        type: 2,
        custom_id: `offer:accept:${offerId}`,
        emoji: { animated: false, name: '✅' },
        label: 'Sign Contract',
        style: 3,
        disabled: false,
      },
      {
        type: 2,
        custom_id: `offer:decline:${offerId}`,
        emoji: { animated: false, name: '❌' },
        label: 'Decline Offer',
        style: 4,
        disabled: false,
      },
    ]);
  });

  it('does not use a legacy logo as a team thumbnail', () => {
    const withLogo = offerCreationResult();
    withLogo.destinationClub.logoUrl = 'https://example.com/team-logo.png';
    const payloadWithLogo = JSON.parse(JSON.stringify(createOfferMessagePayload(withLogo))) as {
      embeds: Array<{ thumbnail?: { url: string } }>;
    };
    const payloadWithoutLogo = JSON.parse(
      JSON.stringify(createOfferMessagePayload(offerCreationResult())),
    ) as { embeds: Array<{ thumbnail?: { url: string } }> };
    expect(payloadWithLogo.embeds[0]?.thumbnail?.url).toContain('twemoji');
    expect(payloadWithoutLogo.embeds[0]?.thumbnail?.url).toBe(
      payloadWithLogo.embeds[0]?.thumbnail?.url,
    );
  });

  it('brands the private offer with the source team identity and custom thumbnail', () => {
    const result = offerCreationResult();
    result.destinationClub.emoji = '<:Newcastle:987654321098765432>';

    const payload = JSON.parse(
      JSON.stringify(createOfferMessagePayload(result, { sourceTeamRoleName: 'Newcastle' })),
    ) as {
      embeds: Array<{
        fields: Array<{ name: string; value: string }>;
        thumbnail?: { url: string };
      }>;
    };

    expect(payload.embeds[0]?.fields.find(({ name }) => name === 'Source Team')?.value).toBe(
      '<:Newcastle:987654321098765432> @Newcastle',
    );
    expect(payload.embeds[0]?.thumbnail?.url).toBe(
      'https://cdn.discordapp.com/emojis/987654321098765432.png',
    );
  });

  it.each([
    [
      'supplied role color',
      { sourceTeamRoleColor: 0xf97316, sourceTeamRoleName: 'T2' },
      0xf97316,
      '🔵 @T2',
    ],
    ['zero-color fallback', { sourceTeamRoleColor: 0 }, 0x5865f2, '🔵 Team'],
    ['missing metadata fallback', {}, 0x5865f2, '🔵 Team'],
  ] as const)(
    'uses the %s for the private offer DM with a safe readable identity',
    (_, metadata, color, expectedIdentity) => {
      const payload = JSON.parse(
        JSON.stringify(createOfferMessagePayload(offerCreationResult(), metadata)),
      ) as {
        embeds: Array<{ color: number; fields: Array<{ name: string; value: string }> }>;
        components: Array<{ components: Array<{ label: string }> }>;
      };

      expect(payload.embeds[0]?.color).toBe(color);
      expect(payload.embeds[0]?.fields.find(({ name }) => name === 'Source Team')?.value).toBe(
        expectedIdentity,
      );
      expect(JSON.stringify(payload.embeds[0])).not.toMatch(/<@&|@unknown-role/);
      expect(payload.components[0]?.components.map(({ label }) => label)).toEqual([
        'Sign Contract',
        'Decline Offer',
      ]);
    },
  );

  it('opens the offered player DM and never fetches a guild transfer channel', async () => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const send = vi.fn(() =>
      Promise.resolve({
        channelId: '100000000000000005',
        id: '100000000000000006',
      }),
    );
    const createDM = vi.fn(() => Promise.resolve({ send } as unknown as DMChannel));
    const userFetch = vi
      .spyOn(client.users, 'fetch')
      .mockResolvedValue({ createDM } as unknown as User);
    const channelFetch = vi.spyOn(client.channels, 'fetch');
    try {
      await expect(
        new DiscordOfferMessageAdapter(client).sendOffer(offerCreationResult()),
      ).resolves.toEqual({
        channelId: '100000000000000005',
        messageId: '100000000000000006',
      });
      expect(userFetch).toHaveBeenCalledWith('100000000000000003');
      expect(createDM).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledOnce();
      expect(channelFetch).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });

  it('maps a DM send failure to a safe manager response', () => {
    const mapped1 = mapDiscordError(new OfferDeliveryError('offer message could not be delivered'));
    expect(mapped1.description).toBe(
      'The player could not be contacted privately, so the offer was cancelled.',
    );
    const mapped2 = mapDiscordError(new OfferDeliveryError('discord raw detail'));
    expect(mapped2.description).not.toContain('discord raw detail');
  });
});

describe('persistent offer buttons', () => {
  it('creates and parses restart-safe custom ids', () => {
    expect(createOfferCustomId('accept', offerId)).toBe(`offer:accept:${offerId}`);
    expect(parseOfferCustomId(`offer:decline:${offerId}`)).toEqual({
      action: 'decline',
      offerId,
    });
  });

  it.each(['offer:accept:not-a-uuid', `offer:unknown:${offerId}`, 'different:accept:value'])(
    'rejects malformed custom id %s',
    (customId) => {
      expect(parseOfferCustomId(customId)).toBeNull();
    },
  );

  it('keeps accepted database success when Discord message editing fails', async () => {
    const now = new Date();
    const result: OfferAcceptanceResult = {
      offer: {
        id: offerId,
        guildId: '1',
        clubId: '2',
        playerUserId: '3',
        offeredByUserId: '4',
        status: 'ACCEPTED',
        discordChannelId: '5',
        discordMessageId: '6',
        expiresAt: now,
        createdAt: now,
        respondedAt: now,
        cancelledAt: null,
        updatedAt: now,
      },
      player: {
        id: '3',
        discordUserId: '100000000000000003',
        robloxUserId: null,
        robloxUsername: null,
        createdAt: now,
        updatedAt: now,
      },
      destinationClub: {
        id: '2',
        guildId: '1',
        discordRoleId: '7',
        logoUrl: null,
        emoji: '🔵',
        squadLimitOverride: 10,
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      sourceClub: null,
      newMembership: {
        id: '8',
        guildId: '1',
        clubId: '2',
        userId: '3',
        membershipType: 'PLAYER',
        status: 'ACTIVE',
        joinedAt: now,
        leftAt: null,
        createdByUserId: '4',
        endedByUserId: null,
        createdAt: now,
        updatedAt: now,
      },
      transaction: {
        id: '9',
        guildId: '1',
        userId: '3',
        transactionType: 'SIGNING',
        sourceClubId: null,
        destinationClubId: '2',
        performedByUserId: '4',
        offerId,
        reason: null,
        createdAt: now,
        reversedAt: null,
        reversedByUserId: null,
      },
      transactionType: 'SIGNING',
      roleMutation: {
        discordGuildId: '100000000000000001',
        discordUserId: '100000000000000003',
        addRoles: [],
        removeRoles: [],
      },
      announcement: null,
    };
    const order: string[] = [];
    const responses = {
      acceptOffer: vi.fn(() => {
        order.push('database');
        return Promise.resolve(result);
      }),
      declineOffer: vi.fn(() => Promise.reject(new Error('unused'))),
    };
    const recovery = { recordMessageUpdateFailure: vi.fn(() => Promise.resolve()) };
    const messages: OfferMessageAdapter = {
      sendOffer: vi.fn(() => Promise.reject(new Error('unused'))),
      setTerminalState: vi.fn(() => Promise.reject(new Error('discord edit failed'))),
      cleanupOrphan: vi.fn(() => Promise.resolve()),
    };
    const logger = new MemoryLogger();
    const handler = new OfferButtonHandler(responses, recovery, messages, logger);
    const replies: SafeInteractionResponse[] = [];
    const interaction: OfferButtonInteraction = {
      customId: createOfferCustomId('accept', offerId),
      userId: result.player.discordUserId,
      channelId: '5',
      messageId: '6',
      replied: false,
      deferred: false,
      reply: (response) => {
        order.push('reply');
        replies.push(response);
        return Promise.resolve();
      },
      deferReply: () => {
        order.push('defer');
        interaction.deferred = true;
        return Promise.resolve();
      },
      editReply: (response) => {
        order.push('edit');
        replies.push({ ...response, flags: MessageFlags.Ephemeral });
        interaction.replied = true;
        return Promise.resolve();
      },
      followUp: (response) => {
        order.push('follow_up');
        replies.push(response);
        return Promise.resolve();
      },
    };
    await expect(handler.handle(interaction)).resolves.toBe(true);
    expect(responses.acceptOffer).toHaveBeenCalledOnce();
    expect(order).toEqual(['defer', 'database', 'edit']);
    expect(recovery.recordMessageUpdateFailure).toHaveBeenCalledWith(
      result.offer,
      result.player.discordUserId,
      'ACCEPTED',
    );
    expect(replies).toEqual([
      { content: 'Offer accepted successfully.', flags: MessageFlags.Ephemeral },
    ]);
  });

  it('defers decline before database work and edits the deferred response', async () => {
    const result = offerCreationResult();
    const declinedOffer = { ...result.offer, status: 'DECLINED', respondedAt: new Date() };
    const order: string[] = [];
    const responses = {
      acceptOffer: vi.fn(() => Promise.reject(new Error('unused'))),
      declineOffer: vi.fn(() => {
        order.push('database');
        return Promise.resolve({
          status: 'DECLINED' as const,
          offer: declinedOffer,
          destinationClub: result.destinationClub,
          teamManagerDiscordUserId: null,
          activePlayerCount: 0,
          effectiveSquadLimit: 17,
          guildName: 'Test Guild',
        });
      }),
    };
    const recovery = { recordMessageUpdateFailure: vi.fn(() => Promise.resolve()) };
    const messages: OfferMessageAdapter = {
      sendOffer: vi.fn(() => Promise.reject(new Error('unused'))),
      setTerminalState: vi.fn(() => {
        order.push('terminal');
        return Promise.resolve();
      }),
      cleanupOrphan: vi.fn(() => Promise.resolve()),
    };
    const handler = new OfferButtonHandler(responses, recovery, messages, new MemoryLogger());
    const replies: SafeInteractionResponse[] = [];
    const interaction: OfferButtonInteraction = {
      customId: createOfferCustomId('decline', offerId),
      userId: result.player.discordUserId,
      channelId: result.offer.discordChannelId ?? '',
      messageId: result.offer.discordMessageId ?? '',
      replied: false,
      deferred: false,
      reply: (response) => {
        order.push('reply');
        replies.push(response);
        return Promise.resolve();
      },
      deferReply: () => {
        order.push('defer');
        interaction.deferred = true;
        return Promise.resolve();
      },
      deferUpdate: () => {
        order.push('defer');
        interaction.deferred = true;
        return Promise.resolve();
      },
      editReply: (response) => {
        order.push('edit');
        replies.push({ ...response, flags: MessageFlags.Ephemeral });
        interaction.replied = true;
        return Promise.resolve();
      },
      followUp: (response) => {
        order.push('follow_up');
        replies.push(response);
        return Promise.resolve();
      },
    };
    await expect(handler.handle(interaction)).resolves.toBe(true);
    expect(order).toEqual(['defer', 'database', 'terminal']);
    expect(responses.declineOffer).toHaveBeenCalledOnce();
    expect(replies).toEqual([]);
  });
});

describe('discord error mapping', () => {
  it('maps expected errors and keeps unknown internal text private', () => {
    const authMapped = mapDiscordError(new AuthorizationError('private authorization detail'));
    expect(authMapped.title).toBe('❌ Permission Denied');
    expect(authMapped.description).toBe('private authorization detail');

    const unknownMapped = mapDiscordError(new Error('raw database password'));
    expect(unknownMapped.title).toBe('❌ Command Failed');
    expect(unknownMapped.description).toBe('An unexpected error occurred. Please try again later.');
    expect(unknownMapped.description).not.toContain('password');

    const invalidOfferMapped = mapDiscordError(new InvalidOfferMessageError('private message ids'));
    expect(invalidOfferMapped.title).toBe('❌ Invalid Offer Interaction');
    expect(invalidOfferMapped.description).toBe('This offer interaction is no longer valid.');

    const staffTargetMapped = mapDiscordError(
      new StaffMemberCannotReceiveOffersError(
        '100000000000000009',
        'Assistant Team Manager',
        '<:Newcastle:987654321098765432> <@&100000000000000008>',
      ),
    );
    expect(staffTargetMapped.title).toBe('❌ Staff Member Cannot Receive Offers');
    expect(staffTargetMapped.description).toContain(
      '<@100000000000000009> is currently the Assistant Team Manager of <:Newcastle:987654321098765432> <@&100000000000000008>.',
    );
  });
});
