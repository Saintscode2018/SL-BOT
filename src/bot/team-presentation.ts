import type { TeamIdentitySource } from '../domain/team-label.js';
import type { CommandInteraction, GuildRoleMetadata } from './types.js';

export interface ResolvedTeamPresentation<T extends TeamIdentitySource> {
  team: T & { discordRoleName: string | null };
  role: GuildRoleMetadata | null;
}

export function resolveTeamPresentation<T extends TeamIdentitySource>(
  interaction: Pick<CommandInteraction, 'getGuildRoleMetadata'>,
  team: T,
): ResolvedTeamPresentation<T> {
  const role = interaction.getGuildRoleMetadata?.(team.discordRoleId) ?? null;
  return {
    team: { ...team, discordRoleName: role?.name ?? null },
    role,
  };
}

export function getTeamEmbedColor(
  presentation: Pick<ResolvedTeamPresentation<TeamIdentitySource>, 'role'>,
  fallbackColor: number,
): number {
  return resolveTeamRoleColor(presentation.role?.color, fallbackColor);
}

export function resolveTeamRoleColor(
  roleColor: number | null | undefined,
  fallbackColor: number,
): number {
  return roleColor === undefined || roleColor === null || roleColor === 0
    ? fallbackColor
    : roleColor;
}
