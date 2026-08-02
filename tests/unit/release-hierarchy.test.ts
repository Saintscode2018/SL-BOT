import { describe, expect, it } from 'vitest';

import { canReleaseStaffRole, type StaffRoleCode } from '../../src/domain/roster-mutation.js';

describe('/release hierarchy', () => {
  it.each([
    ['TM', null, true],
    ['TM', 'PM', true],
    ['TM', 'ATM', true],
    ['TM', 'TM', false],
    ['ATM', null, true],
    ['ATM', 'PM', true],
    ['ATM', 'ATM', false],
    ['ATM', 'TM', false],
    ['PM', null, true],
    ['PM', 'PM', false],
    ['PM', 'ATM', false],
    ['PM', 'TM', false],
  ] as const)(
    '%s releasing %s is %s',
    (actor: StaffRoleCode, target: StaffRoleCode | null, allowed: boolean) => {
      expect(canReleaseStaffRole(actor, target)).toBe(allowed);
    },
  );
});
