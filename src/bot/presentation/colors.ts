export const BOT_COLORS = {
  success: 0x57f287,
  info: 0x5865f2,
  warning: 0xfee75c,
  error: 0xed4245,
  neutral: 0x747f8d,
} as const;

export type BotColorKey = keyof typeof BOT_COLORS;

export const EMBED_COLORS = {
  SUCCESS: BOT_COLORS.success,
  INFO: BOT_COLORS.info,
  WARNING: BOT_COLORS.warning,
  ERROR: BOT_COLORS.error,
} as const;

export function resolveTeamRoleColor(
  roleColor: number | null | undefined,
  fallbackColor: number = BOT_COLORS.info,
): number {
  return roleColor === undefined || roleColor === null || roleColor === 0
    ? fallbackColor
    : roleColor;
}
