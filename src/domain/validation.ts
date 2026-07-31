import { z } from 'zod';

export const discordSnowflakeSchema = z.string().regex(/^\d+$/, 'must contain decimal digits only');

export const robloxUserIdSchema = z.string().regex(/^\d+$/, 'must contain decimal digits only');
