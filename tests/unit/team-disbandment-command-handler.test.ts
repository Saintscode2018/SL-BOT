import type { Club, Guild, GuildSettings } from '@prisma/client';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import {
  ConfirmationAlreadyHandledError,
  ConfirmationOwnershipError,
} from '../../src/domain/errors.js';
import { commandDefinitions } from '../../src/bot/commands.js';
import { TeamDisbandmentCommandHandler } from '../../src/bot/team-disbandment-command-handler.js';
import type {
  ButtonInteractionAdapter,
  CommandInteraction,
  EditedInteractionResponse,
  GuildRoleMetadata,
} from '../../src/bot/types.js';
import { ConfirmationRegistry } from '../../src/services/confirmation-registry.js';
import type { TeamDisbandmentService } from '../../src/services/team-disbandment-service.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const now = new Date('2026-08-06T12:00:00Z');
const guild: Guild = {
  id: 'guild-1',
  discordGuildId: '100000000000000001',
  name: 'Super League',
  createdAt: now,
  updatedAt: now,
};
const settings: GuildSettings = {
  id: 'settings-1',
  guildId: guild.id,
  botCommandsChannelId: '200000000000000002',
  staffChannelId: '200000000000000001',
  transferChannelId: null,
  auditChannelId: null,
  botPermissionsRoleId: '300000000000000001',
  teamManagerRoleId: '300000000000000002',
  assistantManagerRoleId: '300000000000000003',
  playerManagerRoleId: '300000000000000004',
  defaultSquadLimit: 17,
  offerTimeoutSeconds: 3600,
  createdAt: now,
  updatedAt: now,
};
const team: Club = {
  id: 'team-1',
  guildId: guild.id,
  discordRoleId: '400000000000000001',
  logoUrl: null,
  emoji: '🦁',
  squadLimitOverride: null,
  active: true,
  createdAt: now,
  updatedAt: now,
};

class CommandFixture implements CommandInteraction {
  public readonly commandName = 'team';
  public replied = false;
  public deferred = false;
  public readonly guildId = guild.discordGuildId;
  public readonly guildName = guild.name;
  public readonly guildIconUrl = 'https://example.com/guild.png';
  public readonly guildOwnerId = '500000000000000001';
  public readonly userId = this.guildOwnerId;
  public readonly userDisplayName = 'League Owner';
  public readonly channelId = settings.staffChannelId ?? undefined;
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = false;
  public readonly edits: EditedInteractionResponse[] = [];
  public readonly options = {
    getSubcommand: () => 'disband',
    getString: (name: string) => (name === 'team' ? team.id : null),
    getInteger: () => null,
    getUser: () => null,
    getRole: () => null,
    getChannel: () => null,
  };

  public async resolveGuildRoleMetadata(): Promise<GuildRoleMetadata | null> {
    return Promise.resolve(null);
  }

  public getGuildRoleMetadata(roleId: string) {
    return roleId === team.discordRoleId ? { id: roleId, name: 'T1', color: 0x123456 } : null;
  }
  public reply(): Promise<void> {
    this.replied = true;
    return Promise.resolve();
  }
  public deferReply(response?: { flags?: MessageFlags.Ephemeral }): Promise<void> {
    expect(response?.flags).toBe(MessageFlags.Ephemeral);
    this.deferred = true;
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

class ButtonFixture implements ButtonInteractionAdapter {
  public replied = false;
  public deferred = false;
  public readonly guildId = guild.discordGuildId;
  public readonly guildName = guild.name;
  public readonly guildOwnerId = '500000000000000001';
  public readonly channelId = settings.staffChannelId ?? undefined;
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = false;
  public readonly userDisplayName = 'League Owner';
  public readonly edits: EditedInteractionResponse[] = [];

  public constructor(
    public readonly customId: string,
    public readonly userId = '500000000000000001',
  ) {}

  public async resolveGuildRoleMetadata(): Promise<GuildRoleMetadata | null> {
    return Promise.resolve(null);
  }

  public getGuildRoleMetadata(roleId: string) {
    return roleId === team.discordRoleId ? { id: roleId, name: 'T1', color: 0x123456 } : null;
  }
  public deferUpdate(): Promise<void> {
    this.deferred = true;
    return Promise.resolve();
  }
  public reply(): Promise<void> {
    this.replied = true;
    return Promise.resolve();
  }
  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.edits.push(response);
    return Promise.resolve();
  }
  public followUp(): Promise<void> {
    return Promise.resolve();
  }
}

function customIds(interaction: CommandFixture): { confirm: string; cancel: string } {
  const components = interaction.edits[0]?.components?.[0]?.toJSON().components ?? [];
  const ids = components.map((component) => ('custom_id' in component ? component.custom_id : ''));
  return { confirm: ids[0] ?? '', cancel: ids[1] ?? '' };
}

function fixture() {
  const validateChannelPolicy = vi.fn(() => Promise.resolve());
  const getEligibility = vi.fn(() => Promise.resolve({ guild, settings, team }));
  const disband = vi.fn(() =>
    Promise.resolve({
      guild,
      team: { ...team, active: false },
      endedMembershipCount: 4,
      affectedUserCount: 2,
      expiredOfferCount: 3,
      affectedUsers: [],
    }),
  );
  const service = { getEligibility, disband } as unknown as TeamDisbandmentService;
  const confirmations = new ConfirmationRegistry(new MemoryLogger(), 120_000);
  const handler = new TeamDisbandmentCommandHandler(
    { validateChannelPolicy },
    service,
    confirmations,
    () => now,
  );
  return { handler, confirmations, validateChannelPolicy, getEligibility, disband };
}

describe('/team disband command and confirmation', () => {
  it('registers required team autocomplete only and removes public /team remove', () => {
    const json = commandDefinitions.find(({ data }) => data.name === 'team')!.data.toJSON() as {
      options?: Array<{
        name: string;
        options?: Array<{ name: string; required?: boolean; autocomplete?: boolean }>;
      }>;
    };
    const subcommands = json.options ?? [];
    const disband = subcommands.find(({ name }) => name === 'disband');
    expect(disband).toBeDefined();
    expect(subcommands.map(({ name }) => name)).not.toContain('remove');
    expect(disband?.options).toEqual([
      expect.objectContaining({ name: 'team', required: true, autocomplete: true }),
    ]);
    expect(disband?.options?.map(({ name }) => name)).not.toContain('reason');
  });

  it('shows an ephemeral warning with confirm/cancel buttons and preservation details', async () => {
    const { handler, validateChannelPolicy } = fixture();
    const interaction = new CommandFixture();

    await handler.begin(interaction);

    expect(interaction.deferred).toBe(true);
    expect(validateChannelPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: 'team', subcommand: 'disband' }),
    );
    const embed = interaction.edits[0]?.embeds?.[0]?.data;
    expect(embed?.title).toContain('Confirm Team Disbandment');
    expect(embed?.description).toContain('<@&400000000000000001>');
    expect(embed?.description).toContain('team emoji will not be deleted');
    expect(customIds(interaction).confirm).toContain('team-disband-confirm:');
    expect(customIds(interaction).cancel).toContain(':cancel');
  });

