import {
    ChannelType,
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    SlashCommandBuilder
} from "discord.js";

import { loadData, saveData } from "./database.js";
import { createErrorEmbed, createSuccessEmbed } from "./embeds.js";
import { canRunLeagueAdmin } from "./permissions.js";

import type { Command } from "../types.js";

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName("transactionchannel")
        .setDescription("Set the public channel for completed transactions.")
        .addChannelOption(option =>
            option
                .setName("channel")
                .setDescription("The channel that will receive completed transactions.")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [createErrorEmbed("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }

        const data = loadData();

        if (!canRunLeagueAdmin(interaction, data)) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "You do not have permission to configure the transaction channel.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const selectedChannel = interaction.options.getChannel("channel", true);
        const channel = interaction.guild.channels.cache.get(selectedChannel.id);
        const botMember = interaction.guild.members.me;

        if (!channel?.isTextBased() || !botMember) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "That text channel could not be found.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const permissions = channel.permissionsFor(botMember);
        const requiredPermissions = [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks
        ];

        if (!permissions?.has(requiredPermissions)) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        `I need View Channel, Send Messages, and Embed Links in ${channel}.`,
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        data.settings.transactionChannels[interaction.guild.id] = channel.id;
        saveData(data);

        const embed = createSuccessEmbed(
            interaction.guild,
            "Transaction Channel Set",
            `Completed transactions will now be posted in ${channel}.`
        );

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
