import type { Client } from 'discord.js';

import type {
  SetupAuditMessage,
  SetupAuditMessageAdapter,
} from '../services/setup-audit-service.js';
import { createActorField, createSuccessEmbed } from './embeds.js';

export class DiscordSetupAuditMessageAdapter implements SetupAuditMessageAdapter {
  public constructor(private readonly client: Client) {}

  public async send(message: SetupAuditMessage): Promise<void> {
    const channel = await this.client.channels.fetch(message.channelId);
    if (channel === null || !channel.isSendable()) {
      throw new Error('configured audit channel is not sendable');
    }

    const embed = createSuccessEmbed({
      title: message.title,
      description: message.description,
      fields: [
        ...message.fields.map((field) => ({ ...field, inline: field.inline ?? false })),
        createActorField('Configured', message.actorDiscordUserId),
      ],
      timestamp: message.timestamp,
    });
    await channel.send({ embeds: [embed] });
  }
}
