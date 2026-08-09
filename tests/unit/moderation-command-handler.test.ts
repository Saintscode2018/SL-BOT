import { ApplicationCommandOptionType, MessageFlags } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModerationAuthorizationError } from '../../src/domain/errors.js';
import { commandDefinitions } from '../../src/bot/commands.js';
import { ModerationCommandHandler } from '../../src/bot/moderation-command-handler.js';
import type { ValidateChannelPolicyInput } from '../../src/services/command-channel-policy-service.js';
import type {
  MuteExecutionInput,
  UnmuteExecutionInput,
} from '../../src/services/moderation-mute-service.js';
import type {
  CommandInteraction,
  CommandInteractionOptions,
  DeferredInteractionResponse,
  EditedInteractionResponse,
  SafeInteractionResponse,
} from '../../src/bot/types.js';

const guildId = '992000000000000001';
const actorId = '992000000000000002';
const targetId = '992000000000000003';
const staffChannelId = '992000000000000004';
const occurredAt = new Date('2026-08-09T16:30:00.000Z');

class ModerationInteraction implements CommandInteraction {
  public replied = false;
  public deferred = false;
  public readonly guildId = guildId;
  public readonly guildName = 'Mute Command League';
  public readonly guildIconUrl = 'https://cdn.example.test/guild.png';
  public readonly guildOwnerId = '992000000000000099';
  public readonly userId = actorId;
  public readonly userDisplayName = 'Actual Moderator';
  public readonly channelId = staffChannelId;
  public readonly memberRoleIds = ['992000000000000010'];
  public readonly hasAdministratorPermission = false;
  public readonly edits: EditedInteractionResponse[] = [];
  public readonly deferrals: Array<DeferredInteractionResponse | undefined> = [];
  public readonly options: CommandInteractionOptions;

  public constructor(
    public readonly commandName: 'mute' | 'unmute',
    input: { duration?: string | null; reason?: string | null; bail?: number | null } = {},
  ) {
    this.options = {
      getSubcommand: () => null,
      getSubcommandGroup: () => null,
      getString: (name) =>
        name === 'duration'
          ? (input.duration ?? null)
          : name === 'reason'
            ? (input.reason ?? null)
            : null,
      getInteger: (name) => (name === 'bail' ? (input.bail ?? null) : null),
      getUser: (name) =>
        name === 'user' ? { id: targetId, bot: false, displayName: 'Fetched Target' } : null,
      getRole: () => null,
      getChannel: () => null,
    };
  }

  public getGuildMemberDisplayName(userId: string): string | null {
    return userId === targetId ? 'Cached Target' : null;
  }

  public reply(response: SafeInteractionResponse): Promise<void> {
    void response;
    this.replied = true;
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

  public followUp(response: SafeInteractionResponse): Promise<void> {
    void response;
    return Promise.resolve();
  }

  public deleteReply(): Promise<void> {
    return Promise.resolve();
  }
}

function executionResult(caseFilesDelivered = true, auditDelivered = true) {
  return {
    moderationCase: { id: 'case-1', caseNumber: 1 },
    caseFilesDelivered,
    auditDelivered,
  } as never;
}

describe('mute and unmute command handlers', () => {
  const policy = {
    validateChannelPolicy: vi.fn((input: ValidateChannelPolicyInput) => {
      void input;
      return Promise.resolve();
    }),
  };
  const moderation = {
    mute: vi.fn((input: MuteExecutionInput) => {
      void input;
      return Promise.resolve(executionResult());
    }),
    unmute: vi.fn((input: UnmuteExecutionInput) => {
      void input;
      return Promise.resolve(executionResult());
    }),
  };
  let handler: ModerationCommandHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    policy.validateChannelPolicy.mockResolvedValue(undefined);
    moderation.mute.mockResolvedValue(executionResult());
    moderation.unmute.mockResolvedValue(executionResult());
    handler = new ModerationCommandHandler(policy, moderation, () => occurredAt);
  });

