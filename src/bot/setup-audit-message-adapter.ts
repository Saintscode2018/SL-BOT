import type { Client, GuildMember, User } from 'discord.js';

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

    const guild = 'guild' in channel && channel.guild ? channel.guild : null;
    const member: GuildMember | null =
      guild && 'members' in guild && guild.members?.cache
        ? (guild.members.cache.get(message.actorDiscordUserId) ?? null)
        : null;
    const user: User | null = this.client.users?.cache?.get(message.actorDiscordUserId) ?? null;
    const actorDisplayName =
      member?.displayName?.trim() ||
      member?.user?.globalName ||
      member?.user?.username ||
      user?.globalName ||
      user?.username ||
      'Unknown User';

    const actorVerb = message.actorVerb ?? 'Configured';

    const embed = createSuccessEmbed({
      title: message.title,
      description: message.description,
      fields: [
        ...message.fields.map((field) => ({ ...field, inline: field.inline ?? false })),
        createActorField(actorVerb, message.actorDiscordUserId, actorDisplayName),
      ],
      timestamp: message.timestamp,
    });
    await channel.send({ embeds: [embed] });
  }
}
