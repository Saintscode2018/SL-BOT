"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendStaffCommandLog = sendStaffCommandLog;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const embeds_js_1 = require("./embeds.js");
function displayOption(option) {
    const value = option.value;
    if (value === undefined || value === null) {
        return "Not provided";
    }
    switch (option.type) {
        case discord_js_1.ApplicationCommandOptionType.User:
        case discord_js_1.ApplicationCommandOptionType.Mentionable:
            return `<@${value}>`;
        case discord_js_1.ApplicationCommandOptionType.Role:
            return `<@&${value}>`;
        case discord_js_1.ApplicationCommandOptionType.Channel:
            return `<#${value}>`;
        default:
            return String(value);
    }
}
function formatOptions(options) {
    if (!options.length)
        return "None";
    const lines = [];
    for (const option of options) {
        if (option.options?.length) {
            lines.push(`**${option.name}:** ${formatOptions(option.options)}`);
        }
        else {
            lines.push(`**${option.name}:** ${displayOption(option)}`);
        }
    }
    const text = lines.join("\n");
    return text.length > 1024 ? `${text.slice(0, 1021)}...` : text;
}
async function sendStaffCommandLog(interaction) {
    if (!interaction.guild)
        return;
    const data = (0, database_js_1.loadData)();
    const channelId = (0, database_js_1.getLogChannelId)(data, interaction.guild.id);
    if (!channelId)
        return;
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased())
        return;
    const embed = (0, embeds_js_1.createStatusEmbed)({
        guild: interaction.guild,
        title: "Staff Command Log",
        description: `${interaction.user} used **/${interaction.commandName}**.`,
        color: 0x5865f2,
        fields: [
            {
                name: "Used By",
                value: `${interaction.user} \`${interaction.user.id}\``,
                inline: true
            },
            {
                name: "Channel",
                value: `<#${interaction.channelId}>`,
                inline: true
            },
            {
                name: "Options",
                value: formatOptions(interaction.options.data)
            }
        ]
    });
    await channel.send({ embeds: [embed] });
}
