import { describe, expect, it } from 'vitest';
import { InvalidTeamEmojiError } from '../../src/domain/errors.js';
import {
  formatTeamNameWithEmoji,
  getTeamThumbnail,
  getTwemojiUrl,
  isUnicodeEmoji,
  parseCustomEmoji,
  validateTeamEmoji,
} from '../../src/bot/emoji-helper.js';

describe('emoji-helper', () => {
  it('parses static custom Discord emoji', () => {
    const parsed = parseCustomEmoji('<:arsenal:123456789012345678>');
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe('123456789012345678');
    expect(parsed?.name).toBe('arsenal');
    expect(parsed?.animated).toBe(false);
    expect(parsed?.mention).toBe('<:arsenal:123456789012345678>');
    expect(parsed?.cdnUrl).toBe('https://cdn.discordapp.com/emojis/123456789012345678.png');
  });

  it('parses animated custom Discord emoji', () => {
    const parsed = parseCustomEmoji('<a:chelsea_fire:987654321098765432>');
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe('987654321098765432');
    expect(parsed?.name).toBe('chelsea_fire');
    expect(parsed?.animated).toBe(true);
    expect(parsed?.mention).toBe('<a:chelsea_fire:987654321098765432>');
    expect(parsed?.cdnUrl).toBe('https://cdn.discordapp.com/emojis/987654321098765432.gif');
  });

  it('validates unicode emojis accurately', () => {
    expect(isUnicodeEmoji('⚽')).toBe(true);
    expect(isUnicodeEmoji('🦁')).toBe(true);
    expect(isUnicodeEmoji('🔵')).toBe(true);
    expect(isUnicodeEmoji('👨‍👩‍👧')).toBe(true);
    expect(isUnicodeEmoji('word')).toBe(false);
    expect(isUnicodeEmoji('hello ⚽')).toBe(false);
    expect(isUnicodeEmoji('123')).toBe(false);
  });

  it('validates team emojis with guild custom emoji filter', () => {
    const serverEmojis = new Set(['123456789012345678', '987654321098765432']);
    const isGuildEmojiAvailable = (id: string) => serverEmojis.has(id);

    // server custom emoji
    const validCustom = validateTeamEmoji('<:arsenal:123456789012345678>', isGuildEmojiAvailable);
    expect(validCustom.type).toBe('custom');
    expect(validCustom.customEmojiId).toBe('123456789012345678');

    // server animated custom emoji
    const validAnimated = validateTeamEmoji(
      '<a:chelsea_fire:987654321098765432>',
      isGuildEmojiAvailable,
    );
    expect(validAnimated.type).toBe('custom');

    // unicode emoji
    const validUnicode = validateTeamEmoji('⚽', isGuildEmojiAvailable);
    expect(validUnicode.type).toBe('unicode');
    expect(validUnicode.display).toBe('⚽');

    // custom emoji from another server
    expect(() => validateTeamEmoji('<:other:111122223333444455>', isGuildEmojiAvailable)).toThrow(
      InvalidTeamEmojiError,
    );

    // malformed emoji string
    expect(() => validateTeamEmoji('invalid_text', isGuildEmojiAvailable)).toThrow(
      InvalidTeamEmojiError,
    );
  });

  it('derives team thumbnail correctly for custom and unicode emojis', () => {
    expect(getTeamThumbnail('<:fc:123456789012345678>')).toBe(
      'https://cdn.discordapp.com/emojis/123456789012345678.png',
    );

    const twemojiUrl = getTwemojiUrl('⚽');
    expect(twemojiUrl).not.toBeNull();
    expect(getTeamThumbnail('⚽')).toBe(twemojiUrl);

    expect(getTeamThumbnail(null, 'https://example.com/logo.png')).toBe(
      'https://example.com/logo.png',
    );
    expect(getTeamThumbnail(null, null)).toBeNull();
  });

  it('formats team name with emoji mention or unicode emoji', () => {
    expect(formatTeamNameWithEmoji('Arsenal FC', '<:ars:123456789012345678>')).toBe(
      '<:ars:123456789012345678> **Arsenal FC**',
    );
    expect(formatTeamNameWithEmoji('Chelsea FC', '⚽')).toBe('⚽ **Chelsea FC**');
    expect(formatTeamNameWithEmoji('Arsenal FC', null)).toBe('**Arsenal FC**');
  });
});
