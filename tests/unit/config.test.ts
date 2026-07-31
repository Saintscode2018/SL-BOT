import { describe, expect, it } from 'vitest';

import { parseEnvironment, parseRuntimeEnvironment } from '../../src/config/env.js';
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
});
