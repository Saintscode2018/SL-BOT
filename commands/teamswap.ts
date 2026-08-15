import {
    ChatInputCommandInteraction,
    GuildMember,
    PermissionFlagsBits,
    Role,
    SlashCommandBuilder
} from "discord.js";

import { loadData } from "./database.js";
import { createErrorEmbed, createStatusEmbed } from "./embeds.js";
import { canRunLeagueAdmin } from "./permissions.js";
import { findTeamAccess } from "./teamstaff.js";
import {
    getTeamEmoji,
    getTeamThumbnail,
    sendTransactionRecord
} from "./teamembeds.js";

import type { Command } from "../types.js";

async function restorePlayer(
    member: GuildMember,
    originalTeam: Role,
    otherTeam: Role
): Promise<boolean> {
    let restored = true;

    if (!member.roles.cache.has(originalTeam.id)) {
        await member.roles.add(originalTeam, "Restoring roles after an incomplete team swap")
            .catch(error => {
                console.error(error);
                restored = false;
            });
    }

    if (member.roles.cache.has(otherTeam.id)) {
        await member.roles.remove(otherTeam, "Restoring roles after an incomplete team swap")
            .catch(error => {
                console.error(error);
                restored = false;
            });
    }

    return restored;
}

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName("teamswap")
        .setDescription("Swap two players between their current teams.")
        .addUserOption(option =>
            option
                .setName("player_one")
                .setDescription("The first player in the swap.")
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName("player_two")
                .setDescription("The second player in the swap.")
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
                        "You do not have permission to swap players between teams.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const firstUser = interaction.options.getUser("player_one", true);
        const secondUser = interaction.options.getUser("player_two", true);

        if (firstUser.id === secondUser.id) {
            await interaction.reply({
                embeds: [createErrorEmbed("Choose two different players.", interaction.guild)],
                ephemeral: true
            });
            return;
        }

        if (firstUser.bot || secondUser.bot) {
            await interaction.reply({
                embeds: [createErrorEmbed("Bots cannot be included in a team swap.", interaction.guild)],
                ephemeral: true
            });
            return;
        }

        const [firstMember, secondMember] = await Promise.all([
            interaction.guild.members.fetch(firstUser.id).catch(() => null),
            interaction.guild.members.fetch(secondUser.id).catch(() => null)
        ]);

        if (!firstMember || !secondMember) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "Both players must still be members of this server.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (findTeamAccess(data, firstUser.id) || findTeamAccess(data, secondUser.id)) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "Managers and team staff cannot be swapped as players.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const firstTeamIds = Object.keys(data.teams).filter(roleId =>
            firstMember.roles.cache.has(roleId)
        );
        const secondTeamIds = Object.keys(data.teams).filter(roleId =>
            secondMember.roles.cache.has(roleId)
        );

        if (firstTeamIds.length !== 1 || secondTeamIds.length !== 1) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "Each player must have exactly one registered team role.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const firstTeam = interaction.guild.roles.cache.get(firstTeamIds[0]);
        const secondTeam = interaction.guild.roles.cache.get(secondTeamIds[0]);

        if (!firstTeam || !secondTeam) {
            await interaction.reply({
                embeds: [createErrorEmbed("One of the team roles could not be found.", interaction.guild)],
                ephemeral: true
            });
            return;
        }

        if (firstTeam.id === secondTeam.id) {
            await interaction.reply({
                embeds: [createErrorEmbed("The selected players are already on the same team.", interaction.guild)],
                ephemeral: true
            });
            return;
        }

        if (!data.teams[firstTeam.id].managerid || !data.teams[secondTeam.id].managerid) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "Both teams need an active manager before their players can be swapped.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const botMember = interaction.guild.members.me;
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            await interaction.reply({
                embeds: [createErrorEmbed("I need the Manage Roles permission to complete a team swap.", interaction.guild)],
                ephemeral: true
            });
            return;
        }

        if (
            !firstMember.manageable ||
            !secondMember.manageable ||
            !firstTeam.editable ||
            !secondTeam.editable
        ) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "I cannot manage one of the players or team roles. Check the role order and try again.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            await firstMember.roles.add(secondTeam, `Team swap by ${interaction.user.tag}`);
            await secondMember.roles.add(firstTeam, `Team swap by ${interaction.user.tag}`);
            await firstMember.roles.remove(firstTeam, `Team swap by ${interaction.user.tag}`);
            await secondMember.roles.remove(secondTeam, `Team swap by ${interaction.user.tag}`);
        } catch (error) {
            console.error(error);

            const [firstRestored, secondRestored] = await Promise.all([
                restorePlayer(firstMember, firstTeam, secondTeam),
                restorePlayer(secondMember, secondTeam, firstTeam)
            ]);

            await interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        firstRestored && secondRestored
                            ? "The swap could not be completed, so both players were returned to their original teams."
                            : "The swap could not be completed and some roles need to be corrected manually.",
                        interaction.guild
                    )
                ]
            });
            return;
        }

        const embed = createStatusEmbed({
            guild: interaction.guild,
            title: "Team Swap Completed",
            description:
                `${firstMember} has joined ${getTeamEmoji(secondTeam)} ${secondTeam}.\n` +
                `${secondMember} has joined ${getTeamEmoji(firstTeam)} ${firstTeam}.`,
            color: secondTeam.color || firstTeam.color || 0x5865f2,
            fields: [
                {
                    name: firstUser.username,
                    value: `${firstTeam} → ${secondTeam}`,
                    inline: true
                },
                {
                    name: secondUser.username,
                    value: `${secondTeam} → ${firstTeam}`,
                    inline: true
                },
                {
                    name: "Swapped By",
                    value: `${interaction.user}`,
                    inline: true
                }
            ]
        }).setThumbnail(getTeamThumbnail(secondTeam, interaction.guild));

        await interaction.editReply({ embeds: [embed] });
        await sendTransactionRecord(
            interaction.guild,
            data,
            embed
        );
    }
};
