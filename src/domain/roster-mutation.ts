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

export type UserTransferAnnouncementType =
  | 'SIGNED'
  | 'DEMANDED'
  | 'RELEASED'
  | 'PROMOTED'
  | 'DEMOTED'
  | 'APPOINTED';

export type TransferAnnouncementType = UserTransferAnnouncementType | 'TEAM_DISBANDED';

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

export interface UserTransferAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  type: UserTransferAnnouncementType;
  discordUserId: string;
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
  actorDiscordUserId?: string;
  staffRole?: StaffRoleCode;
  staffRoleId?: string;
  departureMode?: 'STAFF_ONLY' | 'FULL';
  roster?: TransferRosterPresentation;
  presentation?: TransferAnnouncementPresentation;
}

export interface TeamDisbandTransferAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  type: 'TEAM_DISBANDED';
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
  actorDiscordUserId?: string;
  staffRole?: StaffRoleCode;
  staffRoleId?: string;
  departureMode?: 'STAFF_ONLY' | 'FULL';
  roster?: TransferRosterPresentation;
  presentation?: TransferAnnouncementPresentation;
}

export type TransferAnnouncementPlan =
  | UserTransferAnnouncementPlan
  | TeamDisbandTransferAnnouncementPlan;

export type UserAuditAnnouncementOperation =
  | 'ROSTER_PLAYER_ADDED'
  | 'ROSTER_PLAYER_REMOVED'
  | 'STAFF_APPOINTED'
  | 'STAFF_REMOVED'
  | 'ROSTER_DEMANDED'
  | 'ROSTER_RELEASED'
  | 'ROSTER_PROMOTED'
  | 'ROSTER_DEMOTED';

export type AuditAnnouncementOperation = UserAuditAnnouncementOperation | 'TEAM_DISBANDED';

export interface TeamDisbandDetails {
  endedMembershipCount: number;
  affectedUserCount: number;
  expiredOfferCount: number;
}

export interface UserAuditAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  operation: UserAuditAnnouncementOperation;
  actorDiscordUserId: string;
  playerDiscordUserId: string;
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
  staffRole?: StaffRoleCode;
  departureMode?: 'STAFF_ONLY' | 'FULL';
  presentation?: TransferAnnouncementPresentation;
}

export interface TeamDisbandAuditAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  operation: 'TEAM_DISBANDED';
  actorDiscordUserId: string;
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
  staffRole?: StaffRoleCode;
  departureMode?: 'STAFF_ONLY' | 'FULL';
  disbandDetails?: TeamDisbandDetails;
  presentation?: TransferAnnouncementPresentation;
}

export type AuditAnnouncementPlan = UserAuditAnnouncementPlan | TeamDisbandAuditAnnouncementPlan;

export interface MutationPlans {
  roleMutation: MemberRoleMutationPlan;
  announcement: TransferAnnouncementPlan | null;
  auditAnnouncement?: AuditAnnouncementPlan | null;
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

export function canReleaseStaffRole(
  actorRole: StaffRoleCode,
  targetRole: StaffRoleCode | null,
): boolean {
  if (targetRole === 'TM') return false;
  if (actorRole === 'TM') return true;
  if (actorRole === 'ATM') return targetRole === null || targetRole === 'PM';
  return targetRole === null;
}
