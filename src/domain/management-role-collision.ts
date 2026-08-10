import { ConfigurationError } from './errors.js';

export interface ManagementRoleIds {
  teamManagerRoleId: string | null;
  assistantManagerRoleId: string | null;
  playerManagerRoleId: string | null;
}

export function assertNoManagementTeamRoleCollision(
  managementRoleIds: ManagementRoleIds,
  teamRoleIds: Iterable<string>,
): void {
  const activeTeamRoleIds = new Set(teamRoleIds);
  const collidingRoleId = [
    managementRoleIds.teamManagerRoleId,
    managementRoleIds.assistantManagerRoleId,
    managementRoleIds.playerManagerRoleId,
  ].find((roleId) => roleId !== null && activeTeamRoleIds.has(roleId));

  if (collidingRoleId !== undefined) {
    throw new ConfigurationError(
      `The role <@&${collidingRoleId}> cannot be configured as both a management role and an active team role.`,
    );
  }
}
