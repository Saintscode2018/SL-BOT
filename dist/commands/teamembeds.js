"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTeamEmoji = getTeamEmoji;
exports.getTeamThumbnail = getTeamThumbnail;
exports.createTeamTransactionEmbed = createTeamTransactionEmbed;
exports.sendTransactionEmbed = sendTransactionEmbed;
exports.sendTransactionRecord = sendTransactionRecord;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const rosterutils_js_1 = require("./rosterutils.js");
function getTeamEmoji(role) {
    const match = role.name.match(/<a?:\w+:\d+>/);
    return match?.[0] ?? "⚽";
}
function getTeamEmojiUrl(role) {
    const match = role.name.match(/<a?:(\w+):(\d+)>/);
    if (!match)
        return null;
    const extension = role.name.includes("<a:") ? "gif" : "png";
    return `https://cdn.discordapp.com/emojis/${match[2]}.${extension}`;
}
function getTeamThumbnail(role, guild) {
    return getTeamEmojiUrl(role) ??
        role.iconURL({ size: 128 }) ??
        guild.iconURL({ size: 128 });
}
function createTeamTransactionEmbed(options) {
    const guildIcon = options.guild.iconURL({ size: 128 }) ?? undefined;
    const manager = options.team.managerid ? `<@${options.team.managerid}>` : "Vacant";
    const rosterSize = (0, rosterutils_js_1.getRosterPlayers)(options.teamRole, options.team).length;
    const rosterLimit = (0, database_js_1.getRosterLimit)(options.data, options.guild.id);
    return new discord_js_1.EmbedBuilder()
        .setColor(options.color ?? (options.teamRole.color || 0x5865f2))
        .setAuthor({ name: options.guild.name, iconURL: guildIcon })
        .setTitle(options.title)
        .setDescription(options.description)
        .addFields({
        name: "📊 Roster",
        value: `\`${rosterSize}/${rosterLimit}\``,
        inline: true
    }, {
        name: "💼 Manager",
        value: manager,
        inline: true
    }, ...(options.extraFields ?? []))
        .setThumbnail(getTeamThumbnail(options.teamRole, options.guild))
        .setFooter({ text: `${options.guild.name} • Transactions`, iconURL: guildIcon })
        .setTimestamp();
}
async function sendTransactionEmbed(guild, channelId, embed) {
    if (!channelId)
        return;
    const channel = guild.channels.cache.get(channelId);
    if (channel?.isTextBased()) {
        await channel.send({ embeds: [embed] }).catch(console.error);
    }
}
async function sendTransactionRecord(guild, data, embed) {
    const channelIds = new Set([
        (0, database_js_1.getTransactionChannelId)(data, guild.id),
        (0, database_js_1.getLogChannelId)(data, guild.id)
    ]);
    for (const channelId of channelIds) {
        if (!channelId)
            continue;
        await sendTransactionEmbed(guild, channelId, embed);
    }
}
