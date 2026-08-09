import { describe, expect, it } from 'vitest';

import {
  InvalidModerationDurationError,
  ModerationTimeoutTooLongError,
} from '../../src/domain/errors.js';
import {
  formatModerationDuration,
  maximumDiscordTimeoutSeconds,
  parseModerationDuration,
} from '../../src/domain/moderation-duration.js';

describe('moderation duration parsing and presentation', () => {
  it.each([
    ['30s', 30],
    ['10m', 600],
    ['1h', 3_600],
    ['2h30m', 9_000],
    ['1d', 86_400],
    ['3d12h', 302_400],
    ['28d', maximumDiscordTimeoutSeconds],
  ])('parses %s into normalized integer seconds', (input, expected) => {
    expect(parseModerationDuration(input)).toBe(expected);
  });

  it.each(['', 'later', '1.5h', '-1h', '+1h', '1h30', '30m2h', '1h1h', '1 h', '0', '0s'])(
    'rejects malformed or zero duration %j',
    (input) => {
      expect(() => parseModerationDuration(input)).toThrow(InvalidModerationDurationError);
    },
  );

  it.each(['28d1s', '29d', '999999999999999999999999999999999999d'])(
    'rejects Discord timeout overflow %s with a typed maximum error',
    (input) => {
      expect(() => parseModerationDuration(input)).toThrow(ModerationTimeoutTooLongError);
    },
  );

  it.each([
    [30, '30 seconds'],
    [600, '10 minutes'],
    [3_600, '1 hour'],
    [9_000, '2 hours 30 minutes'],
    [86_400, '1 day'],
  ])('formats %d seconds as %s', (seconds, expected) => {
    expect(formatModerationDuration(seconds)).toBe(expected);
  });
});
