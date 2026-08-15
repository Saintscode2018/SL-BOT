"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.demoteCommand = exports.promoteCommand = exports.fofillCommand = exports.setCandidateRoleCommand = void 0;
exports.findTeamAccess = findTeamAccess;
exports.isTeamStaffMember = isTeamStaffMember;
exports.canPromote = canPromote;
exports.canDemote = canDemote;
const crypto_1 = require("crypto");
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const embeds_js_1 = require("./embeds.js");
const managerrole_js_1 = require("./managerrole.js");
const assistantmanagerrole_js_1 = require("./assistantmanagerrole.js");
const teamembeds_js_1 = require("./teamembeds.js");
const permissions_js_1 = require("./permissions.js");
const rosterutils_js_1 = require("./rosterutils.js");
const POSITION_LABELS = {
    assistant_manager: "Assistant Manager",
    captain: "Captain",
    coach: "Coach"
};
function positionOptions(builder) {
    return builder.addStringOption(option => option
        .setName("position")
        .setDescription("The team staff position.")
        .setRequired(true)
        .addChoices({ name: "Assistant Manager", value: "assistant_manager" }, { name: "Captain", value: "captain" }, { name: "Coach", value: "coach" }));
}
function getPosition(interaction) {
    return interaction.options.getString("position", true);
}
function findExistingLeadershipRole(data, userId) {
    for (const [teamRoleId, team] of Object.entries(data.teams)) {
        if (team.managerid === userId) {
            return { teamRoleId, label: "Manager" };
        }
        for (const [position, staffId] of Object.entries(team.staff)) {
            if (staffId === userId) {
                return {
                    teamRoleId,
                    label: POSITION_LABELS[position]
                };
            }
        }
    }
    return null;
}
function findTeamAccess(data, userId) {
    for (const [teamRoleId, team] of Object.entries(data.teams)) {
        if (team.managerid === userId) {
            return { teamRoleId, team, authority: "manager" };
        }
        for (const [position, staffId] of Object.entries(team.staff)) {
            if (staffId === userId) {
                return {
                    teamRoleId,
                    team,
                    authority: position
                };
            }
        }
    }
    return null;
}
function isTeamStaffMember(team, userId) {
    return Object.values(team.staff).includes(userId);
}
function canPromote(authority, position) {
    return authority === "manager" ||
        (authority === "assistant_manager" && position !== "assistant_manager");
}
function canDemote(authority) {
    return authority === "manager";
}
async function sendTransactionLog(interaction, embed) {
    if (!interaction.guild)
        return;
    const data = (0, database_js_1.loadData)();
    await (0, teamembeds_js_1.sendTransactionRecord)(interaction.guild, data, embed);
}
exports.setCandidateRoleCommand = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("setcandidaterole")
        .setDescription("Set the role used as the manager lottery pool.")
        .addRoleOption(option => option
        .setName("role")
        .setDescription("Members of this role can be selected as managers.")
        .setRequired(true)),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }
        const data = (0, database_js_1.loadData)();
        if (!(0, permissions_js_1.canRunLeagueAdmin)(interaction, data)) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("You do not have permission to set the candidate role.")],
                ephemeral: true
            });
            return;
        }
        const selectedRole = interaction.options.getRole("role", true);
        const role = interaction.guild.roles.cache.get(selectedRole.id);
        if (!role || role.id === interaction.guild.id) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("The @everyone role cannot be used as the candidate pool.")],
                ephemeral: true
            });
            return;
        }
        if ((0, managerrole_js_1.getConfiguredManagerRole)(data, interaction.guild)?.id === role.id) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("The candidate and manager roles must be different.")],
                ephemeral: true
            });
            return;
        }
        if (!role.editable) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`I cannot remove ${role} after a manager is selected. Place my bot role above it and try again.`)
                ],
                ephemeral: true
            });
            return;
        }
        data.settings.candidateRoles[interaction.guild.id] = role.id;
        (0, database_js_1.saveData)(data);
        const embed = (0, embeds_js_1.createSuccessEmbed)(interaction.guild, "Candidate Role Set", `${role} is now the manager lottery pool for this server.`);
        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
    }
};
exports.fofillCommand = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("fofill")
        .setDescription("Randomly select a manager for a team from the candidate role.")
        .addRoleOption(option => option
        .setName("team")
        .setDescription("The team whose manager will be selected.")
        .setRequired(true)),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }
        const data = (0, database_js_1.loadData)();
        if (!(0, permissions_js_1.canRunLeagueAdmin)(interaction, data)) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("You do not have permission to run the manager lottery.")],
                ephemeral: true
            });
            return;
        }
        await interaction.deferReply({ ephemeral: true });
        const selectedTeamRole = interaction.options.getRole("team", true);
        const teamRole = interaction.guild.roles.cache.get(selectedTeamRole.id);
        if (!teamRole) {
            await interaction.editReply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("That team role could not be found in this server.")]
            });
            return;
        }
        const team = data.teams[teamRole.id];
        if (!team) {
            await interaction.editReply({
                embeds: [(0, embeds_js_1.createErrorEmbed)(`${teamRole} is not a registered team.`)]
            });
            return;
        }
        const managerRole = (0, managerrole_js_1.getConfiguredManagerRole)(data, interaction.guild);
        if (!managerRole) {
            await interaction.editReply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("Set a manager role first with `/managerrole`.")]
            });
            return;
        }
        const candidateRoleId = data.settings.candidateRoles[interaction.guild.id];
        if (!candidateRoleId) {
            await interaction.editReply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("Set a candidate role first with `/setcandidaterole`.")]
            });
            return;
        }
        try {
            await interaction.guild.members.fetch();
        }
        catch (error) {
            console.error(error);
            await interaction.editReply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("I could not load the full candidate list. Enable Server Members Intent for the bot and try again.")
                ]
            });
            return;
        }
        const candidateRole = interaction.guild.roles.cache.get(candidateRoleId);
        if (!candidateRole) {
            await interaction.editReply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("The saved candidate role no longer exists. Run `/setcandidaterole` again.")]
            });
            return;
        }
        if (candidateRole.id === teamRole.id) {
            await interaction.editReply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("The candidate role and team role are the same. Set a dedicated candidate role first.")
                ]
            });
            return;
        }
        if (candidateRole.id === managerRole.id) {
            await interaction.editReply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("The candidate role and manager role must be different.")
                ]
            });
            return;
        }
        if (!candidateRole.editable) {
            await interaction.editReply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`I cannot remove ${candidateRole} from the selected candidate. Place my bot role above it and try again.`)
                ]
            });
            return;
        }
        const eligible = candidateRole.members.filter(member => !member.user.bot &&
            member.manageable &&
            !Object.keys(data.teams).some(roleId => roleId !== teamRole.id && member.roles.cache.has(roleId)) &&
            !findExistingLeadershipRole(data, member.id));
        if (!eligible.size) {
            await interaction.editReply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`${candidateRole} has no eligible candidates. Bots, existing leadership, players from other teams, and members above my bot role are excluded.`)
                ]
            });
            return;
        }
        const candidates = [...eligible.values()];
        const winner = candidates[(0, crypto_1.randomInt)(candidates.length)];
        const previousManagerId = team.managerid;
        const hadTeamRole = winner.roles.cache.has(teamRole.id);
        const hadManagerRole = winner.roles.cache.has(managerRole.id);
        try {
            await (0, managerrole_js_1.assignManagerRoles)(winner, teamRole, data, `Selected by ${interaction.user.tag} in /fofill`);
            await winner.roles.remove(candidateRole, `Appointed manager by ${interaction.user.tag}`);
        }
        catch (error) {
            const rolesToRemove = [];
            if (!hadTeamRole)
                rolesToRemove.push(teamRole);
            if (!hadManagerRole)
                rolesToRemove.push(managerRole);
            if (rolesToRemove.length) {
                await winner.roles.remove(rolesToRemove, "Restoring roles after an incomplete manager appointment").catch(console.error);
            }
            const message = error instanceof Error
                ? error.message
                : "I could not complete the manager appointment.";
            await interaction.editReply({ embeds: [(0, embeds_js_1.createErrorEmbed)(message)] });
            return;
        }
        team.managerid = winner.id;
        (0, database_js_1.saveData)(data);
        const oldRoleRemoved = previousManagerId
            ? await (0, managerrole_js_1.removeFormerManagerRoles)(interaction.guild, previousManagerId, teamRole, data, `Replaced by /fofill run by ${interaction.user.tag}`)
            : true;
        const appointmentEmbed = (0, embeds_js_1.createStatusEmbed)({
            guild: interaction.guild,
            title: "Team Manager Appointment",
            description: `You’ve been appointed Team Manager of **${teamRole.name}**!`,
            color: teamRole.color || 0x5865f2
        }).setThumbnail((0, teamembeds_js_1.getTeamThumbnail)(teamRole, interaction.guild));
        const notified = await winner.send({ embeds: [appointmentEmbed] }).then(() => true, error => {
            console.error(error);
            return false;
        });
        const description = !notified
            ? "The appointment is complete, but I could not send the candidate a direct message."
            : !oldRoleRemoved
                ? "The candidate has been notified, but the previous manager's roles need manual removal."
                : "The appointment is complete and the candidate has been notified.";
        const resultEmbed = (0, embeds_js_1.createStatusEmbed)({
            guild: interaction.guild,
            title: oldRoleRemoved && notified
                ? "Manager Appointment Complete"
                : "Manager Appointment Complete with a Warning",
            description,
            fields: [
                { name: "Team", value: `${teamRole}`, inline: true },
                { name: "Eligible Candidates", value: String(candidates.length), inline: true }
            ],
            color: oldRoleRemoved && notified ? 0x57f287 : 0xfee75c
        });
        resultEmbed.setThumbnail((0, teamembeds_js_1.getTeamThumbnail)(teamRole, interaction.guild));
        await interaction.editReply({ embeds: [resultEmbed] });
    }
};
exports.promoteCommand = {
    data: positionOptions(new discord_js_1.SlashCommandBuilder()
        .setName("promote")
        .setDescription("Promote a member of your team to a staff position.")).addUserOption(option => option
        .setName("member")
        .setDescription("The team member to promote.")
        .setRequired(true)),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }
        const data = (0, database_js_1.loadData)();
        const access = findTeamAccess(data, interaction.user.id);
        const position = getPosition(interaction);
        if (!access || !canPromote(access.authority, position)) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(position === "assistant_manager"
                        ? "Only the team manager can appoint an assistant manager."
                        : "Only a team manager or assistant manager can promote staff.")
                ],
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
        const selectedMember = interaction.options.getUser("member", true);
        const member = await interaction.guild.members.fetch(selectedMember.id).catch(() => null);
        if (!member) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("That member could not be found in this server.")],
                ephemeral: true
            });
            return;
        }
        const teamRole = interaction.guild.roles.cache.get(access.teamRoleId);
        if (!teamRole) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("Your team's Discord role no longer exists.")],
                ephemeral: true
            });
            return;
        }
        if (member.user.bot) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("Bots cannot hold team staff positions.")],
                ephemeral: true
            });
            return;
        }
        if (access.authority === "assistant_manager" && member.id === interaction.user.id) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("Assistant managers cannot promote themselves.")],
                ephemeral: true
            });
            return;
        }
        const otherTeamId = Object.keys(data.teams).find(roleId => roleId !== teamRole.id && member.roles.cache.has(roleId));
        if (otherTeamId) {
            const otherTeam = interaction.guild.roles.cache.get(otherTeamId);
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`${member} is already on ${otherTeam ?? "another registered team"}.`)
                ],
                ephemeral: true
            });
            return;
        }
        const existingRole = findExistingLeadershipRole(data, member.id);
        if (existingRole) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`${member} is already a ${existingRole.label}. Demote them from that position first.`)
                ],
                ephemeral: true
            });
            return;
        }
        const currentHolderId = access.team.staff[position];
        if (currentHolderId) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`${POSITION_LABELS[position]} is already held by <@${currentHolderId}>. Demote them first.`)
                ],
                ephemeral: true
            });
            return;
        }
        try {
            if (position === "assistant_manager") {
                await (0, assistantmanagerrole_js_1.assignAssistantManagerRoles)(member, teamRole, data, `Promoted by ${interaction.user.tag}`);
            }
            else if (!member.roles.cache.has(teamRole.id)) {
                if (!member.manageable || !teamRole.editable) {
                    await interaction.reply({
                        embeds: [
                            (0, embeds_js_1.createErrorEmbed)(`I cannot add ${teamRole} to ${member}. Check my Manage Roles permission and role order.`)
                        ],
                        ephemeral: true
                    });
                    return;
                }
                await member.roles.add(teamRole, `Promoted by ${interaction.user.tag}`);
            }
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message
                : "I could not assign the required roles.";
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)(message)],
                ephemeral: true
            });
            return;
        }
        access.team.staff[position] = member.id;
        (0, database_js_1.saveData)(data);
        const embed = (0, embeds_js_1.createSuccessEmbed)(interaction.guild, "🎖️ Team Staff Promotion", `${member} has been promoted to **${POSITION_LABELS[position]}** for ${teamRole}.`, [{ name: "Promoted By", value: `${interaction.user}`, inline: true }]).setThumbnail((0, teamembeds_js_1.getTeamThumbnail)(teamRole, interaction.guild));
        await interaction.reply({ embeds: [embed], ephemeral: true });
        await sendTransactionLog(interaction, embed);
    }
};
exports.demoteCommand = {
    data: positionOptions(new discord_js_1.SlashCommandBuilder()
        .setName("demote")
        .setDescription("Remove a member from a team staff position.")).addUserOption(option => option
        .setName("member")
        .setDescription("The team staff member to demote.")
        .setRequired(true)),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }
        const data = (0, database_js_1.loadData)();
        const access = findTeamAccess(data, interaction.user.id);
        if (!access || !canDemote(access.authority)) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("Only the team manager can demote team staff.")],
                ephemeral: true
            });
            return;
        }
        const position = getPosition(interaction);
        const member = interaction.options.getUser("member", true);
        const currentHolderId = access.team.staff[position];
        if (currentHolderId !== member.id) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)(`${member} is not your team's ${POSITION_LABELS[position]}.`)],
                ephemeral: true
            });
            return;
        }
        const teamRole = interaction.guild.roles.cache.get(access.teamRoleId);
        if (teamRole) {
            await interaction.guild.members.fetch().catch(() => null);
            const staffMember = teamRole.members.get(member.id);
            const rosterSize = (0, rosterutils_js_1.getRosterPlayers)(teamRole, access.team).length;
            if (staffMember &&
                rosterSize >= (0, database_js_1.getRosterLimit)(data, interaction.guild.id)) {
                await interaction.reply({
                    embeds: [
                        (0, embeds_js_1.createErrorEmbed)(`${teamRole} is at its roster limit. Release a player before moving this staff member back to the playing roster.`)
                    ],
                    ephemeral: true
                });
                return;
            }
        }
        access.team.staff[position] = null;
        (0, database_js_1.saveData)(data);
        const roleRemoved = position === "assistant_manager"
            ? await (0, assistantmanagerrole_js_1.removeAssistantManagerRoleIfUnused)(interaction.guild, member.id, data, `Demoted by ${interaction.user.tag}`)
            : true;
        const description = roleRemoved
            ? `${member} has been removed as **${POSITION_LABELS[position]}** for ${teamRole ?? "the team"}.`
            : `${member} was demoted, but the assistant manager role needs manual removal.`;
        const embed = (0, embeds_js_1.createStatusEmbed)({
            guild: interaction.guild,
            title: roleRemoved ? "Team Staff Demotion" : "Demotion Completed with a Warning",
            description,
            fields: [{ name: "Demoted By", value: `${interaction.user}`, inline: true }],
            color: roleRemoved ? 0xed4245 : 0xfee75c
        });
        if (teamRole) {
            embed.setThumbnail((0, teamembeds_js_1.getTeamThumbnail)(teamRole, interaction.guild));
        }
        await interaction.reply({ embeds: [embed], ephemeral: true });
        await sendTransactionLog(interaction, embed);
    }
};
