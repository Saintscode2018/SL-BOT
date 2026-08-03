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
    [new TeamManagerCannotDemandError(), '❌ Team Manager Cannot Demand'],
    [new NotCurrentlySignedError(), '❌ Not Currently Signed'],
    [new DemandRateLimitedError(42), '❌ Demand Rate Limited'],
    [new CallerHasNoStaffAppointmentError(), '❌ Staff Appointment Required'],
    [new SelfReleaseForbiddenError(), '❌ Cannot Release Yourself'],
    [new TargetNotOnCallerTeamError(), '❌ Player Not On Your Team'],
    [new ReleaseTargetIsFreeAgentError(), '❌ Player Is Already a Free Agent'],
    [new TargetRankNotManageableError(), '❌ Insufficient Staff Authority'],
    [new TeamManagerCannotBeReleasedError(), '❌ Team Manager Cannot Be Released'],
    [new SelfActionForbiddenError(), '❌ Cannot Modify Yourself'],
    [new StaffSlotOccupiedError('PM'), '❌ Staff Position Already Occupied'],
    [new InvalidPromotionPathError(), '❌ Insufficient Staff Authority'],
    [new InvalidDemotionTargetError(), '❌ Player Is Not Staff'],
    [new TargetAlreadyDesiredRankError(), '❌ Roster Action Failed'],
  ])('maps %s without exposing internal identifiers', (error, title) => {
    const mapped = mapDiscordError(error);
    expect(mapped.title).toBe(title);
    expect(`${mapped.title}\n${mapped.description}`).not.toMatch(/\b\d{17,20}\b|stack|database/i);
  });

  it('reports the remaining demand cooldown', () => {
    expect(mapDiscordError(new DemandRateLimitedError(42)).description).toContain('42 seconds');
  });

  it('formats SelfActionForbiddenError description correctly', () => {
    const mapped = mapDiscordError(new SelfActionForbiddenError());
    expect(mapped.title).toBe('❌ Cannot Modify Yourself');
    expect(mapped.description).toBe('You cannot promote or demote yourself with this command.');
  });

  it('formats InvalidPromotionPathError description correctly', () => {
    const mapped = mapDiscordError(new InvalidPromotionPathError());
    expect(mapped.title).toBe('❌ Insufficient Staff Authority');
    expect(mapped.description).toBe(
      'Assistant Team Managers may only promote ordinary players to Player Manager.',
    );
  });

  it('formats InvalidDemotionTargetError description correctly', () => {
    const mapped = mapDiscordError(new InvalidDemotionTargetError());
    expect(mapped.title).toBe('❌ Player Is Not Staff');
    expect(mapped.description).toBe(
      'That player is not currently an Assistant Team Manager or Player Manager.',
    );
  });
});
