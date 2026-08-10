import type { Logger } from '../logging/logger.js';

export const offerExpirationSweepIntervalMs = 60_000;

export interface OfferExpirationRunner {
  expire(now: Date): Promise<unknown>;
}

type ExpirationTimer = ReturnType<typeof setTimeout>;

export interface OfferExpirationSchedulerOptions {
  intervalMs?: number;
  now?: () => Date;
  schedule?: (callback: () => void, delayMs: number) => ExpirationTimer;
  cancel?: (timer: ExpirationTimer) => void;
}

/** Runs the canonical offer expiry workflow without allowing concurrent sweeps. */
export class OfferExpirationScheduler {
  private timer: ExpirationTimer | null = null;
  private started = false;
  private stopped = false;

  public constructor(
    private readonly expirationService: OfferExpirationRunner,
    private readonly logger: Logger,
    private readonly options: OfferExpirationSchedulerOptions = {},
  ) {}

  public start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    void this.runThenSchedule();
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer === null) return;
    (this.options.cancel ?? clearTimeout)(this.timer);
    this.timer = null;
  }

  private async runThenSchedule(): Promise<void> {
    if (this.stopped) return;
    const now = (this.options.now ?? (() => new Date()))();
    try {
      await this.expirationService.expire(now);
    } catch (error: unknown) {
      this.logger.error('offer expiration sweep failed', error);
    }
    if (!this.stopped) this.scheduleNext();
  }

  private scheduleNext(): void {
    const schedule = this.options.schedule ?? setTimeout;
    this.timer = schedule(() => {
      this.timer = null;
      void this.runThenSchedule();
    }, this.options.intervalMs ?? offerExpirationSweepIntervalMs);
    this.timer.unref();
  }
}
