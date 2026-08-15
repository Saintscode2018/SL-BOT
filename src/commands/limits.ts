import {
    ChatInputCommandInteraction,
    SlashCommandBuilder
} from "discord.js";

import { getRosterLimit, loadData, saveData } from "./database.js";
import { createErrorEmbed, createSuccessEmbed } from "./embeds.js";
import { canRunLeagueAdmin } from "./permissions.js";
import { getRosterPlayers } from "./rosterutils.js";

import type { Command } from "../types.js";

export const rosterLimitCommand: Command = {
    data: new SlashCommandBuilder()
        .setName("rosterlimit")
        .setDescription("Set the player limit for every team in this server.")
        .addIntegerOption(option =>
            option
                .setName("limit")
                .setDescription("The maximum number of players on each team.")
                .setMinValue(1)
                .setMaxValue(100)
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
                        "You do not have permission to change the roster limit.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const limit = interaction.options.getInteger("limit", true);
        const previousLimit = getRosterLimit(data, interaction.guild.id);

        await interaction.deferReply({ ephemeral: true });

        try {
            await interaction.guild.members.fetch();
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        "I could not load the current team rosters. Make sure Server Members Intent is enabled.",
                        interaction.guild
                    )
                ]
            });
            return;
        }

        const registeredTeams = Object.entries(data.teams)
            .map(([roleId, team]) => ({
                role: interaction.guild?.roles.cache.get(roleId),
                team
            }))
            .filter(entry => entry.role);

        const teamsOverLimit = registeredTeams.filter(({ role, team }) =>
            getRosterPlayers(role!, team).length > limit
        ).length;

        data.settings.rosterLimits[interaction.guild.id] = limit;
        saveData(data);

        const embed = createSuccessEmbed(
            interaction.guild,
            "Roster Limit Updated",
            `Every registered team in this server can now have up to **${limit}** players.`,
            [
                { name: "Previous Limit", value: String(previousLimit), inline: true },
                { name: "New Limit", value: String(limit), inline: true },
                { name: "Teams Updated", value: String(registeredTeams.length), inline: true },
                { name: "Currently Over Limit", value: String(teamsOverLimit), inline: true }
            ]
        );

        await interaction.editReply({ embeds: [embed] });
    }
};
