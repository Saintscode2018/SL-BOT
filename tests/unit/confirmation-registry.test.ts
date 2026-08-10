import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('consumes cancel atomically, queues the response update, and rejects double handling', async () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const onCancel = vi.fn(() => Promise.resolve());
    const confirmation = registry.create(context, { now, onCancel });
    expect(
      registry.cancel(confirmation.cancelCustomId, context.initiatorDiscordUserId, now),
    ).toEqual(context);
    expect(onCancel).not.toHaveBeenCalled();
    await Promise.resolve();
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

  it('atomically consumes the staff-only decision and enforces the bound guild', () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const confirmation = registry.create(
      { ...context, action: 'DEMAND', commandName: 'demand', targetStaffRole: 'ATM' },
      { now },
    );
    expect(() =>
      registry.consumeDecision(
        confirmation.staffOnlyCustomId,
        context.initiatorDiscordUserId,
        now,
        'different-guild',
      ),
    ).toThrow(StaleConfirmationError);
    expect(
      registry.consumeDecision(
        confirmation.staffOnlyCustomId,
        context.initiatorDiscordUserId,
        now,
        context.discordGuildId,
      ),
    ).toEqual({
      context: {
        ...context,
        action: 'DEMAND',
        commandName: 'demand',
        targetStaffRole: 'ATM',
      },
      decision: 'staff-only',
    });
    expect(() =>
      registry.consume(confirmation.confirmCustomId, context.initiatorDiscordUserId, now),
    ).toThrow(ConfirmationAlreadyHandledError);
    registry.clear();
  });
});

describe('confirmation registry terminal cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function recordCount(registry: ConfirmationRegistry): number {
    return (registry as unknown as { records: Map<string, unknown> }).records.size;
  }

  it('keeps a consumed tombstone briefly, then removes it', () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const confirmation = registry.create(context, { now });

    expect(registry.consume(confirmation.confirmCustomId, context.initiatorDiscordUserId, now)).toEqual(
      context,
    );
    expect(recordCount(registry)).toBe(1);
    expect(() =>
      registry.consume(confirmation.confirmCustomId, context.initiatorDiscordUserId, now),
    ).toThrow(ConfirmationAlreadyHandledError);

    vi.advanceTimersByTime(confirmationLifetimeMs);

    expect(recordCount(registry)).toBe(0);
    expect(() =>
      registry.consume(confirmation.confirmCustomId, context.initiatorDiscordUserId, now),
    ).toThrow(StaleConfirmationError);
  });

  it('keeps a cancelled tombstone briefly, then removes it', async () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const onCancel = vi.fn(() => Promise.resolve());
    const confirmation = registry.create(context, { now, onCancel });

    expect(registry.cancel(confirmation.cancelCustomId, context.initiatorDiscordUserId, now)).toEqual(
      context,
    );
    await Promise.resolve();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(recordCount(registry)).toBe(1);
    expect(() =>
      registry.cancel(confirmation.cancelCustomId, context.initiatorDiscordUserId, now),
    ).toThrow(ConfirmationAlreadyHandledError);

    vi.advanceTimersByTime(confirmationLifetimeMs);

    expect(recordCount(registry)).toBe(0);
    expect(() =>
      registry.cancel(confirmation.cancelCustomId, context.initiatorDiscordUserId, now),
    ).toThrow(StaleConfirmationError);
  });

  it('keeps an expired tombstone briefly, then removes it', () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const confirmation = registry.create(context, { now });

    vi.advanceTimersByTime(confirmationLifetimeMs);

    expect(() =>
      registry.consume(confirmation.confirmCustomId, context.initiatorDiscordUserId, now),
    ).toThrow(ConfirmationAlreadyHandledError);
    expect(recordCount(registry)).toBe(1);

    vi.advanceTimersByTime(confirmationLifetimeMs);

    expect(recordCount(registry)).toBe(0);
    expect(() =>
      registry.consume(confirmation.confirmCustomId, context.initiatorDiscordUserId, now),
    ).toThrow(StaleConfirmationError);
  });

  it('keeps active confirmations available until terminalization or expiry', () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const confirmation = registry.create(context, { now });

    expect(
      registry.expire(confirmation.id, new Date(now.getTime() + confirmationLifetimeMs - 1)),
    ).toBe(false);
    expect(recordCount(registry)).toBe(1);
    expect(registry.consume(confirmation.confirmCustomId, context.initiatorDiscordUserId, now)).toEqual(
      context,
    );
  });

  it('cleans up terminal records in bulk instead of retaining them forever', () => {
    const registry = new ConfirmationRegistry(new MemoryLogger());
    const confirmations = Array.from({ length: 100 }, () => registry.create(context, { now }));

    for (const confirmation of confirmations) {
      registry.consume(confirmation.confirmCustomId, context.initiatorDiscordUserId, now);
    }
    expect(recordCount(registry)).toBe(confirmations.length);

    vi.advanceTimersByTime(confirmationLifetimeMs);

    expect(recordCount(registry)).toBe(0);
  });
});
