import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commandDefinitions } from '../../src/bot/commands.js';
import type {
  CommandAutocompleteInteraction,
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  DeferredInteractionResponse,
  EditedInteractionResponse,
  GuildRoleMetadata,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import { ClubInactiveError, TeamNotFoundError } from '../../src/domain/errors.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { GuildRepository } from '../../src/repositories/guild-repository.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { ClubManagementService } from '../../src/services/club-management-service.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import { GuildConfigurationService } from '../../src/services/guild-configuration-service.js';
import { GuildSetupService } from '../../src/services/guild-setup-service.js';
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

const discordGuildId = '700000000000000001';
const ownerId = '700000000000000002';
const botChannelId = '700000000000000003';
const staffChannelId = '700000000000000004';

const authorization: AuthorizationInput = {
  discordGuildId,
  discordUserId: ownerId,
  guildOwnerId: ownerId,
  memberRoleIds: [],
  hasAdministratorPermission: true,
};

class RosterAutocompleteInteraction implements CommandAutocompleteInteraction {
  public readonly guildId = discordGuildId;
  public readonly focusedName = 'team';
  public readonly choices: Array<{ name: string; value: string }> = [];

  public constructor(
    public readonly commandName: string,
    public readonly focusedValue: string,
    private readonly roles: readonly GuildRoleMetadata[],
  ) {}

  public getGuildRoles(): readonly GuildRoleMetadata[] {
    return this.roles;
  }

  public respond(choices: Array<{ name: string; value: string }>): Promise<void> {
    this.choices.push(...choices);
    return Promise.resolve();
  }
}

class RosterCommandInteraction implements CommandInteraction {
  public readonly guildId = discordGuildId;
  public readonly guildName = 'Roster League';
  public readonly guildOwnerId = ownerId;
  public readonly userId = ownerId;
  public readonly channelId: string;
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = true;
  public readonly replies: SafeInteractionResponse[] = [];
  public readonly edits: EditedInteractionResponse[] = [];
  public replied = false;
  public deferred = false;

  public constructor(
    private readonly clubId: string,
    public readonly commandName = 'roster',
    private readonly subcommand: string | null = null,
    private readonly role: GuildRoleMetadata | null = null,
    channelId = botChannelId,
    private readonly stringOptions: Readonly<Record<string, string>> = {},
  ) {
    this.channelId = channelId;
  }

  public readonly options: CommandInteractionOptions = {
    getSubcommand: () => this.subcommand,
    getString: (name) => (name === 'team' ? this.clubId : (this.stringOptions[name] ?? null)),
    getInteger: () => null,
    getUser: () => null,
    getRole: () => null,
    getChannel: () => null,
  };

  public getGuildRoleMetadata(roleId: string): GuildRoleMetadata | null {
    return this.role?.id === roleId ? this.role : null;
  }

  public reply(response: SafeInteractionResponse): Promise<void> {
    this.replied = true;
    this.replies.push(response);
    return Promise.resolve();
  }

  public deferReply(response?: DeferredInteractionResponse): Promise<void> {
    void response;
    this.deferred = true;
    return Promise.resolve();
  }

  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.edits.push(response);
    return Promise.resolve();
  }

  public followUp(response: SafeInteractionResponse): Promise<void> {
    void response;
    return Promise.resolve();
  }

  public deleteReply(): Promise<void> {
    return Promise.resolve();
  }
}

