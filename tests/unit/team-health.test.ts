import type { Club, ClubMembership, Guild, LeagueUser } from '@prisma/client';
import { MessageFlags } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { commands } from '../../src/bot/commands.js';
import {
  chunkTeamHealthLines,
  formatCompactTeamHealthLine,
  formatDetailedTeamHealthDescription,
  getTeamHealthHeart,
} from '../../src/bot/team-health-presentation.js';
import type {
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  DeferredInteractionResponse,
  EditedInteractionResponse,
  GuildRoleMetadata,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import { DiscordRoleMissingError, ValidationError } from '../../src/domain/errors.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const now = new Date('2026-08-03T12:00:00.000Z');

function club(index: number, overrides: Partial<Club> = {}): Club {
  return {
    id: `club-${index}`,
    guildId: 'guild-db',
    discordRoleId: `1000000000000000${index.toString().padStart(2, '0')}`,
    logoUrl: null,
    emoji: index % 2 === 0 ? '🌊' : '🔥',
    squadLimitOverride: null,
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const guild: Guild = {
  id: 'guild-db',
  discordGuildId: '100000000000000001',
  name: 'Super League',
  createdAt: now,
  updatedAt: now,
};

function staffMembership(
  type: 'TEAM_MANAGER' | 'ASSISTANT_MANAGER' | 'PLAYER_MANAGER',
  userIndex: number,
): ClubMembership & { user: LeagueUser } {
  const user: LeagueUser = {
    id: `user-db-${userIndex}`,
    discordUserId: `20000000000000000${userIndex}`,
    robloxUserId: null,
    robloxUsername: null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    id: `membership-${type}`,
    guildId: guild.id,
    clubId: 'club-1',
    userId: user.id,
    membershipType: type,
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

class TeamHealthInteraction implements CommandInteraction {
  public readonly commandName = 'teamhealth';
  public readonly guildId = guild.discordGuildId;
  public readonly guildName = guild.name;
  public readonly guildIconUrl = 'https://cdn.discordapp.com/icons/league/icon.png';
  public readonly guildOwnerId = '300000000000000001';
  public readonly userId = this.guildOwnerId;
  public readonly userDisplayName = 'League Owner';
  public readonly channelId = '400000000000000001';
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

  public constructor(selectedTeamId: string | null = null) {
    this.options = {
      getSubcommand: () => null,
      getString: (name) => (name === 'team' ? selectedTeamId : null),
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

function context(overrides: NonNullable<CommandContext['teamHealthService']>): CommandContext {
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
      autocomplete: () => Promise.resolve([]),
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
    commandChannelPolicyService: { validateChannelPolicy: () => Promise.resolve() },
    offerDeliveryService: { createAndDeliver: unused },
    offerButtonHandler: { handle: unused },
    setupAuditService: { publish: () => Promise.resolve(true) },
    teamHealthService: overrides,
  };
}

const teamHealthCommand = commands.find(({ data }) => data.name === 'teamhealth')!;

describe('team health presentation', () => {
  it.each([
    [0, '🖤'],
    [4, '🖤'],
    [5, '💛'],
    [9, '💛'],
    [10, '💚'],
    [15, '💚'],
    [16, '❤️'],
    [17, '❤️'],
    [42, '❤️'],
  ])('maps %i active players to %s', (count, expected) => {
    expect(getTeamHealthHeart(count)).toBe(expected);
  });

  it('rejects impossible negative counts', () => {
    expect(() => getTeamHealthHeart(-1)).toThrow(ValidationError);
  });

  it('formats the exact compact row without blank lines or health labels', () => {
    expect(formatCompactTeamHealthLine(club(1), 8)).toBe('🔥 <@&100000000000000001>: 8 👤, 💛');
  });

  it('chunks only between complete rows and preserves order', () => {
    expect(chunkTeamHealthLines(['first', 'second', 'third'], 12)).toEqual([
      'first\nsecond',
      'third',
    ]);
  });

  it.each([
    [0, '🖤'],
    [5, '💛'],
    [10, '💚'],
    [16, '❤️'],
  ])('renders the detailed continuous blockquote for the %i range', (count, heart) => {
    const tm = staffMembership('TEAM_MANAGER', 1);
    const description = formatDetailedTeamHealthDescription({
      team: club(1),
      activePlayerCount: count,
      effectiveSquadLimit: 21,
      staff: [tm],
      resolvedNames: new Map([[tm.user.discordUserId, 'Visible TM']]),
    });
    expect(description).toBe(
      [
        '🔥 <@&100000000000000001>',
        '> 👑 Team Manager: <@200000000000000001> `Visible TM`',
        '> 👔 Assistant Team Manager: Vacant',
        '> 🧠 Player Manager: Vacant',
        `> 📊 Roster: ${count}/21`,
        `> 🩺 Health: ${heart}`,
      ].join('\n'),
    );
    expect(description).not.toMatch(/\n\n|^>$|\n>$|Poor|Good|Healthy|Full|Critical|Excellent/m);
  });
});

describe('/teamhealth command', () => {
  it('registers one optional autocomplete team string option', () => {
    const json = teamHealthCommand.data.toJSON();
    expect(json.options).toEqual([
      expect.objectContaining({
        name: 'team',
        description: 'View detailed health for a specific team',
        required: false,
        autocomplete: true,
        type: 3,
      }),
    ]);
  });

  it('renders every supplied active team in deterministic service order', async () => {
    const interaction = new TeamHealthInteraction();
    const teams = [
      { club: club(2), activePlayerCount: 14 },
      { club: club(1), activePlayerCount: 3 },
    ];
    for (const { club: item } of teams) {
      interaction.roles.set(item.discordRoleId, {
        id: item.discordRoleId,
        name: item.id,
        color: 0,
      });
    }
    await teamHealthCommand.execute(
      interaction,
      context({
        getOverview: () => Promise.resolve({ guild, teams }),
        getDetail: () => Promise.reject(new Error('unused')),
      }),
    );

    expect(interaction.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(interaction.replies).toHaveLength(1);
    expect(interaction.edits).toHaveLength(1);
    expect(interaction.followUps).toEqual([]);
    expect(interaction.edits[0]?.embeds?.[0]?.data.description).toBe(
      ['🌊 <@&100000000000000002>: 14 👤, 💚', '🔥 <@&100000000000000001>: 3 👤, 🖤'].join('\n'),
    );
    expect(interaction.roleRequests).toEqual(teams.map(({ club: item }) => item.discordRoleId));
    expect(interaction.edits[0]?.embeds?.[0]?.data.color).toBe(0x5865f2);
  });

  it('uses the standard informational empty state', async () => {
    const interaction = new TeamHealthInteraction();
    await teamHealthCommand.execute(
      interaction,
      context({
        getOverview: () => Promise.resolve({ guild, teams: [] }),
        getDetail: () => Promise.reject(new Error('unused')),
      }),
    );
    expect(interaction.edits[0]?.embeds?.[0]?.data.description).toBe(
      'No active teams are currently configured.',
    );
  });

  it('chunks a large overview without losing or splitting teams', async () => {
    const interaction = new TeamHealthInteraction();
    const teams = Array.from({ length: 1_200 }, (_, index) => ({
      club: club(index + 1),
      activePlayerCount: index,
    }));
    for (const { club: item } of teams) {
      interaction.roles.set(item.discordRoleId, {
        id: item.discordRoleId,
        name: item.id,
        color: 0,
      });
    }
    await teamHealthCommand.execute(
      interaction,
      context({
        getOverview: () => Promise.resolve({ guild, teams }),
        getDetail: () => Promise.reject(new Error('unused')),
      }),
    );
    const descriptions = [
      ...(interaction.edits[0]?.embeds?.map(({ data }) => data.description ?? '') ?? []),
      ...interaction.followUps.flatMap(
        ({ embeds }) => embeds?.map(({ data }) => data.description ?? '') ?? [],
      ),
    ];
    expect(interaction.replies).toEqual([{ flags: MessageFlags.Ephemeral }]);
    expect(interaction.edits).toHaveLength(1);
    expect(interaction.followUps.length).toBeGreaterThan(0);
    expect(interaction.followUps.every(({ flags }) => flags === MessageFlags.Ephemeral)).toBe(true);
    expect(descriptions.length).toBeGreaterThan(10);
    expect(descriptions.join('\n').split('\n')).toHaveLength(1_200);
    expect(descriptions.join('\n')).toContain('<@&100000000000000001>');
    expect(descriptions.join('\n')).toContain('<@&10000000000000001200>');
  });

  it('renders selected staff names from cold-cache fetches exactly once and uses role color', async () => {
    const interaction = new TeamHealthInteraction('club-1');
    const selectedClub = club(1, { squadLimitOverride: 19 });
    interaction.roles.set(selectedClub.discordRoleId, {
      id: selectedClub.discordRoleId,
      name: 'T1',
      color: 0xf97316,
    });
    const staff = [staffMembership('TEAM_MANAGER', 1), staffMembership('ASSISTANT_MANAGER', 2)];
    interaction.names.set(staff[0]!.user.discordUserId, 'Fetched TM');
    interaction.names.set(staff[1]!.user.discordUserId, 'Fetched ATM');
    await teamHealthCommand.execute(
      interaction,
      context({
        getOverview: () => Promise.reject(new Error('unused')),
        getDetail: () =>
          Promise.resolve({
            guild,
            team: {
              club: selectedClub,
              activePlayerCount: 8,
              effectiveSquadLimit: 19,
              staff,
            },
          }),
      }),
    );

    const embed = interaction.edits[0]?.embeds?.[0]?.data;
    expect(embed?.description).toContain('> 👑 Team Manager: <@200000000000000001> `Fetched TM`');
    expect(embed?.description).toContain(
      '> 👔 Assistant Team Manager: <@200000000000000002> `Fetched ATM`',
    );
    expect(embed?.description).toContain('> 🧠 Player Manager: Vacant');
    expect(embed?.description).toContain('> 📊 Roster: 8/19');
    expect(embed?.description).toContain('> 🩺 Health: 💛');
    expect(embed?.description).not.toContain('Unknown User');
    expect(embed?.color).toBe(0xf97316);
    expect(interaction.roleRequests).toEqual([selectedClub.discordRoleId]);
    expect(interaction.userRequests).toEqual(staff.map(({ user }) => user.discordUserId));
  });

  it('rejects a selected team whose configured Discord role is stale', async () => {
    const interaction = new TeamHealthInteraction('club-1');
    await expect(
      teamHealthCommand.execute(
        interaction,
        context({
          getOverview: () => Promise.reject(new Error('unused')),
          getDetail: () =>
            Promise.resolve({
              guild,
              team: {
                club: club(1),
                activePlayerCount: 8,
                effectiveSquadLimit: 17,
                staff: [],
              },
            }),
        }),
      ),
    ).rejects.toBeInstanceOf(DiscordRoleMissingError);
  });
});
