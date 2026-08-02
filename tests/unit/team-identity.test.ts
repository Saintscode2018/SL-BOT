import { describe, expect, it } from 'vitest';

import {
  autocompleteTeamIdentityMaxLength,
  formatTeamIdentity,
} from '../../src/domain/team-label.js';

const unicodeTeam = {
  emoji: '🔥',
  discordRoleId: '123456789012345678',
  discordRoleName: 'T1',
};

const customTeam = {
  emoji: '<:Newcastle:223456789012345678>',
  discordRoleId: '323456789012345678',
  discordRoleName: 'T2',
};

describe('team identity formatter', () => {
  it('renders canonical Unicode/custom emoji and role mentions in message bodies', () => {
    expect(formatTeamIdentity(unicodeTeam, 'message')).toBe('🔥 <@&123456789012345678>');
    expect(formatTeamIdentity(customTeam, 'message')).toBe(
      '<:Newcastle:223456789012345678> <@&323456789012345678>',
    );
    expect(
      formatTeamIdentity({ ...customTeam, emoji: '<a:Newcastle:223456789012345678>' }, 'message'),
    ).toBe('<a:Newcastle:223456789012345678> <@&323456789012345678>');
  });

  it('renders readable Unicode/custom title identities without raw role IDs', () => {
    expect(formatTeamIdentity(unicodeTeam, 'title')).toBe('🔥 @T1');
    expect(formatTeamIdentity(customTeam, 'title')).toBe('<:Newcastle:223456789012345678> @T2');
    expect(formatTeamIdentity({ ...unicodeTeam, discordRoleName: null }, 'title')).toBe('🔥 Team');
    expect(formatTeamIdentity(customTeam, 'title')).not.toContain(customTeam.discordRoleId);
  });

  it('renders footer-safe Unicode/custom identities without mention markup or raw IDs', () => {
    expect(formatTeamIdentity(unicodeTeam, 'footer')).toBe('🔥 T1');
    expect(formatTeamIdentity(customTeam, 'footer')).toBe('.Newcastle. T2');
    const footer = formatTeamIdentity(customTeam, 'footer');
    expect(footer).not.toMatch(/<a?:|<@&|\d{17,20}/u);
  });

  it('uses the safe missing-role fallback in titles, footers, and autocomplete', () => {
    const missingRole = { ...customTeam, discordRoleName: null };
    expect(formatTeamIdentity(missingRole, 'title')).toBe('<:Newcastle:223456789012345678> Team');
    expect(formatTeamIdentity(missingRole, 'footer')).toBe('.Newcastle. Unknown Team Role');
    expect(formatTeamIdentity(missingRole, 'autocomplete')).toBe('Unknown Team Role');
    expect(formatTeamIdentity(missingRole, 'footer')).not.toContain(missingRole.discordRoleId);
  });

  it('renders role-only autocomplete labels for Unicode and custom emoji teams', () => {
    expect(formatTeamIdentity(unicodeTeam, 'autocomplete')).toBe('@T1');
    expect(formatTeamIdentity(customTeam, 'autocomplete')).toBe('@T2');
  });

  it('never exposes emoji, custom mentions, or raw IDs in autocomplete labels', () => {
    const unicodeLabel = formatTeamIdentity(unicodeTeam, 'autocomplete');
    const customLabel = formatTeamIdentity(customTeam, 'autocomplete');
    expect(unicodeLabel).not.toContain('🔥');
    expect(customLabel).not.toContain('.Newcastle.');
    expect(customLabel).not.toContain('<:Newcastle:223456789012345678>');
    expect(`${unicodeLabel}${customLabel}`).not.toMatch(/\d{17,20}|<@&|<a?:/u);
  });

  it('normalizes role whitespace without duplicate spaces', () => {
    expect(
      formatTeamIdentity(
        {
          emoji: '  🔥  ',
          discordRoleId: ' 123456789012345678 ',
          discordRoleName: ' T1 ',
        },
        'autocomplete',
      ),
    ).toBe('@T1');
  });

  it('keeps role-only autocomplete labels within the Discord choice limit', () => {
    const label = formatTeamIdentity(
      { ...customTeam, discordRoleName: '🧠'.repeat(100) },
      'autocomplete',
    );
    expect(label.length).toBeLessThanOrEqual(autocompleteTeamIdentityMaxLength);
    expect(label).toMatch(/^@/u);
    expect(label.endsWith('\ud83e')).toBe(false);
  });
});
