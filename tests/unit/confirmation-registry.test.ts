import { describe, expect, it, vi } from 'vitest';

import {
  ConfirmationAlreadyHandledError,
  ConfirmationOwnershipError,
  InvalidConfirmationTokenError,
  StaleConfirmationError,
} from '../../src/domain/errors.js';
import {
  ConfirmationRegistry,
  confirmationLifetimeMs,
} from '../../src/services/confirmation-registry.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const now = new Date('2026-08-02T10:00:00.000Z');
const context = {
  action: 'RELEASE' as const,
  commandName: 'release',
  discordGuildId: '100000000000000001',
  initiatorDiscordUserId: '200000000000000001',
  teamId: 'team-one',
  targetDiscordUserId: '200000000000000002',
};

describe('confirmation registry', () => {
  it('binds server-side context and only allows the initiator', () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const confirmation = registry.create(context, { now });
    expect(() => registry.consume(confirmation.confirmCustomId, '200000000000000099', now)).toThrow(
      ConfirmationOwnershipError,
    );
    expect(
      registry.consume(confirmation.confirmCustomId, context.initiatorDiscordUserId, now),
    ).toEqual(context);
    registry.clear();
  });

  it('expires at two minutes and treats restart-invalid state as stale', () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const confirmation = registry.create(context, { now });
    expect(confirmation.expiresAt.getTime() - now.getTime()).toBe(confirmationLifetimeMs);
    expect(() =>
      registry.consume(
        confirmation.confirmCustomId,
        context.initiatorDiscordUserId,
        new Date(now.getTime() + confirmationLifetimeMs),
      ),
    ).toThrow(StaleConfirmationError);
    registry.clear();
    expect(() =>
      registry.consume(confirmation.confirmCustomId, context.initiatorDiscordUserId, now),
    ).toThrow(StaleConfirmationError);
  });

  it('consumes cancel atomically, updates the response, and rejects double handling', async () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const onCancel = vi.fn(() => Promise.resolve());
    const confirmation = registry.create(context, { now, onCancel });
    await expect(
      registry.cancel(confirmation.cancelCustomId, context.initiatorDiscordUserId, now),
    ).resolves.toEqual(context);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(() =>
      registry.consume(confirmation.confirmCustomId, context.initiatorDiscordUserId, now),
    ).toThrow(ConfirmationAlreadyHandledError);
    registry.clear();
  });

  it('rejects tampered custom ids', () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const confirmation = registry.create(context, { now });
    expect(() =>
      registry.consume(
        confirmation.confirmCustomId.replace(':confirm', ':cancel'),
        context.initiatorDiscordUserId,
        now,
      ),
    ).toThrow(InvalidConfirmationTokenError);
    registry.clear();
  });

  it('runs fresh authorization and eligibility at confirmation time', async () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const confirmation = registry.create(context, { now });
    const recheck = vi.fn(() => Promise.reject(new Error('target left before confirmation')));
    await expect(
      registry.consumeAndExecute(
        confirmation.confirmCustomId,
        context.initiatorDiscordUserId,
        recheck,
        now,
      ),
    ).rejects.toThrow('target left before confirmation');
    expect(recheck).toHaveBeenCalledWith(context);
    expect(() =>
      registry.consume(confirmation.confirmCustomId, context.initiatorDiscordUserId, now),
    ).toThrow(ConfirmationAlreadyHandledError);
    registry.clear();
  });
});
