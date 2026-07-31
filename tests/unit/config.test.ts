import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadRuntimeEnvironment,
  parseEnvironment,
  parseRuntimeEnvironment,
} from '../../src/config/env.js';
import { ConfigurationError } from '../../src/domain/errors.js';
import { discordSnowflakeSchema } from '../../src/domain/validation.js';

describe('environment configuration', () => {
  it('uses database safe defaults without requiring a discord token', () => {
    expect(parseEnvironment({ NODE_ENV: 'test' })).toEqual({
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./dev.db',
      LOG_LEVEL: 'info',
    });
  });

  it('rejects invalid configuration with a typed error', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'invalid' })).toThrow(ConfigurationError);
  });

  it('validates snowflakes as decimal strings', () => {
    expect(discordSnowflakeSchema.parse('1520900719799042088')).toBe('1520900719799042088');
    expect(() => discordSnowflakeSchema.parse('12.5')).toThrow();
  });

  it('requires a discord token for application startup', () => {
    expect(() => parseRuntimeEnvironment({ NODE_ENV: 'production' })).toThrow(ConfigurationError);
  });

  it('accepts a discord token for application startup without exposing it', () => {
    expect(
      parseRuntimeEnvironment({ NODE_ENV: 'production', DISCORD_TOKEN: 'secret-token' }),
    ).toMatchObject({ NODE_ENV: 'production', DISCORD_TOKEN: 'secret-token' });
  });

  it('loads normal local runtime values from an env file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sl-bot-env-'));
    const path = join(directory, '.env');
    writeFileSync(
      path,
      'NODE_ENV=development\nDATABASE_URL=file:./local.db\nDISCORD_TOKEN=local-token\n',
    );
    try {
      expect(loadRuntimeEnvironment({}, path)).toMatchObject({
        NODE_ENV: 'development',
        DATABASE_URL: 'file:./local.db',
        DISCORD_TOKEN: 'local-token',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves injected values over env file values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sl-bot-env-'));
    const path = join(directory, '.env');
    writeFileSync(path, 'DATABASE_URL=file:./file.db\nDISCORD_TOKEN=file-token\n');
    try {
      expect(
        loadRuntimeEnvironment(
          { DATABASE_URL: 'file:./injected.db', DISCORD_TOKEN: 'injected-token' },
          path,
        ),
      ).toMatchObject({
        DATABASE_URL: 'file:./injected.db',
        DISCORD_TOKEN: 'injected-token',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects missing runtime values loaded from an env file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sl-bot-env-'));
    const path = join(directory, '.env');
    writeFileSync(path, 'NODE_ENV=development\n');
    try {
      expect(() => loadRuntimeEnvironment({}, path)).toThrow(ConfigurationError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not expose an env file token in configuration errors', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sl-bot-env-'));
    const path = join(directory, '.env');
    writeFileSync(path, 'NODE_ENV=invalid\nDISCORD_TOKEN=do-not-log-this-token\n');
    try {
      const error = (() => {
        try {
          loadRuntimeEnvironment({}, path);
          return null;
        } catch (caught: unknown) {
          return caught;
        }
      })();
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).not.toContain('do-not-log-this-token');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
