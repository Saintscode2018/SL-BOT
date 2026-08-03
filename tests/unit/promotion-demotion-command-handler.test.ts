import type { Club, ClubMembership, LeagueUser } from '@prisma/client';
import { ApplicationCommandOptionType, MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { commandDefinitions } from '../../src/bot/commands.js';
import { RosterPromotionDemotionCommandHandler } from '../../src/bot/promotion-demotion-command-handler.js';
import type { ButtonInteractionAdapter, CommandInteraction } from '../../src/bot/types.js';
import {
  ConfirmationOwnershipError,
  StaleConfirmationError,
  WrongCommandChannelError,
} from '../../src/domain/errors.js';
import { ConfirmationRegistry } from '../../src/services/confirmation-registry.js';
import type {
  DemotionEligibility,
  PromotionEligibility,
  RosterPromotionDemotionService,
} from '../../src/services/roster-promotion-demotion-service.js';
import type { RosterMutationResult } from '../../src/services/roster-mutation-service.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const guildId = '100000000000000001';
const callerId = '200000000000000001';
const targetId = '200000000000000002';
const baseDate = new Date('2026-08-02T12:00:00.000Z');

function club(): Club {
  return {
    id: 'club-1',
    guildId: 'database-guild-1',
    discordRoleId: '400000000000000001',
    logoUrl: null,
    emoji: '⚽',
    squadLimitOverride: null,
    active: true,
    createdAt: baseDate,
    updatedAt: baseDate,
  };
}

function user(discordUserId: string): LeagueUser {
  return {
    id: `database-${discordUserId}`,
    discordUserId,
    robloxUserId: null,
    robloxUsername: null,
    createdAt: baseDate,
    updatedAt: baseDate,
  };
}

function membership(type = 'PLAYER'): ClubMembership {
  return {
    id: `membership-${type}`,
    guildId: 'database-guild-1',
    clubId: 'club-1',
    userId: 'database-user',
    membershipType: type,
    status: 'ACTIVE',
    joinedAt: baseDate,
    leftAt: null,
    createdByUserId: null,
    endedByUserId: null,
    createdAt: baseDate,
    updatedAt: baseDate,
  };
}

function promotionEligibility(): PromotionEligibility {
  return {
    club: club(),
    caller: user(callerId),
    callerStaffType: 'TEAM_MANAGER',
    callerStaffRole: 'TM',
    target: user(targetId),
    targetPlayerMembership: membership(),
    targetStaffType: null,
    targetStaffRole: null,
    destinationStaffType: 'PLAYER_MANAGER',
    destinationStaffRole: 'PM',
  };
}

function demotionEligibility(): DemotionEligibility {
  return {
    club: club(),
    caller: user(callerId),
    callerStaffType: 'TEAM_MANAGER',
    callerStaffRole: 'TM',
    target: user(targetId),
    targetPlayerMembership: membership(),
    targetStaffType: 'ASSISTANT_MANAGER',
    targetStaffRole: 'ATM',
  };
}

function mockMutationResult(kind: 'PROMOTED' | 'DEMOTED' = 'PROMOTED'): RosterMutationResult {
  return {
    guild: {
      id: 'database-guild-1',
      discordGuildId: guildId,
      name: 'Test Server',
      createdAt: baseDate,
      updatedAt: baseDate,
    },
    club: club(),
    user: user(targetId),
    playerMembership: membership(),
    staffMembership: kind === 'PROMOTED' ? membership('PLAYER_MANAGER') : null,
    previousStaffType: kind === 'DEMOTED' ? 'ASSISTANT_MANAGER' : null,
    transaction: {
      id: 'tx-1',
      guildId: 'database-guild-1',
      userId: 'database-target',
      transactionType: kind === 'PROMOTED' ? 'STAFF_PROMOTION' : 'STAFF_DEMOTION',
      sourceClubId: null,
      destinationClubId: 'club-1',
      performedByUserId: 'database-caller',
      offerId: null,
      reason: null,
      reversedAt: null,
      reversedByUserId: null,
      createdAt: baseDate,
    },
    roleMutation: {
      discordGuildId: guildId,
      discordUserId: targetId,
      addRoles: kind === 'PROMOTED' ? [{ id: 'pm-role-1', purpose: 'PM' }] : [],
      removeRoles: kind === 'DEMOTED' ? [{ id: 'atm-role-1', purpose: 'ATM' }] : [],
    },
    announcement: {
      discordGuildId: guildId,
      channelId: 'transfer-channel-1',
      type: kind,
      discordUserId: targetId,
      teamIdentity: club(),
      occurredAt: baseDate,
      actorDiscordUserId: callerId,
      ...(kind === 'PROMOTED' ? { staffRole: 'PM' as const, staffRoleId: 'pm-role-1' } : {}),
      roster: {
        currentSize: 5,
        maximumSize: 17,
        teamManagerDiscordUserId: callerId,
      },
    },
  };
}

describe('Stage 4B.3 /promote and /demote command registration and handler', () => {
  it('registers /promote and /demote commands with correct options and choices', () => {
    const promoteDef = commandDefinitions.find((c) => c.data.name === 'promote');
    expect(promoteDef).toBeDefined();
    const promoteJson = promoteDef!.data.toJSON();
    expect(promoteJson.description).toBe('Promote a team member to a staff position');
    const playerOption = promoteJson.options?.find((o) => o.name === 'player');
    expect(playerOption?.required).toBe(true);
    expect(playerOption?.type).toBe(ApplicationCommandOptionType.User);
    const rankOption = promoteJson.options?.find((o) => o.name === 'rank') as
      | {
          required?: boolean;
          choices?: Array<{ name: string; value: string }>;
        }
      | undefined;
    expect(rankOption?.required).toBe(true);
    expect(rankOption?.choices).toHaveLength(2);
    expect(rankOption?.choices).toEqual([
      { name: 'Assistant Team Manager', value: 'ATM' },
      { name: 'Player Manager', value: 'PM' },
    ]);

    const demoteDef = commandDefinitions.find((c) => c.data.name === 'demote');
    expect(demoteDef).toBeDefined();
    const demoteJson = demoteDef!.data.toJSON();
    expect(demoteJson.description).toBe('Demote a team staff member to player');
    const staffOption = demoteJson.options?.find((o) => o.name === 'staff');
    expect(staffOption?.required).toBe(true);
    expect(staffOption?.type).toBe(ApplicationCommandOptionType.User);
    expect(demoteJson.options?.find((o) => o.name === 'rank')).toBeUndefined();
  });

  it('isolates component custom ID namespaces between handlers', () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const channelPolicy = { validateChannelPolicy: vi.fn() };
    const service = {} as unknown as RosterPromotionDemotionService;
    const handler = new RosterPromotionDemotionCommandHandler(channelPolicy, service, registry);

    expect(handler.canHandle('promotion-demotion-confirm:1234:confirm')).toBe(true);
    expect(handler.canHandle('promotion-demotion-confirm:1234:cancel')).toBe(true);
    expect(handler.canHandle('roster-confirm:1234:confirm')).toBe(false);
    expect(handler.canHandle('offer:accept:1234')).toBe(false);
  });

  it('initiates /promote confirmation and builds 2-minute ephemeral runner prompt', async () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const validateChannelPolicySpy = vi.fn().mockResolvedValue(undefined);
    const channelPolicy = { validateChannelPolicy: validateChannelPolicySpy };
    const getPromotionEligibilitySpy = vi.fn().mockResolvedValue(promotionEligibility());
    const service = {
      getPromotionEligibility: getPromotionEligibilitySpy,
    } as unknown as RosterPromotionDemotionService;

    const handler = new RosterPromotionDemotionCommandHandler(
      channelPolicy,
      service,
      registry,
      () => baseDate,
    );

    const deferReplySpy = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction: CommandInteraction = {
      commandName: 'promote',
      replied: false,
      deferred: false,
      guildId,
      guildName: 'Test Server',
      guildOwnerId: callerId,
      userId: callerId,
      channelId: 'bot-cmds',
      options: {
        getSubcommand: () => null,
        getString: (name: string) => (name === 'rank' ? 'PM' : null),
        getInteger: () => null,
        getUser: (name: string) =>
          name === 'player' ? { id: targetId, bot: false, displayName: 'TargetPlayer' } : null,
        getRole: () => null,
        getChannel: () => null,
      },
      deferReply: deferReplySpy,
      editReply,
      reply: vi.fn(),
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    };

    await handler.beginPromote(interaction);

    expect(deferReplySpy).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(validateChannelPolicySpy).toHaveBeenCalled();
    expect(getPromotionEligibilitySpy).toHaveBeenCalledWith(
      guildId,
      callerId,
      targetId,
      'PLAYER_MANAGER',
    );
    expect(editReply).toHaveBeenCalled();
    const payload = (
      editReply.mock.calls[0] as unknown as [
        {
          components?: Array<{
            components?: Array<{ data: { custom_id: string; label: string } }>;
          }>;
        },
      ]
    )[0];
    const buttonData = payload.components?.[0]?.components?.[0]?.data;
    expect(buttonData?.custom_id).toMatch(/^promotion-demotion-confirm:/);
    expect(buttonData?.label).toBe('Promote');
  });

  it('initiates /demote confirmation and builds 2-minute ephemeral runner prompt', async () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const validateChannelPolicySpy = vi.fn().mockResolvedValue(undefined);
    const channelPolicy = { validateChannelPolicy: validateChannelPolicySpy };
    const getDemotionEligibilitySpy = vi.fn().mockResolvedValue(demotionEligibility());
    const service = {
      getDemotionEligibility: getDemotionEligibilitySpy,
    } as unknown as RosterPromotionDemotionService;

    const handler = new RosterPromotionDemotionCommandHandler(
      channelPolicy,
      service,
      registry,
      () => baseDate,
    );

    const deferReplySpy = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction: CommandInteraction = {
      commandName: 'demote',
      replied: false,
      deferred: false,
      guildId,
      guildName: 'Test Server',
      guildOwnerId: callerId,
      userId: callerId,
      channelId: 'bot-cmds',
      options: {
        getSubcommand: () => null,
        getString: () => null,
        getInteger: () => null,
        getUser: (name: string) =>
          name === 'staff' ? { id: targetId, bot: false, displayName: 'TargetStaff' } : null,
        getRole: () => null,
        getChannel: () => null,
      },
      deferReply: deferReplySpy,
      editReply,
      reply: vi.fn(),
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    };

    await handler.beginDemote(interaction);

    expect(deferReplySpy).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(validateChannelPolicySpy).toHaveBeenCalled();
    expect(getDemotionEligibilitySpy).toHaveBeenCalledWith(guildId, callerId, targetId);
    expect(editReply).toHaveBeenCalled();
    const payload = (
      editReply.mock.calls[0] as unknown as [
        {
          components?: Array<{
            components?: Array<{ data: { custom_id: string; label: string } }>;
          }>;
        },
      ]
    )[0];
    const buttonData = payload.components?.[0]?.components?.[0]?.data;
    expect(buttonData?.custom_id).toMatch(/^promotion-demotion-confirm:/);
    expect(buttonData?.label).toBe('Demote');
  });

  it('executes promotion button interaction cleanly and replies ephemerally', async () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const channelPolicy = { validateChannelPolicy: vi.fn() };
    const promoteSpy = vi.fn().mockResolvedValue(mockMutationResult('PROMOTED'));
    const service = {
      getPromotionEligibility: vi.fn().mockResolvedValue(promotionEligibility()),
      promote: promoteSpy,
    } as unknown as RosterPromotionDemotionService;

    const handler = new RosterPromotionDemotionCommandHandler(
      channelPolicy,
      service,
      registry,
      () => baseDate,
    );

    const registration = registry.create(
      {
        action: 'PROMOTE',
        commandName: 'promote',
        discordGuildId: guildId,
        initiatorDiscordUserId: callerId,
        initiatorStaffRole: 'TM',
        teamId: 'club-1',
        targetDiscordUserId: targetId,
        destinationStaffRole: 'PM',
      },
      { prefix: 'promotion-demotion-confirm', now: baseDate },
    );

    const editReply = vi.fn().mockResolvedValue(undefined);
    const buttonAdapter: ButtonInteractionAdapter = {
      customId: registration.confirmCustomId,
      userId: callerId,
      guildId,
      replied: false,
      deferred: false,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      editReply,
      followUp: vi.fn(),
    };

    const handled = await handler.handleButton(buttonAdapter);
    expect(handled).toBe(true);
    expect(promoteSpy).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalled();
    const embed = (
      editReply.mock.calls[0] as unknown as [{ embeds?: Array<{ data: { title: string } }> }]
    )[0].embeds?.[0];
    expect(embed?.data.title).toContain('Staff Member Promoted');
  });

  it('executes demotion button interaction cleanly and replies ephemerally', async () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const channelPolicy = { validateChannelPolicy: vi.fn() };
    const demoteSpy = vi.fn().mockResolvedValue(mockMutationResult('DEMOTED'));
    const service = {
      getDemotionEligibility: vi.fn().mockResolvedValue(demotionEligibility()),
      demote: demoteSpy,
    } as unknown as RosterPromotionDemotionService;

    const handler = new RosterPromotionDemotionCommandHandler(
      channelPolicy,
      service,
      registry,
      () => baseDate,
    );

    const registration = registry.create(
      {
        action: 'DEMOTE',
        commandName: 'demote',
        discordGuildId: guildId,
        initiatorDiscordUserId: callerId,
        initiatorStaffRole: 'TM',
        teamId: 'club-1',
        targetDiscordUserId: targetId,
        targetStaffRole: 'ATM',
      },
      { prefix: 'promotion-demotion-confirm', now: baseDate },
    );

    const editReply = vi.fn().mockResolvedValue(undefined);
    const buttonAdapter: ButtonInteractionAdapter = {
      customId: registration.confirmCustomId,
      userId: callerId,
      guildId,
      replied: false,
      deferred: false,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      editReply,
      followUp: vi.fn(),
    };

    const handled = await handler.handleButton(buttonAdapter);
    expect(handled).toBe(true);
    expect(demoteSpy).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalled();
    const embed = (
      editReply.mock.calls[0] as unknown as [{ embeds?: Array<{ data: { title: string } }> }]
    )[0].embeds?.[0];
    expect(embed?.data.title).toContain('Staff Member Demoted');
  });

  it('handles button cancellation cleanly and removes registry entry', async () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const channelPolicy = { validateChannelPolicy: vi.fn() };
    const service = {} as unknown as RosterPromotionDemotionService;
    const handler = new RosterPromotionDemotionCommandHandler(
      channelPolicy,
      service,
      registry,
      () => baseDate,
    );

    const registration = registry.create(
      {
        action: 'PROMOTE',
        commandName: 'promote',
        discordGuildId: guildId,
        initiatorDiscordUserId: callerId,
        initiatorStaffRole: 'TM',
        teamId: 'club-1',
        targetDiscordUserId: targetId,
        destinationStaffRole: 'PM',
      },
      { prefix: 'promotion-demotion-confirm', now: baseDate },
    );

    const editReply = vi.fn().mockResolvedValue(undefined);
    const buttonAdapter: ButtonInteractionAdapter = {
      customId: registration.cancelCustomId,
      userId: callerId,
      guildId,
      replied: false,
      deferred: false,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      editReply,
      followUp: vi.fn(),
    };

    const handled = await handler.handleButton(buttonAdapter);
    expect(handled).toBe(true);
    expect(editReply).toHaveBeenCalled();
    // After cancellation the registry entry is finalized; re-attempting cancel must throw.
    await expect(registry.cancel(registration.cancelCustomId, callerId)).rejects.toThrow();
  });

  it('rejects confirmation attempts by non-initiator users', async () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const channelPolicy = { validateChannelPolicy: vi.fn() };
    const service = {} as unknown as RosterPromotionDemotionService;
    const handler = new RosterPromotionDemotionCommandHandler(
      channelPolicy,
      service,
      registry,
      () => baseDate,
    );

    const registration = registry.create(
      {
        action: 'PROMOTE',
        commandName: 'promote',
        discordGuildId: guildId,
        initiatorDiscordUserId: callerId,
        initiatorStaffRole: 'TM',
        teamId: 'club-1',
        targetDiscordUserId: targetId,
        destinationStaffRole: 'PM',
      },
      { prefix: 'promotion-demotion-confirm', now: baseDate },
    );

    const buttonAdapter: ButtonInteractionAdapter = {
      customId: registration.confirmCustomId,
      userId: targetId, // Target trying to confirm manager's action
      guildId,
      replied: false,
      deferred: false,
      deferUpdate: vi.fn(),
      reply: vi.fn(),
      editReply: vi.fn(),
      followUp: vi.fn(),
    };

    await expect(handler.handleButton(buttonAdapter)).rejects.toThrow(ConfirmationOwnershipError);
  });

  it('throws StaleConfirmationError when button interaction token is expired or missing', async () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const channelPolicy = { validateChannelPolicy: vi.fn() };
    const service = {} as unknown as RosterPromotionDemotionService;
    const handler = new RosterPromotionDemotionCommandHandler(
      channelPolicy,
      service,
      registry,
      () => baseDate,
    );

    const buttonAdapter: ButtonInteractionAdapter = {
      customId: 'promotion-demotion-confirm:00000000-0000-4000-8000-000000000000:confirm',
      userId: callerId,
      guildId,
      replied: false,
      deferred: false,
      deferUpdate: vi.fn(),
      reply: vi.fn(),
      editReply: vi.fn(),
      followUp: vi.fn(),
    };

    await expect(handler.handleButton(buttonAdapter)).rejects.toThrow(StaleConfirmationError);
  });

  it('does not defer or register prompt when wrong channel policy rejects execution', async () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const channelPolicy = {
      validateChannelPolicy: vi
        .fn()
        .mockRejectedValue(new WrongCommandChannelError(['111'], 'bot_or_staff')),
    };
    const service = {} as unknown as RosterPromotionDemotionService;
    const handler = new RosterPromotionDemotionCommandHandler(
      channelPolicy,
      service,
      registry,
      () => baseDate,
    );

    const deferReplySpy = vi.fn();
    const interaction: CommandInteraction = {
      commandName: 'promote',
      replied: false,
      deferred: false,
      guildId,
      guildName: 'Test Server',
      guildOwnerId: callerId,
      userId: callerId,
      channelId: 'unrelated-channel',
      options: {
        getSubcommand: () => null,
        getString: (name: string) => (name === 'rank' ? 'PM' : null),
        getInteger: () => null,
        getUser: (name: string) =>
          name === 'player' ? { id: targetId, bot: false, displayName: 'TargetPlayer' } : null,
        getRole: () => null,
        getChannel: () => null,
      },
      deferReply: deferReplySpy,
      editReply: vi.fn(),
      reply: vi.fn(),
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    };

    await expect(handler.beginPromote(interaction)).rejects.toThrow(WrongCommandChannelError);
    expect(deferReplySpy).not.toHaveBeenCalled();
  });
});
