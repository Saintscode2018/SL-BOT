import { describe, expect, it } from 'vitest';

import { InvalidBannerConfigurationError } from '../../src/domain/errors.js';
import {
  autocompleteBannerMaxLength,
  formatTeamBanner,
  type TeamBannerConfig,
} from '../../src/domain/team-label.js';

const team = {
  emoji: '🔵',
  name: 'Chelsea',
  shortName: 'CHE',
  discordRoleId: '123456789012345678',
  discordRoleName: 'Chelsea',
};

const allComponents: Array<keyof TeamBannerConfig> = [
  'bannerHasEmoji',
  'bannerHasName',
  'bannerHasShort',
  'bannerHasRole',
];

function config(enabled: Array<keyof TeamBannerConfig>): TeamBannerConfig {
  return {
    bannerHasEmoji: enabled.includes('bannerHasEmoji'),
    bannerHasName: enabled.includes('bannerHasName'),
    bannerHasShort: enabled.includes('bannerHasShort'),
    bannerHasRole: enabled.includes('bannerHasRole'),
  };
}

describe('team banner formatter', () => {
  it('uses emoji and role by default and preserves fixed order when all components are enabled', () => {
    expect(formatTeamBanner(team)).toBe('🔵 <@&123456789012345678>');
    expect(formatTeamBanner(team, config(allComponents))).toBe(
      '🔵 Chelsea (CHE) <@&123456789012345678>',
    );
    expect(formatTeamBanner(team, config(allComponents), 'autocomplete')).toBe(
      '🔵 Chelsea (CHE) @Chelsea',
    );
  });

  it.each([
    [['bannerHasEmoji'], '🔵'],
    [['bannerHasName'], 'Chelsea'],
    [['bannerHasShort'], '(CHE)'],
    [['bannerHasRole'], '<@&123456789012345678>'],
    [['bannerHasEmoji', 'bannerHasName'], '🔵 Chelsea'],
    [['bannerHasName', 'bannerHasShort'], 'Chelsea (CHE)'],
    [['bannerHasEmoji', 'bannerHasRole'], '🔵 <@&123456789012345678>'],
  ] as Array<[Array<keyof TeamBannerConfig>, string]>)('%j produces %s', (enabled, expected) => {
    expect(formatTeamBanner(team, config(enabled))).toBe(expected);
  });

  it('rejects an all false configuration', () => {
    expect(() => formatTeamBanner(team, config([]))).toThrow(InvalidBannerConfigurationError);
  });

  it('uses real custom emoji and role mentions in embeds without unsafe autocomplete ids', () => {
    const customTeam = {
      ...team,
      name: 'Newcastle',
      shortName: 'NEW',
      emoji: '<:Newcastle:987654321098765432>',
      discordRoleId: '876543210987654321',
      discordRoleName: 'Newcastle',
    };
    expect(formatTeamBanner(customTeam)).toBe(
      '<:Newcastle:987654321098765432> <@&876543210987654321>',
    );
    const autocomplete = formatTeamBanner(customTeam, config(allComponents), 'autocomplete');
    expect(autocomplete).toBe('.Newcastle. Newcastle (NEW) @Newcastle');
    expect(autocomplete).not.toContain('987654321098765432');
    expect(autocomplete).not.toContain('876543210987654321');
    expect(autocomplete).not.toContain('<:');
    expect(autocomplete).not.toContain(':Newcastle:');
  });

  it('omits unavailable legacy emoji and unresolved autocomplete roles safely', () => {
    expect(formatTeamBanner({ ...team, emoji: null, discordRoleId: null })).toBe('Chelsea');
    expect(formatTeamBanner({ ...team, discordRoleName: null }, undefined, 'autocomplete')).toBe(
      '🔵',
    );
    expect(formatTeamBanner({ ...team, emoji: null }, config(['bannerHasEmoji']))).toBe('Chelsea');
    expect(
      formatTeamBanner(
        { ...team, discordRoleName: null },
        config(['bannerHasRole']),
        'autocomplete',
      ),
    ).toBe('Chelsea');
  });

  it('limits long autocomplete banners without splitting joined emoji or exposing raw ids', () => {
    const value = formatTeamBanner(
      {
        emoji: '<a:NewcastleUnitedBadgeLongName:987654321098765432>',
        name: `Newcastle ${'👨‍👩‍👧‍👦 United '.repeat(12)}`,
        shortName: 'NEWCASTLE123',
        discordRoleId: '876543210987654321',
        discordRoleName: `Newcastle ${'Administration '.repeat(12)}`,
      },
      config(allComponents),
      'autocomplete',
    );

    expect(value.length).toBeLessThanOrEqual(autocompleteBannerMaxLength);
    expect(value).toContain('.NewcastleUnitedBadgeLongName.');
    expect(value).toContain('(NEWCASTLE123)');
    expect(value).not.toMatch(/[\uD800-\uDBFF]$/u);
    expect(value).not.toContain('987654321098765432');
    expect(value).not.toContain('876543210987654321');
    expect(value).not.toMatch(/\s{2,}/u);
    expect(value).not.toMatch(/(?:\(|@)$/u);
  });
});
