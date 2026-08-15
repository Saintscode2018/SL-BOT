"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const embeds_js_1 = require("./embeds.js");
const assistantmanagerrole_js_1 = require("./assistantmanagerrole.js");
const managerrole_js_1 = require("./managerrole.js");
const teamembeds_js_1 = require("./teamembeds.js");
const permissions_js_1 = require("./permissions.js");
exports.command = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("teamdisband")
        .setDescription("Disband a registered team.")
        .addRoleOption(option => option
        .setName("team")
        .setDescription("The registered team to disband.")
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
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("You do not have permission to disband teams.", interaction.guild)
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
                    (0, embeds_js_1.createErrorEmbed)("The selected role is not a registered team.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const previousManagerId = team.managerid;
        const previousAssistantId = team.staff.assistant_manager;
        delete data.teams[teamRole.id];
        (0, database_js_1.saveData)(data);
        const managerRoleRemoved = await (0, managerrole_js_1.removeManagerRoleIfUnused)(interaction.guild, previousManagerId, data, `Team disbanded by ${interaction.user.tag}`);
        const assistantRoleRemoved = previousAssistantId
            ? await (0, assistantmanagerrole_js_1.removeAssistantManagerRoleIfUnused)(interaction.guild, previousAssistantId, data, `Team disbanded by ${interaction.user.tag}`)
            : true;
        const rolesRemoved = managerRoleRemoved && assistantRoleRemoved;
        const description = rolesRemoved
            ? `${teamRole} has been disbanded.`
            : `${teamRole} has been disbanded, but a former leadership role needs manual removal.`;
        const embed = rolesRemoved
            ? (0, embeds_js_1.createSuccessEmbed)(interaction.guild, "Team Disbanded", description, [{ name: "Disbanded By", value: `${interaction.user}`, inline: true }])
            : (0, embeds_js_1.createStatusEmbed)({
                guild: interaction.guild,
                title: "Team Disbanded with a Warning",
                description,
                fields: [{ name: "Disbanded By", value: `${interaction.user}`, inline: true }],
                color: 0xfee75c
            });
        embed.setThumbnail((0, teamembeds_js_1.getTeamThumbnail)(teamRole, interaction.guild));
        await interaction.reply({ embeds: [embed], ephemeral: true });
        await (0, teamembeds_js_1.sendTransactionRecord)(interaction.guild, data, embed);
    }
};
