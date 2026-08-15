import {
    ChatInputCommandInteraction,
    SlashCommandBuilder
} from "discord.js";

import { loadData, saveData } from "./database.js";
import { createErrorEmbed, createStatusEmbed, createSuccessEmbed } from "./embeds.js";
import { removeAssistantManagerRoleIfUnused } from "./assistantmanagerrole.js";
import { removeManagerRoleIfUnused } from "./managerrole.js";
import { getTeamThumbnail, sendTransactionRecord } from "./teamembeds.js";
import { canRunLeagueAdmin } from "./permissions.js";

import type { Command } from "../types.js";

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName("teamdisband")
        .setDescription("Disband a registered team.")
        .addRoleOption(option =>
            option
                .setName("team")
                .setDescription("The registered team to disband.")
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
                        "You do not have permission to disband teams.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const selectedRole = interaction.options.getRole("team", true);
        const teamRole = interaction.guild.roles.cache.get(selectedRole.id);
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

        const previousManagerId = team.managerid;
        const previousAssistantId = team.staff.assistant_manager;
        delete data.teams[teamRole.id];
        saveData(data);

        const managerRoleRemoved = await removeManagerRoleIfUnused(
            interaction.guild,
            previousManagerId,
            data,
            `Team disbanded by ${interaction.user.tag}`
        );

        const assistantRoleRemoved = previousAssistantId
            ? await removeAssistantManagerRoleIfUnused(
                interaction.guild,
                previousAssistantId,
                data,
                `Team disbanded by ${interaction.user.tag}`
            )
            : true;

        const rolesRemoved = managerRoleRemoved && assistantRoleRemoved;

        const description = rolesRemoved
            ? `${teamRole} has been disbanded.`
            : `${teamRole} has been disbanded, but a former leadership role needs manual removal.`;

        const embed = rolesRemoved
            ? createSuccessEmbed(
                interaction.guild,
                "Team Disbanded",
                description,
                [{ name: "Disbanded By", value: `${interaction.user}`, inline: true }]
            )
            : createStatusEmbed({
                guild: interaction.guild,
                title: "Team Disbanded with a Warning",
                description,
                fields: [{ name: "Disbanded By", value: `${interaction.user}`, inline: true }],
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
