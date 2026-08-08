import type { Club, Guild, GuildSettings } from '@prisma/client';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import {
  ConfirmationAlreadyHandledError,
  ConfirmationOwnershipError,
} from '../../src/domain/errors.js';
import { commandDefinitions } from '../../src/bot/commands.js';
import { TeamSwapCommandHandler } from '../../src/bot/team-swap-command-handler.js';
import type {
  ButtonInteractionAdapter,
  CommandInteraction,
  EditedInteractionResponse,
  GuildRoleMetadata,
} from '../../src/bot/types.js';
import { ConfirmationRegistry } from '../../src/services/confirmation-registry.js';
import type { TeamSwapService } from '../../src/services/team-swap-service.js';
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
const team1: Club = {
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
const team2: Club = {
  id: 'team-2',
  guildId: guild.id,
  discordRoleId: '400000000000000002',
  logoUrl: null,
  emoji: '🐯',
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
    getSubcommand: () => 'swap',
    getString: (name: string) => {
      if (name === 'team1') return team1.id;
      if (name === 'team2') return team2.id;
      return null;
    },
    getInteger: () => null,
    getUser: () => null,
    getRole: () => null,
    getChannel: () => null,
  };

  public async resolveGuildRoleMetadata(): Promise<GuildRoleMetadata | null> {
    return Promise.resolve(null);
  }

  public getGuildRoleMetadata(roleId: string) {
    if (roleId === team1.discordRoleId) return { id: roleId, name: 'T1', color: 0x123456 };
    if (roleId === team2.discordRoleId) return { id: roleId, name: 'T2', color: 0x654321 };
    return null;
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
    if (roleId === team1.discordRoleId) return { id: roleId, name: 'T1', color: 0x123456 };
    if (roleId === team2.discordRoleId) return { id: roleId, name: 'T2', color: 0x654321 };
    return null;
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
  const getEligibility = vi.fn(() =>
    Promise.resolve({
      guild,
      settings,
      team1,
      team2,
      team1Memberships: [
        { id: 'cm-1', membershipType: 'TEAM_MANAGER' },
        { id: 'cm-2', membershipType: 'PLAYER' },
      ],
      team2Memberships: [{ id: 'cm-3', membershipType: 'PLAYER' }],
      team1EffectiveLimit: 17,
      team2EffectiveLimit: 17,
      team1ActivePlayerCount: 1,
      team2ActivePlayerCount: 1,
    }),
  );
  const swap = vi.fn(() =>
    Promise.resolve({
      guild,
      team1,
      team2,
      team1MovedCount: 2,
      team2MovedCount: 1,
      announcementDelivered: null as boolean | null,
      auditAnnouncementDelivered: null as boolean | null,
    }),
  );
  const service = { getEligibility, swap } as unknown as TeamSwapService;
  const confirmations = new ConfirmationRegistry(new MemoryLogger(), 120_000);
  const handler = new TeamSwapCommandHandler(
    { validateChannelPolicy },
    service,
    confirmations,
    () => now,
  );
  return { handler, confirmations, validateChannelPolicy, getEligibility, swap };
}

describe('/team swap command and confirmation UI', () => {
  it('registers required team1 and team2 autocomplete options under /team', () => {
    const json = commandDefinitions.find(({ data }) => data.name === 'team')!.data.toJSON() as {
      options?: Array<{
        name: string;
        options?: Array<{ name: string; required?: boolean; autocomplete?: boolean }>;
      }>;
    };
    const subcommands = json.options ?? [];
    const swap = subcommands.find(({ name }) => name === 'swap');
    expect(swap).toBeDefined();
    expect(swap?.options).toEqual([
      expect.objectContaining({ name: 'team1', required: true, autocomplete: true }),
      expect.objectContaining({ name: 'team2', required: true, autocomplete: true }),
    ]);
  });

  it('shows an ephemeral confirmation card with confirm/cancel buttons and team counts', async () => {
    const { handler, validateChannelPolicy } = fixture();
    const interaction = new CommandFixture();

    await handler.begin(interaction);

    expect(interaction.deferred).toBe(true);
    expect(validateChannelPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: 'team', subcommand: 'swap' }),
    );
    const embed = interaction.edits[0]?.embeds?.[0]?.data;
    expect(embed?.title).toContain('Confirm Team Population Swap');
    expect(embed?.description).toContain('<@&400000000000000001>');
    expect(embed?.description).toContain('<@&400000000000000002>');
    expect(customIds(interaction).confirm).toContain('team-swap-confirm:');
    expect(customIds(interaction).cancel).toContain(':cancel');
  });

  it('denies non-initiator user and cancellation performs no mutation', async () => {
    const { handler, swap } = fixture();
    const interaction = new CommandFixture();
    await handler.begin(interaction);
    const ids = customIds(interaction);

    await expect(
      handler.handleButton(new ButtonFixture(ids.confirm, '500000000000000099')),
    ).rejects.toBeInstanceOf(ConfirmationOwnershipError);

    const cancel = new ButtonFixture(ids.cancel);
    await expect(handler.handleButton(cancel)).resolves.toBe(true);
    expect(swap).not.toHaveBeenCalled();
    expect(cancel.edits[0]?.components).toEqual([]);
    expect(cancel.edits[0]?.embeds?.[0]?.data.title).toContain('Cancelled');
  });

  it('expires without mutation and marks confirmation handled', async () => {
    const { handler, confirmations, swap } = fixture();
    const interaction = new CommandFixture();
    await handler.begin(interaction);
    const confirmId = customIds(interaction).confirm;
    const confirmationId = confirmId.split(':')[1]!;

    expect(confirmations.expire(confirmationId, new Date(now.getTime() + 120_001))).toBe(true);
    await expect(handler.handleButton(new ButtonFixture(confirmId))).rejects.toBeInstanceOf(
      ConfirmationAlreadyHandledError,
    );
    expect(swap).not.toHaveBeenCalled();
  });

  it('revalidates policy, executes swap once, and presents counts', async () => {
    const { handler, validateChannelPolicy, swap } = fixture();
    const interaction = new CommandFixture();
    await handler.begin(interaction);
    const confirm = new ButtonFixture(customIds(interaction).confirm);

    await expect(handler.handleButton(confirm)).resolves.toBe(true);
    expect(validateChannelPolicy).toHaveBeenCalledTimes(2);
    expect(swap).toHaveBeenCalledOnce();
    expect(swap).toHaveBeenCalledWith(
      expect.objectContaining({ team1Id: team1.id, team2Id: team2.id }),
    );
    expect(confirm.edits[0]?.components).toEqual([]);
    expect(confirm.edits[0]?.embeds?.[0]?.data.title).toContain('Teams Swapped');
    expect(confirm.edits[0]?.embeds?.[0]?.data.description).toContain(
      'Members moved to 🦁 <@&400000000000000001>: **1**',
    );
    expect(confirm.edits[0]?.embeds?.[0]?.data.description).toContain(
      'Members moved to 🐯 <@&400000000000000002>: **2**',
    );

    await expect(handler.handleButton(new ButtonFixture(confirm.customId))).rejects.toBeInstanceOf(
      ConfirmationAlreadyHandledError,
    );
    expect(swap).toHaveBeenCalledOnce();
  });

  it.each([
    [true, true, false, false],
    [false, true, true, false],
    [true, false, false, true],
    [false, false, true, true],
    [null, null, false, false],
  ])(
    'presents delivery warning in response when auditDelivered=%s and transferDelivered=%s',
    async (auditDelivered, transferDelivered, expectAuditWarn, expectTransferWarn) => {
      const { handler, swap } = fixture();
      vi.mocked(swap).mockResolvedValueOnce({
        guild,
        team1,
        team2,
        team1MovedCount: 2,
        team2MovedCount: 1,
        auditAnnouncementDelivered: auditDelivered,
        announcementDelivered: transferDelivered,
      });

      const interaction = new CommandFixture();
      await handler.begin(interaction);
      const confirm = new ButtonFixture(customIds(interaction).confirm);

      await handler.handleButton(confirm);
      const description = confirm.edits[0]?.embeds?.[0]?.data.description ?? '';

      if (expectAuditWarn && expectTransferWarn) {
        expect(description).toContain(
          'The team swap completed, but the Audit and Transfer Market announcements could not be delivered.',
        );
      } else if (expectAuditWarn) {
        expect(description).toContain(
          'The team swap completed, but the Audit announcement could not be delivered.',
        );
      } else if (expectTransferWarn) {
        expect(description).toContain(
          'The team swap completed, but the Transfer Market announcement could not be delivered.',
        );
      } else {
        expect(description).not.toContain('could not be delivered');
      }
    },
  );
});
