export interface GuildAuthorPresentation {
  guildName: string;
  guildIconUrl?: string | null | undefined;
}

export function createGuildAuthor(presentation: GuildAuthorPresentation): {
  name: string;
  iconURL?: string;
} {
  const name = presentation.guildName.trim() || 'Discord Server';
  return {
    name,
    ...(presentation.guildIconUrl ? { iconURL: presentation.guildIconUrl } : {}),
  };
}
