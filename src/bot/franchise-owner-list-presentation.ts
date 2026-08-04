import type { TeamIdentitySource } from '../domain/team-label.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import { BOT_LABELS, formatUserWithVisibleName } from './presentation/index.js';

export function formatFranchiseOwnerListLine(
  team: TeamIdentitySource,
  managerUserId: string | null,
  managerDisplayName: string | null,
): string {
  const managerText =
    managerUserId !== null && managerDisplayName !== null
      ? formatUserWithVisibleName(managerUserId, managerDisplayName)
      : BOT_LABELS.vacant;

  return `${formatTeamIdentity(team, 'message')} ${BOT_LABELS.teamManager}: ${managerText}`;
}
