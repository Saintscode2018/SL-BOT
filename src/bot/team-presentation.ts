import type { TeamIdentitySource } from '../domain/team-label.js';
import { resolveTeamRoleColor } from './presentation/colors.js';
import type { CommandInteraction, GuildRoleMetadata } from './types.js';

export { resolveTeamRoleColor };

export interface ResolvedTeamPresentation<T extends TeamIdentitySource> {
  team: T & { discordRoleName: string | null };
  role: GuildRoleMetadata | null;
}

export async function resolveTeamPresentation<T extends TeamIdentitySource>(
  interaction: Pick<CommandInteraction, 'getGuildRoleMetadata' | 'resolveGuildRoleMetadata'>,
  team: T,
): Promise<ResolvedTeamPresentation<T>> {
  let role: GuildRoleMetadata | null;
  try {
    role = (await interaction.resolveGuildRoleMetadata?.(team.discordRoleId)) ?? null;
  } catch {
    role = null;
  }
  if (role === null) {
    role = interaction.getGuildRoleMetadata?.(team.discordRoleId) ?? null;
  }
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
