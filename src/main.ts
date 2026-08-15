import {
    Client,
    Collection,
    GatewayIntentBits,
    REST,
    Routes
} from "discord.js";

import type { Command } from "./types.js";

import * as offer from "./commands/offer.js";
import * as roster from "./commands/roster.js";
import * as teamcreate from "./commands/teamcreate.js";
import * as teamdisband from "./commands/teamdisband.js";
import * as teamlist from "./commands/teamlist.js";
import * as managerswap from "./commands/managerswap.js";
import * as logchannel from "./commands/logchannel.js";
import * as transactionchannel from "./commands/transactionchannel.js";
import * as release from "./commands/release.js";
import * as teamstaff from "./commands/teamstaff.js";
import * as teamswap from "./commands/teamswap.js";
import * as managerrole from "./commands/managerrole.js";
import * as assistantmanagerrole from "./commands/assistantmanagerrole.js";
import * as access from "./commands/access.js";
import * as limits from "./commands/limits.js";
import * as demand from "./commands/demand.js";
import { createErrorEmbed } from "./commands/embeds.js";
import { loadData } from "./commands/database.js";
import { sendStaffCommandLog } from "./commands/stafflog.js";

const token = "Savior put ur token for slbot";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const commands = new Collection<string, Command>();

const commandList: Command[] = [
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

client.on("interactionCreate", async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);

        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);

            const embed = createErrorEmbed(
                "Something went wrong while running that command.",
                interaction.guild
            );

            if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else if (!interaction.replied) {
                await interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                }).catch(() => {});
            }
        } finally {
            await sendStaffCommandLog(interaction).catch(console.error);
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

        } catch (error) {
            console.error(error);

            const embed = createErrorEmbed(
                "Something went wrong while handling that offer.",
                interaction.guild
            );

            if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else if (!interaction.replied) {
                await interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                }).catch(() => {});
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

        } catch (error) {
            console.error(error);

            const embed = createErrorEmbed(
                "Something went wrong while confirming that offer.",
                interaction.guild
            );

            if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else if (!interaction.replied) {
                await interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }
});

client.on("guildMemberUpdate", async (_oldMember, newMember) => {
    const database = loadData();

    await managerrole.syncManagerMemberRoles(
        newMember,
        database,
        "Restoring required manager and team roles"
    ).catch(console.error);

    await assistantmanagerrole.syncAssistantManagerMemberRoles(
        newMember,
        database,
        "Restoring required assistant manager and team roles"
    ).catch(console.error);
});

client.once("clientReady", async readyClient => {
    console.log(`${readyClient.user.tag} is online`);

    await managerrole.syncAllManagerRoles(readyClient);
    await assistantmanagerrole.syncAllAssistantManagerRoles(readyClient);

    const rest = new REST({ version: "10" }).setToken(token);

    await rest.put(
        Routes.applicationCommands(readyClient.user.id),
        {
            body: commands.map(command => command.data.toJSON())
        }
    );

    console.log("Commands loaded");
});

client.login(token);
