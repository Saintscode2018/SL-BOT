import { pathToFileURL } from 'node:url';

import { config as loadDotenv } from 'dotenv';

import { loadCommands } from '../src/bot/command-loader.js';
import { commandDefinitions } from '../src/bot/commands.js';
import {
  deployGuildCommands,
  DiscordGuildCommandDeploymentAdapter,
} from '../src/bot/deploy-commands.js';
import { parseCommandDeploymentEnvironment } from '../src/config/env.js';
import { ConsoleLogger } from '../src/logging/logger.js';

export async function runGuildCommandDeployment(values: NodeJS.ProcessEnv): Promise<void> {
  const environment = parseCommandDeploymentEnvironment(values);
  const logger = new ConsoleLogger(environment.LOG_LEVEL);
  const registry = loadCommands(commandDefinitions);
  await deployGuildCommands({
    applicationId: environment.DISCORD_APPLICATION_ID,
    guildId: environment.DISCORD_DEVELOPMENT_GUILD_ID,
    commands: registry.toJSON(),
    adapter: new DiscordGuildCommandDeploymentAdapter(environment.DISCORD_TOKEN),
    logger,
  });
}

async function main(): Promise<void> {
  loadDotenv();
  await runGuildCommandDeployment(process.env);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  void main().catch((error: unknown) => {
    console.error({ level: 'error', message: 'guild command deployment failed', error });
    process.exitCode = 1;
  });
}
