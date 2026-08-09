import type { Client, GuildMember, User } from 'discord.js';

import type {
  SetupAuditMessage,
  SetupAuditMessageAdapter,
} from '../services/setup-audit-service.js';
import { createActorField, createSuccessEmbed } from './embeds.js';

function memberDisplayName(member: GuildMember | null): string | null {
  return member?.displayName?.trim() || member?.user?.globalName || member?.user?.username || null;
}

function userDisplayName(user: User | null): string | null {
  return user?.globalName || user?.username || null;
}

export class DiscordSetupAuditMessageAdapter implements SetupAuditMessageAdapter {
  public constructor(private readonly client: Client) {}

  public async send(message: SetupAuditMessage): Promise<void> {
    const channel = await this.client.channels.fetch(message.channelId);
    if (channel === null || !channel.isSendable()) {
      throw new Error('configured audit channel is not sendable');
    }

    const guild = 'guild' in channel && channel.guild ? channel.guild : null;
    const cachedMember: GuildMember | null =
      guild && 'members' in guild && guild.members?.cache
        ? (guild.members.cache.get(message.actorDiscordUserId) ?? null)
        : null;
    const member: GuildMember | null =
      cachedMember ??
      (guild !== null && typeof guild.members?.fetch === 'function'
        ? await guild.members.fetch(message.actorDiscordUserId).catch(() => null)
        : null);
    const memberName = memberDisplayName(member);
    const user: User | null =
      memberName !== null
        ? null
        : (this.client.users?.cache?.get(message.actorDiscordUserId) ??
          (typeof this.client.users?.fetch === 'function'
            ? await this.client.users.fetch(message.actorDiscordUserId).catch(() => null)
            : null));
    const actorDisplayName = memberName || userDisplayName(user) || 'Unknown User';

    const actorVerb = message.actorVerb ?? 'Configured';

    const embed = createSuccessEmbed({
      title: message.title,
      description: message.description,
      author: message.author ?? null,
      fields: [
        ...message.fields.map((field) => ({ ...field, inline: field.inline ?? false })),
        createActorField(actorVerb, message.actorDiscordUserId, actorDisplayName),
      ],
      timestamp: message.timestamp,
    });
    await channel.send({ embeds: [embed] });
  }
}
