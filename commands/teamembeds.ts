import {
    APIEmbedField,
    ColorResolvable,
    EmbedBuilder,
    Guild,
    Role
} from "discord.js";
import {
    getLogChannelId,
    getRosterLimit,
    getTransactionChannelId
} from "./database.js";
import { getRosterPlayers } from "./rosterutils.js";

import type { Database, Team } from "./database.js";

export function getTeamEmoji(role: Role): string {
    const match = role.name.match(/<a?:\w+:\d+>/);
    return match?.[0] ?? "⚽";
}

function getTeamEmojiUrl(role: Role): string | null {
    const match = role.name.match(/<a?:(\w+):(\d+)>/);
    if (!match) return null;

    const extension = role.name.includes("<a:") ? "gif" : "png";
    return `https://cdn.discordapp.com/emojis/${match[2]}.${extension}`;
}

export function getTeamThumbnail(role: Role, guild: Guild): string | null {
    return getTeamEmojiUrl(role) ??
        role.iconURL({ size: 128 }) ??
        guild.iconURL({ size: 128 });
}

type TeamTransactionEmbedOptions = {
    guild: Guild;
    teamRole: Role;
    team: Team;
    data: Database;
    title: string;
    description: string;
    color?: ColorResolvable;
    extraFields?: APIEmbedField[];
};

export function createTeamTransactionEmbed(
    options: TeamTransactionEmbedOptions
): EmbedBuilder {
    const guildIcon = options.guild.iconURL({ size: 128 }) ?? undefined;
    const manager = options.team.managerid ? `<@${options.team.managerid}>` : "Vacant";
    const rosterSize = getRosterPlayers(options.teamRole, options.team).length;
    const rosterLimit = getRosterLimit(options.data, options.guild.id);

    return new EmbedBuilder()
        .setColor(options.color ?? (options.teamRole.color || 0x5865f2))
        .setAuthor({ name: options.guild.name, iconURL: guildIcon })
        .setTitle(options.title)
        .setDescription(options.description)
        .addFields(
            {
                name: "📊 Roster",
                value: `\`${rosterSize}/${rosterLimit}\``,
                inline: true
            },
            {
                name: "💼 Manager",
                value: manager,
                inline: true
            },
            ...(options.extraFields ?? [])
        )
        .setThumbnail(getTeamThumbnail(options.teamRole, options.guild))
        .setFooter({ text: `${options.guild.name} • Transactions`, iconURL: guildIcon })
        .setTimestamp();
}

export async function sendTransactionEmbed(
    guild: Guild,
    channelId: string | null,
    embed: EmbedBuilder
): Promise<void> {
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    if (channel?.isTextBased()) {
        await channel.send({ embeds: [embed] }).catch(console.error);
    }
}

export async function sendTransactionRecord(
    guild: Guild,
    data: Database,
    embed: EmbedBuilder
): Promise<void> {
    const channelIds = new Set([
        getTransactionChannelId(data, guild.id),
        getLogChannelId(data, guild.id)
    ]);

    for (const channelId of channelIds) {
        if (!channelId) continue;
        await sendTransactionEmbed(guild, channelId, embed);
    }
}
