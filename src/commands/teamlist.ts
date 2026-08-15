import {
    ChatInputCommandInteraction,
    SlashCommandBuilder
} from "discord.js";

import { getRosterLimit, loadData } from "./database.js";
import { createErrorEmbed, createStatusEmbed } from "./embeds.js";
import { getRosterPlayers } from "./rosterutils.js";

import type { Command } from "../types.js";

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName("teamlist")
        .setDescription("View every registered team in this server."),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [createErrorEmbed("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }

        const data = loadData();
        await interaction.deferReply({ ephemeral: true });

        try {
            await interaction.guild.members.fetch();
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        "I could not load the team list. Make sure Server Members Intent is enabled.",
                        interaction.guild
                    )
                ]
            });
            return;
        }

        const teams = Object.entries(data.teams)
            .map(([roleId, team]) => ({
                role: interaction.guild?.roles.cache.get(roleId),
                team
            }))
            .filter(entry => entry.role);

        if (!teams.length) {
            await interaction.editReply({
                embeds: [
                    createStatusEmbed({
                        guild: interaction.guild,
                        title: "No Registered Teams",
                        description: "There are no registered teams in this server yet."
                    })
                ]
            });
            return;
        }

        const rosterLimit = getRosterLimit(data, interaction.guild.id);
        const lines = teams.map(({ role, team }) =>
            `${role} — ${team.managerid ? `<@${team.managerid}>` : "Vacant"} — ${getRosterPlayers(role!, team).length}/${rosterLimit} players`
        );

        const embed = createStatusEmbed({
            guild: interaction.guild,
            title: "Registered Teams",
            description: lines.join("\n")
        });

        await interaction.editReply({ embeds: [embed] });
    }
};
