import { ApplicationCommandOptionType, MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { commandDefinitions } from '../../src/bot/commands.js';
import type {
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  DeferredInteractionResponse,
  EditedInteractionResponse,
} from '../../src/bot/types.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const roster = commandDefinitions.find(({ data }) => data.name === 'roster');
if (roster === undefined) throw new Error('roster command is missing');

describe('roster administrative command', () => {
  it('registers exactly view, add, and remove with their required options', () => {
    const json = roster.data.toJSON() as {
      options?: Array<{
        name: string;
        type: ApplicationCommandOptionType;
        options?: Array<{
          name: string;
          type: ApplicationCommandOptionType;
          required?: boolean;
          autocomplete?: boolean;
        }>;
      }>;
    };
    expect(json.options?.map(({ name }) => name)).toEqual(['view', 'add', 'remove']);
    expect(
      json.options?.every(({ type }) => type === ApplicationCommandOptionType.Subcommand),
    ).toBe(true);

    const subcommands = new Map(json.options?.map((option) => [option.name, option]));
    expect(subcommands.get('view')?.options).toEqual([
      expect.objectContaining({
        name: 'team',
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      }),
    ]);
    expect(subcommands.get('add')?.options).toEqual([
      expect.objectContaining({
        name: 'player',
        type: ApplicationCommandOptionType.User,
        required: true,
      }),
      expect.objectContaining({
        name: 'team',
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      }),
    ]);
    expect(subcommands.get('remove')?.options).toEqual([
      expect.objectContaining({
        name: 'player',
        type: ApplicationCommandOptionType.User,
        required: true,
      }),
    ]);
    expect(JSON.stringify(json)).not.toContain('reason');
  });

  it.each([
    ['add', 'has been added to'],
    ['remove', 'is now a free agent'],
  ] as const)(
    'returns a private canonical success card for /roster %s',
    async (subcommand, text) => {
      const interaction = new RosterAdminInteraction(subcommand);
      const add = vi.fn(() => Promise.resolve(result()));
      const remove = vi.fn(() => Promise.resolve(result()));
      const context = contextWith({ add, remove });

      await roster.execute(interaction, context);

      expect(interaction.deferrals).toEqual([{ flags: MessageFlags.Ephemeral }]);
      expect(interaction.edits).toHaveLength(1);
      const embed = interaction.edits[0]?.embeds?.[0]?.data;
      expect(embed?.description).toContain('<@810000000000000003> `Player One`');
      expect(embed?.description).toContain('⚽ <@&810000000000000020>');
      expect(embed?.description).toContain(text);
      expect(embed?.author?.name).toBe('Roster Administration League');
      expect(embed?.footer?.text).toContain(
        subcommand === 'add' ? 'Added by League Owner' : 'Removed by League Owner',
      );
      expect(embed?.timestamp).toBeDefined();
      expect(subcommand === 'add' ? add : remove).toHaveBeenCalledOnce();
    },
  );
});

class RosterAdminInteraction implements CommandInteraction {
  public readonly commandName = 'roster';
  public readonly guildId = '810000000000000001';
  public readonly guildName = 'Roster Administration League';
  public readonly guildOwnerId = '810000000000000002';
  public readonly userId = '810000000000000002';
  public readonly userDisplayName = 'League Owner';
  public readonly channelId = '810000000000000010';
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = false;
  public readonly replied = false;
  public deferred = false;
  public readonly deferrals: Array<DeferredInteractionResponse | undefined> = [];
  public readonly edits: EditedInteractionResponse[] = [];

  public constructor(private readonly subcommand: 'add' | 'remove') {}

  public readonly options: CommandInteractionOptions = {
    getSubcommand: () => this.subcommand,
    getString: (name) => (name === 'team' ? 'club-1' : null),
    getInteger: () => null,
    getUser: (name) =>
      name === 'player'
        ? { id: '810000000000000003', bot: false, displayName: 'Player One' }
        : null,
    getRole: () => null,
    getChannel: () => null,
  };

  public resolveGuildRoleMetadata(roleId: string) {
    return Promise.resolve(
      roleId === '810000000000000020' ? { id: roleId, name: 'T1', color: 0xf97316 } : null,
    );
  }

  public reply(): Promise<void> {
    return Promise.resolve();
  }

  public deferReply(response?: DeferredInteractionResponse): Promise<void> {
    this.deferred = true;
    this.deferrals.push(response);
    return Promise.resolve();
  }

  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.edits.push(response);
    return Promise.resolve();
  }

  public followUp(): Promise<void> {
    return Promise.resolve();
  }

  public deleteReply(): Promise<void> {
    return Promise.resolve();
  }
}

function result() {
  const occurredAt = new Date('2026-08-06T20:00:00.000Z');
  return {
    guild: {
      id: 'guild-1',
      discordGuildId: '810000000000000001',
      name: 'Roster Administration League',
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    club: {
      id: 'club-1',
      guildId: 'guild-1',
      discordRoleId: '810000000000000020',
      emoji: '⚽',
      logoUrl: null,
      squadLimitOverride: null,
      active: true,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    player: {
      id: 'player-1',
      discordUserId: '810000000000000003',
      robloxUserId: null,
      robloxUsername: null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    membership: {
      id: 'membership-1',
      guildId: 'guild-1',
      clubId: 'club-1',
      userId: 'player-1',
      membershipType: 'PLAYER',
      status: 'ACTIVE',
      joinedAt: occurredAt,
      leftAt: null,
      createdByUserId: 'actor-1',
      endedByUserId: null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    transaction: {
      id: 'transaction-1',
      guildId: 'guild-1',
      userId: 'player-1',
      transactionType: 'SIGNING',
      sourceClubId: null,
      destinationClubId: 'club-1',
      performedByUserId: 'actor-1',
      offerId: null,
      reason: null,
      createdAt: occurredAt,
      reversedAt: null,
      reversedByUserId: null,
    },
    roleMutation: {
      discordGuildId: '810000000000000001',
      discordUserId: '810000000000000003',
      addRoles: [],
      removeRoles: [],
    },
    announcement: null,
    announcementDelivered: null,
  };
}

function contextWith(
  rosterAdministrationService: NonNullable<CommandContext['rosterAdministrationService']>,
): CommandContext {
  const unused = () => Promise.reject(new Error('unused'));
  return {
    logger: new MemoryLogger(),
    database: {} as CommandContext['database'],
    databaseHealth: { check: unused },
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
    rosterAdministrationService,
    limitManagementService: {
      setDefaultLimit: unused,
      setTeamLimit: unused,
      resetTeamLimit: unused,
      viewLimit: unused,
    },
    commandChannelPolicyService: { validateChannelPolicy: () => Promise.resolve() },
    offerDeliveryService: { createAndDeliver: unused },
    offerButtonHandler: { handle: unused },
    setupAuditService: { publish: unused },
  };
}
