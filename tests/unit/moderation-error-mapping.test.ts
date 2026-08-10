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
  ModerationTimeoutChangedError,
} from '../../src/domain/errors.js';

describe('moderation command error mapping and classification', () => {
  it('maps missing Case Files configuration without exposing infrastructure detail', () => {
    const error = new ModerationChannelNotConfiguredError('CASE_FILES');
    const mapped = mapDiscordError(error);
    expect(mapped.title).toContain('Moderation Channel Not Configured');
    expect(mapped.description).toContain('/setup channels');
    expect(classifyInteractionError(error)).toMatchObject({
      level: 'info',
      isInfrastructure: false,
    });
  });

  it.each([
    new InvalidModerationDurationError(),
    new ModerationMemberNotFoundError(),
    new ModerationTargetNotModeratableError(),
    new ModerationTimeoutChangedError(),
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
