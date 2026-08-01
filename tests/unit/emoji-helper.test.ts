import { describe, expect, it } from 'vitest';
import {
  formatTeamNameWithEmoji,
  getTeamThumbnail,
  parseCustomEmoji,
  validateCustomEmoji,
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

  it('returns null and throws error for malformed emojis', () => {
    expect(parseCustomEmoji('😄')).toBeNull();
    expect(parseCustomEmoji('invalid')).toBeNull();
    expect(parseCustomEmoji('<:name:short>')).toBeNull();

    expect(() => validateCustomEmoji('😄')).toThrow();
    expect(() => validateCustomEmoji('invalid_emoji')).toThrow();
    expect(() => validateCustomEmoji('<:name:123>')).toThrow();
  });

  it('derives team thumbnail correctly', () => {
    expect(getTeamThumbnail('<:fc:123456789012345678>', 'https://example.com/logo.png')).toBe(
      'https://cdn.discordapp.com/emojis/123456789012345678.png',
    );

    expect(getTeamThumbnail(null, 'https://example.com/logo.png')).toBe(
      'https://example.com/logo.png',
    );
    expect(getTeamThumbnail(null, null)).toBeNull();
  });

  it('formats team name with emoji mention', () => {
    expect(formatTeamNameWithEmoji('Arsenal FC', '<:ars:123456789012345678>')).toBe(
      '<:ars:123456789012345678> **Arsenal FC**',
    );
    expect(formatTeamNameWithEmoji('Arsenal FC', null)).toBe('**Arsenal FC**');
  });
});
