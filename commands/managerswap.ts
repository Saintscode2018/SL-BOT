import {
    ChatInputCommandInteraction,
    SlashCommandBuilder
} from "discord.js";

import { loadData, saveData } from "./database.js";
import { createErrorEmbed, createStatusEmbed, createSuccessEmbed } from "./embeds.js";
import {
    assignManagerRoles,
    removeFormerManagerRoles
} from "./managerrole.js";
import { findTeamAccess } from "./teamstaff.js";
import { getTeamThumbnail, sendTransactionRecord } from "./teamembeds.js";
import { canRunLeagueAdmin } from "./permissions.js";

import type { Command } from "../types.js";

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName("managerswap")
        .setDescription("Replace the manager of a registered team.")
        .addRoleOption(option =>
            option
                .setName("team")
                .setDescription("The team receiving a new manager.")
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName("manager")
                .setDescription("The new manager.")
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
                        "You do not have permission to replace managers.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const selectedRole = interaction.options.getRole("team", true);
        const teamRole = interaction.guild.roles.cache.get(selectedRole.id);
        const newManager = interaction.options.getUser("manager", true);
        const team = data.teams[selectedRole.id];

        if (!teamRole || !team) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "The selected role is not a registered team.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (newManager.bot) {
            await interaction.reply({
                embeds: [createErrorEmbed("Bots cannot manage teams.", interaction.guild)],
                ephemeral: true
            });
            return;
        }

        if (team.managerid === newManager.id) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        `${newManager} already manages ${teamRole}.`,
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (findTeamAccess(data, newManager.id)) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        `${newManager} already holds a manager or team staff position.`,
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const newManagerMember = await interaction.guild.members
            .fetch(newManager.id)
            .catch(() => null);

        if (!newManagerMember) {
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

        const otherTeamId = Object.keys(data.teams).find(roleId =>
            roleId !== teamRole.id && newManagerMember.roles.cache.has(roleId)
        );

        if (otherTeamId) {
            const otherTeam = interaction.guild.roles.cache.get(otherTeamId);
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        `${newManager} is already a player on ${otherTeam ?? "another registered team"}.`,
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        try {
            await assignManagerRoles(
                newManagerMember,
                teamRole,
                data,
                `Manager changed by ${interaction.user.tag}`
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

        const previousManagerId = team.managerid;
        team.managerid = newManager.id;
        saveData(data);

        const oldRoleRemoved = previousManagerId
            ? await removeFormerManagerRoles(
                interaction.guild,
                previousManagerId,
                teamRole,
                data,
                `No longer managing a team after change by ${interaction.user.tag}`
            )
            : true;

        const description = oldRoleRemoved
            ? `${newManager} is now the manager of ${teamRole}.`
            : `${newManager} is now the manager of ${teamRole}. The previous manager's roles need manual removal.`;

        const fields = [
            {
                name: "Previous Manager",
                value: previousManagerId ? `<@${previousManagerId}>` : "Vacant",
                inline: true
            },
            { name: "New Manager", value: `${newManager}`, inline: true },
            { name: "Changed By", value: `${interaction.user}`, inline: true }
        ];

        const embed = oldRoleRemoved
            ? createSuccessEmbed(
                interaction.guild,
                "Manager Changed",
                description,
                fields
            )
            : createStatusEmbed({
                guild: interaction.guild,
                title: "Manager Changed with a Warning",
                description,
                fields,
                color: 0xfee75c
            });

        embed.setThumbnail(getTeamThumbnail(teamRole, interaction.guild));

        await interaction.reply({ embeds: [embed], ephemeral: true });
        await sendTransactionRecord(
            interaction.guild,
            data,
            embed
        );
    }
};
