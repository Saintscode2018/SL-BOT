import {
    ChatInputCommandInteraction,
    SlashCommandBuilder
} from "discord.js";

import { loadData, saveData } from "./database.js";
import { createErrorEmbed, createSuccessEmbed } from "./embeds.js";
import {
    assignManagerRoles,
    getConfiguredManagerRole
} from "./managerrole.js";
import { findTeamAccess } from "./teamstaff.js";
import { getTeamThumbnail, sendTransactionRecord } from "./teamembeds.js";
import { canRunLeagueAdmin } from "./permissions.js";

import type { Command } from "../types.js";

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName("teamcreate")
        .setDescription("Create a team and assign its manager.")
        .addRoleOption(option =>
            option
                .setName("role")
                .setDescription("The Discord role used for this team.")
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName("manager")
                .setDescription("The team's first manager.")
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
                        "You do not have permission to create teams.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const selectedRole = interaction.options.getRole("role", true);
        const teamRole = interaction.guild.roles.cache.get(selectedRole.id);
        const manager = interaction.options.getUser("manager", true);

        if (!teamRole || teamRole.id === interaction.guild.id) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "Choose a normal Discord role for the team.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (data.teams[teamRole.id]) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        `${teamRole} is already registered as a team.`,
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (getConfiguredManagerRole(data, interaction.guild)?.id === teamRole.id) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "The shared manager role cannot also be used as a team role.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (data.settings.assistantManagerRoles[interaction.guild.id] === teamRole.id) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "The assistant manager role cannot also be used as a team role.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (manager.bot) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed("Bots cannot manage teams.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }

        const existingAccess = findTeamAccess(data, manager.id);
        if (existingAccess) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        `${manager} already holds a manager or team staff position.`,
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const managerMember = await interaction.guild.members.fetch(manager.id).catch(() => null);
        if (!managerMember) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "The selected manager is no longer in this server.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const currentTeamId = Object.keys(data.teams).find(roleId =>
            managerMember.roles.cache.has(roleId)
        );

        if (currentTeamId) {
            const currentTeam = interaction.guild.roles.cache.get(currentTeamId);
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        `${manager} is already a player on ${currentTeam ?? "another registered team"}.`,
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        try {
            await assignManagerRoles(
                managerMember,
                teamRole,
                data,
                `Team created by ${interaction.user.tag}`
            );
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : "I could not assign the required manager roles.";

            await interaction.reply({
                embeds: [createErrorEmbed(message, interaction.guild)],
                ephemeral: true
            });
            return;
        }

        data.teams[teamRole.id] = {
            managerid: manager.id,
            staff: {
                assistant_manager: null,
                captain: null,
                coach: null
            }
        };
        saveData(data);

        const managerRole = getConfiguredManagerRole(data, interaction.guild);
        const embed = createSuccessEmbed(
            interaction.guild,
            "Team Created",
            `${teamRole} is ready and ${manager} has been appointed as manager.`,
            [
                { name: "Team Role", value: `${teamRole}`, inline: true },
                { name: "Manager Role", value: `${managerRole}`, inline: true },
                { name: "Created By", value: `${interaction.user}`, inline: true }
            ]
        ).setThumbnail(getTeamThumbnail(teamRole, interaction.guild));

        await interaction.reply({ embeds: [embed], ephemeral: true });
        await sendTransactionRecord(
            interaction.guild,
            data,
            embed
        );
    }
};