  it('registers the required slash command shapes and no Stage 4 moderation commands', () => {
    const mute = commandDefinitions.find(({ data }) => data.name === 'mute')!.data.toJSON();
    const unmute = commandDefinitions.find(({ data }) => data.name === 'unmute')!.data.toJSON();
    const setup = commandDefinitions.find(({ data }) => data.name === 'setup')!.data.toJSON();
    expect(mute.options?.map(({ name, type, required }) => ({ name, type, required }))).toEqual([
      { name: 'user', type: ApplicationCommandOptionType.User, required: true },
      { name: 'duration', type: ApplicationCommandOptionType.String, required: true },
      { name: 'bail', type: ApplicationCommandOptionType.Integer, required: true },
      { name: 'reason', type: ApplicationCommandOptionType.String, required: false },
    ]);
    expect(mute.options?.find(({ name }) => name === 'bail')?.description).toBe(
      'Bail amount for this punishment',
    );
    expect(unmute.options?.map(({ name }) => name)).toEqual(['user', 'reason']);
    const setupChannels = setup.options?.find(({ name }) => name === 'channels');
    expect(
      setupChannels && 'options' in setupChannels
        ? setupChannels.options?.map(({ name }) => name)
        : [],
    ).toEqual(['bot_commands', 'staff', 'transfer', 'audit', 'case_files']);
    expect(commandDefinitions.map(({ data }) => data.name)).not.toEqual(
      expect.arrayContaining(['ban', 'unban', 'blacklist', 'unblacklist', 'info']),
    );
  });

  it('normalizes /mute options, enforces Staff Commands policy, and replies privately', async () => {
    const interaction = new ModerationInteraction('mute', {
      duration: '2h30m',
      reason: null,
      bail: 125,
    });
    await handler.mute(interaction);
    expect(policy.validateChannelPolicy.mock.calls[0]?.[0]).toMatchObject({
      commandName: 'mute',
      channelId: staffChannelId,
    });
    const muteInput = moderation.mute.mock.calls[0]?.[0];
    expect(muteInput).toMatchObject({
      targetDiscordUserId: targetId,
      durationSeconds: 9_000,
      reason: null,
      bail: 125,
      issuedAt: occurredAt,
    });
    expect(muteInput?.authorization.discordUserId).toBe(actorId);
    expect(interaction.deferrals).toEqual([{ flags: MessageFlags.Ephemeral }]);
    const embed = interaction.edits[0]?.embeds?.[0]?.toJSON();
    expect(embed?.title).toContain('Mute Applied');
    expect(embed?.description).toContain('2 hours 30 minutes');
  });

  it('passes only the new resolution reason and actual actor through /unmute', async () => {
    const interaction = new ModerationInteraction('unmute', { reason: 'Appeal approved' });
    await handler.unmute(interaction);
    expect(policy.validateChannelPolicy.mock.calls[0]?.[0]).toMatchObject({
      commandName: 'unmute',
      channelId: staffChannelId,
    });
    const unmuteInput = moderation.unmute.mock.calls[0]?.[0];
    expect(unmuteInput).toMatchObject({
      targetDiscordUserId: targetId,
      reason: 'Appeal approved',
      resolvedAt: occurredAt,
    });
    expect(unmuteInput?.authorization.discordUserId).toBe(actorId);
  });

  it.each(['nonsense', '0s', '28d1s'])(
    'rejects invalid duration %s before moderation execution',
    async (duration) => {
      await expect(
        handler.mute(new ModerationInteraction('mute', { duration, bail: 0 })),
      ).rejects.toBeDefined();
      expect(moderation.mute).not.toHaveBeenCalled();
    },
  );

  it('does not execute moderation when the channel/authorization policy rejects', async () => {
    policy.validateChannelPolicy.mockRejectedValue(new ModerationAuthorizationError());
    await expect(
      handler.mute(new ModerationInteraction('mute', { duration: '10m', bail: 0 })),
    ).rejects.toBeInstanceOf(ModerationAuthorizationError);
    expect(moderation.mute).not.toHaveBeenCalled();
  });

  it.each([
    [false, true, 'Case Files message'],
    [true, false, 'Audit message'],
    [false, false, 'Case Files and Audit messages'],
  ])(
    'reports delivery status without undoing moderation (%s, %s)',
    async (caseFilesDelivered, auditDelivered, warningText) => {
      moderation.mute.mockResolvedValue(executionResult(caseFilesDelivered, auditDelivered));
      const interaction = new ModerationInteraction('mute', { duration: '10m', bail: 0 });
      await handler.mute(interaction);
      expect(interaction.edits[0]?.embeds?.[0]?.toJSON().description).toContain(warningText);
      expect(moderation.mute).toHaveBeenCalledOnce();
    },
  );
});
