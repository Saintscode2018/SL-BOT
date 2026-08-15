import {
    ApplicationCommandOptionType,
    ChatInputCommandInteraction
} from "discord.js";

import { getLogChannelId, loadData } from "./database.js";
import { createStatusEmbed } from "./embeds.js";

type CommandOption = ChatInputCommandInteraction["options"]["data"][number];

function displayOption(option: CommandOption): string {
    const value = option.value;

    if (value === undefined || value === null) {
        return "Not provided";
    }

    switch (option.type) {
        case ApplicationCommandOptionType.User:
        case ApplicationCommandOptionType.Mentionable:
            return `<@${value}>`;
        case ApplicationCommandOptionType.Role:
            return `<@&${value}>`;
        case ApplicationCommandOptionType.Channel:
            return `<#${value}>`;
        default:
            return String(value);
    }
}

function formatOptions(options: readonly CommandOption[]): string {
    if (!options.length) return "None";

    const lines: string[] = [];

    for (const option of options) {
        if (option.options?.length) {
            lines.push(`**${option.name}:** ${formatOptions(option.options)}`);
        } else {
            lines.push(`**${option.name}:** ${displayOption(option)}`);
        }
    }

    const text = lines.join("\n");
    return text.length > 1024 ? `${text.slice(0, 1021)}...` : text;
}

export async function sendStaffCommandLog(
    interaction: ChatInputCommandInteraction
): Promise<void> {
    if (!interaction.guild) return;

    const data = loadData();
    const channelId = getLogChannelId(data, interaction.guild.id);
    if (!channelId) return;

    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return;

    const embed = createStatusEmbed({
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
