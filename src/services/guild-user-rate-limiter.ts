export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export type MillisecondClock = () => number;

export class GuildUserRateLimiter {
  private readonly expiresAt = new Map<string, number>();

  public constructor(
    private readonly windowMs: number,
    private readonly clock: MillisecondClock = Date.now,
  ) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError('rate-limit window must be a positive number');
    }
  }

  public tryAcquire(discordGuildId: string, discordUserId: string): RateLimitResult {
    const now = this.clock();
    const key = `${discordGuildId}:${discordUserId}`;
    const expiry = this.expiresAt.get(key);
    if (expiry !== undefined && expiry > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((expiry - now) / 1_000)),
      };
    }

    this.expiresAt.set(key, now + this.windowMs);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  public clear(): void {
    this.expiresAt.clear();
  }
}

export const demandRateLimitMs = 60_000;
