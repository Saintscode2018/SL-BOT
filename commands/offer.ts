import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    ButtonInteraction,
    ModalSubmitInteraction,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from "discord.js";

import { getRosterLimit, loadData } from "./database.js";
import { findTeamAccess } from "./teamstaff.js";
import {
    createErrorEmbed as errorEmbed,
    createStatusEmbed
} from "./embeds.js";
import {
    createTeamTransactionEmbed,
    getTeamEmoji,
    getTeamThumbnail,
    sendTransactionRecord
} from "./teamembeds.js";
import { isRosterFull } from "./rosterutils.js";
import type { Command } from "../types.js";

const activeSignings = new Set<string>();

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName("offer")
        .setDescription("Offer a player a contract to join your team.")
        .addUserOption(option =>
            option
                .setName("player")
                .setDescription("The player you want to sign.")
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
                embeds: [errorEmbed("Only a manager, assistant manager, captain, or coach can send offers.")],
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

        const { teamRoleId } = access;
        const teamRole = interaction.guild.roles.cache.get(teamRoleId);

        if (!teamRole) {
            await interaction.reply({
                embeds: [errorEmbed("Your team role could not be found.")],
                ephemeral: true
            });
            return;
        }

        if (player.bot) {
            await interaction.reply({
                embeds: [errorEmbed("You can't offer contracts to bots.")],
                ephemeral: true
            });
            return;
        }

        if (player.id === interaction.user.id) {
            await interaction.reply({
                embeds: [errorEmbed("You can't offer yourself a contract.")],
                ephemeral: true
            });
            return;
        }

        const member = await interaction.guild.members.fetch(player.id).catch(() => null);

        if (!member) {
            await interaction.reply({
                embeds: [errorEmbed("That player isn't in this server.")],
                ephemeral: true
            });
            return;
        }

        if (findTeamAccess(data, player.id)) {
            await interaction.reply({
                embeds: [errorEmbed("That person already holds a manager or team staff position.")],
                ephemeral: true
            });
            return;
        }

        const teams = data.teams ?? {};
        const alreadyOnTeam = Object.keys(teams).some(roleId => member.roles.cache.has(roleId));

        if (alreadyOnTeam) {
            await interaction.reply({
                embeds: [errorEmbed("That player is already on a team.")],
                ephemeral: true
            });
            return;
        }

        try {
            await interaction.guild.members.fetch();
        } catch (error) {
            console.error(error);
            await interaction.reply({
                embeds: [
                    errorEmbed(
                        "I could not load the current roster. Make sure Server Members Intent is enabled."
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (isRosterFull(
            teamRole,
            access.team,
            getRosterLimit(data, interaction.guild.id)
        )) {
            await interaction.reply({
                embeds: [errorEmbed(`${teamRole} has reached its roster limit.`)],
                ephemeral: true
            });
            return;
        }

        const guildIcon = interaction.guild.iconURL({ size: 128 }) ?? undefined;
        const thumbnail = getTeamThumbnail(teamRole, interaction.guild);

        const offerEmbed = new EmbedBuilder()
            .setColor(teamRole.color || 0x5865f2)
            .setAuthor({ name: interaction.guild.name, iconURL: guildIcon })
            .setTitle("⚽ Contract Offer")
            .setDescription(`${player} has received a contract offer to join ${teamRole}.`)
            .addFields(
                { name: "Team", value: `${teamRole}`, inline: true },
                { name: "Offered By", value: `${interaction.user}`, inline: true },
                { name: "Role Offered", value: "`Player`", inline: true }
            )
            .setThumbnail(thumbnail)
            .setFooter({ text: `${interaction.guild.name} • Contract Offer` })
            .setTimestamp();

        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`offer_accept:${interaction.guild.id}:${teamRoleId}:${player.id}`)
                .setLabel("Accept")
                .setEmoji("✅")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId(`offer_decline:${interaction.guild.id}:${teamRoleId}:${player.id}`)
                .setLabel("Decline")
                .setEmoji("❌")
                .setStyle(ButtonStyle.Danger)
        );

        try {
            await player.send({ embeds: [offerEmbed], components: [buttons] });

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57f287)
                        .setAuthor({ name: interaction.guild.name, iconURL: guildIcon })
                        .setTitle("✅ Offer Sent")
                        .setDescription(`Your contract offer has been sent to ${player}.`)
                        .addFields(
                            { name: "Team", value: `${teamRole}`, inline: true },
                            { name: "Player", value: `${player}`, inline: true }
                        )
                        .setThumbnail(thumbnail)
                        .setFooter({ text: `${interaction.guild.name} • Contract Offer` })
                        .setTimestamp()
                ],
                ephemeral: true
            });
        } catch {
            await interaction.reply({
                embeds: [errorEmbed(`I couldn't DM ${player} — they may have DMs disabled for this server.`)],
                ephemeral: true
            });
        }
    }
};

export async function handleAcceptButton(interaction: ButtonInteraction) {
    const [, guildId, teamRoleId, playerId] = interaction.customId.split(":");

    if (interaction.user.id !== playerId) {
        await interaction.reply({
            embeds: [errorEmbed("This offer isn't for you.")],
            ephemeral: true
        });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`offer_confirm:${guildId}:${teamRoleId}:${playerId}`)
        .setTitle("Accept Contract");

    const confirmation = new TextInputBuilder()
        .setCustomId("confirmation")
        .setLabel("Type YES to accept")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("YES")
        .setRequired(true)
        .setMaxLength(3);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(confirmation));

    await interaction.showModal(modal);
}

