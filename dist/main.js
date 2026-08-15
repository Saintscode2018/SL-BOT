"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const offer = __importStar(require("./commands/offer.js"));
const roster = __importStar(require("./commands/roster.js"));
const teamcreate = __importStar(require("./commands/teamcreate.js"));
const teamdisband = __importStar(require("./commands/teamdisband.js"));
const teamlist = __importStar(require("./commands/teamlist.js"));
const managerswap = __importStar(require("./commands/managerswap.js"));
const logchannel = __importStar(require("./commands/logchannel.js"));
const transactionchannel = __importStar(require("./commands/transactionchannel.js"));
const release = __importStar(require("./commands/release.js"));
const teamstaff = __importStar(require("./commands/teamstaff.js"));
const teamswap = __importStar(require("./commands/teamswap.js"));
const managerrole = __importStar(require("./commands/managerrole.js"));
const assistantmanagerrole = __importStar(require("./commands/assistantmanagerrole.js"));
const access = __importStar(require("./commands/access.js"));
const limits = __importStar(require("./commands/limits.js"));
const demand = __importStar(require("./commands/demand.js"));
const embeds_js_1 = require("./commands/embeds.js");
const database_js_1 = require("./commands/database.js");
const stafflog_js_1 = require("./commands/stafflog.js");
const token = process.env.DISCORD_TOKEN;
if (!token) {
    throw new Error("DISCORD_TOKEN is required. Set it before starting the bot.");
}
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMembers
    ]
});
const commands = new discord_js_1.Collection();
const commandList = [
    offer.command,
    release.command,
    teamswap.command,
    roster.command,
    teamcreate.command,
    teamdisband.command,
    teamlist.command,
    managerswap.command,
    logchannel.command,
    transactionchannel.command,
    managerrole.command,
    assistantmanagerrole.command,
    teamstaff.setCandidateRoleCommand,
    teamstaff.fofillCommand,
    teamstaff.promoteCommand,
    teamstaff.demoteCommand,
    access.whitelistCommand,
    access.echoCommand,
    limits.rosterLimitCommand,
    demand.command,
    demand.demandLimitCommand,
    demand.demandResetCommand,
];
for (const command of commandList) {
    commands.set(command.data.name, command);
}
client.on("interactionCreate", async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (!command)
            return;
        try {
            await command.execute(interaction);
        }
        catch (error) {
            console.error(error);
            const embed = (0, embeds_js_1.createErrorEmbed)("Something went wrong while running that command.", interaction.guild);
            if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ embeds: [embed] }).catch(() => { });
            }
            else if (!interaction.replied) {
                await interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                }).catch(() => { });
            }
        }
        finally {
            await (0, stafflog_js_1.sendStaffCommandLog)(interaction).catch(console.error);
        }
        return;
    }
    if (interaction.isButton()) {
        try {
            if (interaction.customId.startsWith("offer_accept:")) {
                await offer.handleAcceptButton(interaction);
                return;
            }
            if (interaction.customId.startsWith("offer_decline:")) {
                await offer.handleDeclineButton(interaction);
                return;
            }
        }
        catch (error) {
            console.error(error);
            const embed = (0, embeds_js_1.createErrorEmbed)("Something went wrong while handling that offer.", interaction.guild);
            if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ embeds: [embed] }).catch(() => { });
            }
            else if (!interaction.replied) {
                await interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                }).catch(() => { });
            }
        }
        return;
    }
    if (interaction.isModalSubmit()) {
        try {
            if (interaction.customId.startsWith("offer_confirm:")) {
                await offer.handleOfferModal(interaction);
                return;
            }
        }
        catch (error) {
            console.error(error);
            const embed = (0, embeds_js_1.createErrorEmbed)("Something went wrong while confirming that offer.", interaction.guild);
            if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ embeds: [embed] }).catch(() => { });
            }
            else if (!interaction.replied) {
                await interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                }).catch(() => { });
            }
        }
    }
});
client.on("guildMemberUpdate", async (_oldMember, newMember) => {
    const database = (0, database_js_1.loadData)();
    await managerrole.syncManagerMemberRoles(newMember, database, "Restoring required manager and team roles").catch(console.error);
    await assistantmanagerrole.syncAssistantManagerMemberRoles(newMember, database, "Restoring required assistant manager and team roles").catch(console.error);
});
client.once("clientReady", async (readyClient) => {
    console.log(`${readyClient.user.tag} is online`);
    await managerrole.syncAllManagerRoles(readyClient);
    await assistantmanagerrole.syncAllAssistantManagerRoles(readyClient);
    const rest = new discord_js_1.REST({ version: "10" }).setToken(token);
    await rest.put(discord_js_1.Routes.applicationCommands(readyClient.user.id), {
        body: commands.map(command => command.data.toJSON())
    });
    console.log("Commands loaded");
});
client.login(token);
