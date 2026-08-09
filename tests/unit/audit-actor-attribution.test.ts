import { ChannelType, type Client, type GuildEmoji } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { DiscordAuditAnnouncementAdapter } from '../../src/bot/audit-announcement-adapter.js';
import { DiscordAuditAnnouncementPresentationProvider } from '../../src/bot/audit-announcement-presentation.js';
import { commands } from '../../src/bot/commands.js';
import { DiscordSetupAuditMessageAdapter } from '../../src/bot/setup-audit-message-adapter.js';
import type {
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  DeferredInteractionResponse,
  EditedInteractionResponse,
  GuildRoleMetadata,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import type { AuditAnnouncementPlan } from '../../src/domain/roster-mutation.js';

const guildId = '710000000000000001';
const channelId = '710000000000000002';
const actualActorId = '710000000000000003';
const targetUserId = '710000000000000004';
const currentTeamManagerId = '710000000000000005';
const teamRoleId = '710000000000000006';
const secondTeamRoleId = '710000000000000007';
const occurredAt = new Date('2026-08-09T12:00:00.000Z');

const presentation = {
  serverName: 'Actor Attribution League',
  serverIconUrl: null,
  teamRoleName: 'Attribution Team',
  teamRoleColor: 0x336699,
  subject: { username: 'Target User' },
  actor: { username: 'Actual Actor' },
  teamManager: { username: 'Current Team Manager' },
};

function userPlan(
  operation:
    | 'ROSTER_PLAYER_ADDED'
    | 'ROSTER_PLAYER_REMOVED'
    | 'STAFF_APPOINTED'
    | 'STAFF_REMOVED'
    | 'ROSTER_RELEASED'
    | 'ROSTER_PROMOTED'
    | 'ROSTER_DEMOTED',
): AuditAnnouncementPlan {
  return {
    discordGuildId: guildId,
    channelId,
    operation,
    actorDiscordUserId: actualActorId,
    playerDiscordUserId: targetUserId,
    teamIdentity: { discordRoleId: teamRoleId, emoji: '⚽' },
    occurredAt,
    ...(operation === 'STAFF_APPOINTED' || operation === 'STAFF_REMOVED'
      ? { staffRole: 'ATM' as const }
      : operation === 'ROSTER_PROMOTED'
        ? { staffRole: 'PM' as const }
        : {}),
    presentation,
  };
}

const humanPlans: Array<{
  operation: string;
  verb: string;
  actorIsTarget: boolean;
  plan: AuditAnnouncementPlan;
}> = [
  {
    operation: 'ROSTER_PLAYER_ADDED',
    verb: 'Added',
    actorIsTarget: false,
    plan: userPlan('ROSTER_PLAYER_ADDED'),
  },
  {
    operation: 'ROSTER_PLAYER_REMOVED',
    verb: 'Removed',
    actorIsTarget: false,
    plan: userPlan('ROSTER_PLAYER_REMOVED'),
  },
  {
    operation: 'STAFF_APPOINTED',
    verb: 'Appointed',
    actorIsTarget: false,
    plan: userPlan('STAFF_APPOINTED'),
  },
  {
    operation: 'STAFF_REMOVED',
    verb: 'Removed',
    actorIsTarget: false,
    plan: userPlan('STAFF_REMOVED'),
  },
  {
    operation: 'ROSTER_DEMANDED',
    verb: 'Demanded',
    actorIsTarget: true,
    plan: {
      discordGuildId: guildId,
      channelId,
      operation: 'ROSTER_DEMANDED',
      actorDiscordUserId: targetUserId,
      playerDiscordUserId: targetUserId,
      teamIdentity: { discordRoleId: teamRoleId, emoji: '⚽' },
      occurredAt,
      presentation: { ...presentation, actor: presentation.subject },
      departureMode: 'FULL',
    },
  },
  {
    operation: 'ROSTER_RELEASED',
    verb: 'Released',
    actorIsTarget: false,
    plan: userPlan('ROSTER_RELEASED'),
  },
  {
    operation: 'ROSTER_PROMOTED',
    verb: 'Promoted',
    actorIsTarget: false,
    plan: userPlan('ROSTER_PROMOTED'),
  },
  {
    operation: 'ROSTER_DEMOTED',
    verb: 'Demoted',
    actorIsTarget: false,
    plan: userPlan('ROSTER_DEMOTED'),
  },
  {
    operation: 'TEAM_DISBANDED',
    verb: 'Disbanded',
    actorIsTarget: false,
    plan: {
      discordGuildId: guildId,
      channelId,
      operation: 'TEAM_DISBANDED',
      actorDiscordUserId: actualActorId,
      teamIdentity: { discordRoleId: teamRoleId, emoji: '⚽' },
      occurredAt,
      presentation,
    },
  },
  {
    operation: 'TEAM_SWAPPED',
    verb: 'Swapped',
    actorIsTarget: false,
    plan: {
      discordGuildId: guildId,
      channelId,
      operation: 'TEAM_SWAPPED',
      actorDiscordUserId: actualActorId,
      team1Identity: { discordRoleId: teamRoleId, emoji: '⚽' },
      team2Identity: { discordRoleId: secondTeamRoleId, emoji: '🔥' },
      occurredAt,
      swapDetails: { team1MovedCount: 2, team2MovedCount: 3 },
      presentation,
    },
  },
  {
    operation: 'OFFER_CREATED',
    verb: 'Created',
    actorIsTarget: false,
    plan: {
      discordGuildId: guildId,
      channelId,
      operation: 'OFFER_CREATED',
      actorDiscordUserId: actualActorId,
      playerDiscordUserId: targetUserId,
      teamIdentity: { discordRoleId: teamRoleId, emoji: '⚽' },
      occurredAt,
      expiresAt: new Date('2026-08-10T12:00:00.000Z'),
      presentation,
    },
  },
  {
    operation: 'OFFER_ACCEPTED',
    verb: 'Accepted',
    actorIsTarget: true,
    plan: {
      discordGuildId: guildId,
      channelId,
      operation: 'OFFER_ACCEPTED',
      actorDiscordUserId: targetUserId,
      playerDiscordUserId: targetUserId,
      teamIdentity: { discordRoleId: teamRoleId, emoji: '⚽' },
      occurredAt,
      presentation: { ...presentation, actor: presentation.subject },
    },
  },
  {
    operation: 'OFFER_DECLINED',
    verb: 'Declined',
    actorIsTarget: true,
    plan: {
      discordGuildId: guildId,
      channelId,
      operation: 'OFFER_DECLINED',
      actorDiscordUserId: targetUserId,
      playerDiscordUserId: targetUserId,
      teamIdentity: { discordRoleId: teamRoleId, emoji: '⚽' },
      occurredAt,
      presentation: { ...presentation, actor: presentation.subject },
    },
  },
];

async function renderAudit(plan: AuditAnnouncementPlan) {
  const send = vi.fn((payload: unknown) => {
    void payload;
    return Promise.resolve();
  });
  const client = {
    channels: {
      fetch: vi.fn(() => Promise.resolve({ guildId, isSendable: () => true, send })),
    },
  } as unknown as Client;
  await new DiscordAuditAnnouncementAdapter(client).send(plan);
  const payload = send.mock.calls[0]?.[0] as
    | { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> }
    | undefined;
  return payload?.embeds[0]?.toJSON();
}

describe('Discord Audit actor attribution', () => {
  it.each(humanPlans)('$operation renders the authoritative human actor', async (testCase) => {
    const embed = await renderAudit(testCase.plan);
    const actorField = embed?.fields?.find(({ name }) => name === `${testCase.verb} by`);
    const expectedActorId = testCase.actorIsTarget ? targetUserId : actualActorId;
    const expectedName = testCase.actorIsTarget ? 'Target User' : 'Actual Actor';

    expect(actorField).toEqual({
      name: `${testCase.verb} by`,
      value: `<@${expectedActorId}> \`${expectedName}\``,
      inline: false,
    });
    expect(actorField?.value).not.toContain(currentTeamManagerId);
    expect(actorField?.value).not.toContain('Current Team Manager');
    if (!testCase.actorIsTarget) expect(actorField?.value).not.toContain(targetUserId);
  });

  it('OFFER_EXPIRED remains System/Automatic with no substituted human actor', async () => {
    const embed = await renderAudit({
      discordGuildId: guildId,
      channelId,
      operation: 'OFFER_EXPIRED',
      playerDiscordUserId: targetUserId,
      teamIdentity: { discordRoleId: teamRoleId, emoji: '⚽' },
      occurredAt,
      presentation,
    });

    expect(embed?.fields).toEqual([
      { name: 'Expired by', value: 'System (Automatic Expiration)', inline: false },
    ]);
    expect(JSON.stringify(embed?.fields)).not.toContain(actualActorId);
    expect(JSON.stringify(embed?.fields)).not.toContain(currentTeamManagerId);
  });

  it.each([
    ['OFFER_CREATED', actualActorId, 'Fetched Sender'],
    ['OFFER_DECLINED', targetUserId, 'Fetched Player'],
    ['OFFER_EXPIRED', null, null],
  ] as const)(
    '%s resolves subject and actor through the cold-cache presentation provider',
    async (operation, expectedActorId, expectedActorName) => {
      const members = new Map([
        [
          actualActorId,
          {
            displayName: 'Fetched Sender',
            user: { username: 'sender' },
            displayAvatarURL: () => 'https://example.com/sender.png',
          },
        ],
        [
          targetUserId,
          {
            displayName: 'Fetched Player',
            user: { username: 'player' },
            displayAvatarURL: () => 'https://example.com/player.png',
          },
        ],
      ]);
      const memberFetch = vi.fn((id: string) => Promise.resolve(members.get(id)!));
      const guild = {
        name: 'Fetched Guild',
        iconURL: () => 'https://example.com/guild.png',
        members: { cache: new Map(), fetch: memberFetch },
        roles: {
          cache: new Map(),
          fetch: vi.fn(() => Promise.resolve({ name: 'Fetched Team', color: 0x123456 })),
        },
        client: { users: { cache: new Map() } },
      };
      const client = {
        guilds: { cache: new Map([[guildId, guild]]) },
        users: { cache: new Map(), fetch: vi.fn(() => Promise.reject(new Error('unused'))) },
      } as unknown as Client;
      const common = {
        discordGuildId: guildId,
        channelId,
        playerDiscordUserId: targetUserId,
        teamIdentity: { discordRoleId: teamRoleId, emoji: '⚽' },
        occurredAt,
      };
      const plan: AuditAnnouncementPlan =
        operation === 'OFFER_CREATED'
          ? {
              ...common,
              operation,
              actorDiscordUserId: actualActorId,
              expiresAt: new Date('2026-08-10T12:00:00.000Z'),
            }
          : operation === 'OFFER_DECLINED'
            ? { ...common, operation, actorDiscordUserId: targetUserId }
            : { ...common, operation };

      const resolved = await new DiscordAuditAnnouncementPresentationProvider(client).resolve(plan);

      expect(resolved.presentation?.subject?.username).toBe('Fetched Player');
      if (expectedActorId === null) {
        expect(resolved.presentation?.actor).toBeNull();
      } else {
        expect(resolved.presentation?.actor?.username).toBe(expectedActorName);
        expect(memberFetch).toHaveBeenCalledWith(expectedActorId);
      }
    },
  );

  it('setup/admin Audit messages fetch the actual actor instead of rendering Unknown User', async () => {
    const send = vi.fn((payload: unknown) => {
      void payload;
      return Promise.resolve();
    });
    const memberFetch = vi.fn(() =>
      Promise.resolve({
        displayName: 'Fetched Setup Actor',
        user: { username: 'setup_actor' },
      }),
    );
    const guild = { members: { cache: new Map(), fetch: memberFetch } };
    const client = {
      channels: {
        fetch: vi.fn(() => Promise.resolve({ isSendable: () => true, guild, send })),
      },
      users: { cache: new Map(), fetch: vi.fn(() => Promise.reject(new Error('unused'))) },
    } as unknown as Client;

    await new DiscordSetupAuditMessageAdapter(client).send({
      channelId,
      title: 'Team Added',
      description: 'A team was added.',
      fields: [{ name: 'Target', value: `<@${targetUserId}>` }],
      actorDiscordUserId: actualActorId,
      actorVerb: 'Added',
      timestamp: occurredAt,
    });

    const payload = send.mock.calls[0]?.[0] as
      | { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> }
      | undefined;
    expect(payload?.embeds[0]?.toJSON().fields).toContainEqual({
      name: 'Added by',
      value: `<@${actualActorId}> \`Fetched Setup Actor\``,
      inline: false,
    });
    expect(memberFetch).toHaveBeenCalledWith(actualActorId);
  });
});

interface InteractionInput {
  commandName: 'setup' | 'team' | 'limit';
  subcommand: string;
  group?: string;
  strings?: Record<string, string | null>;
  integers?: Record<string, number | null>;
  user?: { id: string; bot: boolean; displayName?: string };
  roles?: Record<string, { id: string } | null>;
  channels?: Record<string, { id: string; type: number } | null>;
}

class AuditCommandInteraction implements CommandInteraction {
  public readonly replied = false;
  public readonly deferred = false;
  public readonly guildId = guildId;
  public readonly guildName = 'Actor Attribution League';
  public readonly guildIconUrl = 'https://example.com/guild.png';
  public readonly guildOwnerId = currentTeamManagerId;
  public readonly userId = actualActorId;
  public readonly userDisplayName = 'Actual Actor';
  public readonly channelId = '710000000000000008';
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = false;
  public readonly options: CommandInteractionOptions;
  public editedResponse: EditedInteractionResponse | undefined;

  public constructor(
    public readonly commandName: string,
    input: InteractionInput,
  ) {
    this.options = {
      getSubcommand: () => input.subcommand,
      getSubcommandGroup: () => input.group ?? null,
      getString: (name) => input.strings?.[name] ?? null,
      getInteger: (name) => input.integers?.[name] ?? null,
      getUser: () => input.user ?? null,
      getRole: (name) => input.roles?.[name] ?? null,
      getChannel: (name) => input.channels?.[name] ?? null,
    };
  }

  public getGuildEmojis(): readonly GuildEmoji[] {
    return [];
  }

  public getGuildRoleMetadata(roleId: string): GuildRoleMetadata | null {
    return { id: roleId, name: 'Resolved Team', color: 0x123456 };
  }

  public resolveGuildRoleMetadata(roleId: string): Promise<GuildRoleMetadata | null> {
    return Promise.resolve(this.getGuildRoleMetadata(roleId));
  }

  public getGuildMemberDisplayName(userId: string): string | null {
    if (userId === actualActorId) return 'Actual Actor';
    if (userId === targetUserId) return 'Target User';
    if (userId === currentTeamManagerId) return 'Current Team Manager';
    return null;
  }

  public resolveGuildMemberDisplayName(userId: string): Promise<string | null> {
    return Promise.resolve(this.getGuildMemberDisplayName(userId));
  }

  public deferUpdate(): Promise<void> {
    return Promise.resolve();
  }

  public reply(response: SafeInteractionResponse): Promise<void> {
    void response;
    return Promise.resolve();
  }

  public deferReply(response?: DeferredInteractionResponse): Promise<void> {
    void response;
    return Promise.resolve();
  }

  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.editedResponse = response;
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

const guild = {
  id: 'internal-guild',
  discordGuildId: guildId,
  name: 'Actor Attribution League',
};
const settings = { auditChannelId: channelId, offerTimeoutSeconds: 3600 };
const club = {
  id: 'internal-club',
  guildId: guild.id,
  discordRoleId: teamRoleId,
  discordRoleName: 'Resolved Team',
  emoji: '⚽',
  squadLimitOverride: null,
  active: true,
};

function command(name: string) {
  const definition = commands.find(({ data }) => data.name === name);
  if (definition === undefined) throw new Error(`missing command ${name}`);
  return definition;
}

function commandContext(
  publish: ReturnType<typeof vi.fn>,
  overrides: Partial<CommandContext>,
): CommandContext {
  return {
    commandChannelPolicyService: { validateChannelPolicy: vi.fn(() => Promise.resolve()) },
    setupAuditService: { publish },
    guildConfigurationService: {
      load: vi.fn(() => Promise.resolve({ guild, settings })),
    },
    ...overrides,
  } as unknown as CommandContext;
}

describe('setup/admin Audit plan actor sources', () => {
  it('carries the actual command actor through every setup, permission, team, and limit mutation', async () => {
    const textChannel = (id: string) => ({ id, type: ChannelType.GuildText });
    const permissionResult = (
      mutation: 'added' | 'promoted' | 'removed',
      afterLevel: 'BOTPERM' | 'BOTPERM_ADMIN' | null,
    ) => ({
      guild,
      permission: { id: `permission-${mutation}` },
      auditChannelId: channelId,
      beforeLevel: mutation === 'promoted' || mutation === 'removed' ? 'BOTPERM' : null,
      afterLevel,
      targetDiscordUserId: targetUserId,
      mutation,
    });
    const scenarios: Array<{
      name: string;
      interaction: AuditCommandInteraction;
      context: (publish: ReturnType<typeof vi.fn>) => CommandContext;
      verb: string;
    }> = [
      {
        name: 'bot permission added',
        interaction: new AuditCommandInteraction('setup', {
          commandName: 'setup',
          group: 'botperm',
          subcommand: 'add',
          user: { id: targetUserId, bot: false, displayName: 'Target User' },
        }),
        context: (publish) =>
          commandContext(publish, {
            botPermissionService: {
              addStandard: vi.fn(() => Promise.resolve(permissionResult('added', 'BOTPERM'))),
            } as never,
          }),
        verb: 'Added',
      },
      {
        name: 'bot permission removed',
        interaction: new AuditCommandInteraction('setup', {
          commandName: 'setup',
          group: 'botperm',
          subcommand: 'remove',
          user: { id: targetUserId, bot: false, displayName: 'Target User' },
        }),
        context: (publish) =>
          commandContext(publish, {
            botPermissionService: {
              removeStandard: vi.fn(() => Promise.resolve(permissionResult('removed', null))),
            } as never,
          }),
        verb: 'Removed',
      },
      {
        name: 'bot permission admin added',
        interaction: new AuditCommandInteraction('setup', {
          commandName: 'setup',
          group: 'botpermadmin',
          subcommand: 'add',
          user: { id: targetUserId, bot: false, displayName: 'Target User' },
        }),
        context: (publish) =>
          commandContext(publish, {
            botPermissionService: {
              addAdmin: vi.fn(() => Promise.resolve(permissionResult('added', 'BOTPERM_ADMIN'))),
            } as never,
          }),
        verb: 'Added',
      },
      {
        name: 'bot permission promoted',
        interaction: new AuditCommandInteraction('setup', {
          commandName: 'setup',
          group: 'botpermadmin',
          subcommand: 'add',
          user: { id: targetUserId, bot: false, displayName: 'Target User' },
        }),
        context: (publish) =>
          commandContext(publish, {
            botPermissionService: {
              addAdmin: vi.fn(() => Promise.resolve(permissionResult('promoted', 'BOTPERM_ADMIN'))),
            } as never,
          }),
        verb: 'Promoted',
      },
      {
        name: 'league configured',
        interaction: new AuditCommandInteraction('setup', {
          commandName: 'setup',
          subcommand: 'league',
          integers: { offer_timeout_minutes: 60 },
        }),
        context: (publish) =>
          commandContext(publish, {
            guildSetupService: {
              setupGuildOnly: vi.fn(() => Promise.resolve({ guild, settings, created: false })),
            } as never,
          }),
        verb: 'Configured',
      },
      {
        name: 'channels configured',
        interaction: new AuditCommandInteraction('setup', {
          commandName: 'setup',
          subcommand: 'channels',
          channels: {
            bot_commands: textChannel('710000000000000010'),
            staff: textChannel('710000000000000011'),
            transfer: textChannel('710000000000000012'),
            audit: textChannel(channelId),
            case_files: textChannel('710000000000000013'),
          },
        }),
        context: (publish) =>
          commandContext(publish, {
            guildSetupService: {
              setupChannels: vi.fn(() => Promise.resolve({ guild, settings, created: false })),
            } as never,
          }),
        verb: 'Configured',
      },
      {
        name: 'roles configured',
        interaction: new AuditCommandInteraction('setup', {
          commandName: 'setup',
          subcommand: 'roles',
          roles: {
            bot_permissions: { id: '710000000000000020' },
            team_manager: { id: '710000000000000021' },
            assistant_manager: { id: '710000000000000022' },
            player_manager: { id: '710000000000000023' },
          },
        }),
        context: (publish) =>
          commandContext(publish, {
            guildSetupService: {
              setupRoles: vi.fn(() => Promise.resolve({ guild, settings, created: false })),
            } as never,
          }),
        verb: 'Configured',
      },
      {
        name: 'team added',
        interaction: new AuditCommandInteraction('team', {
          commandName: 'team',
          subcommand: 'add',
          strings: { emoji: '⚽' },
          roles: { role: { id: teamRoleId } },
        }),
        context: (publish) =>
          commandContext(publish, {
            clubManagementService: { create: vi.fn(() => Promise.resolve(club)) } as never,
          }),
        verb: 'Added',
      },
      {
        name: 'team edited',
        interaction: new AuditCommandInteraction('team', {
          commandName: 'team',
          subcommand: 'edit',
          strings: { team: club.id, emoji: null },
          roles: { role: { id: teamRoleId } },
        }),
        context: (publish) =>
          commandContext(publish, {
            clubManagementService: { edit: vi.fn(() => Promise.resolve(club)) } as never,
          }),
        verb: 'Edited',
      },
      {
        name: 'default limit updated',
        interaction: new AuditCommandInteraction('limit', {
          commandName: 'limit',
          subcommand: 'default',
          integers: { amount: 17 },
        }),
        context: (publish) =>
          commandContext(publish, {
            limitManagementService: {
              setDefaultLimit: vi.fn(() => Promise.resolve({ defaultSquadLimit: 17 })),
            } as never,
          }),
        verb: 'Updated',
      },
      {
        name: 'team limit updated',
        interaction: new AuditCommandInteraction('limit', {
          commandName: 'limit',
          subcommand: 'team',
          strings: { team: club.id },
          integers: { amount: 18 },
        }),
        context: (publish) =>
          commandContext(publish, {
            limitManagementService: {
              setTeamLimit: vi.fn(() =>
                Promise.resolve({ club, override: 18, effectiveLimit: 18 }),
              ),
            } as never,
          }),
        verb: 'Updated',
      },
      {
        name: 'team limit reset',
        interaction: new AuditCommandInteraction('limit', {
          commandName: 'limit',
          subcommand: 'reset',
          strings: { team: club.id },
        }),
        context: (publish) =>
          commandContext(publish, {
            limitManagementService: {
              resetTeamLimit: vi.fn(() => Promise.resolve({ club, effectiveLimit: 17 })),
            } as never,
          }),
        verb: 'Reset',
      },
    ];

    for (const scenario of scenarios) {
      const publish = vi.fn((message: unknown) => {
        void message;
        return Promise.resolve(true);
      });
      await command(scenario.interaction.commandName).execute(
        scenario.interaction,
        scenario.context(publish),
      );
      expect(publish, scenario.name).toHaveBeenCalledOnce();
      expect(publish, scenario.name).toHaveBeenCalledWith(
        expect.objectContaining({
          actorDiscordUserId: actualActorId,
        }),
      );
      const message = publish.mock.calls[0]?.[0] as
        | { actorDiscordUserId: string; actorVerb?: string }
        | undefined;
      expect(message?.actorVerb ?? 'Configured', scenario.name).toBe(scenario.verb);
      expect(message?.actorDiscordUserId, scenario.name).not.toBe(targetUserId);
      expect(message?.actorDiscordUserId, scenario.name).not.toBe(currentTeamManagerId);
      if (scenario.name === 'channels configured') {
        const embed = scenario.interaction.editedResponse?.embeds?.[0]?.toJSON();
        expect(JSON.stringify(embed)).toContain('Case Files');
        expect(JSON.stringify(embed)).toContain('<#710000000000000013>');
      }
    }
  });
});
