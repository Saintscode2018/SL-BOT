import { describe, expect, it, vi } from 'vitest';

import {
  Application,
  type DatabaseLifecycle,
  type DiscordLifecycle,
} from '../../src/app/application.js';
import { ApplicationStartupError } from '../../src/domain/errors.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

interface LifecycleFakes {
  database: DatabaseLifecycle;
  discord: DiscordLifecycle;
  connect: ReturnType<typeof vi.fn<() => Promise<void>>>;
  disconnect: ReturnType<typeof vi.fn<() => Promise<void>>>;
  login: ReturnType<typeof vi.fn<(token: string) => Promise<string>>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
}

function lifecycleFakes(order: string[] = []): LifecycleFakes {
  const connect = vi.fn(() => {
    order.push('connect');
    return Promise.resolve();
  });
  const disconnect = vi.fn(() => {
    order.push('disconnect');
    return Promise.resolve();
  });
  const login = vi.fn((token: string) => {
    order.push('login');
    return Promise.resolve(`session-${token.length}`);
  });
  const destroy = vi.fn(() => {
    order.push('destroy');
  });
  return {
    database: { connect, disconnect },
    discord: { login, destroy },
    connect,
    disconnect,
    login,
    destroy,
  };
}

describe('application lifecycle', () => {
  it('connects prisma then registers definitions then logs in', async () => {
    const order: string[] = [];
    const fakes = lifecycleFakes(order);
    const logger = new MemoryLogger();
    const application = new Application({
      discordToken: 'secret-token',
      database: fakes.database,
      discord: fakes.discord,
      register: () => order.push('register'),
      logger,
    });
    await application.start();
    expect(order).toEqual(['connect', 'register', 'login']);
    expect(fakes.login).toHaveBeenCalledWith('secret-token');
    expect(logger.entries).toContainEqual({ level: 'info', message: 'application started' });
  });

  it('cleans up both resources when discord login fails', async () => {
    const fakes = lifecycleFakes();
    const loginError = new Error('login failed');
    fakes.login.mockRejectedValueOnce(loginError);
    const application = new Application({
      discordToken: 'secret-token',
      database: fakes.database,
      discord: fakes.discord,
      register: vi.fn(),
      logger: new MemoryLogger(),
    });
    const error = await application.start().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApplicationStartupError);
    expect((error as ApplicationStartupError).cause).toBe(loginError);
    expect(fakes.destroy).toHaveBeenCalledOnce();
    expect(fakes.disconnect).toHaveBeenCalledOnce();
  });

  it('destroys discord and disconnects prisma on stop', async () => {
    const fakes = lifecycleFakes();
    const application = new Application({
      discordToken: 'secret-token',
      database: fakes.database,
      discord: fakes.discord,
      register: vi.fn(),
      logger: new MemoryLogger(),
    });
    await application.start();
    await application.stop();
    expect(fakes.destroy).toHaveBeenCalledOnce();
    expect(fakes.disconnect).toHaveBeenCalledOnce();
  });

  it('is idempotent when stop is called concurrently', async () => {
    const fakes = lifecycleFakes();
    const application = new Application({
      discordToken: 'secret-token',
      database: fakes.database,
      discord: fakes.discord,
      register: vi.fn(),
      logger: new MemoryLogger(),
    });
    await Promise.all([application.stop(), application.stop(), application.stop()]);
    expect(fakes.destroy).toHaveBeenCalledOnce();
    expect(fakes.disconnect).toHaveBeenCalledOnce();
  });

  it('waits for an in progress startup before closing resources', async () => {
    const order: string[] = [];
    const fakes = lifecycleFakes(order);
    const application = new Application({
      discordToken: 'secret-token',
      database: fakes.database,
      discord: fakes.discord,
      register: () => order.push('register'),
      logger: new MemoryLogger(),
    });
    const start = application.start();
    const stop = application.stop();
    await Promise.all([start, stop]);
    expect(order).toEqual(['connect', 'register', 'login', 'destroy', 'disconnect']);
  });

  it('cleans up a partial startup when registration fails', async () => {
    const fakes = lifecycleFakes();
    const application = new Application({
      discordToken: 'secret-token',
      database: fakes.database,
      discord: fakes.discord,
      register: () => {
        throw new Error('registration failed');
      },
      logger: new MemoryLogger(),
    });
    await expect(application.start()).rejects.toBeInstanceOf(ApplicationStartupError);
    await expect(application.stop()).resolves.toBeUndefined();
    expect(fakes.login).not.toHaveBeenCalled();
    expect(fakes.destroy).toHaveBeenCalledOnce();
    expect(fakes.disconnect).toHaveBeenCalledOnce();
  });

  it('never writes the discord token to logs', async () => {
    const fakes = lifecycleFakes();
    fakes.login.mockRejectedValueOnce(new Error('login failed'));
    const logger = new MemoryLogger();
    const application = new Application({
      discordToken: 'highly-secret-token',
      database: fakes.database,
      discord: fakes.discord,
      register: vi.fn(),
      logger,
    });
    await application.start().catch(() => undefined);
    expect(JSON.stringify(logger.entries)).not.toContain('highly-secret-token');
  });
});
