import { InvalidTeamEmojiError } from '../domain/errors.js';

export interface GuildEmoji {
  id: string;
  name: string;
  animated: boolean;
}

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
  canonicalMention?: string;
  customEmojiId?: string;
  customEmojiName?: string;
  animated?: boolean;
  thumbnailUrl: string | null;
}

const CUSTOM_EMOJI_REGEX = /^<(a)?:([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/;
const CUSTOM_EMOJI_NAME_REGEX = /^:([a-zA-Z0-9_]{2,32}):$/;
const PLAIN_CUSTOM_EMOJI_NAME_REGEX = /^[a-zA-Z0-9_]{2,32}$/;
const UNICODE_EMOJI_REGEX =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\uFE0F|\u200D)+$/u;
const UNICODE_EMOJI_BASE_REGEX =
  /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator})/u;

function customEmojiCdnUrl(id: string, animated: boolean): string {
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`;
}

function canonicalCustomEmoji(emoji: GuildEmoji): ValidatedTeamEmoji {
  const canonicalMention = emoji.animated
    ? `<a:${emoji.name}:${emoji.id}>`
    : `<:${emoji.name}:${emoji.id}>`;
  return {
    type: 'custom',
    display: canonicalMention,
    canonicalMention,
    customEmojiId: emoji.id,
    customEmojiName: emoji.name,
    animated: emoji.animated,
    thumbnailUrl: customEmojiCdnUrl(emoji.id, emoji.animated),
  };
}

export function parseCustomEmoji(input: string | null | undefined): ParsedEmoji | null {
  if (!input) return null;
  const trimmed = input.trim();
  const match = CUSTOM_EMOJI_REGEX.exec(trimmed);
  if (!match) return null;

  const animated = Boolean(match[1]);
  const name = match[2]!;
  const id = match[3]!;
  return {
    id,
    name,
    animated,
    mention: animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`,
    cdnUrl: customEmojiCdnUrl(id, animated),
  };
}

export function isUnicodeEmoji(input: string | null | undefined): boolean {
  if (!input) return false;
  const trimmed = input.trim();
  if (/[a-zA-Z0-9]/.test(trimmed)) return false;
  return UNICODE_EMOJI_REGEX.test(trimmed) && UNICODE_EMOJI_BASE_REGEX.test(trimmed);
}

export function getTwemojiUrl(unicodeEmoji: string): string | null {
  try {
    const codepoints = [...unicodeEmoji.trim()]
      .map((character) => character.codePointAt(0)?.toString(16))
      .filter((codepoint): codepoint is string => codepoint !== undefined && codepoint !== 'fe0f');
    if (codepoints.length === 0) return null;
    return `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${codepoints.join('-')}.png`;
  } catch {
    return null;
  }
}

export function validateTeamEmoji(
  input: string,
  guildEmojis: readonly GuildEmoji[] = [],
): ValidatedTeamEmoji {
  if (!input || typeof input !== 'string') throw new InvalidTeamEmojiError();
  const trimmed = input.trim();
  const parsedMention = parseCustomEmoji(trimmed);

  if (parsedMention !== null) {
    const guildEmoji = guildEmojis.find((emoji) => emoji.id === parsedMention.id);
    if (!guildEmoji) throw new InvalidTeamEmojiError();
    return canonicalCustomEmoji(guildEmoji);
  }

  const wrappedName = CUSTOM_EMOJI_NAME_REGEX.exec(trimmed)?.[1];
  const emojiName = wrappedName ?? (PLAIN_CUSTOM_EMOJI_NAME_REGEX.test(trimmed) ? trimmed : null);
  if (emojiName !== null) {
    const matches = guildEmojis.filter(
      (emoji) => emoji.name.toLowerCase() === emojiName.toLowerCase(),
    );
    if (matches.length === 0) throw new InvalidTeamEmojiError();
    if (matches.length > 1) {
      throw new InvalidTeamEmojiError(
        'Multiple server emojis have that name. Paste the full custom emoji mention, for example `<:chelsea:123456789012345678>`.',
      );
    }
    return canonicalCustomEmoji(matches[0]!);
  }

  if (isUnicodeEmoji(trimmed)) {
    return {
      type: 'unicode',
      display: trimmed,
      thumbnailUrl: getTwemojiUrl(trimmed),
    };
  }

  throw new InvalidTeamEmojiError();
}

export function validateCustomEmoji(
  input: string | null | undefined,
  guildEmojis: readonly GuildEmoji[] = [],
): void {
  if (!input) return;
  validateTeamEmoji(input, guildEmojis);
}

export function getTeamThumbnail(emojiInput: string | null | undefined): string | null {
  if (!emojiInput) return null;
  const customParsed = parseCustomEmoji(emojiInput);
  if (customParsed !== null) return customParsed.cdnUrl;
  if (isUnicodeEmoji(emojiInput)) {
    const twemoji = getTwemojiUrl(emojiInput);
    if (twemoji !== null) return twemoji;
  }
  return null;
}
