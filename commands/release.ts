import {
    ChatInputCommandInteraction,
    SlashCommandBuilder
} from "discord.js";

import { loadData } from "./database.js";
import { findTeamAccess, isTeamStaffMember } from "./teamstaff.js";
import { createErrorEmbed as errorEmbed } from "./embeds.js";
import {
    createTeamTransactionEmbed,
    getTeamEmoji,
    sendTransactionRecord
} from "./teamembeds.js";

import type { Command } from "../types.js";

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName("release")
        .setDescription("Release a player from your team.")
        .addUserOption(option =>
            option
                .setName("player")
                .setDescription("The player you want to release.")
                .setRequired(true)
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [errorEmbed("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }

        const player = interaction.options.getUser("player", true);
        const data = loadData();
        const access = findTeamAccess(data, interaction.user.id);

        if (!access) {
            await interaction.reply({
                embeds: [
                    errorEmbed(
                        "Only a manager, assistant manager, captain, or coach can release players."
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (!access.team.managerid) {
            await interaction.reply({
                embeds: [errorEmbed("This team is frozen until a new manager is appointed.")],
                ephemeral: true
            });
            return;
        }

        const teamRole = interaction.guild.roles.cache.get(access.teamRoleId);
        if (!teamRole) {
            await interaction.reply({
                embeds: [errorEmbed("Your team role could not be found.")],
                ephemeral: true
            });
            return;
        }

        const member = await interaction.guild.members.fetch(player.id).catch(() => null);
        if (!member) {
            await interaction.reply({
                embeds: [errorEmbed("That player is no longer in this server.")],
                ephemeral: true
            });
            return;
        }

        if (!member.roles.cache.has(teamRole.id)) {
            await interaction.reply({
                embeds: [errorEmbed(`${player} is not on your team.`)],
                ephemeral: true
            });
            return;
        }

        if (player.id === access.team.managerid || isTeamStaffMember(access.team, player.id)) {
            await interaction.reply({
                embeds: [
                    errorEmbed(
                        "Managers and team staff cannot be released as players. Demote staff first."
                    )
                ],
                ephemeral: true
            });
            return;
        }

        try {
            await member.roles.remove(
                teamRole,
                `Released by ${interaction.user.tag}`
            );
        } catch (error) {
            console.error(error);
            await interaction.reply({
                embeds: [
                    errorEmbed(
                        `I could not remove ${teamRole} from ${player}. Check Manage Roles and the role order.`
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const embed = createTeamTransactionEmbed({
            guild: interaction.guild,
            teamRole,
            team: access.team,
            data,
            title: `Player Released - ${teamRole.name}`,
            description: `> ${member} has been released from ${getTeamEmoji(teamRole)} ${teamRole}.`,
            color: 0xed4245,
            extraFields: [
                {
                    name: "👤 Released By",
                    value: `${interaction.user}`,
                    inline: true
                }
            ]
        });

        await interaction.reply({ embeds: [embed], ephemeral: true });
        await sendTransactionRecord(
            interaction.guild,
            data,
            embed
        );
    }
};
