import type { MembershipType } from './enums.js';
import type { TeamIdentitySource } from './team-label.js';

export type StaffMembershipType = Exclude<MembershipType, 'PLAYER'>;
export type StaffRoleCode = 'TM' | 'ATM' | 'PM';
export type DiscordRolePurpose = 'TEAM' | StaffRoleCode;

export interface PlannedDiscordRole {
  id: string;
  purpose: DiscordRolePurpose;
}

export interface MemberRoleMutationPlan {
  discordGuildId: string;
  discordUserId: string;
  addRoles: PlannedDiscordRole[];
  removeRoles: PlannedDiscordRole[];
}

export type TransferAnnouncementType =
  | 'SIGNED'
  | 'DEMANDED'
  | 'RELEASED'
  | 'PROMOTED'
  | 'DEMOTED'
  | 'APPOINTED';

export interface TransferUserPresentation {
  username: string;
  avatarUrl?: string | null;
}

export interface TransferAnnouncementPresentation {
  serverName: string;
  serverIconUrl?: string | null;
  teamRoleName?: string | null;
  teamRoleColor?: number | null;
  subject?: TransferUserPresentation | null;
  actor?: TransferUserPresentation | null;
  teamManager?: TransferUserPresentation | null;
}

export interface TransferRosterPresentation {
  currentSize: number;
  maximumSize: number;
  teamManagerDiscordUserId?: string | null;
}

export interface TransferAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  type: TransferAnnouncementType;
  discordUserId: string;
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
  actorDiscordUserId?: string;
  staffRole?: StaffRoleCode;
  staffRoleId?: string;
  roster?: TransferRosterPresentation;
  presentation?: TransferAnnouncementPresentation;
}

export interface MutationPlans {
  roleMutation: MemberRoleMutationPlan;
  announcement: TransferAnnouncementPlan | null;
}

export function toStaffRoleCode(staffType: StaffMembershipType): StaffRoleCode {
  switch (staffType) {
    case 'TEAM_MANAGER':
      return 'TM';
    case 'ASSISTANT_MANAGER':
      return 'ATM';
    case 'PLAYER_MANAGER':
      return 'PM';
  }
}

export function fromStaffRoleCode(role: StaffRoleCode): StaffMembershipType {
  switch (role) {
    case 'TM':
      return 'TEAM_MANAGER';
    case 'ATM':
      return 'ASSISTANT_MANAGER';
    case 'PM':
      return 'PLAYER_MANAGER';
  }
}
