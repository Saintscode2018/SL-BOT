"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStatusEmbed = createStatusEmbed;
exports.createErrorEmbed = createErrorEmbed;
exports.createSuccessEmbed = createSuccessEmbed;
const discord_js_1 = require("discord.js");
function createStatusEmbed(options) {
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(options.color ?? 0x5865f2)
        .setTitle(options.title)
        .setDescription(options.description)
        .setTimestamp();
    if (options.fields?.length) {
        embed.addFields(options.fields);
    }
    if (options.guild) {
        const icon = options.guild.iconURL({ size: 128 }) ?? undefined;
        embed
            .setAuthor({ name: options.guild.name, iconURL: icon })
            .setThumbnail(icon ?? null)
            .setFooter({ text: options.guild.name, iconURL: icon });
    }
    else {
        embed.setFooter({ text: "SLBot" });
    }
    return embed;
}
function createErrorEmbed(description, guild) {
    return createStatusEmbed({
        guild,
        title: "Unable to Complete Request",
        description: `❌ ${description}`,
        color: 0xed4245
    });
}
function createSuccessEmbed(guild, title, description, fields) {
    return createStatusEmbed({
        guild,
        title,
        description,
        fields,
        color: 0x57f287
    });
}
