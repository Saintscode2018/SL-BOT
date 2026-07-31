import { createApplication } from './app/create-application.js';
import { ConsoleLogger, type Logger } from './logging/logger.js';

async function main(): Promise<void> {
  const bootstrapLogger = new ConsoleLogger('info');
  let logger: Logger = bootstrapLogger;
  try {
    const bundle = createApplication();
    logger = bundle.logger;
    let shutdownPromise: Promise<void> | null = null;
    const stopOnce = (signal?: NodeJS.Signals): Promise<void> => {
      if (shutdownPromise === null) {
        if (signal !== undefined) logger.info('shutdown requested', { signal });
        shutdownPromise = bundle.application.stop().catch((error: unknown) => {
          logger.error('application shutdown failed', error);
          process.exitCode = 1;
          throw error;
        });
      }
      return shutdownPromise;
    };
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        void stopOnce(signal).catch(() => undefined);
      });
    }
    try {
      await bundle.application.start();
    } catch (error: unknown) {
      logger.error('application startup failed', error);
      process.exitCode = 1;
      await stopOnce().catch(() => undefined);
    }
  } catch (error: unknown) {
    logger.error('application construction failed', error);
    process.exitCode = 1;
  }
}

void main();
