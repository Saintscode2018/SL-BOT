import { describe, expect, it, vi } from 'vitest';

import { ConsoleLogger } from '../../src/logging/logger.js';

describe('console logger', () => {
  it('filters messages below the configured level', () => {
    const sink = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const logger = new ConsoleLogger('warn', sink);
    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message', { component: 'test' });
    expect(sink.debug).not.toHaveBeenCalled();
    expect(sink.info).not.toHaveBeenCalled();
    expect(sink.warn).toHaveBeenCalledWith({
      level: 'warn',
      message: 'warn message',
      component: 'test',
    });
  });

  it('preserves the original error object', () => {
    const sink = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const logger = new ConsoleLogger('error', sink);
    const error = new Error('failure');
    logger.error('operation failed', error, { component: 'test' });
    expect(sink.error).toHaveBeenCalledWith({
      level: 'error',
      message: 'operation failed',
      component: 'test',
      error,
    });
  });

  it('prevents context from overriding normal log fields', () => {
    const sink = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const logger = new ConsoleLogger('info', sink);

    logger.info('trusted message', {
      level: 'debug',
      message: 'untrusted message',
    });

    expect(sink.info).toHaveBeenCalledWith({
      level: 'info',
      message: 'trusted message',
    });
  });

  it('prevents context from overriding error log fields', () => {
    const sink = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const logger = new ConsoleLogger('info', sink);
    const error = new Error('trusted error');

    logger.error('trusted message', error, {
      level: 'debug',
      message: 'untrusted message',
      error: new Error('untrusted error'),
    });

    expect(sink.error).toHaveBeenCalledWith({
      level: 'error',
      message: 'trusted message',
      error,
    });
  });
});
