import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commandDefinitions } from '../../src/bot/commands.js';
import type {
  CommandAutocompleteInteraction,
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  DeferredInteractionResponse,
  EditedInteractionResponse,
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
  public readonly commandName = 'roster';
  public readonly guildId = discordGuildId;
  public readonly focusedName = 'team';
  public readonly choices: Array<{ name: string; value: string }> = [];

  public constructor(
    public readonly focusedValue: string,
    private readonly roles: readonly { id: string; name: string }[],
  ) {}

  public getGuildRoles(): readonly { id: string; name: string }[] {
    return this.roles;
  }

  public respond(choices: Array<{ name: string; value: string }>): Promise<void> {
    this.choices.push(...choices);
    return Promise.resolve();
  }
}

class RosterCommandInteraction implements CommandInteraction {
  public readonly commandName = 'roster';
  public readonly guildId = discordGuildId;
  public readonly guildName = 'Roster League';
  public readonly guildOwnerId = ownerId;
  public readonly userId = ownerId;
  public readonly channelId = botChannelId;
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = true;
  public readonly replies: SafeInteractionResponse[] = [];
  public replied = false;
  public deferred = false;

  public constructor(private readonly clubId: string) {}

  public readonly options: CommandInteractionOptions = {
    getSubcommand: () => null,
    getString: (name) => (name === 'team' ? this.clubId : null),
    getInteger: () => null,
    getUser: () => null,
    getRole: () => null,
    getChannel: () => null,
  };

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
    void response;
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
      limitManagementService: {
        setDefaultLimit: () => Promise.reject(new Error('unused')),
        setTeamLimit: () => Promise.reject(new Error('unused')),
        resetTeamLimit: () => Promise.reject(new Error('unused')),
        viewLimit: () => Promise.reject(new Error('unused')),
      },
      offerDeliveryService: { createAndDeliver: () => Promise.reject(new Error('unused')) },
      offerButtonHandler: { handle: () => Promise.resolve(false) },
      setupAuditService: { publish: () => Promise.resolve(true) },
    };
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  it.each([
    ['Unicode United', 'UNI', '700000000000000010', '🔵', 'T2', '🔵 @T2'],
    [
      'Newcastle',
      'NEW',
      '700000000000000011',
      '<:Newcastle:987654321098765432>',
      'T1',
      '.Newcastle. @T1',
    ],
  ] as const)(
    'opens the %s roster using the immutable autocomplete club id',
    async (name, shortName, roleId, emoji, roleName, expectedLabel) => {
      const club = await clubs.create({
        authorization,
        name,
        shortName,
        discordRoleId: roleId,
        emoji,
      });
      const command = commandDefinitions.find((candidate) => candidate.data.name === 'roster');
      if (command?.autocomplete === undefined) throw new Error('roster autocomplete is missing');
      const autocomplete = new RosterAutocompleteInteraction(name, [
        { id: roleId, name: roleName },
      ]);

      await command.autocomplete(autocomplete, context);

      expect(autocomplete.choices).toEqual([{ name: expectedLabel, value: club.id }]);
      const choice = autocomplete.choices[0];
      if (choice === undefined) throw new Error('roster choice is missing');
      await setup.updateBannerConfiguration({
        authorization,
        bannerHasEmoji: true,
        bannerHasName: true,
        bannerHasShort: true,
        bannerHasRole: true,
      });
      const changedChoices = await clubs.autocomplete(discordGuildId, name, 25, {
        [roleId]: roleName,
      });
      expect(changedChoices[0]?.value).toBe(choice.value);
      const interaction = new RosterCommandInteraction(choice.value);

      await command.execute(interaction, context);

      expect(interaction.replies).toHaveLength(1);
      expect(interaction.replies[0]?.embeds?.[0]?.data.title).toContain('Roster');
      expect(JSON.stringify(interaction.replies[0])).toContain(name);
    },
  );

  it('returns specific errors for inactive and missing club ids', async () => {
    const inactive = await clubs.create({
      authorization,
      name: 'Inactive Team',
      shortName: 'INA',
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
