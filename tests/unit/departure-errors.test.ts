import { describe, expect, it } from 'vitest';

import { mapDiscordError } from '../../src/bot/error-mapper.js';
import {
  CallerHasNoStaffAppointmentError,
  DemandRateLimitedError,
  InvalidDemotionTargetError,
  InvalidPromotionPathError,
  NotCurrentlySignedError,
  ReleaseTargetIsFreeAgentError,
  SelfActionForbiddenError,
  SelfReleaseForbiddenError,
  StaffSlotOccupiedError,
  TargetAlreadyDesiredRankError,
  TargetNotOnCallerTeamError,
  TargetRankNotManageableError,
  TeamManagerCannotBeReleasedError,
  TeamManagerCannotDemandError,
} from '../../src/domain/errors.js';

describe('Stage 4B.2 and 4B.3 error mapping', () => {
  it.each([
    [new TeamManagerCannotDemandError(), '❌ Team Manager Cannot Demand', undefined],
    [new NotCurrentlySignedError(), '❌ Not Currently Signed', undefined],
    [new DemandRateLimitedError(42), '❌ Demand Rate Limited', undefined],
    [new CallerHasNoStaffAppointmentError(), '❌ Staff Appointment Required', undefined],
    [new SelfReleaseForbiddenError(), '❌ Cannot Release Yourself', undefined],
    [new TargetNotOnCallerTeamError(), '❌ Player Not On Your Team', undefined],
    [new ReleaseTargetIsFreeAgentError(), '❌ Player Is Already a Free Agent', undefined],
    [new TargetRankNotManageableError(), '❌ Insufficient Staff Authority', undefined],
    [new TeamManagerCannotBeReleasedError(), '❌ Team Manager Cannot Be Released', undefined],
    [
      new SelfActionForbiddenError(),
      '❌ Cannot Modify Yourself',
      'You cannot promote or demote yourself with this command.',
    ],
    [new StaffSlotOccupiedError('PM'), '❌ Staff Position Already Occupied', undefined],
    [
      new InvalidPromotionPathError(),
      '❌ Insufficient Staff Authority',
      'Assistant Team Managers may only promote ordinary players to Player Manager.',
    ],
    [
      new InvalidDemotionTargetError(),
      '❌ Player Is Not Staff',
      'That player is not currently an Assistant Team Manager or Player Manager.',
    ],
    [new TargetAlreadyDesiredRankError(), '❌ Roster Action Failed', undefined],
  ] as const)(
    'maps %s without exposing internal identifiers',
    (error, title, expectedDescription) => {
      const mapped = mapDiscordError(error);
      expect(mapped.title).toBe(title);
      expect(`${mapped.title}\n${mapped.description}`).not.toMatch(/\b\d{17,20}\b|stack|database/i);
      if (expectedDescription !== undefined) {
        expect(mapped.description).toBe(expectedDescription);
      }
    },
  );

  it('reports the remaining demand cooldown', () => {
    expect(mapDiscordError(new DemandRateLimitedError(42)).description).toContain('42 seconds');
  });
});
