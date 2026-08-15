import {
    APIEmbedField,
    ChatInputCommandInteraction,
    SlashCommandBuilder
} from "discord.js";

import { getRosterLimit, loadData } from "./database.js";
import { createErrorEmbed, createStatusEmbed } from "./embeds.js";
import { getTeamThumbnail } from "./teamembeds.js";
import { getRosterPlayers } from "./rosterutils.js";

import type { Command } from "../types.js";

function buildPlayerFields(players: string[], count: number, limit: number): APIEmbedField[] {
    if (!players.length) {
        return [{
            name: `Players (${count}/${limit})`,
            value: "No players are currently registered to this team."
        }];
    }

    const groups: string[] = [];
    let current = "";

    for (const player of players) {
        const next = current ? `${current}\n${player}` : player;
        if (next.length > 1024) {
            groups.push(current);
            current = player;
        } else {
            current = next;
        }
    }

    if (current) groups.push(current);

    return groups.map((value, index) => ({
        name: index === 0
            ? `Players (${count}/${limit})`
            : "Players Continued",
        value
    }));
}

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName("roster")
        .setDescription("View a team's current roster.")
        .addRoleOption(option =>
            option
                .setName("team")
                .setDescription("The team to view.")
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

        const selectedRole = interaction.options.getRole("team", true);
        const teamRole = interaction.guild.roles.cache.get(selectedRole.id);
        const data = loadData();
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

        await interaction.deferReply({ ephemeral: true });

        try {
            await interaction.guild.members.fetch();
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        "I could not load the server member list. Make sure Server Members Intent is enabled.",
                        interaction.guild
                    )
                ]
            });
            return;
        }

        const players = getRosterPlayers(teamRole, team);
        const rosterLimit = getRosterLimit(data, interaction.guild.id);
        const playerFields = buildPlayerFields(
            players.map(member => `${member}`),
            players.length,
            rosterLimit
        );

        const embed = createStatusEmbed({
            guild: interaction.guild,
            title: `${teamRole.name} Roster`,
            description: `The current lineup for ${teamRole}.`,
            color: teamRole.color || 0x5865f2,
            fields: [
                {
                    name: "Manager",
                    value: team.managerid ? `<@${team.managerid}>` : "Vacant",
                    inline: true
                },
                {
                    name: "Assistant Manager",
                    value: team.staff.assistant_manager
                        ? `<@${team.staff.assistant_manager}>`
                        : "Vacant",
                    inline: true
                },
                {
                    name: "Captain",
                    value: team.staff.captain
                        ? `<@${team.staff.captain}>`
                        : "Vacant",
                    inline: true
                },
                {
                    name: "Coach",
                    value: team.staff.coach
                        ? `<@${team.staff.coach}>`
                        : "Vacant",
                    inline: true
                },
                {
                    name: "Status",
                    value: team.managerid ? "Active" : "Frozen",
                    inline: true
                },
                ...playerFields
            ]
        }).setThumbnail(getTeamThumbnail(teamRole, interaction.guild));

        await interaction.editReply({ embeds: [embed] });
    }
};
