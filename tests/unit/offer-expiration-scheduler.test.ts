import { describe, expect, it, vi } from 'vitest';

import {
  OfferExpirationScheduler,
  offerExpirationSweepIntervalMs,
  type OfferExpirationRunner,
} from '../../src/services/offer-expiration-scheduler.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

type Timer = ReturnType<typeof setTimeout>;

interface ScheduledTimer {
  callback: () => void;
  delayMs: number;
  timer: Timer;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function schedulerHarness(
  runner: OfferExpirationRunner,
  now: Date = new Date('2026-08-10T12:00:00.000Z'),
) {
  const logger = new MemoryLogger();
  const scheduled: ScheduledTimer[] = [];
  const schedule = vi.fn((callback: () => void, delayMs: number) => {
    const timer = { unref: vi.fn() } as unknown as Timer;
    scheduled.push({ callback, delayMs, timer });
    return timer;
  });
  const cancel = vi.fn();
  const scheduler = new OfferExpirationScheduler(runner, logger, {
    now: () => now,
    schedule,
    cancel,
  });
  return { cancel, logger, schedule, scheduled, scheduler };
}

describe('offer expiration scheduler', () => {
  it('runs an initial sweep immediately, with one captured sweep time, then schedules one minute later', async () => {
    const sweepTime = new Date('2026-08-10T12:00:00.000Z');
    const expire = vi.fn<OfferExpirationRunner['expire']>().mockResolvedValue([]);
    const harness = schedulerHarness({ expire }, sweepTime);

    harness.scheduler.start();
    await settle();

    expect(expire).toHaveBeenCalledWith(sweepTime);
    expect(harness.scheduled).toHaveLength(1);
    expect(harness.scheduled[0]).toMatchObject({ delayMs: offerExpirationSweepIntervalMs });
    expect(
      (harness.scheduled[0]?.timer as unknown as { unref: ReturnType<typeof vi.fn> }).unref,
    ).toHaveBeenCalledOnce();
  });

  it('performs later sweeps serially and does not start another while the first is unresolved', async () => {
    const firstSweep = deferred<unknown>();
    const expire = vi.fn<OfferExpirationRunner['expire']>().mockReturnValue(firstSweep.promise);
    const harness = schedulerHarness({ expire });

    harness.scheduler.start();
    harness.scheduler.start();
    await settle();

    expect(expire).toHaveBeenCalledOnce();
    expect(harness.scheduled).toHaveLength(0);

    firstSweep.resolve([]);
    await settle();
    expect(harness.scheduled).toHaveLength(1);

    harness.scheduled[0]?.callback();
    await settle();
    expect(expire).toHaveBeenCalledTimes(2);
  });

  it('logs a failed sweep and continues with the next scheduled sweep', async () => {
    const failure = new Error('database temporarily unavailable');
    const expire = vi
      .fn<OfferExpirationRunner['expire']>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce([]);
    const harness = schedulerHarness({ expire });

    harness.scheduler.start();
    await settle();
    expect(harness.logger.entries).toContainEqual({
      level: 'error',
      message: 'offer expiration sweep failed',
      error: failure,
    });
    expect(harness.scheduled).toHaveLength(1);

    harness.scheduled[0]?.callback();
    await settle();

    expect(expire).toHaveBeenCalledTimes(2);
    expect(harness.scheduled).toHaveLength(2);
  });

  it('clears its timer on shutdown and cannot schedule or run again', async () => {
    const expire = vi.fn<OfferExpirationRunner['expire']>().mockResolvedValue([]);
    const harness = schedulerHarness({ expire });

    harness.scheduler.start();
    await settle();
    const scheduled = harness.scheduled[0]!;
    harness.scheduler.stop();
    scheduled.callback();
    await settle();

    expect(harness.cancel).toHaveBeenCalledWith(scheduled.timer);
    expect(expire).toHaveBeenCalledOnce();
    expect(harness.scheduled).toHaveLength(1);
  });
});
