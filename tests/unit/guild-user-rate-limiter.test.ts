import { describe, expect, it } from 'vitest';

import {
  demandRateLimitMs,
  GuildUserRateLimiter,
} from '../../src/services/guild-user-rate-limiter.js';

describe('guild user rate limiter', () => {
  function retainedEntryCount(limiter: GuildUserRateLimiter): number {
    return (limiter as unknown as { expiresAt: Map<string, number> }).expiresAt.size;
  }

  it('uses a fixed window that rejected retries do not extend', () => {
    let now = 1_000;
    const limiter = new GuildUserRateLimiter(demandRateLimitMs, () => now);

    expect(limiter.tryAcquire('guild-1', 'user-1')).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });

    now += 30_000;
    expect(limiter.tryAcquire('guild-1', 'user-1')).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });

    now += 29_000;
    expect(limiter.tryAcquire('guild-1', 'user-1')).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });

    now += 1_000;
    expect(limiter.tryAcquire('guild-1', 'user-1')).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('isolates guilds and users and safely clears in-memory state', () => {
    const limiter = new GuildUserRateLimiter(demandRateLimitMs, () => 5_000);
    expect(limiter.tryAcquire('guild-1', 'user-1').allowed).toBe(true);
    expect(limiter.tryAcquire('guild-1', 'user-2').allowed).toBe(true);
    expect(limiter.tryAcquire('guild-2', 'user-1').allowed).toBe(true);
    expect(limiter.tryAcquire('guild-1', 'user-1')).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    limiter.clear();
    expect(limiter.tryAcquire('guild-1', 'user-1').allowed).toBe(true);
  });

  it('removes an expired entry when that key is checked again', () => {
    let now = 1_000;
    const limiter = new GuildUserRateLimiter(60_000, () => now);

    expect(limiter.tryAcquire('guild-1', 'user-1').allowed).toBe(true);
    now += 60_000;

    expect(limiter.tryAcquire('guild-1', 'user-1')).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(retainedEntryCount(limiter)).toBe(1);
  });

  it('opportunistically removes expired entries for keys that are not checked again', () => {
    let now = 1_000;
    const limiter = new GuildUserRateLimiter(60_000, () => now);

    for (let index = 0; index < 100; index += 1) {
      expect(limiter.tryAcquire('guild-1', `user-${index}`).allowed).toBe(true);
    }
    expect(retainedEntryCount(limiter)).toBe(100);

    now += 60_000;
    for (let index = 100; index < 200; index += 1) {
      limiter.tryAcquire('guild-1', `user-${index}`);
    }

    expect(retainedEntryCount(limiter)).toBe(100);
  });

  it('does not let retained storage grow monotonically across expired unique keys', () => {
    let now = 1_000;
    const limiter = new GuildUserRateLimiter(10, () => now);
    const retainedCounts: number[] = [];

    for (let index = 0; index < 100; index += 1) {
      limiter.tryAcquire('guild-1', `user-${index}`);
      now += 10;
      retainedCounts.push(retainedEntryCount(limiter));
    }

    expect(Math.max(...retainedCounts.slice(50))).toBeLessThan(20);
    expect(retainedEntryCount(limiter)).toBeLessThan(20);
  });

  it('cleans one key without affecting another active key', () => {
    let now = 1_000;
    const limiter = new GuildUserRateLimiter(60_000, () => now);

    expect(limiter.tryAcquire('guild-1', 'user-1').allowed).toBe(true);
    now += 30_000;
    expect(limiter.tryAcquire('guild-2', 'user-2').allowed).toBe(true);
    now += 30_000;

    expect(limiter.tryAcquire('guild-1', 'user-1').allowed).toBe(true);
    expect(limiter.tryAcquire('guild-2', 'user-2')).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });
});
