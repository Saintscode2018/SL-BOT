import { ApplicationCommandOptionType, MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { commandDefinitions } from '../../src/bot/commands.js';
import type {
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  DeferredInteractionResponse,
  EditedInteractionResponse,
  SafeInteractionResponse,
} from '../../src/bot/types.js';

const guildId = '840000000000000001';
const actorId = '840000000000000002';
const standardId = '840000000000000003';
const adminId = '840000000000000004';
const staffChannelId = '850000000000000001';
const auditChannelId = '850000000000000002';

function setupDefinition() {
  return commandDefinitions.find(({ data }) => data.name === 'setup')!;
}

class PermissionCommandInteraction implements CommandInteraction {
  public readonly commandName = 'setup';
  public readonly replied = false;
  public readonly deferred = false;
  public readonly guildId = guildId;
  public readonly guildName = 'Command League';
  public readonly guildIconUrl = 'https://example.com/guild.png';
  public readonly guildOwnerId = '840000000000000099';
  public readonly userId = actorId;
  public readonly userDisplayName = 'Actor Name';
  public readonly channelId = staffChannelId;
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = false;
  public deferredResponse: DeferredInteractionResponse | undefined;
  public editedResponse: EditedInteractionResponse | undefined;

  public constructor(
    group: 'botperm' | 'botpermadmin',
    subcommand: 'add' | 'remove' | 'view',
    target?: { id: string; bot: boolean; displayName?: string },
  ) {
    this.options = {
      getSubcommand: () => subcommand,
      getSubcommandGroup: () => group,
      getString: () => null,
      getInteger: () => null,
      getUser: () => target ?? null,
      getRole: () => null,
      getChannel: () => null,
    };
  }

  public readonly options: CommandInteractionOptions;

  public getGuildMemberDisplayName(userId: string): string | null {
    return userId === actorId ? 'Actor Name' : null;
  }

  public resolveGuildMemberDisplayName(userId: string): Promise<string | null> {
    const names = new Map([
      [standardId, 'Standard Name'],
      [adminId, 'Admin Name'],
    ]);
    return Promise.resolve(names.get(userId) ?? null);
  }

  public reply(_response: SafeInteractionResponse): Promise<void> {
    void _response;
    return Promise.resolve();
  }

  public deferReply(response?: DeferredInteractionResponse): Promise<void> {
    this.deferredResponse = response;
    return Promise.resolve();
  }

  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.editedResponse = response;
    return Promise.resolve();
  }

  public followUp(_response: SafeInteractionResponse): Promise<void> {
    void _response;
    return Promise.resolve();
  }

  public deleteReply(): Promise<void> {
    return Promise.resolve();
  }
}

function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    commandChannelPolicyService: { validateChannelPolicy: vi.fn(() => Promise.resolve()) },
    setupAuditService: { publish: vi.fn(() => Promise.resolve(true)) },
    ...overrides,
  } as unknown as CommandContext;
}

