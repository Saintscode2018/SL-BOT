export interface DiscordUserPresentation {
  discordUserId: string;
  displayName: string;
  avatarUrl?: string | null;
}

export function sanitizeInlineCode(value: string): string {
  return value.replace(/`/g, "'");
}

export function formatUserMention(userId: string): string {
  return `<@${userId}>`;
}

export function formatUserWithVisibleName(userId: string, displayName: string): string {
  return `<@${userId}> \`${sanitizeInlineCode(displayName)}\``;
}

export function formatUserFooterName(displayName: string): string {
  return displayName.trim() || 'Unknown User';
}
