import {
    ChatInputCommandInteraction,
    Client,
    Guild,
    GuildMember,
    Role,
    SlashCommandBuilder
} from "discord.js";

import {
    Database,
    loadData,
    saveData
} from "./database.js";
import { createErrorEmbed, createStatusEmbed, createSuccessEmbed } from "./embeds.js";
import { canRunLeagueAdmin } from "./permissions.js";

import type { Command } from "../types.js";

function getManagedTeamRoles(
    data: Database,
    guild: Guild,
    userId: string
): Role[] {
    return Object.entries(data.teams)
        .filter(([, team]) => team.managerid === userId)
        .map(([roleId]) => guild.roles.cache.get(roleId))
        .filter((role): role is Role => Boolean(role));
}

export function isManagerInGuild(
    data: Database,
    guild: Guild,
    userId: string
): boolean {
    return getManagedTeamRoles(data, guild, userId).length > 0;
}

export function getConfiguredManagerRole(
    data: Database,
    guild: Guild
): Role | null {
    const roleId = data.settings.managerRoles[guild.id];
    return roleId ? guild.roles.cache.get(roleId) ?? null : null;
}

function ensureRoleCanBeAssigned(role: Role, label: string): void {
    if (!role.editable) {
        throw new Error(
            `I cannot assign the ${label}. Place my bot role above ${role} and make sure I have Manage Roles.`
        );
    }
}

export async function assignManagerRoles(
    member: GuildMember,
    teamRole: Role,
    data: Database,
    reason: string
): Promise<void> {
    const managerRole = getConfiguredManagerRole(data, member.guild);

    if (!managerRole) {
        throw new Error("Set a manager role first with `/managerrole`.");
    }

    if (!member.manageable) {
        throw new Error(
            `I cannot manage ${member}. Place my bot role above their highest role and try again.`
        );
    }

    ensureRoleCanBeAssigned(managerRole, "configured manager role");
    ensureRoleCanBeAssigned(teamRole, "team role");

    const missingRoles = [managerRole, teamRole].filter(
        role => !member.roles.cache.has(role.id)
    );

    if (missingRoles.length) {
        await member.roles.add(missingRoles, reason);
    }
}

export async function syncManagerMemberRoles(
    member: GuildMember,
    data: Database,
    reason: string
): Promise<number> {
    const teamRoles = getManagedTeamRoles(data, member.guild, member.id);
    if (!teamRoles.length) return 0;

    const managerRole = getConfiguredManagerRole(data, member.guild);
    if (!managerRole) return 0;

    if (!member.manageable) {
        throw new Error(`Cannot manage ${member.user.tag}.`);
    }

    ensureRoleCanBeAssigned(managerRole, "configured manager role");
    for (const teamRole of teamRoles) {
        ensureRoleCanBeAssigned(teamRole, "team role");
    }

    const missingRoles = [managerRole, ...teamRoles].filter(
        role => !member.roles.cache.has(role.id)
    );

    if (missingRoles.length) {
        await member.roles.add(missingRoles, reason);
    }

    return missingRoles.length;
}

export async function removeManagerRoleIfUnused(
    guild: Guild,
    userId: string,
    data: Database,
    reason: string
): Promise<boolean> {
    if (isManagerInGuild(data, guild, userId)) return true;

    const managerRole = getConfiguredManagerRole(data, guild);
    if (!managerRole) return true;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || !member.roles.cache.has(managerRole.id)) return true;
    if (!member.manageable || !managerRole.editable) return false;

    return member.roles.remove(managerRole, reason).then(
        () => true,
        error => {
            console.error(error);
            return false;
        }
    );
}

export async function removeFormerManagerRoles(
    guild: Guild,
    userId: string,
    teamRole: Role,
    data: Database,
    reason: string
): Promise<boolean> {
    const managerRoleRemoved = await removeManagerRoleIfUnused(
        guild,
        userId,
        data,
        reason
    );
    const member = await guild.members.fetch(userId).catch(() => null);

    if (!member || !member.roles.cache.has(teamRole.id)) {
        return managerRoleRemoved;
    }

    if (!member.manageable || !teamRole.editable) {
        return false;
    }

    const teamRoleRemoved = await member.roles.remove(teamRole, reason).then(
        () => true,
        error => {
            console.error(error);
            return false;
        }
    );

    return managerRoleRemoved && teamRoleRemoved;
}

export async function syncAllManagerRoles(client: Client): Promise<void> {
    const data = loadData();

    for (const guild of client.guilds.cache.values()) {
        if (!getConfiguredManagerRole(data, guild)) continue;

        const managerIds = new Set(
            Object.entries(data.teams)
                .filter(([roleId]) => guild.roles.cache.has(roleId))
                .map(([, team]) => team.managerid)
                .filter(Boolean)
        );

        for (const managerId of managerIds) {
            const member = await guild.members.fetch(managerId).catch(() => null);
            if (!member) continue;

            await syncManagerMemberRoles(
                member,
                data,
                "Restoring configured manager and team roles"
            ).catch(console.error);
        }
    }
}

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName("managerrole")
        .setDescription("Set the Discord role automatically assigned to team managers.")
        .addRoleOption(option =>
            option
                .setName("role")
                .setDescription("The shared manager role.")
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
                        "You do not have permission to configure the manager role.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        const selectedRole = interaction.options.getRole("role", true);
        const managerRole = interaction.guild.roles.cache.get(selectedRole.id);

        if (!managerRole || managerRole.id === interaction.guild.id) {
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

        if (data.teams[managerRole.id]) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        "A registered team role cannot also be the shared manager role.",
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        if (data.settings.assistantManagerRoles[interaction.guild.id] === managerRole.id) {
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

        if (!managerRole.editable) {
            await interaction.reply({
                embeds: [
                    createErrorEmbed(
                        `I cannot assign ${managerRole}. Place my bot role above it and grant Manage Roles.`,
                        interaction.guild
                    )
                ],
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        const previousRoleId = data.settings.managerRoles[interaction.guild.id];
        const previousRole = previousRoleId
            ? interaction.guild.roles.cache.get(previousRoleId)
            : null;

        data.settings.managerRoles[interaction.guild.id] = managerRole.id;
        saveData(data);

        const managerIds = new Set(
            Object.entries(data.teams)
                .filter(([roleId]) => interaction.guild?.roles.cache.has(roleId))
                .map(([, team]) => team.managerid)
                .filter(Boolean)
        );

        let synced = 0;
        let failed = 0;

        for (const managerId of managerIds) {
            const member = await interaction.guild.members.fetch(managerId).catch(() => null);
            if (!member) {
                failed += 1;
                continue;
            }

            try {
                await syncManagerMemberRoles(
                    member,
                    data,
                    `Manager role configured by ${interaction.user.tag}`
                );

                if (
                    previousRole &&
                    previousRole.id !== managerRole.id &&
                    member.roles.cache.has(previousRole.id)
                ) {
                    await member.roles.remove(
                        previousRole,
                        `Manager role changed by ${interaction.user.tag}`
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
                title: "Manager Role Saved with Warnings",
                description: `${managerRole} is now the shared manager role. Some existing managers could not be updated.`,
                color: 0xfee75c,
                fields: [
                    { name: "Managers Updated", value: String(synced), inline: true },
                    { name: "Needs Attention", value: String(failed), inline: true }
                ]
            })
            : createSuccessEmbed(
                interaction.guild,
                "Manager Role Set",
                `${managerRole} is now the shared manager role.`,
                [{ name: "Managers Updated", value: String(synced), inline: true }]
            );

        await interaction.editReply({ embeds: [embed] });
    }
};
