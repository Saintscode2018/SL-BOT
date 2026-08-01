export interface TeamLabelSource {
  name: string;
  shortName: string;
  emoji?: string | null;
}

const CUSTOM_EMOJI_MENTION_REGEX = /^<a?:([a-zA-Z0-9_]{2,32}):\d{17,20}>$/;

export function formatTeamLabel(team: TeamLabelSource): string {
  const name = `${team.name} (${team.shortName})`;
  const emoji = team.emoji?.trim();
  return emoji ? `${emoji} ${name}` : name;
}

export function formatTeamAutocompleteLabel(team: TeamLabelSource): string {
  const emoji = team.emoji?.trim();
  if (!emoji) return `${team.name} (${team.shortName})`;

  const customEmoji = CUSTOM_EMOJI_MENTION_REGEX.exec(emoji);
  const autocompleteEmoji = customEmoji ? `:${customEmoji[1]}:` : emoji;
  return `${autocompleteEmoji} ${team.name} (${team.shortName})`;
}
