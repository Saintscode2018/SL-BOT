import { describe, expect, it, vi } from 'vitest';

import {
  createConfirmationCancelledEmbed,
  createConfirmationExpiredEmbed,
  handleConfirmationCancel,
} from '../../src/bot/confirmation-ui.js';
import type { ButtonInteractionAdapter } from '../../src/bot/types.js';
import type {
  ConfirmationContext,
  ConfirmationRegistry,
} from '../../src/services/confirmation-registry.js';

describe('confirmation-ui helpers', () => {
  describe('createConfirmationCancelledEmbed', () => {
    it('creates default cancellation embed', () => {
      const embed = createConfirmationCancelledEmbed();
      const json = embed.toJSON();

      expect(json.title).toContain('Action Cancelled');
      expect(json.description).toBe('No roster or Discord role changes were made.');
    });

    it('creates custom cancellation embed when title and description are supplied', () => {
      const embed = createConfirmationCancelledEmbed({
        title: '⚠️ Team Disbandment Cancelled',
        description: 'No database or Discord role changes were made.',
      });
      const json = embed.toJSON();

      expect(json.title).toBe('⚠️ Team Disbandment Cancelled');
      expect(json.description).toBe('No database or Discord role changes were made.');
    });
  });

  describe('createConfirmationExpiredEmbed', () => {
    it('creates default expiry embed', () => {
      const embed = createConfirmationExpiredEmbed();
      const json = embed.toJSON();

      expect(json.title).toContain('Confirmation Expired');
      expect(json.description).toBe(
        'This confirmation expired after two minutes. Run the command again to retry.',
      );
    });

    it('creates custom expiry embed when custom description is supplied', () => {
      const embed = createConfirmationExpiredEmbed({
        description:
          'This confirmation expired after two minutes. Run `/team disband` again to retry.',
      });
      const json = embed.toJSON();

      expect(json.title).toContain('Confirmation Expired');
      expect(json.description).toBe(
        'This confirmation expired after two minutes. Run `/team disband` again to retry.',
      );
    });
  });

  describe('handleConfirmationCancel', () => {
    it('returns false if customId does not end with :cancel', async () => {
      const mockInteraction = {
        customId: 'roster-confirm:123:confirm',
      } as ButtonInteractionAdapter;

      const cancelFn = vi.fn();
      const mockContext: ConfirmationContext = {
        action: 'DEMAND',
        commandName: 'demand',
        discordGuildId: 'guild-456',
        initiatorDiscordUserId: 'user-789',
        targetDiscordUserId: 'user-789',
        teamId: 'team-1',
      };
      const mockConfirmations: Pick<ConfirmationRegistry, 'cancel'> = {
        cancel: (customId: string, userId: string, now?: Date, guildId?: string) => {
          cancelFn(customId, userId, now, guildId);
          return Promise.resolve(mockContext);
        },
      };
      const result = await handleConfirmationCancel(mockInteraction, mockConfirmations, new Date());

      expect(result).toBe(false);
      expect(cancelFn).not.toHaveBeenCalled();
    });

    it('cancels confirmation, defers update, edits reply removing components, and returns true', async () => {
      const deferUpdate = vi.fn().mockResolvedValue(undefined);
      const editReply = vi.fn().mockResolvedValue(undefined);
      const mockInteraction = {
        customId: 'roster-confirm:abc-123:cancel',
        userId: 'user-789',
        guildId: 'guild-456',
        deferUpdate,
        editReply,
      } as unknown as ButtonInteractionAdapter;

      const cancelFn = vi.fn();
      const mockContext: ConfirmationContext = {
        action: 'DEMAND',
        commandName: 'demand',
        discordGuildId: 'guild-456',
        initiatorDiscordUserId: 'user-789',
        targetDiscordUserId: 'user-789',
        teamId: 'team-1',
      };
      const mockConfirmations: Pick<ConfirmationRegistry, 'cancel'> = {
        cancel: (customId: string, userId: string, now?: Date, guildId?: string) => {
          cancelFn(customId, userId, now, guildId);
          return Promise.resolve(mockContext);
        },
      };
      const now = new Date('2026-08-07T12:00:00Z');

      const result = await handleConfirmationCancel(mockInteraction, mockConfirmations, now);

      expect(result).toBe(true);
      expect(cancelFn).toHaveBeenCalledWith(
        'roster-confirm:abc-123:cancel',
        'user-789',
        now,
        'guild-456',
      );
      expect(deferUpdate).toHaveBeenCalledTimes(1);
      expect(editReply).toHaveBeenCalledTimes(1);
      const editCall = editReply.mock.calls[0];
      expect(editCall).toBeDefined();
      const editArgs = editCall![0] as {
        embeds?: Array<{ data: { title?: string } }>;
        components?: unknown[];
      };
      expect(editArgs.components).toEqual([]);
      expect(editArgs.embeds?.[0]?.data.title).toContain('Action Cancelled');
    });
  });
});
