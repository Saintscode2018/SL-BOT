import { z } from 'zod';

const maxUnsigned64BitInteger = '18446744073709551615';

/**
 * Discord IDs are unsigned 64-bit snowflakes serialized as decimal strings.
 * Keep the value as a string so IDs above Number.MAX_SAFE_INTEGER retain their
 * exact representation.
 */
export const discordSnowflakeSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/, 'must be a canonical decimal snowflake')
  .refine(
    (value) =>
      value.length < maxUnsigned64BitInteger.length ||
      (value.length === maxUnsigned64BitInteger.length && value <= maxUnsigned64BitInteger),
    'must fit the unsigned 64-bit Discord snowflake range',
  );

export const robloxUserIdSchema = z.string().regex(/^\d+$/, 'must contain decimal digits only');
