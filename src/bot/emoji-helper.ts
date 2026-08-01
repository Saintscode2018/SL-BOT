import { InvalidTeamEmojiError } from '../domain/errors.js';

export interface ParsedEmoji {
  id: string;
  name: string;
  animated: boolean;
  mention: string;
  cdnUrl: string;
}

export interface ValidatedTeamEmoji {
  type: 'custom' | 'unicode';
  display: string;
  cdnUrl: string | null;
  customEmojiId?: string;
}

const CUSTOM_EMOJI_REGEX = /^<(a)?:([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/;
const UNICODE_EMOJI_REGEX = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D)+$/u;

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

export function isUnicodeEmoji(input: string | null | undefined): boolean {
  if (!input) return false;
  const trimmed = input.trim();
  if (/[a-zA-Z0-9]/.test(trimmed)) return false;
  if (!UNICODE_EMOJI_REGEX.test(trimmed)) return false;
  return /\p{Extended_Pictographic}/u.test(trimmed);
}

export function getTwemojiUrl(unicodeEmoji: string): string | null {
  try {
    const codepoints = [...unicodeEmoji.trim()]
      .map((c) => c.codePointAt(0)?.toString(16))
      .filter((cp): cp is string => cp !== undefined && cp !== 'fe0f');
    if (codepoints.length === 0) return null;
    return `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${codepoints.join('-')}.png`;
  } catch {
    return null;
  }
}

export function validateTeamEmoji(
  input: string,
  isGuildEmojiAvailable?: (emojiId: string) => boolean,
): ValidatedTeamEmoji {
  if (!input || typeof input !== 'string') {
    throw new InvalidTeamEmojiError();
  }
  const trimmed = input.trim();
  const customParsed = parseCustomEmoji(trimmed);
  if (customParsed !== null) {
    if (isGuildEmojiAvailable && !isGuildEmojiAvailable(customParsed.id)) {
      throw new InvalidTeamEmojiError();
    }
    return {
      type: 'custom',
      display: customParsed.mention,
      cdnUrl: customParsed.cdnUrl,
      customEmojiId: customParsed.id,
    };
  }

  if (isUnicodeEmoji(trimmed)) {
    return {
      type: 'unicode',
      display: trimmed,
      cdnUrl: getTwemojiUrl(trimmed),
    };
  }

  throw new InvalidTeamEmojiError();
}

export function validateCustomEmoji(
  input: string | null | undefined,
  isGuildEmojiAvailable?: (emojiId: string) => boolean,
): void {
  if (!input) return;
  validateTeamEmoji(input, isGuildEmojiAvailable);
}

export function getTeamThumbnail(
  emojiInput: string | null | undefined,
  fallbackLogoUrl?: string | null,
): string | null {
  if (!emojiInput) {
    if (fallbackLogoUrl && fallbackLogoUrl.startsWith('http')) return fallbackLogoUrl;
    return null;
  }
  const customParsed = parseCustomEmoji(emojiInput);
  if (customParsed !== null) return customParsed.cdnUrl;
  if (isUnicodeEmoji(emojiInput)) {
    const twemoji = getTwemojiUrl(emojiInput);
    if (twemoji !== null) return twemoji;
  }
  if (fallbackLogoUrl && fallbackLogoUrl.startsWith('http')) return fallbackLogoUrl;
  return null;
}

export function formatTeamNameWithEmoji(name: string, emojiInput?: string | null): string {
  if (!emojiInput) return `**${name}**`;
  const customParsed = parseCustomEmoji(emojiInput);
  if (customParsed !== null) {
    return `${customParsed.mention} **${name}**`;
  }
  const trimmed = emojiInput.trim();
  if (isUnicodeEmoji(trimmed)) {
    return `${trimmed} **${name}**`;
  }
  return `**${name}**`;
}
