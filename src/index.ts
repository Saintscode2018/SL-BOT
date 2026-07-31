import { loadEnvironment } from './config/env.js';
import { prisma, shutdownDatabase } from './database/client.js';

const environment = loadEnvironment();
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.info(`received ${signal.toLowerCase()} and closing the database connection`);
  await shutdownDatabase();
}

async function main(): Promise<void> {
  await prisma.$connect();
  console.info(`sl bot data foundation started in ${environment.NODE_ENV} mode`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal).then(() => process.exit(0));
    });
  }
}

main().catch(async (error: unknown) => {
  console.error('sl bot failed to start', error);
  await shutdownDatabase();
  process.exitCode = 1;
});
