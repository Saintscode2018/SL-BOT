import {
    ChatInputCommandInteraction,
    SlashCommandBuilder
} from "discord.js";

import { loadData, saveData } from "./database.js";
import { createErrorEmbed, createSuccessEmbed } from "./embeds.js";
import { hasAccess, isOwner } from "./permissions.js";

import type { Command } from "../types.js";
import type { AccessScope } from "./permissions.js";

const scopeNames: Record<AccessScope, string> = {
    echo: "Echo",
    league_admin: "League Administration"
};

export const whitelistCommand: Command = {
    data: new SlashCommandBuilder()
        .setName("whitelist")
        .setDescription("Manage access to restricted bot commands.")
        .addStringOption(option =>
            option
                .setName("scope")
                .setDescription("The access list to update.")
                .setRequired(true)
                .addChoices(
                    { name: "Echo", value: "echo" },
                    { name: "League Administration", value: "league_admin" }
                )
        )
        .addStringOption(option =>
            option
                .setName("action")
                .setDescription("Add or remove access.")
                .setRequired(true)
                .addChoices(
                    { name: "Add", value: "add" },
                    { name: "Remove", value: "remove" }
                )
        )
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("The person whose access should be changed.")
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

        if (!isOwner(data, interaction.user.id)) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "Only the bot owner can change command access.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const scope = interaction.options.getString("scope", true) as AccessScope;
        const action = interaction.options.getString("action", true);
        const user = interaction.options.getUser("user", true);
        const list = data.settings.whitelists[scope];

        if (user.id === data.settings.owner_id) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "The bot owner already has access to every restricted command.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (action === "add") {
            if (list.includes(user.id)) {
                await interaction.reply({
                    embeds: [
                        createErrorEmbed(
                            `${user} already has ${scopeNames[scope]} access.`,
                            interaction.guild
                        )
                    ],
                    ephemeral: true
                });
                return;
            }

            list.push(user.id);
        } else {
            const index = list.indexOf(user.id);
            if (index === -1) {
                await interaction.reply({
                    embeds: [
                        createErrorEmbed(
                            `${user} does not have ${scopeNames[scope]} access.`,
                            interaction.guild
                        )
                    ],
                    ephemeral: true
                });
                return;
            }

            list.splice(index, 1);
        }

        saveData(data);

        const description = action === "add"
            ? `${user} can now use commands covered by **${scopeNames[scope]}**.`
            : `${user} no longer has access to commands covered by **${scopeNames[scope]}**.`;

        await interaction.reply({
            embeds: [
                createSuccessEmbed(
                    interaction.guild,
                    action === "add" ? "Access Granted" : "Access Removed",
                    description
                )
            ],
            ephemeral: true
        });
    }
};

export const echoCommand: Command = {
    data: new SlashCommandBuilder()
        .setName("echo")
        .setDescription("Send an announcement through the bot.")
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("The announcement to send.")
                .setMaxLength(2000)
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

        if (!hasAccess(data, interaction.user.id, "echo")) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "You do not have permission to use this command.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const message = interaction.options.getString("message", true);
        const embed = createSuccessEmbed(
            interaction.guild,
            "Announcement",
            message
        );

        await interaction.reply({ embeds: [embed] });
    }
};
