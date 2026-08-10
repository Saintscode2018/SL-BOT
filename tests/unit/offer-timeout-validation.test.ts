import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../src/domain/errors.js';
import {
  maxOfferTimeoutSeconds,
  parseOfferTimeoutSeconds,
} from '../../src/domain/validation.js';

describe('offer timeout configuration', () => {
  it('accepts the existing default and the supported maximum', () => {
    expect(parseOfferTimeoutSeconds(86_400)).toBe(86_400);
    expect(parseOfferTimeoutSeconds(maxOfferTimeoutSeconds)).toBe(maxOfferTimeoutSeconds);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5])(
    'rejects invalid timeout value %s',
    (value) => {
      expect(() => parseOfferTimeoutSeconds(value)).toThrow(ConfigurationError);
    },
  );

  it('rejects values beyond the supported seven-day lifetime', () => {
    expect(() => parseOfferTimeoutSeconds(maxOfferTimeoutSeconds + 1)).toThrow(
      ConfigurationError,
    );
  });
});
