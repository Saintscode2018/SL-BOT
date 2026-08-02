import { describe, expect, it } from 'vitest';

import { mapDiscordError } from '../../src/bot/error-mapper.js';
import {
  CallerHasNoStaffAppointmentError,
  DemandRateLimitedError,
  NotCurrentlySignedError,
  ReleaseTargetIsFreeAgentError,
  SelfReleaseForbiddenError,
  TargetNotOnCallerTeamError,
  TargetRankNotManageableError,
  TeamManagerCannotBeReleasedError,
  TeamManagerCannotDemandError,
} from '../../src/domain/errors.js';

describe('Stage 4B.2 departure error mapping', () => {
  it.each([
    [new TeamManagerCannotDemandError(), '❌ Team Manager Cannot Demand'],
    [new NotCurrentlySignedError(), '❌ Not Currently Signed'],
    [new DemandRateLimitedError(42), '❌ Demand Rate Limited'],
    [new CallerHasNoStaffAppointmentError(), '❌ Staff Appointment Required'],
    [new SelfReleaseForbiddenError(), '❌ Cannot Release Yourself'],
    [new TargetNotOnCallerTeamError(), '❌ Player Not On Your Team'],
    [new ReleaseTargetIsFreeAgentError(), '❌ Player Is Already a Free Agent'],
    [new TargetRankNotManageableError(), '❌ Insufficient Staff Authority'],
    [new TeamManagerCannotBeReleasedError(), '❌ Team Manager Cannot Be Released'],
  ])('maps %s without exposing internal identifiers', (error, title) => {
    const mapped = mapDiscordError(error);
    expect(mapped.title).toBe(title);
    expect(`${mapped.title}\n${mapped.description}`).not.toMatch(/\b\d{17,20}\b|stack|database/i);
  });

  it('reports the remaining demand cooldown', () => {
    expect(mapDiscordError(new DemandRateLimitedError(42)).description).toContain('42 seconds');
  });
});
