import { InvalidModerationDurationError, ModerationTimeoutTooLongError } from './errors.js';

export const maximumDiscordTimeoutSeconds = 2_419_200;

const durationPattern = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
const units = [
  { index: 1, seconds: 86_400n },
  { index: 2, seconds: 3_600n },
  { index: 3, seconds: 60n },
  { index: 4, seconds: 1n },
] as const;

export function parseModerationDuration(value: string): number {
  const normalized = value.trim().toLowerCase();
  const match = durationPattern.exec(normalized);
  if (match === null || normalized.length === 0) {
    throw new InvalidModerationDurationError(
      'Use positive whole-number duration components in d/h/m/s order, for example `2h30m`.',
    );
  }

  let total = 0n;
  let componentCount = 0;
  for (const unit of units) {
    const component = match[unit.index];
    if (component === undefined) continue;
    const amount = BigInt(component);
    if (amount <= 0n) {
      throw new InvalidModerationDurationError('Duration components must be positive.');
    }
    componentCount += 1;
    total += amount * unit.seconds;
  }

  if (componentCount === 0 || total <= 0n) {
    throw new InvalidModerationDurationError();
  }
  if (total > BigInt(maximumDiscordTimeoutSeconds)) {
    throw new ModerationTimeoutTooLongError(maximumDiscordTimeoutSeconds);
  }
  return Number(total);
}

export function formatModerationDuration(durationSeconds: number): string {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    throw new InvalidModerationDurationError();
  }
  let remaining = durationSeconds;
  const parts: string[] = [];
  for (const [label, unitSeconds] of [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ] as const) {
    const amount = Math.floor(remaining / unitSeconds);
    if (amount === 0) continue;
    remaining %= unitSeconds;
    parts.push(`${amount} ${label}${amount === 1 ? '' : 's'}`);
  }
  return parts.join(' ');
}