  it('denies another user and cancellation makes no mutation while disabling buttons', async () => {
    const { handler, disband } = fixture();
    const interaction = new CommandFixture();
    await handler.begin(interaction);
    const ids = customIds(interaction);

    await expect(
      handler.handleButton(new ButtonFixture(ids.confirm, '500000000000000099')),
    ).rejects.toBeInstanceOf(ConfirmationOwnershipError);
    const cancel = new ButtonFixture(ids.cancel);
    await expect(handler.handleButton(cancel)).resolves.toBe(true);
    expect(disband).not.toHaveBeenCalled();
    expect(cancel.edits[0]?.components).toEqual([]);
    expect(cancel.edits[0]?.embeds?.[0]?.data.title).toContain('Cancelled');
  });

  it('expires without mutation and leaves the confirmation inert', async () => {
    const { handler, confirmations, disband } = fixture();
    const interaction = new CommandFixture();
    await handler.begin(interaction);
    const confirmId = customIds(interaction).confirm;
    const confirmationId = confirmId.split(':')[1]!;

    expect(confirmations.expire(confirmationId, new Date(now.getTime() + 120_001))).toBe(true);
    await expect(handler.handleButton(new ButtonFixture(confirmId))).rejects.toBeInstanceOf(
      ConfirmationAlreadyHandledError,
    );
    expect(disband).not.toHaveBeenCalled();
  });

  it('revalidates policy, disbands once, presents counts, and rejects duplicate confirmation', async () => {
    const { handler, validateChannelPolicy, disband } = fixture();
    const interaction = new CommandFixture();
    await handler.begin(interaction);
    const confirm = new ButtonFixture(customIds(interaction).confirm);

    await expect(handler.handleButton(confirm)).resolves.toBe(true);
    expect(validateChannelPolicy).toHaveBeenCalledTimes(2);
    expect(disband).toHaveBeenCalledOnce();
    expect(disband).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: team.id, teamName: 'T1' }),
    );
    expect(confirm.edits[0]?.components).toEqual([]);
    expect(confirm.edits[0]?.embeds?.[0]?.data.title).toContain('Team Disbanded');
    expect(confirm.edits[0]?.embeds?.[0]?.data.description).toContain(
      'Staff and player memberships ended: **4**',
    );
    await expect(handler.handleButton(new ButtonFixture(confirm.customId))).rejects.toBeInstanceOf(
      ConfirmationAlreadyHandledError,
    );
    expect(disband).toHaveBeenCalledOnce();
  });

  it('resolves team presentation correctly with a cold role cache during disbandment', async () => {
    const { handler, disband } = fixture();
    const interaction = new CommandFixture();
    vi.spyOn(interaction, 'getGuildRoleMetadata').mockReturnValue(null);
    vi.spyOn(interaction, 'resolveGuildRoleMetadata').mockResolvedValue({
      id: team.discordRoleId,
      name: 'Cold Disband Team',
      color: 0x990000,
    });

    await handler.begin(interaction);

    const embed = interaction.edits[0]?.embeds?.[0]?.data;
    expect(embed?.title).toContain('Confirm Team Disbandment');
    expect(embed?.color).toBe(0x990000);

    const confirmFixture = new ButtonFixture(customIds(interaction).confirm);
    vi.spyOn(confirmFixture, 'getGuildRoleMetadata').mockReturnValue(null);
    vi.spyOn(confirmFixture, 'resolveGuildRoleMetadata').mockResolvedValue({
      id: team.discordRoleId,
      name: 'Cold Disband Team',
      color: 0x990000,
    });

    await handler.handleButton(confirmFixture);
    expect(disband).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: team.id, teamName: 'Cold Disband Team' }),
    );
    expect(confirmFixture.edits[0]?.embeds?.[0]?.data.color).toBe(0x990000);
  });
});
