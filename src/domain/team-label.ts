import { ValidationError } from './errors.js';

export interface TeamIdentitySource {
  emoji: string;
  discordRoleId: string;
  discordRoleName?: string | null;
}

export type TeamIdentityMode = 'message' | 'title' | 'footer' | 'autocomplete';

export const autocompleteTeamIdentityMaxLength = 100;
export const unknownTeamRoleLabel = 'Unknown Team Role';

const CUSTOM_EMOJI_MENTION_REGEX = /^<(a)?:([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/;

function graphemes(value: string): string[] {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(
    ({ segment }) => segment,
  );
}

function requireComponent(value: string, component: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`team ${component} is required`);
  }
  return trimmed;
}

function renderEmbedEmoji(emoji: string): string {
  const customEmoji = CUSTOM_EMOJI_MENTION_REGEX.exec(emoji);
  if (customEmoji === null) return emoji;
  return `<${customEmoji[1] ? 'a' : ''}:${customEmoji[2]}:${customEmoji[3]}>`;
}

function renderPlainTextEmoji(emoji: string): string {
  const customEmoji = CUSTOM_EMOJI_MENTION_REGEX.exec(emoji);
  if (customEmoji !== null) return `.${customEmoji[2]}.`;
  if (/[<>]|\d{17,20}/.test(emoji)) return 'Unknown Team Emoji';
  return emoji;
}

function limitAutocompleteIdentity(role: string): string {
  let limitedRole = '';
  for (const segment of graphemes(role)) {
    if (limitedRole.length + segment.length > autocompleteTeamIdentityMaxLength) break;
    limitedRole += segment;
  }
  return limitedRole.trim();
}

export function formatTeamIdentity(team: TeamIdentitySource, mode: TeamIdentityMode): string {
  const emoji = requireComponent(team.emoji, 'emoji');
  const roleId = requireComponent(team.discordRoleId, 'Discord role');

  if (mode === 'message') {
    return `${renderEmbedEmoji(emoji)} <@&${roleId}>`;
  }

  const roleName = team.discordRoleName?.trim();
  const role = roleName ? `@${roleName}` : unknownTeamRoleLabel;

  if (mode === 'title') {
    return `${renderEmbedEmoji(emoji)} ${roleName ? `@${roleName}` : 'Team'}`;
  }

  if (mode === 'footer') {
    return `${renderPlainTextEmoji(emoji)} ${role}`;
  }

  return limitAutocompleteIdentity(role);
}
