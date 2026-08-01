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
      name: 'Team',
      shortName: 'TM',
      discordRoleId: '100000000000000007',
      logoUrl: null,
      emoji: null,
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
      list: () => Promise.reject(new Error('unused')),
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
  };
}

class ReplyInteraction implements CommandInteraction {
  public readonly commandName = 'health';
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
}

class OfferCommandInteraction implements CommandInteraction {
  public readonly commandName = 'offer';
  public readonly guildId = '100000000000000001';
  public readonly guildName = 'Test Guild';
  public readonly guildOwnerId = '100000000000000002';
  public readonly userId = '100000000000000002';
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = true;
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
}

class RosterCommandInteraction implements CommandInteraction {
  public readonly commandName = 'roster';
  public readonly guildId = '100000000000000001';
  public readonly guildName = 'Test Guild';
  public readonly guildOwnerId = '100000000000000002';
  public readonly userId = '100000000000000002';
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = true;
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
}

describe('stage three command registry and deployment', () => {
  it('exports every visible command as exact deployment JSON', () => {
    const registry = loadCommands(commandDefinitions);
    expect(registry.toJSON().map(({ name }) => name)).toEqual([
      'health',
      'setup',
      'team',
      'limit',
      'staff',
      'roster',
      'offer',
    ]);
    expect(registry.toJSON().find(({ name }) => name === 'offer')).toMatchObject({
      options: [expect.objectContaining({ name: 'create' })],
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
    expect(interaction.replies).toEqual([
      { content: 'SL Bot is online.\nDatabase: unavailable', flags: MessageFlags.Ephemeral },
    ]);
    expect(JSON.stringify(interaction.replies)).not.toContain('database secret');
  });

  it('formats roster using effective squad limit from guild settings', async () => {
    const command = loadCommands(commandDefinitions).resolve('roster');
    const interaction = new RosterCommandInteraction();
    const logger = new MemoryLogger();
    const context = commandContext(logger);
    const now = new Date();
    context.rosterManagementService = {
      ...context.rosterManagementService,
      list: () =>
        Promise.resolve({
          club: {
            id: 'club-1',
            guildId: '100000000000000001',
            name: 'Arsenal',
            shortName: 'ARS',
            discordRoleId: 'role-1',
            logoUrl: null,
            emoji: null,
            squadLimitOverride: null,
            active: true,
            createdAt: now,
            updatedAt: now,
          },
          players: [],
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
            adminRoleId: null,
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
    expect(interaction.replies[0]?.content).toContain('Arsenal — 0/22 (22 spaces remaining)');
  });

  it('defers offer creation before delivery and edits the successful response', async () => {
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
    expect(interaction.edits).toEqual([
      {
        content: 'Offer sent privately to <@100000000000000003>.',
      },
    ]);
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

  it('builds a private contract card without broad mentions', () => {
    const payload = createOfferMessagePayload(offerCreationResult());
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
        description: string;
        fields: Array<{ name: string; value: string }>;
        thumbnail?: { url: string };
      }>;
      components: Array<{
        components: Array<{ custom_id: string; label: string; disabled: boolean }>;
      }>;
    };
    expect(serialized.allowedMentions).toEqual({
      parse: [],
      users: [],
      roles: [],
      repliedUser: false,
    });
    expect(serialized.embeds[0]).toMatchObject({
      title: 'Test League Contract Offer',
      description: 'Professional First Team',
    });
    expect(serialized.embeds[0]?.thumbnail).toBeUndefined();
    expect(
      Object.fromEntries(
        serialized.embeds[0]?.fields.map(({ name, value }) => [name, value]) ?? [],
      ),
    ).toMatchObject({
      'Destination Club': 'Team',
      'Offered Player': '<@100000000000000003>',
      'Offering Manager': '<@100000000000000004>',
      Squad: '4/10',
      'Remaining Spots': '6',
      'Current Club': 'Free agent',
    });
    expect(serialized.embeds[0]?.fields.find(({ name }) => name === 'Expires')?.value).toMatch(
      /^<t:\d+:F>\n<t:\d+:R>$/,
    );
    expect(serialized.components[0]?.components).toEqual([
      {
        type: 2,
        custom_id: `offer:accept:${offerId}`,
        label: 'Sign Contract',
        style: 3,
        disabled: false,
      },
      {
        type: 2,
        custom_id: `offer:decline:${offerId}`,
        label: 'Decline Offer',
        style: 4,
        disabled: false,
      },
    ]);
  });

  it('includes the destination club logo only when configured', () => {
    const withLogo = offerCreationResult();
    withLogo.destinationClub.logoUrl = 'https://example.com/team-logo.png';
    const payloadWithLogo = JSON.parse(JSON.stringify(createOfferMessagePayload(withLogo))) as {
      embeds: Array<{ thumbnail?: { url: string } }>;
    };
    const payloadWithoutLogo = JSON.parse(
      JSON.stringify(createOfferMessagePayload(offerCreationResult())),
    ) as { embeds: Array<{ thumbnail?: { url: string } }> };
    expect(payloadWithLogo.embeds[0]?.thumbnail?.url).toBe('https://example.com/team-logo.png');
    expect(payloadWithoutLogo.embeds[0]?.thumbnail).toBeUndefined();
  });

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
    expect(mapDiscordError(new OfferDeliveryError('offer message could not be delivered'))).toBe(
      'The player could not be contacted privately, so the offer was cancelled.',
    );
    expect(mapDiscordError(new OfferDeliveryError('discord raw detail'))).not.toContain(
      'discord raw detail',
    );
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
        name: 'Team',
        shortName: 'TM',
        discordRoleId: '7',
        logoUrl: null,
        emoji: null,
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
        return Promise.resolve(declinedOffer);
      }),
    };
    const recovery = { recordMessageUpdateFailure: vi.fn(() => Promise.resolve()) };
    const messages: OfferMessageAdapter = {
      sendOffer: vi.fn(() => Promise.reject(new Error('unused'))),
      setTerminalState: vi.fn(() => Promise.resolve()),
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
    expect(order).toEqual(['defer', 'database', 'edit']);
    expect(responses.declineOffer).toHaveBeenCalledOnce();
    expect(replies).toEqual([{ content: 'Offer declined.', flags: MessageFlags.Ephemeral }]);
  });
});

describe('discord error mapping', () => {
  it('maps expected errors and keeps unknown internal text private', () => {
    expect(mapDiscordError(new AuthorizationError('private authorization detail'))).toBe(
      'You are not authorized to do that.',
    );
    expect(mapDiscordError(new Error('raw database password'))).toBe(
      'The command could not be completed. Please try again later.',
    );
    expect(mapDiscordError(new Error('raw database password'))).not.toContain('password');
    expect(mapDiscordError(new InvalidOfferMessageError('private message ids'))).toBe(
      'This offer interaction is not valid.',
    );
  });
});
