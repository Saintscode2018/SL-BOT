import {
    ChatInputCommandInteraction,
    Client,
    Guild,
    GuildMember,
    Role,
    SlashCommandBuilder
} from "discord.js";

import { Database, loadData, saveData } from "./database.js";
import { createErrorEmbed, createStatusEmbed, createSuccessEmbed } from "./embeds.js";
import { getConfiguredManagerRole } from "./managerrole.js";
import { canRunLeagueAdmin } from "./permissions.js";

import type { Command } from "../types.js";

function getAssistantTeamRoles(
    data: Database,
    guild: Guild,
    userId: string
): Role[] {
    return Object.entries(data.teams)
        .filter(([, team]) => team.staff.assistant_manager === userId)
        .map(([roleId]) => guild.roles.cache.get(roleId))
        .filter((role): role is Role => Boolean(role));
}

export function isAssistantManagerInGuild(
    data: Database,
    guild: Guild,
    userId: string
): boolean {
    return getAssistantTeamRoles(data, guild, userId).length > 0;
}

export function getConfiguredAssistantManagerRole(
    data: Database,
    guild: Guild
): Role | null {
    const roleId = data.settings.assistantManagerRoles[guild.id];
    return roleId ? guild.roles.cache.get(roleId) ?? null : null;
}

function ensureRoleCanBeAssigned(role: Role, label: string): void {
    if (!role.editable) {
        throw new Error(
            `I cannot assign the ${label}. Place my bot role above ${role} and make sure I have Manage Roles.`
        );
    }
}

export async function assignAssistantManagerRoles(
    member: GuildMember,
    teamRole: Role,
    data: Database,
    reason: string
): Promise<void> {
    const assistantRole = getConfiguredAssistantManagerRole(data, member.guild);

    if (!assistantRole) {
        throw new Error(
            "Set an assistant manager role first with `/assistantmanagerrole`."
        );
    }

    if (!member.manageable) {
        throw new Error(
            `I cannot manage ${member}. Place my bot role above their highest role and try again.`
        );
    }

    ensureRoleCanBeAssigned(assistantRole, "configured assistant manager role");
    ensureRoleCanBeAssigned(teamRole, "team role");

    const missingRoles = [assistantRole, teamRole].filter(
        role => !member.roles.cache.has(role.id)
    );

    if (missingRoles.length) {
        await member.roles.add(missingRoles, reason);
    }
}

export async function syncAssistantManagerMemberRoles(
    member: GuildMember,
    data: Database,
    reason: string
): Promise<number> {
    const teamRoles = getAssistantTeamRoles(data, member.guild, member.id);
    if (!teamRoles.length) return 0;

    const assistantRole = getConfiguredAssistantManagerRole(data, member.guild);
    if (!assistantRole) return 0;

    if (!member.manageable) {
        throw new Error(`Cannot manage ${member.user.tag}.`);
    }

    ensureRoleCanBeAssigned(assistantRole, "configured assistant manager role");
    for (const teamRole of teamRoles) {
        ensureRoleCanBeAssigned(teamRole, "team role");
    }

    const missingRoles = [assistantRole, ...teamRoles].filter(
        role => !member.roles.cache.has(role.id)
    );

    if (missingRoles.length) {
        await member.roles.add(missingRoles, reason);
    }

    return missingRoles.length;
}

export async function removeAssistantManagerRoleIfUnused(
    guild: Guild,
    userId: string,
    data: Database,
    reason: string
): Promise<boolean> {
    if (isAssistantManagerInGuild(data, guild, userId)) return true;

    const assistantRole = getConfiguredAssistantManagerRole(data, guild);
    if (!assistantRole) return true;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || !member.roles.cache.has(assistantRole.id)) return true;
    if (!member.manageable || !assistantRole.editable) return false;

    return member.roles.remove(assistantRole, reason).then(
        () => true,
        error => {
            console.error(error);
            return false;
        }
    );
}

export async function syncAllAssistantManagerRoles(client: Client): Promise<void> {
    const data = loadData();

    for (const guild of client.guilds.cache.values()) {
        if (!getConfiguredAssistantManagerRole(data, guild)) continue;

        const assistantIds = new Set(
            Object.entries(data.teams)
                .filter(([roleId]) => guild.roles.cache.has(roleId))
                .map(([, team]) => team.staff.assistant_manager)
                .filter((id): id is string => Boolean(id))
        );

        for (const assistantId of assistantIds) {
            const member = await guild.members.fetch(assistantId).catch(() => null);
            if (!member) continue;

            await syncAssistantManagerMemberRoles(
                member,
                data,
                "Restoring configured assistant manager and team roles"
            ).catch(console.error);
        }
    }
}

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName("assistantmanagerrole")
        .setDescription("Set the Discord role assigned to assistant managers.")
        .addRoleOption(option =>
            option
                .setName("role")
                .setDescription("The shared assistant manager role.")
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
                        "You do not have permission to configure the assistant manager role.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const selectedRole = interaction.options.getRole("role", true);
        const assistantRole = interaction.guild.roles.cache.get(selectedRole.id);

        if (!assistantRole || assistantRole.id === interaction.guild.id) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "Choose a normal Discord role instead of @everyone.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (data.teams[assistantRole.id]) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "A registered team role cannot also be the assistant manager role.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (getConfiguredManagerRole(data, interaction.guild)?.id === assistantRole.id) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "The manager and assistant manager roles must be different.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (!assistantRole.editable) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        `I cannot assign ${assistantRole}. Place my bot role above it and grant Manage Roles.`,
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        const previousRoleId = data.settings.assistantManagerRoles[interaction.guild.id];
        const previousRole = previousRoleId
            ? interaction.guild.roles.cache.get(previousRoleId)
            : null;

        data.settings.assistantManagerRoles[interaction.guild.id] = assistantRole.id;
        saveData(data);

        const assistantIds = new Set(
            Object.entries(data.teams)
                .filter(([roleId]) => interaction.guild?.roles.cache.has(roleId))
                .map(([, team]) => team.staff.assistant_manager)
                .filter((id): id is string => Boolean(id))
        );

        let synced = 0;
        let failed = 0;

        for (const assistantId of assistantIds) {
            const member = await interaction.guild.members.fetch(assistantId).catch(() => null);
            if (!member) {
                failed += 1;
                continue;
            }

            try {
                await syncAssistantManagerMemberRoles(
                    member,
                    data,
                    `Assistant manager role configured by ${interaction.user.tag}`
                );

                if (
                    previousRole &&
                    previousRole.id !== assistantRole.id &&
                    member.roles.cache.has(previousRole.id)
                ) {
                    await member.roles.remove(
                        previousRole,
                        `Assistant manager role changed by ${interaction.user.tag}`
                    );
                }

                synced += 1;
            } catch (error) {
                console.error(error);
                failed += 1;
            }
        }

        const embed = failed
            ? createStatusEmbed({
                guild: interaction.guild,
                title: "Assistant Manager Role Saved with Warnings",
                description: `${assistantRole} is now the assistant manager role. Some existing assistants could not be updated.`,
                color: 0xfee75c,
                fields: [
                    { name: "Assistants Updated", value: String(synced), inline: true },
                    { name: "Needs Attention", value: String(failed), inline: true }
                ]
            })
            : createSuccessEmbed(
                interaction.guild,
                "Assistant Manager Role Set",
                `${assistantRole} is now the shared assistant manager role.`,
                [{ name: "Assistants Updated", value: String(synced), inline: true }]
            );

        await interaction.editReply({ embeds: [embed] });
    }
};
