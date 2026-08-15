"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const embeds_js_1 = require("./embeds.js");
const teamembeds_js_1 = require("./teamembeds.js");
const rosterutils_js_1 = require("./rosterutils.js");
function buildPlayerFields(players, count, limit) {
    if (!players.length) {
        return [{
                name: `Players (${count}/${limit})`,
                value: "No players are currently registered to this team."
            }];
    }
    const groups = [];
    let current = "";
    for (const player of players) {
        const next = current ? `${current}\n${player}` : player;
        if (next.length > 1024) {
            groups.push(current);
            current = player;
        }
        else {
            current = next;
        }
    }
    if (current)
        groups.push(current);
    return groups.map((value, index) => ({
        name: index === 0
            ? `Players (${count}/${limit})`
            : "Players Continued",
        value
    }));
}
exports.command = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("roster")
        .setDescription("View a team's current roster.")
        .addRoleOption(option => option
        .setName("team")
        .setDescription("The team to view.")
        .setRequired(true)),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }
        const selectedRole = interaction.options.getRole("team", true);
        const teamRole = interaction.guild.roles.cache.get(selectedRole.id);
        const data = (0, database_js_1.loadData)();
        const team = data.teams[selectedRole.id];
        if (!teamRole || !team) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("The selected role is not a registered team.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        await interaction.deferReply({ ephemeral: true });
        try {
            await interaction.guild.members.fetch();
        }
        catch (error) {
            console.error(error);
            await interaction.editReply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("I could not load the server member list. Make sure Server Members Intent is enabled.", interaction.guild)
                ]
            });
            return;
        }
        const players = (0, rosterutils_js_1.getRosterPlayers)(teamRole, team);
        const rosterLimit = (0, database_js_1.getRosterLimit)(data, interaction.guild.id);
        const playerFields = buildPlayerFields(players.map(member => `${member}`), players.length, rosterLimit);
        const embed = (0, embeds_js_1.createStatusEmbed)({
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
        }).setThumbnail((0, teamembeds_js_1.getTeamThumbnail)(teamRole, interaction.guild));
        await interaction.editReply({ embeds: [embed] });
    }
};
