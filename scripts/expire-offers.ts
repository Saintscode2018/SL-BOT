import { pathToFileURL } from 'node:url';

import { config as loadDotenv } from 'dotenv';

import { parseEnvironment } from '../src/config/env.js';
import { createDatabaseClient } from '../src/database/client.js';
import { ConsoleLogger } from '../src/logging/logger.js';
import { OfferExpirationService } from '../src/services/offer-expiration-service.js';

export async function runOfferExpiration(values: NodeJS.ProcessEnv): Promise<number> {
  const environment = parseEnvironment(values);
  const logger = new ConsoleLogger(environment.LOG_LEVEL);
  const database = createDatabaseClient(environment.DATABASE_URL);
  try {
    await database.$connect();
    const expired = await new OfferExpirationService(database).expire();
    logger.info('expired pending offers processed', {
      count: expired.length,
      messageReferences: expired
        .filter(({ discordChannelId, discordMessageId }) =>
          Boolean(discordChannelId && discordMessageId),
        )
        .map(({ discordChannelId, discordMessageId }) => ({
          channelId: discordChannelId,
          messageId: discordMessageId,
        })),
    });
    return expired.length;
  } finally {
    await database.$disconnect();
  }
}

async function main(): Promise<void> {
  loadDotenv();
  await runOfferExpiration(process.env);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  void main().catch((error: unknown) => {
    console.error({ level: 'error', message: 'offer expiration failed', error });
    process.exitCode = 1;
  });
}
