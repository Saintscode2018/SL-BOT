import { describe, expect, it } from 'vitest';

import {
  demandRateLimitMs,
  GuildUserRateLimiter,
} from '../../src/services/guild-user-rate-limiter.js';

describe('guild user rate limiter', () => {
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
});
