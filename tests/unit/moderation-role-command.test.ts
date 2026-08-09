import { ApplicationCommandOptionType, MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { commandDefinitions } from '../../src/bot/commands.js';
import { ModerationRoleGuildMismatchError } from '../../src/domain/errors.js';
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
import type { SetupAuditMessage } from '../../src/services/setup-audit-service.js';

const guildId = '940000000000000001';
const actorId = '940000000000000002';
const roleId = '950000000000000001';
const deletedRoleId = '950000000000000002';
const staffChannelId = '960000000000000001';
const auditChannelId = '960000000000000002';

function setupDefinition() {
  return commandDefinitions.find(({ data }) => data.name === 'setup')!;
}

class ModerationRoleInteraction implements CommandInteraction {
  public readonly commandName = 'setup';
  public readonly replied = false;
  public readonly deferred = false;
  public readonly guildId = guildId;
  public readonly guildName = 'Moderation Command League';
  public readonly guildOwnerId = '940000000000000099';
  public readonly userId = actorId;
  public readonly userDisplayName = 'Actual Actor';
  public readonly channelId = staffChannelId;
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = false;
  public deferredResponse: DeferredInteractionResponse | undefined;
  public editedResponse: EditedInteractionResponse | undefined;

  public constructor(
    subcommand: 'add' | 'remove' | 'view',
    selectedRole: { id: string; guildId?: string } | null = null,
    private readonly resolvedRoles: ReadonlyMap<string, GuildRoleMetadata> = new Map(),
  ) {
    this.options = {
      getSubcommand: () => subcommand,
      getSubcommandGroup: () => 'modrole',
      getString: () => null,
      getInteger: () => null,
      getUser: () => null,
      getRole: () => selectedRole,
      getChannel: () => null,
    };
  }

  public readonly options: CommandInteractionOptions;

  public getGuildRoleMetadata(): GuildRoleMetadata | null {
    return null;
  }

  public resolveGuildRoleMetadata(role: string): Promise<GuildRoleMetadata | null> {
    return Promise.resolve(this.resolvedRoles.get(role) ?? null);
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

function moderationRole(discordRoleId: string) {
  return {
    id: `record-${discordRoleId}`,
    guildId: 'internal-guild',
    discordRoleId,
    createdByUserId: 'internal-actor',
    createdAt: new Date(),
  };
}

describe('/setup modrole commands', () => {
  it('registers add/remove with Discord ROLE options and a read-only view', () => {
    const json = setupDefinition().data.toJSON();
    const groups = (json.options ?? []).filter(
      (option) => option.type === ApplicationCommandOptionType.SubcommandGroup,
    );
    const group = groups.find((option) => option.name === 'modrole');

    expect(group?.options?.map(({ name }) => name)).toEqual(['add', 'remove', 'view']);
    for (const name of ['add', 'remove']) {
      const subcommand = group?.options?.find((option) => option.name === name);
      expect(subcommand?.options).toEqual([
        expect.objectContaining({
          name: 'role',
          type: ApplicationCommandOptionType.Role,
          required: true,
        }),
      ]);
    }
    expect(group?.options?.find((option) => option.name === 'view')?.options ?? []).toEqual([]);
  });

  it('keeps add ephemeral and attributes the Discord Audit message to the actual actor', async () => {
    const interaction = new ModerationRoleInteraction(
      'add',
      { id: roleId, guildId },
      new Map([[roleId, { id: roleId, name: 'Head of Department', color: 0x123456 }]]),
    );
    const add = vi.fn((input: { authorization: AuthorizationInput; discordRoleId: string }) => {
      void input;
      return Promise.resolve({
        guild: { id: 'internal-guild', discordGuildId: guildId, name: 'League' },
        moderationRole: moderationRole(roleId),
        auditChannelId,
        mutation: 'added' as const,
      });
    });
    const publish = vi.fn((message: SetupAuditMessage) => {
      void message;
      return Promise.resolve(true);
    });

    await setupDefinition().execute(
      interaction,
      context({
        moderationRoleService: { add } as unknown as NonNullable<
          CommandContext['moderationRoleService']
        >,
        setupAuditService: { publish },
      }),
    );

    expect(interaction.deferredResponse).toEqual({ flags: MessageFlags.Ephemeral });
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0]?.[0].authorization.discordUserId).toBe(actorId);
    expect(add.mock.calls[0]?.[0].discordRoleId).toBe(roleId);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: auditChannelId,
        actorDiscordUserId: actorId,
        actorVerb: 'Added',
        fields: [{ name: 'Role', value: `<@&${roleId}> \`@Head of Department\``, inline: false }],
      }),
    );
    expect(interaction.editedResponse?.embeds?.[0]?.toJSON().title).toContain(
      'Moderation Role Added',
    );
  });

  it('renders empty and deleted-role views without creating Audit messages', async () => {
    const publish = vi.fn((message: SetupAuditMessage) => {
      void message;
      return Promise.resolve(true);
    });
    const emptyInteraction = new ModerationRoleInteraction('view');
    const emptyList = vi.fn(() =>
      Promise.resolve({
        guild: { id: 'internal-guild', discordGuildId: guildId, name: 'League' },
        moderationRoles: [],
      }),
    );
    await setupDefinition().execute(
      emptyInteraction,
      context({
        moderationRoleService: { list: emptyList } as unknown as NonNullable<
          CommandContext['moderationRoleService']
        >,
        setupAuditService: { publish },
      }),
    );
    expect(emptyInteraction.deferredResponse).toEqual({ flags: MessageFlags.Ephemeral });
    expect(emptyInteraction.editedResponse?.embeds?.[0]?.toJSON().description).toBe(
      'No moderation roles configured.',
    );

    const deletedInteraction = new ModerationRoleInteraction('view');
    const list = vi.fn(() =>
      Promise.resolve({
        guild: { id: 'internal-guild', discordGuildId: guildId, name: 'League' },
        moderationRoles: [moderationRole(deletedRoleId)],
      }),
    );
    await setupDefinition().execute(
      deletedInteraction,
      context({
        moderationRoleService: { list } as unknown as NonNullable<
          CommandContext['moderationRoleService']
        >,
        setupAuditService: { publish },
      }),
    );

    expect(deletedInteraction.editedResponse?.embeds?.[0]?.toJSON().description).toContain(
      `Deleted role (ID: \`${deletedRoleId}\`)`,
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps remove ephemeral and publishes a distinct removal Audit message', async () => {
    const interaction = new ModerationRoleInteraction(
      'remove',
      { id: roleId, guildId },
      new Map([[roleId, { id: roleId, name: 'Head of Department', color: 0x123456 }]]),
    );
    const remove = vi.fn(() =>
      Promise.resolve({
        guild: { id: 'internal-guild', discordGuildId: guildId, name: 'League' },
        moderationRole: moderationRole(roleId),
        auditChannelId,
        mutation: 'removed' as const,
      }),
    );
    const publish = vi.fn((message: SetupAuditMessage) => {
      void message;
      return Promise.resolve(true);
    });

    await setupDefinition().execute(
      interaction,
      context({
        moderationRoleService: { remove } as unknown as NonNullable<
          CommandContext['moderationRoleService']
        >,
        setupAuditService: { publish },
      }),
    );

    expect(interaction.deferredResponse).toEqual({ flags: MessageFlags.Ephemeral });
    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0]?.[0]).toMatchObject({
      actorDiscordUserId: actorId,
      actorVerb: 'Removed',
    });
    expect(publish.mock.calls[0]?.[0].title).toContain('Moderation Role Removed');
  });

  it('rejects a role identified as belonging to another guild before persistence', async () => {
    const interaction = new ModerationRoleInteraction('add', {
      id: roleId,
      guildId: '999999999999999999',
    });
    const add = vi.fn();

    await expect(
      setupDefinition().execute(
        interaction,
        context({
          moderationRoleService: { add } as unknown as NonNullable<
            CommandContext['moderationRoleService']
          >,
        }),
      ),
    ).rejects.toBeInstanceOf(ModerationRoleGuildMismatchError);
    expect(add).not.toHaveBeenCalled();
  });
});
