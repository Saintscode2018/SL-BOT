"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
exports.handleAcceptButton = handleAcceptButton;
exports.handleDeclineButton = handleDeclineButton;
exports.handleOfferModal = handleOfferModal;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const teamstaff_js_1 = require("./teamstaff.js");
const embeds_js_1 = require("./embeds.js");
const teamembeds_js_1 = require("./teamembeds.js");
const rosterutils_js_1 = require("./rosterutils.js");
const activeSignings = new Set();
exports.command = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("offer")
        .setDescription("Offer a player a contract to join your team.")
        .addUserOption(option => option
        .setName("player")
        .setDescription("The player you want to sign.")
        .setRequired(true)),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }
        const player = interaction.options.getUser("player", true);
        const data = (0, database_js_1.loadData)();
        const access = (0, teamstaff_js_1.findTeamAccess)(data, interaction.user.id);
        if (!access) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("Only a manager, assistant manager, captain, or coach can send offers.")],
                ephemeral: true
            });
            return;
        }
        if (!access.team.managerid) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("This team is frozen until a new manager is appointed.")],
                ephemeral: true
            });
            return;
        }
        const { teamRoleId } = access;
        const teamRole = interaction.guild.roles.cache.get(teamRoleId);
        if (!teamRole) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("Your team role could not be found.")],
                ephemeral: true
            });
            return;
        }
        if (player.bot) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("You can't offer contracts to bots.")],
                ephemeral: true
            });
            return;
        }
        if (player.id === interaction.user.id) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("You can't offer yourself a contract.")],
                ephemeral: true
            });
            return;
        }
        const member = await interaction.guild.members.fetch(player.id).catch(() => null);
        if (!member) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("That player isn't in this server.")],
                ephemeral: true
            });
            return;
        }
        if ((0, teamstaff_js_1.findTeamAccess)(data, player.id)) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("That person already holds a manager or team staff position.")],
                ephemeral: true
            });
            return;
        }
        const teams = data.teams ?? {};
        const alreadyOnTeam = Object.keys(teams).some(roleId => member.roles.cache.has(roleId));
        if (alreadyOnTeam) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("That player is already on a team.")],
                ephemeral: true
            });
            return;
        }
        try {
            await interaction.guild.members.fetch();
        }
        catch (error) {
            console.error(error);
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("I could not load the current roster. Make sure Server Members Intent is enabled.")
                ],
                ephemeral: true
            });
            return;
        }
        if ((0, rosterutils_js_1.isRosterFull)(teamRole, access.team, (0, database_js_1.getRosterLimit)(data, interaction.guild.id))) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)(`${teamRole} has reached its roster limit.`)],
                ephemeral: true
            });
            return;
        }
        const guildIcon = interaction.guild.iconURL({ size: 128 }) ?? undefined;
        const thumbnail = (0, teamembeds_js_1.getTeamThumbnail)(teamRole, interaction.guild);
        const offerEmbed = new discord_js_1.EmbedBuilder()
            .setColor(teamRole.color || 0x5865f2)
            .setAuthor({ name: interaction.guild.name, iconURL: guildIcon })
            .setTitle("⚽ Contract Offer")
            .setDescription(`${player} has received a contract offer to join ${teamRole}.`)
            .addFields({ name: "Team", value: `${teamRole}`, inline: true }, { name: "Offered By", value: `${interaction.user}`, inline: true }, { name: "Role Offered", value: "`Player`", inline: true })
            .setThumbnail(thumbnail)
            .setFooter({ text: `${interaction.guild.name} • Contract Offer` })
            .setTimestamp();
        const buttons = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
            .setCustomId(`offer_accept:${interaction.guild.id}:${teamRoleId}:${player.id}`)
            .setLabel("Accept")
            .setEmoji("✅")
            .setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder()
            .setCustomId(`offer_decline:${interaction.guild.id}:${teamRoleId}:${player.id}`)
            .setLabel("Decline")
            .setEmoji("❌")
            .setStyle(discord_js_1.ButtonStyle.Danger));
        try {
            await player.send({ embeds: [offerEmbed], components: [buttons] });
            await interaction.reply({
                embeds: [
                    new discord_js_1.EmbedBuilder()
                        .setColor(0x57f287)
                        .setAuthor({ name: interaction.guild.name, iconURL: guildIcon })
                        .setTitle("✅ Offer Sent")
                        .setDescription(`Your contract offer has been sent to ${player}.`)
                        .addFields({ name: "Team", value: `${teamRole}`, inline: true }, { name: "Player", value: `${player}`, inline: true })
                        .setThumbnail(thumbnail)
                        .setFooter({ text: `${interaction.guild.name} • Contract Offer` })
                        .setTimestamp()
                ],
                ephemeral: true
            });
        }
        catch {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)(`I couldn't DM ${player} — they may have DMs disabled for this server.`)],
                ephemeral: true
            });
        }
    }
};
async function handleAcceptButton(interaction) {
    const [, guildId, teamRoleId, playerId] = interaction.customId.split(":");
    if (interaction.user.id !== playerId) {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("This offer isn't for you.")],
            ephemeral: true
        });
        return;
    }
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId(`offer_confirm:${guildId}:${teamRoleId}:${playerId}`)
        .setTitle("Accept Contract");
    const confirmation = new discord_js_1.TextInputBuilder()
        .setCustomId("confirmation")
        .setLabel("Type YES to accept")
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setPlaceholder("YES")
        .setRequired(true)
        .setMaxLength(3);
    modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(confirmation));
    await interaction.showModal(modal);
}
async function handleDeclineButton(interaction) {
    const [, guildId, teamRoleId, playerId] = interaction.customId.split(":");
    if (interaction.user.id !== playerId) {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("This offer isn't for you.")],
            ephemeral: true
        });
        return;
    }
    const guild = interaction.client.guilds.cache.get(guildId);
    const teamRole = guild?.roles.cache.get(teamRoleId);
    const thumbnail = teamRole && guild ? (0, teamembeds_js_1.getTeamThumbnail)(teamRole, guild) : null;
    await interaction.update({
        embeds: [
            (0, embeds_js_1.createStatusEmbed)({
                guild,
                color: 0xed4245,
                title: "Offer Declined",
                description: teamRole
                    ? `You declined the contract offer from ${teamRole}.`
                    : "You declined this contract offer."
            }).setThumbnail(thumbnail)
        ],
        components: []
    });
}
async function handleOfferModal(interaction) {
    const [, guildId, teamRoleId, playerId] = interaction.customId.split(":");
    if (interaction.user.id !== playerId) {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("This offer isn't for you.")],
            ephemeral: true
        });
        return;
    }
    const confirmation = interaction.fields.getTextInputValue("confirmation").trim().toUpperCase();
    if (confirmation !== "YES") {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("The contract wasn't accepted. Type `YES` to confirm.")],
            ephemeral: true
        });
        return;
    }
    const cachedGuild = interaction.client.guilds.cache.get(guildId);
    const guild = cachedGuild ?? (await interaction.client.guilds.fetch(guildId).catch(() => null));
    if (!guild) {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("I couldn't find the server this offer belongs to.")],
            ephemeral: true
        });
        return;
    }
    const data = (0, database_js_1.loadData)();
    const teams = data.teams ?? {};
    const teamData = teams[teamRoleId];
    if (!teamData) {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("That team no longer exists.")],
            ephemeral: true
        });
        return;
    }
    const teamRole = guild.roles.cache.get(teamRoleId);
    if (!teamRole) {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("The team's role could not be found.")],
            ephemeral: true
        });
        return;
    }
    const member = await guild.members.fetch(playerId).catch(() => null);
    if (!member) {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("You are no longer a member of this server.")],
            ephemeral: true
        });
        return;
    }
    if (!teamData.managerid) {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("This team is frozen until a new manager is appointed.")],
            ephemeral: true
        });
        return;
    }
    if ((0, teamstaff_js_1.findTeamAccess)(data, member.id)) {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("You now hold a manager or team staff position, so this player offer cannot be accepted.")],
            ephemeral: true
        });
        return;
    }
    const otherTeam = Object.keys(teams).find(roleId => roleId !== teamRoleId && member.roles.cache.has(roleId));
    if (otherTeam) {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("You are already on another team.")],
            ephemeral: true
        });
        return;
    }
    if (member.roles.cache.has(teamRoleId)) {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("You are already on this team.")],
            ephemeral: true
        });
        return;
    }
    const signingKey = `${guild.id}:${teamRole.id}`;
    if (activeSignings.has(signingKey)) {
        await interaction.reply({
            embeds: [(0, embeds_js_1.createErrorEmbed)("Another signing is being completed for this team. Try again in a moment.")],
            ephemeral: true
        });
        return;
    }
    activeSignings.add(signingKey);
    try {
        try {
            await guild.members.fetch();
        }
        catch (error) {
            console.error(error);
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("I could not load the current roster. Make sure Server Members Intent is enabled.")
                ],
                ephemeral: true
            });
            return;
        }
        if ((0, rosterutils_js_1.isRosterFull)(teamRole, teamData, (0, database_js_1.getRosterLimit)(data, guild.id))) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)(`${teamRole} has reached its roster limit.`)],
                ephemeral: true
            });
            return;
        }
        const botMember = guild.members.me;
        if (!botMember) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("I couldn't find my server member.")],
                ephemeral: true
            });
            return;
        }
        if (teamRole.position >= botMember.roles.highest.position) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)(`I can't give you ${teamRole} because that role is higher than my highest role.`)],
                ephemeral: true
            });
            return;
        }
        try {
            await member.roles.add(teamRole);
        }
        catch (error) {
            console.error(error);
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`I couldn't give you ${teamRole}. Make sure my bot role is above the team role and that I have Manage Roles permission.`)
                ],
                ephemeral: true
            });
            return;
        }
        const embed = (0, teamembeds_js_1.createTeamTransactionEmbed)({
            guild,
            teamRole,
            team: teamData,
            data,
            title: `Contract Accepted - ${teamRole.name}`,
            description: `> ${member} has accepted an offer to join ${(0, teamembeds_js_1.getTeamEmoji)(teamRole)} ${teamRole}.`,
            color: 0x57f287
        });
        await interaction.reply({ embeds: [embed], ephemeral: true });
        await (0, teamembeds_js_1.sendTransactionRecord)(guild, data, embed);
    }
    finally {
        activeSignings.delete(signingKey);
    }
}
