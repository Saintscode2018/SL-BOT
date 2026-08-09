import { describe, expect, it } from 'vitest';

import { mapDiscordError } from '../../src/bot/error-mapper.js';
import { classifyInteractionError } from '../../src/bot/interaction-error-classifier.js';
import {
  InvalidModerationDurationError,
  ModerationChannelNotConfiguredError,
  ModerationCompensationFailedError,
  ModerationMemberNotFoundError,
  ModerationTargetNotModeratableError,
  ModerationTimeoutApplyError,
} from '../../src/domain/errors.js';

describe('moderation command error mapping and classification', () => {
  it('maps missing Case Files configuration without exposing infrastructure detail', () => {
    const mapped = mapDiscordError(new ModerationChannelNotConfiguredError('CASE_FILES'));
    expect(mapped.title).toContain('Moderation Channel Not Configured');
    expect(mapped.description).toContain('/setup channels');
  });

  it.each([
    new InvalidModerationDurationError(),
    new ModerationMemberNotFoundError(),
    new ModerationTargetNotModeratableError(),
  ])('classifies expected moderation rejection %s at info', (error) => {
    expect(classifyInteractionError(error)).toMatchObject({
      level: 'info',
      isInfrastructure: false,
    });
  });

  it.each([new ModerationTimeoutApplyError(), new ModerationCompensationFailedError()])(
    'classifies moderation infrastructure failure %s at error',
    (error) => {
      expect(classifyInteractionError(error)).toMatchObject({
        level: 'error',
        isInfrastructure: true,
      });
    },
  );
});
