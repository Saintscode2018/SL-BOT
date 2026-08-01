import { describe, expect, it } from 'vitest';

import {
  getTeamThumbnail,
  getTwemojiUrl,
  isUnicodeEmoji,
  parseCustomEmoji,
  validateTeamEmoji,
  type GuildEmoji,
} from '../../src/bot/emoji-helper.js';
import { InvalidTeamEmojiError } from '../../src/domain/errors.js';
import { formatTeamAutocompleteLabel, formatTeamLabel } from '../../src/domain/team-label.js';

const guildEmojis: readonly GuildEmoji[] = [
  { id: '123456789012345678', name: 'chelsea', animated: false },
  { id: '987654321098765432', name: 'chelsea_fire', animated: true },
];

describe('emoji helper', () => {
  it('parses static and animated custom mentions', () => {
    expect(parseCustomEmoji('<:chelsea:123456789012345678>')).toEqual({
      id: '123456789012345678',
      name: 'chelsea',
      animated: false,
      mention: '<:chelsea:123456789012345678>',
      cdnUrl: 'https://cdn.discordapp.com/emojis/123456789012345678.png',
    });
    expect(parseCustomEmoji('<a:chelsea_fire:987654321098765432>')?.cdnUrl).toBe(
      'https://cdn.discordapp.com/emojis/987654321098765432.gif',
    );
  });

  it('resolves a full static mention from the guild record', () => {
    expect(validateTeamEmoji('<:typed_name:123456789012345678>', guildEmojis)).toEqual({
      type: 'custom',
      display: '<:chelsea:123456789012345678>',
      canonicalMention: '<:chelsea:123456789012345678>',
      customEmojiId: '123456789012345678',
      customEmojiName: 'chelsea',
      animated: false,
      thumbnailUrl: 'https://cdn.discordapp.com/emojis/123456789012345678.png',
    });
  });

  it('resolves a full animated mention from the guild record', () => {
    const result = validateTeamEmoji('<a:typed_name:987654321098765432>', guildEmojis);
    expect(result.display).toBe('<a:chelsea_fire:987654321098765432>');
    expect(result.animated).toBe(true);
    expect(result.thumbnailUrl).toBe('https://cdn.discordapp.com/emojis/987654321098765432.gif');
  });

  it('resolves wrapped plain and case insensitive names', () => {
    expect(validateTeamEmoji(':chelsea:', guildEmojis).display).toBe(
      '<:chelsea:123456789012345678>',
    );
    expect(validateTeamEmoji('chelsea', guildEmojis).display).toBe('<:chelsea:123456789012345678>');
    expect(validateTeamEmoji('ChElSeA', guildEmojis).display).toBe('<:chelsea:123456789012345678>');
  });

  it('rejects missing cross server and deleted custom emojis', () => {
    expect(() => validateTeamEmoji('missing', guildEmojis)).toThrow(InvalidTeamEmojiError);
    expect(() => validateTeamEmoji('<:foreign:111122223333444455>', guildEmojis)).toThrow(
      InvalidTeamEmojiError,
    );
    expect(() => validateTeamEmoji('<:deleted:123456789012345678>', [])).toThrow(
      InvalidTeamEmojiError,
    );
  });

  it('rejects duplicate case insensitive names with full mention guidance', () => {
    const duplicates: readonly GuildEmoji[] = [
      { id: '111111111111111111', name: 'Chelsea', animated: false },
      { id: '222222222222222222', name: 'chelsea', animated: true },
    ];
    expect(() => validateTeamEmoji('CHELSEA', duplicates)).toThrow(
      'Paste the full custom emoji mention',
    );
  });

  it('preserves unicode emoji sequences', () => {
    for (const emoji of ['⚽', '🔵', '🦁', '🇹🇷', '👍🏽', '👨‍👩‍👧']) {
      expect(isUnicodeEmoji(emoji)).toBe(true);
      expect(validateTeamEmoji(emoji, guildEmojis)).toMatchObject({
        type: 'unicode',
        display: emoji,
      });
    }
  });

  it('rejects malformed text and image urls', () => {
    for (const value of ['invalid text', 'abc', ':bad name:', 'https://example.com/team.png']) {
      expect(() => validateTeamEmoji(value, guildEmojis)).toThrow(InvalidTeamEmojiError);
    }
  });

  it('derives custom and unicode thumbnails', () => {
    expect(getTeamThumbnail('<:chelsea:123456789012345678>')).toBe(
      'https://cdn.discordapp.com/emojis/123456789012345678.png',
    );
    const twemojiUrl = getTwemojiUrl('⚽');
    expect(twemojiUrl).not.toBeNull();
    expect(getTeamThumbnail('⚽')).toBe(twemojiUrl);
  });
});

describe('team labels', () => {
  it('formats unicode custom and legacy labels', () => {
    expect(formatTeamLabel({ name: 'Chelsea', shortName: 'CHE', emoji: '🔵' })).toBe(
      '🔵 Chelsea (CHE)',
    );
    expect(
      formatTeamLabel({
        name: 'Chelsea',
        shortName: 'CHE',
        emoji: '<:chelsea:123456789012345678>',
      }),
    ).toBe('<:chelsea:123456789012345678> Chelsea (CHE)');
    expect(formatTeamLabel({ name: 'Chelsea', shortName: 'CHE', emoji: null })).toBe(
      'Chelsea (CHE)',
    );
  });

  it('uses a custom emoji name fallback for autocomplete', () => {
    expect(
      formatTeamAutocompleteLabel({
        name: 'Chelsea',
        shortName: 'CHE',
        emoji: '<a:chelsea:123456789012345678>',
      }),
    ).toBe(':chelsea: Chelsea (CHE)');
    expect(formatTeamAutocompleteLabel({ name: 'Chelsea', shortName: 'CHE', emoji: '🔵' })).toBe(
      '🔵 Chelsea (CHE)',
    );
    expect(formatTeamAutocompleteLabel({ name: 'Chelsea', shortName: 'CHE' })).toBe(
      'Chelsea (CHE)',
    );
  });
});
