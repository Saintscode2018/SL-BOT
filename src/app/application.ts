import { ApplicationStartupError, InvalidStateTransitionError } from '../domain/errors.js';
import type { Logger } from '../logging/logger.js';

export interface DatabaseLifecycle {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface DiscordLifecycle {
  login(token: string): Promise<string>;
  destroy(): Promise<void> | void;
}

export interface ApplicationOptions {
  discordToken: string;
  database: DatabaseLifecycle;
  discord: DiscordLifecycle;
  register(): void;
  logger: Logger;
}

export class Application {
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private resourcesClosed = false;

  public constructor(private readonly options: ApplicationOptions) {}

  public start(): Promise<void> {
    if (this.stopPromise !== null) {
      return Promise.reject(new InvalidStateTransitionError('application has already stopped'));
    }
    this.startPromise ??= this.performStart();
    return this.startPromise;
  }

  public stop(): Promise<void> {
    this.stopPromise ??= this.performStop();
    return this.stopPromise;
  }

  private async performStart(): Promise<void> {
    try {
      await this.options.database.connect();
      this.options.register();
      await this.options.discord.login(this.options.discordToken);
      this.options.logger.info('application started');
    } catch (error: unknown) {
      try {
        await this.closeResources();
      } catch (cleanupError: unknown) {
        this.options.logger.error('startup cleanup failed', cleanupError);
      }
      throw new ApplicationStartupError('application startup failed', { cause: error });
    }
  }

  private async performStop(): Promise<void> {
    if (this.startPromise !== null) {
      await this.startPromise.catch(() => undefined);
    }
    await this.closeResources();
    this.options.logger.info('application stopped');
  }

  private async closeResources(): Promise<void> {
    if (this.resourcesClosed) return;
    this.resourcesClosed = true;
    const errors: unknown[] = [];
    try {
      await this.options.discord.destroy();
    } catch (error: unknown) {
      errors.push(error);
    }
    try {
      await this.options.database.disconnect();
    } catch (error: unknown) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'application shutdown failed');
    }
  }
}
