import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';

import {
  DEBUG_RESET_CANCEL_CUSTOM_ID_PREFIX,
  DEBUG_RESET_CONFIRM_CUSTOM_ID_PREFIX,
  performGuildDebugReset,
  sendDebugResetPrompt,
} from '../../src/bot/debug-reset-handler.js';
import { OfferButtonHandler } from '../../src/bot/offer-button-handler.js';
import { createOfferCustomId } from '../../src/bot/offer-custom-id.js';
import { AuthorizationError, EntityNotFoundError } from '../../src/domain/errors.js';
import { OfferResponseService } from '../../src/services/offer-response-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const firstDiscordGuildId = '100000000000000001';
const secondDiscordGuildId = '100000000000000002';
const initiatingUserId = '200000000000000001';
const channelId = '300000000000000001';
const messageId = '400000000000000001';

interface SeededGuild {
  guildId: string;
  clubId: string;
  offerId: string;
  playerDiscordUserId: string;
}

async function seedGuild(
  database: PrismaClient,
  discordGuildId: string,
  suffix: string,
): Promise<SeededGuild> {
  const guild = await database.guild.create({
    data: {
      discordGuildId,
      name: `Guild ${suffix}`,
      settings: {
        create: {
          botCommandsChannelId: channelId,
          staffChannelId: channelId,
        },
      },
    },
  });
  const club = await database.club.create({
    data: {
      guildId: guild.id,
      discordRoleId: `50000000000000000${suffix}`,
      emoji: suffix === '1' ? '🔵' : '🔴',
    },
  });
  const actor = await database.leagueUser.create({
    data: { discordUserId: `60000000000000000${suffix}` },
  });
  const player = await database.leagueUser.create({
    data: { discordUserId: `70000000000000000${suffix}` },
  });
  await database.clubMembership.create({
    data: {
      guildId: guild.id,
      clubId: club.id,
      userId: player.id,
      membershipType: 'PLAYER',
      createdByUserId: actor.id,
    },
  });
  const offer = await database.offer.create({
    data: {
      guildId: guild.id,
      clubId: club.id,
      playerUserId: player.id,
      offeredByUserId: actor.id,
      discordChannelId: channelId,
      discordMessageId: messageId,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const transaction = await database.leagueTransaction.create({
    data: {
      guildId: guild.id,
      userId: player.id,
      transactionType: 'SIGNING',
      destinationClubId: club.id,
      performedByUserId: actor.id,
      offerId: offer.id,
    },
  });
  await database.auditEvent.create({
    data: {
      guildId: guild.id,
      actorUserId: actor.id,
      eventType: 'test.event',
      entityType: 'transaction',
      entityId: transaction.id,
    },
  });
  return {
    guildId: guild.id,
    clubId: club.id,
    offerId: offer.id,
    playerDiscordUserId: player.discordUserId,
  };
}

function button(
  customId: string,
  userId: string,
  administrator = true,
): {
  interaction: ButtonInteraction;
  reply: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  const reply = vi.fn();
  const update = vi.fn();
  const interaction = {
    customId,
    user: { id: userId },
    memberPermissions: { has: () => administrator },
    reply,
    update,
  } as unknown as ButtonInteraction;
  return { interaction, reply, update };
}

function resetInteraction(input: {
  candidates: ButtonInteraction[];
  administrator?: boolean;
  accepted?: ButtonInteraction[];
  roleIds?: string[];
}): {
  interaction: ChatInputCommandInteraction;
  reply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
} {
  const accepted = input.accepted ?? [];
  const reply = vi.fn(() =>
    Promise.resolve({
      awaitMessageComponent: ({ filter }: { filter: (item: ButtonInteraction) => boolean }) => {
        for (const candidate of input.candidates) {
          if (filter(candidate)) {
            accepted.push(candidate);
            return Promise.resolve(candidate);
          }
        }
        return Promise.reject(new Error('no matching interaction'));
      },
    }),
  );
  const editReply = vi.fn(() => Promise.resolve());
  const interaction = {
    guildId: firstDiscordGuildId,
    user: { id: initiatingUserId },
    member: { roles: { cache: new Map((input.roleIds ?? []).map((roleId) => [roleId, {}])) } },
    memberPermissions: { has: () => input.administrator ?? true },
    reply,
    editReply,
  } as unknown as ChatInputCommandInteraction;
  return { interaction, reply, editReply };
}

describe('debug reset', () => {
  let context: TestDatabase;

  beforeAll(() => {
    context = createTestDatabase();
  });

  afterAll(async () => {
    await destroyTestDatabase(context);
  });

  beforeEach(async () => {
    await clearDatabase(context.client);
    vi.unstubAllEnvs();
    vi.stubEnv('SLBOT_ENABLE_DEBUG_COMMANDS', 'true');
  });

  it('ignores another users buttons and still accepts the initiating users confirmation', async () => {
    await seedGuild(context.client, firstDiscordGuildId, '1');
    const otherConfirm = button(
      `${DEBUG_RESET_CONFIRM_CUSTOM_ID_PREFIX}${initiatingUserId}`,
      '200000000000000002',
    );
    const otherCancel = button(
      `${DEBUG_RESET_CANCEL_CUSTOM_ID_PREFIX}${initiatingUserId}`,
      '200000000000000002',
    );
    const originalConfirm = button(
      `${DEBUG_RESET_CONFIRM_CUSTOM_ID_PREFIX}${initiatingUserId}`,
      initiatingUserId,
    );
    const accepted: ButtonInteraction[] = [];
    const reset = resetInteraction({
      candidates: [otherConfirm.interaction, otherCancel.interaction, originalConfirm.interaction],
      accepted,
    });

    await sendDebugResetPrompt(reset.interaction, context.client);

    expect(reset.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(accepted).toEqual([originalConfirm.interaction]);
    expect(otherConfirm.reply).not.toHaveBeenCalled();
    expect(otherCancel.reply).not.toHaveBeenCalled();
    expect(originalConfirm.update).toHaveBeenCalledOnce();
    expect(await context.client.guild.count()).toBe(0);
  });

  it('cancels without deleting data', async () => {
    await seedGuild(context.client, firstDiscordGuildId, '1');
    const cancel = button(
      `${DEBUG_RESET_CANCEL_CUSTOM_ID_PREFIX}${initiatingUserId}`,
      initiatingUserId,
    );
    const reset = resetInteraction({ candidates: [cancel.interaction] });

    await sendDebugResetPrompt(reset.interaction, context.client);

    expect(reset.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(await context.client.guild.count()).toBe(1);
    expect(await context.client.offer.count()).toBe(1);
    expect(cancel.update).toHaveBeenCalledOnce();
  });

  it('denies a bot permissions role user without Discord Administrator permission', async () => {
    const botPermissionsRoleId = '800000000000000001';
    const seeded = await seedGuild(context.client, firstDiscordGuildId, '1');
    await context.client.guildSettings.update({
      where: { guildId: seeded.guildId },
      data: { botPermissionsRoleId },
    });
    const reset = resetInteraction({
      candidates: [],
      administrator: false,
      roleIds: [botPermissionsRoleId],
    });

    await expect(sendDebugResetPrompt(reset.interaction, context.client)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(reset.reply).not.toHaveBeenCalled();
  });

  it('deletes only the current guild data and preserves schema and migrations', async () => {
    const first = await seedGuild(context.client, firstDiscordGuildId, '1');
    const second = await seedGuild(context.client, secondDiscordGuildId, '2');
    const migrationsBefore = await context.client.$queryRawUnsafe<Array<{ count: bigint }>>(
      'select count(*) as count from _prisma_migrations',
    );

    await performGuildDebugReset(context.client, firstDiscordGuildId);

    expect(await context.client.guild.findUnique({ where: { id: first.guildId } })).toBeNull();
    expect(await context.client.guildSettings.count({ where: { guildId: first.guildId } })).toBe(0);
    expect(await context.client.club.count({ where: { guildId: first.guildId } })).toBe(0);
    expect(await context.client.clubMembership.count({ where: { guildId: first.guildId } })).toBe(
      0,
    );
    expect(await context.client.offer.count({ where: { guildId: first.guildId } })).toBe(0);
    expect(
      await context.client.leagueTransaction.count({ where: { guildId: first.guildId } }),
    ).toBe(0);
    expect(await context.client.auditEvent.count({ where: { guildId: first.guildId } })).toBe(0);

    expect(await context.client.guild.findUnique({ where: { id: second.guildId } })).not.toBeNull();
    expect(await context.client.guildSettings.count({ where: { guildId: second.guildId } })).toBe(
      1,
    );
    expect(await context.client.club.count({ where: { guildId: second.guildId } })).toBe(1);
    expect(await context.client.clubMembership.count({ where: { guildId: second.guildId } })).toBe(
      1,
    );
    expect(await context.client.offer.count({ where: { guildId: second.guildId } })).toBe(1);
    expect(
      await context.client.leagueTransaction.count({ where: { guildId: second.guildId } }),
    ).toBe(1);
    expect(await context.client.auditEvent.count({ where: { guildId: second.guildId } })).toBe(1);

    const tables = await context.client.$queryRawUnsafe<Array<{ name: string }>>(
      "select name from sqlite_master where type = 'table'",
    );
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['Guild', 'Club', 'Offer', '_prisma_migrations']),
    );
    const migrationsAfter = await context.client.$queryRawUnsafe<Array<{ count: bigint }>>(
      'select count(*) as count from _prisma_migrations',
    );
    expect(migrationsAfter[0]?.count).toBe(migrationsBefore[0]?.count);
    expect(Number(migrationsAfter[0]?.count ?? 0)).toBeGreaterThan(0);
  });

  it('rolls back every deletion when a mid reset deletion fails', async () => {
    const first = await seedGuild(context.client, firstDiscordGuildId, '1');
    await context.client.$executeRawUnsafe(
      "create trigger prevent_club_delete before delete on Club begin select raise(abort, 'blocked'); end",
    );

    try {
      await expect(performGuildDebugReset(context.client, firstDiscordGuildId)).rejects.toThrow();

      expect(await context.client.guild.count({ where: { id: first.guildId } })).toBe(1);
      expect(await context.client.guildSettings.count({ where: { guildId: first.guildId } })).toBe(
        1,
      );
      expect(await context.client.club.count({ where: { guildId: first.guildId } })).toBe(1);
      expect(await context.client.clubMembership.count({ where: { guildId: first.guildId } })).toBe(
        1,
      );
      expect(await context.client.offer.count({ where: { guildId: first.guildId } })).toBe(1);
      expect(
        await context.client.leagueTransaction.count({ where: { guildId: first.guildId } }),
      ).toBe(1);
      expect(await context.client.auditEvent.count({ where: { guildId: first.guildId } })).toBe(1);
    } finally {
      await context.client.$executeRawUnsafe('drop trigger if exists prevent_club_delete');
    }
  });

  it('fails stale offer buttons safely after reset', async () => {
    const seeded = await seedGuild(context.client, firstDiscordGuildId, '1');
    await performGuildDebugReset(context.client, firstDiscordGuildId);
    const messages = {
      setTerminalState: vi.fn(),
      sendOffer: vi.fn(),
      cleanupOrphan: vi.fn(),
    };
    const delivery = { recordMessageUpdateFailure: vi.fn() };
    const handler = new OfferButtonHandler(
      new OfferResponseService(context.client),
      delivery,
      messages,
      new MemoryLogger(),
    );
    const interaction = {
      customId: createOfferCustomId('accept', seeded.offerId),
      userId: seeded.playerDiscordUserId,
      channelId,
      messageId,
      replied: false,
      deferred: false,
      reply: vi.fn(),
      deferReply: vi.fn(),
      editReply: vi.fn(),
      followUp: vi.fn(),
    };

    await expect(handler.handle(interaction)).rejects.toBeInstanceOf(EntityNotFoundError);
    expect(messages.setTerminalState).not.toHaveBeenCalled();
    expect(delivery.recordMessageUpdateFailure).not.toHaveBeenCalled();
    expect(await context.client.offer.count()).toBe(0);
  });

  describe('audit channel publishing', () => {
    const auditChannelId = '900000000000000001';

    it('captures audit context before deletion and publishes audit message only after successful reset', async () => {
      const seeded = await seedGuild(context.client, firstDiscordGuildId, '1');
      await context.client.guildSettings.update({
        where: { guildId: seeded.guildId },
        data: { auditChannelId },
      });

      const setupAuditService = {
        publish: vi.fn(async () => {
          expect(await context.client.guild.count()).toBe(0);
          return true;
        }),
      };

      const confirm = button(
        `${DEBUG_RESET_CONFIRM_CUSTOM_ID_PREFIX}${initiatingUserId}`,
        initiatingUserId,
      );
      const reset = resetInteraction({ candidates: [confirm.interaction] });

      await sendDebugResetPrompt(reset.interaction, context.client, setupAuditService);

      expect(setupAuditService.publish).toHaveBeenCalledOnce();
      expect(setupAuditService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: auditChannelId,
          title: 'Debug Reset Completed',
          description: 'Development/debug data for this server was reset successfully.',
          actorDiscordUserId: initiatingUserId,
          actorVerb: 'Reset',
        }),
      );

      expect(confirm.update).toHaveBeenCalledOnce();
      const updateCall = confirm.update.mock.calls[0] as [
        { embeds: Array<{ data: { title?: string; description?: string } }> },
      ];
      expect(updateCall[0].embeds[0]?.data.title).toContain('Debug Data Reset');
      expect(updateCall[0].embeds[0]?.data.description).not.toContain('could not be delivered');
    });

    it('skips audit channel delivery cleanly when unconfigured', async () => {
      await seedGuild(context.client, firstDiscordGuildId, '1');
      const setupAuditService = {
        publish: vi.fn(() => Promise.resolve(true)),
      };

      const confirm = button(
        `${DEBUG_RESET_CONFIRM_CUSTOM_ID_PREFIX}${initiatingUserId}`,
        initiatingUserId,
      );
      const reset = resetInteraction({ candidates: [confirm.interaction] });

      await sendDebugResetPrompt(reset.interaction, context.client, setupAuditService);

      expect(setupAuditService.publish).not.toHaveBeenCalled();
      expect(await context.client.guild.count()).toBe(0);
      expect(confirm.update).toHaveBeenCalledOnce();
      const updateCall = confirm.update.mock.calls[0] as [
        { embeds: Array<{ data: { description?: string } }> },
      ];
      expect(updateCall[0].embeds[0]?.data.description).not.toContain('could not be delivered');
    });

    it('appends private warning when configured audit channel delivery fails', async () => {
      const seeded = await seedGuild(context.client, firstDiscordGuildId, '1');
      await context.client.guildSettings.update({
        where: { guildId: seeded.guildId },
        data: { auditChannelId },
      });

      const setupAuditService = {
        publish: vi.fn(() => Promise.resolve(false)),
      };

      const confirm = button(
        `${DEBUG_RESET_CONFIRM_CUSTOM_ID_PREFIX}${initiatingUserId}`,
        initiatingUserId,
      );
      const reset = resetInteraction({ candidates: [confirm.interaction] });

      await sendDebugResetPrompt(reset.interaction, context.client, setupAuditService);

      expect(setupAuditService.publish).toHaveBeenCalledOnce();
      expect(await context.client.guild.count()).toBe(0);
      expect(confirm.update).toHaveBeenCalledOnce();
      const updateCall = confirm.update.mock.calls[0] as [
        { embeds: Array<{ data: { description?: string } }> },
      ];
      expect(updateCall[0].embeds[0]?.data.description).toContain(
        'All SL Bot data for this server was removed, but the Audit announcement could not be delivered.',
      );
    });

    it('does not publish audit message if reset transaction fails and does not attempt second reset', async () => {
      const seeded = await seedGuild(context.client, firstDiscordGuildId, '1');
      await context.client.guildSettings.update({
        where: { guildId: seeded.guildId },
        data: { auditChannelId },
      });

      const setupAuditService = {
        publish: vi.fn(() => Promise.resolve(true)),
      };

      await context.client.$executeRawUnsafe(
        "create trigger prevent_club_delete_audit_test before delete on Club begin select raise(abort, 'blocked'); end",
      );

      try {
        const confirm = button(
          `${DEBUG_RESET_CONFIRM_CUSTOM_ID_PREFIX}${initiatingUserId}`,
          initiatingUserId,
        );
        const reset = resetInteraction({ candidates: [confirm.interaction] });

        await expect(
          sendDebugResetPrompt(reset.interaction, context.client, setupAuditService),
        ).rejects.toThrow();

        expect(setupAuditService.publish).not.toHaveBeenCalled();
        expect(await context.client.guild.count()).toBe(1);
      } finally {
        await context.client.$executeRawUnsafe(
          'drop trigger if exists prevent_club_delete_audit_test',
        );
      }
    });

    it('performs no audit publication and no reset on cancel, timeout, or unauthorized interaction', async () => {
      await seedGuild(context.client, firstDiscordGuildId, '1');
      const setupAuditService = {
        publish: vi.fn(() => Promise.resolve(true)),
      };

      // 1. Cancel
      const cancel = button(
        `${DEBUG_RESET_CANCEL_CUSTOM_ID_PREFIX}${initiatingUserId}`,
        initiatingUserId,
      );
      const resetCancel = resetInteraction({ candidates: [cancel.interaction] });
      await sendDebugResetPrompt(resetCancel.interaction, context.client, setupAuditService);
      expect(setupAuditService.publish).not.toHaveBeenCalled();
      expect(await context.client.guild.count()).toBe(1);

      // 2. Timeout/expired
      const resetTimeout = resetInteraction({ candidates: [] });
      await sendDebugResetPrompt(resetTimeout.interaction, context.client, setupAuditService);
      expect(setupAuditService.publish).not.toHaveBeenCalled();
      expect(await context.client.guild.count()).toBe(1);

      // 3. Unauthorized
      const resetUnauth = resetInteraction({ candidates: [], administrator: false });
      await expect(
        sendDebugResetPrompt(resetUnauth.interaction, context.client, setupAuditService),
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect(setupAuditService.publish).not.toHaveBeenCalled();
      expect(await context.client.guild.count()).toBe(1);
    });

    it('proves no post-reset settings query is executed for audit channel delivery', async () => {
      const seeded = await seedGuild(context.client, firstDiscordGuildId, '1');
      await context.client.guildSettings.update({
        where: { guildId: seeded.guildId },
        data: { auditChannelId },
      });

      const setupAuditService = {
        publish: vi.fn(() => Promise.resolve(true)),
      };

      const confirm = button(
        `${DEBUG_RESET_CONFIRM_CUSTOM_ID_PREFIX}${initiatingUserId}`,
        initiatingUserId,
      );
      const reset = resetInteraction({ candidates: [confirm.interaction] });

      await sendDebugResetPrompt(reset.interaction, context.client, setupAuditService);

      // Settings and guild are completely gone from DB
      expect(await context.client.guildSettings.count()).toBe(0);
      // Yet audit message was successfully published using pre-reset captured channelId
      expect(setupAuditService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: auditChannelId }),
      );
    });
  });
});

describe('debug command registration', () => {
  it('is absent when debug commands are disabled or missing', async () => {
    vi.resetModules();
    vi.stubEnv('SLBOT_ENABLE_DEBUG_COMMANDS', 'false');
    const disabled = await import('../../src/bot/commands.js');
    expect(disabled.commandDefinitions.some((command) => command.data.name === 'debugreset')).toBe(
      false,
    );

    vi.resetModules();
    delete process.env['SLBOT_ENABLE_DEBUG_COMMANDS'];
    const missing = await import('../../src/bot/commands.js');
    expect(missing.commandDefinitions.some((command) => command.data.name === 'debugreset')).toBe(
      false,
    );
  });

  it('is present when debug commands are enabled', async () => {
    vi.resetModules();
    vi.stubEnv('SLBOT_ENABLE_DEBUG_COMMANDS', 'true');
    const enabled = await import('../../src/bot/commands.js');
    expect(enabled.commandDefinitions.some((command) => command.data.name === 'debugreset')).toBe(
      true,
    );
  });
});
