export interface ParsedEmoji {
  id: string;
  name: string;
  animated: boolean;
  mention: string;
  cdnUrl: string;
}

const CUSTOM_EMOJI_REGEX = /^<(a)?:([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/;

export function parseCustomEmoji(input: string | null | undefined): ParsedEmoji | null {
  if (!input) return null;
  const trimmed = input.trim();
  const match = CUSTOM_EMOJI_REGEX.exec(trimmed);
  if (!match) return null;

  const animated = Boolean(match[1]);
  const name = match[2]!;
  const id = match[3]!;
  const extension = animated ? 'gif' : 'png';
  const cdnUrl = `https://cdn.discordapp.com/emojis/${id}.${extension}`;
  const mention = animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`;

  return {
    id,
    name,
    animated,
    mention,
    cdnUrl,
  };
}

export function validateCustomEmoji(input: string | null | undefined): void {
  if (!input) return;
  if (parseCustomEmoji(input) === null) {
    throw new Error(
      'Emoji must be a valid custom Discord emoji (e.g. <:name:123456789012345678> or <a:name:123456789012345678>)',
    );
  }
}

export function getTeamThumbnail(
  emojiInput: string | null | undefined,
  fallbackLogoUrl?: string | null,
): string | null {
  const parsed = parseCustomEmoji(emojiInput);
  if (parsed !== null) return parsed.cdnUrl;
  if (fallbackLogoUrl && fallbackLogoUrl.startsWith('http')) return fallbackLogoUrl;
  return null;
}

export function formatTeamNameWithEmoji(name: string, emojiInput?: string | null): string {
  const parsed = parseCustomEmoji(emojiInput);
  if (parsed !== null) {
    return `${parsed.mention} **${name}**`;
  }
  return `**${name}**`;
}
