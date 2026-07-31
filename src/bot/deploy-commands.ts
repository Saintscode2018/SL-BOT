import { REST, Routes, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

import type { Logger } from '../logging/logger.js';

export interface GuildCommandDeploymentAdapter {
  deploy(
    applicationId: string,
    guildId: string,
    commands: readonly RESTPostAPIApplicationCommandsJSONBody[],
  ): Promise<void>;
}

export class DiscordGuildCommandDeploymentAdapter implements GuildCommandDeploymentAdapter {
  private readonly rest: REST;

  public constructor(token: string) {
    this.rest = new REST({ version: '10' }).setToken(token);
  }

  public async deploy(
    applicationId: string,
    guildId: string,
    commands: readonly RESTPostAPIApplicationCommandsJSONBody[],
  ): Promise<void> {
    await this.rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
      body: commands,
    });
  }
}

export async function deployGuildCommands(input: {
  applicationId: string;
  guildId: string;
  commands: readonly RESTPostAPIApplicationCommandsJSONBody[];
  adapter: GuildCommandDeploymentAdapter;
  logger: Logger;
}): Promise<void> {
  await input.adapter.deploy(input.applicationId, input.guildId, input.commands);
  input.logger.info('guild commands deployed', {
    applicationId: input.applicationId,
    guildId: input.guildId,
    commandCount: input.commands.length,
    commandNames: input.commands.map(({ name }) => name),
  });
}
