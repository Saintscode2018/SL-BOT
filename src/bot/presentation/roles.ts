import { formatTeamIdentity, type TeamIdentitySource } from '../../domain/team-label.js';

export interface TeamIdentityPresentationSource {
  emoji: string;
  discordRoleId: string;
  discordRoleName?: string | null | undefined;
}

function toDomainSource(team: TeamIdentityPresentationSource): TeamIdentitySource {
  return {
    emoji: team.emoji,
    discordRoleId: team.discordRoleId,
    discordRoleName: team.discordRoleName ?? null,
  };
}

export function formatTeamMessageIdentity(team: TeamIdentityPresentationSource): string {
  return formatTeamIdentity(toDomainSource(team), 'message');
}

export function formatTeamReadableTitle(team: TeamIdentityPresentationSource): string {
  return formatTeamIdentity(toDomainSource(team), 'title');
}

export function formatTeamPlainRoleName(team: TeamIdentityPresentationSource): string {
  const roleName = team.discordRoleName?.trim().replace(/^@+/u, '');
  return roleName || 'Team';
}

export function formatTeamFooterIdentity(team: TeamIdentityPresentationSource): string {
  return formatTeamIdentity(toDomainSource(team), 'footer');
}

export function formatTeamAutocompleteIdentity(team: TeamIdentityPresentationSource): string {
  return formatTeamIdentity(toDomainSource(team), 'autocomplete');
}