describe('roster autocomplete command correlation', () => {
  let database: TestDatabase;
  let setup: GuildSetupService;
  let clubs: ClubManagementService;
  let rosters: RosterManagementService;
  let context: CommandContext;

  beforeAll(() => {
    database = createTestDatabase();
    setup = new GuildSetupService(database.client);
    clubs = new ClubManagementService(database.client);
    rosters = new RosterManagementService(database.client);
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
    await setup.setupChannels({
      authorization,
      guildName: 'Roster League',
      botCommandsChannelId: botChannelId,
      staffChannelId,
      transferChannelId: '700000000000000005',
      auditChannelId: '700000000000000006',
    });
    context = {
      logger: new MemoryLogger(),
      database: database.client,
      databaseHealth: { check: () => Promise.resolve(true) },
      guildConfigurationService: new GuildConfigurationService(
        new GuildRepository(database.client),
        new ClubRepository(database.client),
      ),
      guildSetupService: setup,
      clubManagementService: clubs,
      staffManagementService: new StaffManagementService(database.client),
      rosterManagementService: rosters,
      commandChannelPolicyService: new CommandChannelPolicyService(database.client),
      offerAcceptanceService: { acceptOffer: () => Promise.reject(new Error('unused')) },
      limitManagementService: new LimitManagementService(database.client),
      offerDeliveryService: { createAndDeliver: () => Promise.reject(new Error('unused')) },
      offerButtonHandler: { handle: () => Promise.resolve(false) },
      setupAuditService: { publish: () => Promise.resolve(true) },
    };
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  it.each([
    ['700000000000000010', '🔥', 'T1', '@T1'],
    ['700000000000000011', '<:Newcastle:987654321098765432>', 'T2', '@T2'],
  ] as const)(
    'opens the %s roster using the immutable autocomplete club id',
    async (roleId, emoji, roleName, expectedLabel) => {
      const club = await clubs.create({
        authorization,
        discordRoleId: roleId,
        emoji,
      });
      const command = commandDefinitions.find((candidate) => candidate.data.name === 'roster');
      if (command?.autocomplete === undefined) throw new Error('roster autocomplete is missing');
      const role = { id: roleId, name: roleName, color: 0xf97316 };
      const autocomplete = new RosterAutocompleteInteraction('roster', roleName, [role]);

      await command.autocomplete(autocomplete, context);

      expect(autocomplete.choices).toEqual([{ name: expectedLabel, value: club.id }]);
      const choice = autocomplete.choices[0];
      if (choice === undefined) throw new Error('roster choice is missing');
      const changedChoices = await clubs.autocomplete(discordGuildId, roleName, 25, {
        [roleId]: roleName,
      });
      expect(changedChoices[0]?.value).toBe(choice.value);
      const interaction = new RosterCommandInteraction(choice.value, 'roster', null, role);

      await command.execute(interaction, context);

      expect(interaction.replies).toHaveLength(1);
      const embed = interaction.replies[0]?.embeds?.[0]?.data;
      expect(embed?.title).toBeUndefined();
      expect(embed?.description).toBe(`${emoji} <@&${roleId}> Roster`);
      expect(embed?.fields?.some(({ name }) => name === 'Team')).toBe(false);
      expect(embed?.description?.match(new RegExp(`<@&${roleId}>`, 'g'))).toHaveLength(1);
      expect(embed?.footer?.text).toBe(
        `Roster for ${emoji.startsWith('<:') ? '.Newcastle.' : emoji} ${roleName}, Roster League`,
      );
    },
  );

  it.each([
    ['staff', 'list', botChannelId, {}],
    ['limit', 'view', botChannelId, {}],
    ['team', 'edit', staffChannelId, { emoji: '🔥' }],
  ] as const)(
    'round-trips a %s team choice through command execution',
    async (name, subcommand, channelId, stringOptions) => {
      const roleId = '700000000000000020';
      const club = await clubs.create({
        authorization,
        discordRoleId: roleId,
        emoji: '<:Newcastle:987654321098765432>',
      });
      const selectedCommand = commandDefinitions.find((candidate) => candidate.data.name === name);
      if (selectedCommand?.autocomplete === undefined) {
        throw new Error(`${name} autocomplete is missing`);
      }
      const role = { id: roleId, name: 'Newcastle', color: 0x3498db };
      const autocomplete = new RosterAutocompleteInteraction(name, 'Newcastle', [role]);

      await selectedCommand.autocomplete(autocomplete, context);

      expect(autocomplete.choices).toEqual([{ name: '@Newcastle', value: club.id }]);
      const choice = autocomplete.choices[0];
      if (choice === undefined) throw new Error(`${name} choice is missing`);
      const interaction = new RosterCommandInteraction(
        choice.value,
        name,
        subcommand,
        role,
        channelId,
        stringOptions,
      );
      await selectedCommand.execute(interaction, context);
      expect(JSON.stringify([...interaction.replies, ...interaction.edits])).toContain(
        `<@&${roleId}>`,
      );
    },
  );

  it('returns specific errors for inactive and missing club ids', async () => {
    const inactive = await clubs.create({
      authorization,
      discordRoleId: '700000000000000012',
      emoji: '⚪',
    });
    await clubs.deactivate(authorization, inactive.id);

    await expect(rosters.list(discordGuildId, inactive.id)).rejects.toBeInstanceOf(
      ClubInactiveError,
    );
    await expect(
      rosters.list(discordGuildId, '123e4567-e89b-42d3-a456-426614174000'),
    ).rejects.toBeInstanceOf(TeamNotFoundError);
  });
});
