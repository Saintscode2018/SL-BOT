export interface DiscordUserPresentation {
  discordUserId: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface InteractionWithUserMetadata {
  userId?: string | undefined;
  userDisplayName?: string | undefined;
  getGuildMemberDisplayName?(userId: string): string | null;
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

export function getUserDisplayName(
  interaction: InteractionWithUserMetadata,
  userId: string,
  fallback?: string | null,
): string {
  if (fallback && fallback.trim().length > 0) return fallback.trim();
  if (interaction.userId === userId && interaction.userDisplayName)
    return interaction.userDisplayName;
  const resolved = interaction.getGuildMemberDisplayName?.(userId);
  if (resolved && resolved.trim().length > 0) return resolved.trim();
  return 'Unknown User';
}