export async function handleDeclineButton(interaction: ButtonInteraction) {
    const [, guildId, teamRoleId, playerId] = interaction.customId.split(":");

    if (interaction.user.id !== playerId) {
        await interaction.reply({
            embeds: [errorEmbed("This offer isn't for you.")],
            ephemeral: true
        });
        return;
    }

    const guild = interaction.client.guilds.cache.get(guildId);
    const teamRole = guild?.roles.cache.get(teamRoleId);
    const thumbnail = teamRole && guild ? getTeamThumbnail(teamRole, guild) : null;

    await interaction.update({
        embeds: [
            createStatusEmbed({
                guild,
                color: 0xed4245,
                title: "Offer Declined",
                description:
                    teamRole
                        ? `You declined the contract offer from ${teamRole}.`
                        : "You declined this contract offer."
            }).setThumbnail(thumbnail)
        ],
        components: []
    });
}

export async function handleOfferModal(interaction: ModalSubmitInteraction) {
    const [, guildId, teamRoleId, playerId] = interaction.customId.split(":");

    if (interaction.user.id !== playerId) {
        await interaction.reply({
            embeds: [errorEmbed("This offer isn't for you.")],
            ephemeral: true
        });
        return;
    }

    const confirmation = interaction.fields.getTextInputValue("confirmation").trim().toUpperCase();

    if (confirmation !== "YES") {
        await interaction.reply({
            embeds: [errorEmbed("The contract wasn't accepted. Type `YES` to confirm.")],
            ephemeral: true
        });
        return;
    }

    const cachedGuild = interaction.client.guilds.cache.get(guildId);
    const guild = cachedGuild ?? (await interaction.client.guilds.fetch(guildId).catch(() => null));

    if (!guild) {
        await interaction.reply({
            embeds: [errorEmbed("I couldn't find the server this offer belongs to.")],
            ephemeral: true
        });
        return;
    }

    const data = loadData();
    const teams = data.teams ?? {};
    const teamData = teams[teamRoleId];

    if (!teamData) {
        await interaction.reply({
            embeds: [errorEmbed("That team no longer exists.")],
            ephemeral: true
        });
        return;
    }

    const teamRole = guild.roles.cache.get(teamRoleId);

    if (!teamRole) {
        await interaction.reply({
            embeds: [errorEmbed("The team's role could not be found.")],
            ephemeral: true
        });
        return;
    }

    const member = await guild.members.fetch(playerId).catch(() => null);

    if (!member) {
        await interaction.reply({
            embeds: [errorEmbed("You are no longer a member of this server.")],
            ephemeral: true
        });
        return;
    }

    if (!teamData.managerid) {
        await interaction.reply({
            embeds: [errorEmbed("This team is frozen until a new manager is appointed.")],
            ephemeral: true
        });
        return;
    }

    if (findTeamAccess(data, member.id)) {
        await interaction.reply({
            embeds: [errorEmbed("You now hold a manager or team staff position, so this player offer cannot be accepted.")],
            ephemeral: true
        });
        return;
    }

    const otherTeam = Object.keys(teams).find(roleId => roleId !== teamRoleId && member.roles.cache.has(roleId));

    if (otherTeam) {
        await interaction.reply({
            embeds: [errorEmbed("You are already on another team.")],
            ephemeral: true
        });
        return;
    }

    if (member.roles.cache.has(teamRoleId)) {
        await interaction.reply({
            embeds: [errorEmbed("You are already on this team.")],
            ephemeral: true
        });
        return;
    }

    const signingKey = `${guild.id}:${teamRole.id}`;
    if (activeSignings.has(signingKey)) {
        await interaction.reply({
            embeds: [errorEmbed("Another signing is being completed for this team. Try again in a moment.")],
            ephemeral: true
        });
        return;
    }

    activeSignings.add(signingKey);

    try {
        try {
            await guild.members.fetch();
        } catch (error) {
            console.error(error);
            await interaction.reply({
                embeds: [
                    errorEmbed(
                        "I could not load the current roster. Make sure Server Members Intent is enabled."
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (isRosterFull(
            teamRole,
            teamData,
            getRosterLimit(data, guild.id)
        )) {
            await interaction.reply({
                embeds: [errorEmbed(`${teamRole} has reached its roster limit.`)],
                ephemeral: true
            });
            return;
        }

        const botMember = guild.members.me;

        if (!botMember) {
            await interaction.reply({
                embeds: [errorEmbed("I couldn't find my server member.")],
                ephemeral: true
            });
            return;
        }

        if (teamRole.position >= botMember.roles.highest.position) {
            await interaction.reply({
                embeds: [errorEmbed(`I can't give you ${teamRole} because that role is higher than my highest role.`)],
                ephemeral: true
            });
            return;
        }

        try {
            await member.roles.add(teamRole);
        } catch (error) {
            console.error(error);
            await interaction.reply({
                embeds: [
                    errorEmbed(
                        `I couldn't give you ${teamRole}. Make sure my bot role is above the team role and that I have Manage Roles permission.`
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const embed = createTeamTransactionEmbed({
            guild,
            teamRole,
            team: teamData,
            data,
            title: `Contract Accepted - ${teamRole.name}`,
            description: `> ${member} has accepted an offer to join ${getTeamEmoji(teamRole)} ${teamRole}.`,
            color: 0x57f287
        });

        await interaction.reply({ embeds: [embed], ephemeral: true });
        await sendTransactionRecord(guild, data, embed);
    } finally {
        activeSignings.delete(signingKey);
    }
}
