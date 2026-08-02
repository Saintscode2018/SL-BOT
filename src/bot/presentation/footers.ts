import { formatUtcFooterTimestamp } from './timestamps.js';
import { formatUserFooterName } from './users.js';

export interface ActorFooterInput {
  verb: string;
  username: string;
  avatarUrl?: string | null | undefined;
  timestamp: Date;
}

export interface PlayerFooterInput {
  username: string;
  avatarUrl?: string | null | undefined;
  timestamp: Date;
}

export interface TimestampedFooterInput {
  text: string;
  avatarUrl?: string | null | undefined;
  timestamp: Date;
}

export function createActorFooter(input: ActorFooterInput): {
  text: string;
  iconURL?: string;
} {
  const safeName = formatUserFooterName(input.username);
  const formattedTime = formatUtcFooterTimestamp(input.timestamp);
  return {
    text: `${input.verb} by ${safeName} • ${formattedTime}`,
    ...(input.avatarUrl ? { iconURL: input.avatarUrl } : {}),
  };
}

export function createPlayerFooter(input: PlayerFooterInput): {
  text: string;
  iconURL?: string;
} {
  const safeName = formatUserFooterName(input.username);
  const formattedTime = formatUtcFooterTimestamp(input.timestamp);
  return {
    text: `Player: ${safeName} • ${formattedTime}`,
    ...(input.avatarUrl ? { iconURL: input.avatarUrl } : {}),
  };
}

export function createTimestampedFooter(input: TimestampedFooterInput): {
  text: string;
  iconURL?: string;
} {
  const formattedTime = formatUtcFooterTimestamp(input.timestamp);
  return {
    text: `${input.text} • ${formattedTime}`,
    ...(input.avatarUrl ? { iconURL: input.avatarUrl } : {}),
  };
}