describe('/setup database Bot Permission commands', () => {
  it('registers exactly the requested subcommands without an admin removal alias', () => {
    const json = setupDefinition().data.toJSON();
    const groups = (json.options ?? []).filter(
      (option) => option.type === ApplicationCommandOptionType.SubcommandGroup,
    );
    const botperm = groups.find((option) => option.name === 'botperm');
    const botpermadmin = groups.find((option) => option.name === 'botpermadmin');

    expect(groups.map(({ name }) => name)).toEqual(['botperm', 'botpermadmin']);
    expect(botperm?.options?.map(({ name }) => name)).toEqual(['add', 'remove', 'view']);
    expect(botpermadmin?.options?.map(({ name }) => name)).toEqual(['add', 'view']);
    expect(botpermadmin?.options?.some(({ name }) => name === 'remove')).toBe(false);
  });

  it('renders both levels with canonical users and cold-cache resolution without auditing', async () => {
    const interaction = new PermissionCommandInteraction('botperm', 'view');
    const list = vi.fn(() =>
      Promise.resolve({
        guild: { id: 'internal-guild', discordGuildId: guildId, name: 'Command League' },
        permissions: [
          {
            id: 'permission-standard',
            guildId: 'internal-guild',
            userId: 'user-standard',
            level: 'BOTPERM',
            grantedByUserId: 'actor-user',
            createdAt: new Date(),
            updatedAt: new Date(),
            user: {
              id: 'user-standard',
              discordUserId: standardId,
              robloxUserId: null,
              robloxUsername: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
          {
            id: 'permission-admin',
            guildId: 'internal-guild',
            userId: 'user-admin',
            level: 'BOTPERM_ADMIN',
            grantedByUserId: 'actor-user',
            createdAt: new Date(),
            updatedAt: new Date(),
            user: {
              id: 'user-admin',
              discordUserId: adminId,
              robloxUserId: null,
              robloxUsername: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        ],
      }),
    );
    const publish = vi.fn(() => Promise.resolve(true));

    await setupDefinition().execute(
      interaction,
      context({
        botPermissionService: { list } as unknown as NonNullable<
          CommandContext['botPermissionService']
        >,
        setupAuditService: { publish },
      }),
    );

    expect(interaction.deferredResponse).toEqual({ flags: MessageFlags.Ephemeral });
    const embed = interaction.editedResponse?.embeds?.[0]?.toJSON();
    expect(embed?.fields).toEqual([
      {
        name: 'Bot Permission Admins',
        value: `<@${adminId}> \`Admin Name\``,
        inline: false,
      },
      {
        name: 'Standard Bot Permissions',
        value: `<@${standardId}> \`Standard Name\``,
        inline: false,
      },
    ]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('renders botpermadmin view with admins only and no audit', async () => {
    const interaction = new PermissionCommandInteraction('botpermadmin', 'view');
    const publish = vi.fn(() => Promise.resolve(true));
    const list = vi.fn(() =>
      Promise.resolve({
        guild: { id: 'internal-guild', discordGuildId: guildId, name: 'Command League' },
        permissions: [
          {
            level: 'BOTPERM',
            user: { discordUserId: standardId },
          },
          {
            level: 'BOTPERM_ADMIN',
            user: { discordUserId: adminId },
          },
        ],
      }),
    );

    await setupDefinition().execute(
      interaction,
      context({
        botPermissionService: { list } as unknown as NonNullable<
          CommandContext['botPermissionService']
        >,
        setupAuditService: { publish },
      }),
    );

    const fields = interaction.editedResponse?.embeds?.[0]?.toJSON().fields;
    expect(fields).toHaveLength(1);
    expect(fields?.[0]?.value).toBe(`<@${adminId}> \`Admin Name\``);
    expect(fields?.[0]?.value).not.toContain(standardId);
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps mutations ephemeral and publishes only through Discord Audit routing', async () => {
    const interaction = new PermissionCommandInteraction('botperm', 'add', {
      id: standardId,
      bot: false,
      displayName: 'Standard Name',
    });
    const publish = vi.fn(() => Promise.resolve(true));
    const addStandard = vi.fn(() =>
      Promise.resolve({
        guild: { id: 'internal-guild', discordGuildId: guildId, name: 'Command League' },
        permission: { id: 'permission-standard' },
        auditChannelId,
        beforeLevel: null,
        afterLevel: 'BOTPERM' as const,
        targetDiscordUserId: standardId,
        mutation: 'added' as const,
      }),
    );

    await setupDefinition().execute(
      interaction,
      context({
        botPermissionService: { addStandard } as unknown as NonNullable<
          CommandContext['botPermissionService']
        >,
        setupAuditService: { publish },
      }),
    );

    expect(interaction.deferredResponse).toEqual({ flags: MessageFlags.Ephemeral });
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: auditChannelId, actorVerb: 'Added' }),
    );
    expect(JSON.stringify(interaction.editedResponse)).not.toContain('Transfer Market');
  });
});
