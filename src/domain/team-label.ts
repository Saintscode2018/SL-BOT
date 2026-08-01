import { InvalidBannerConfigurationError } from './errors.js';

export interface TeamBannerSource {
  name: string;
  shortName: string;
  emoji?: string | null;
  discordRoleId?: string | null;
  discordRoleName?: string | null;
}

export interface TeamBannerConfig {
  bannerHasEmoji: boolean;
  bannerHasName: boolean;
  bannerHasShort: boolean;
  bannerHasRole: boolean;
}

export type TeamBannerMode = 'embed' | 'autocomplete';

export const defaultTeamBannerConfig: TeamBannerConfig = {
  bannerHasEmoji: true,
  bannerHasName: true,
  bannerHasShort: true,
  bannerHasRole: true,
};

export const autocompleteBannerMaxLength = 100;

const CUSTOM_EMOJI_MENTION_REGEX = /^<a?:([a-zA-Z0-9_]{2,32}):\d{17,20}>$/;

function graphemes(value: string): string[] {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(
    ({ segment }) => segment,
  );
}

export function isTeamBannerConfigValid(config: TeamBannerConfig): boolean {
  return (
    config.bannerHasEmoji || config.bannerHasName || config.bannerHasShort || config.bannerHasRole
  );
}

export function requireValidTeamBannerConfig(config: TeamBannerConfig): TeamBannerConfig {
  if (!isTeamBannerConfigValid(config)) throw new InvalidBannerConfigurationError();
  return config;
}

export function teamBannerConfigFrom(
  source: Partial<TeamBannerConfig> | null | undefined,
): TeamBannerConfig {
  return {
    bannerHasEmoji: source?.bannerHasEmoji ?? true,
    bannerHasName: source?.bannerHasName ?? true,
    bannerHasShort: source?.bannerHasShort ?? true,
    bannerHasRole: source?.bannerHasRole ?? true,
  };
}

function autocompleteEmoji(team: TeamBannerSource): string | null {
  const emoji = team.emoji?.trim();
  if (!emoji) return null;

  const customEmoji = CUSTOM_EMOJI_MENTION_REGEX.exec(emoji);
  return customEmoji ? `:${customEmoji[1]}:` : emoji;
}

function renderBannerComponents(
  team: TeamBannerSource,
  config: TeamBannerConfig,
  mode: TeamBannerMode,
  name: string,
  roleName: string,
): string {
  const components: string[] = [];
  const emoji = mode === 'autocomplete' ? autocompleteEmoji(team) : team.emoji?.trim() || null;
  if (config.bannerHasEmoji && emoji) components.push(emoji);
  if (config.bannerHasName && name) components.push(name);
  if (config.bannerHasShort && team.shortName.trim()) {
    components.push(`(${team.shortName.trim()})`);
  }
  if (config.bannerHasRole) {
    if (mode === 'embed' && team.discordRoleId?.trim()) {
      components.push(`<@&${team.discordRoleId.trim()}>`);
    } else if (mode === 'autocomplete' && roleName) {
      components.push(`@${roleName}`);
    }
  }
  return components.join(' ');
}

function limitAutocompleteBanner(team: TeamBannerSource, config: TeamBannerConfig): string {
  let name = team.name.trim();
  let roleName = team.discordRoleName?.trim() ?? '';
  const render = (): string =>
    renderBannerComponents(team, config, 'autocomplete', name, roleName) || name;
  let rendered = render();

  while (rendered.length > autocompleteBannerMaxLength && roleName.length > 0) {
    const segments = graphemes(roleName);
    segments.pop();
    roleName = segments.join('').trimEnd();
    rendered = render();
  }
  while (rendered.length > autocompleteBannerMaxLength && name.length > 0) {
    const segments = graphemes(name);
    segments.pop();
    name = segments.join('').trimEnd();
    rendered = render();
  }

  let limited = '';
  for (const segment of graphemes(rendered)) {
    if (limited.length + segment.length > autocompleteBannerMaxLength) break;
    limited += segment;
  }
  return limited.trim();
}

export function formatTeamBanner(
  team: TeamBannerSource,
  config: TeamBannerConfig = defaultTeamBannerConfig,
  mode: TeamBannerMode = 'embed',
): string {
  requireValidTeamBannerConfig(config);
  if (mode === 'autocomplete') return limitAutocompleteBanner(team, config);
  return (
    renderBannerComponents(
      team,
      config,
      mode,
      team.name.trim(),
      team.discordRoleName?.trim() ?? '',
    ) || team.name.trim()
  );
}
