import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { needsOverrideReason } from './override';

describe('needsOverrideReason', () => {
  it('asks a club-roleless Admin and nobody else', () => {
    // The regression this guards: no screen collected a reason, so every
    // Admin edit of an event or a club came back 422 with no control to fix
    // it. The false cases matter as much: a control shown to a club officer
    // would ask them for a reason the API neither wants nor records.
    expect(needsOverrideReason('ADMIN', [])).toBe(true);
    expect(needsOverrideReason('ADMIN', ['LEAD'])).toBe(false);
    expect(needsOverrideReason('ADMIN', ['MARKETING'])).toBe(false);
    expect(needsOverrideReason('STUDENT', [])).toBe(false);
    expect(needsOverrideReason('STUDENT', ['LEAD'])).toBe(false);
  });

  it('matches the rule the API enforces', () => {
    // The same mirror argument as event-fields.test.ts: a decision made in
    // two places is only safe while both say the same thing.
    const source = readFileSync('../api/src/auth/field-permissions.ts', 'utf8');
    expect(source).toContain(
      "if (facts.platformRole !== 'ADMIN' || facts.clubRoles.length > 0) return undefined;",
    );
  });
});
