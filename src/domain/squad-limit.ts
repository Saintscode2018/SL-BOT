export const DEFAULT_SQUAD_LIMIT = 17;

export interface SquadLimitCarrier {
  squadLimitOverride?: number | null;
}

export interface GuildSettingsSquadLimitCarrier {
  defaultSquadLimit?: number | null;
}

export function getEffectiveSquadLimit(
  club: SquadLimitCarrier,
  settings?: GuildSettingsSquadLimitCarrier | null,
): number {
  if (club.squadLimitOverride !== undefined && club.squadLimitOverride !== null) {
    return club.squadLimitOverride;
  }
  if (settings?.defaultSquadLimit !== undefined && settings?.defaultSquadLimit !== null) {
    return settings.defaultSquadLimit;
  }
  return DEFAULT_SQUAD_LIMIT;
}
