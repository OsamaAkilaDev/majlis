import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATUS } from './StatusBadge';

const SCHEMA = '../api/prisma/schema.prisma';

/** The status enums a screen renders. Anything else in the schema (ClubRole,
 *  EmailStatus, AuditOutcome, ...) is not a status a badge stands for. */
const STATUS_ENUMS = [
  'RegistrationStatus',
  'EventStatus',
  'ClubStatus',
  'MembershipStatus',
  'CertificateStatus',
  'AppointmentStatus',
] as const;

function valuesOf(schema: string, enumName: string): string[] {
  const block = new RegExp(`enum ${enumName} \\{([^}]*)\\}`).exec(schema);
  if (!block?.[1]) throw new Error(`enum ${enumName} is not in ${SCHEMA}`);
  return block[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line));
}

const schema = readFileSync(SCHEMA, 'utf8');
const schemaValues = STATUS_ENUMS.flatMap((name) => valuesOf(schema, name));

describe('status vocabulary', () => {
  it('finds real values for every status enum, so the extraction itself is not vacuous', () => {
    // Without this, a regex that silently matched nothing would leave every
    // assertion below iterating an empty list and passing against anything.
    expect(schemaValues.length).toBeGreaterThan(20);
    expect(schemaValues).toContain('REGISTRATION_CLOSED');
  });

  it('renders every status value in the schema, and nothing it invents', () => {
    // Read from schema.prisma at test time rather than a duplicated list. The
    // broken implementation this catches: a status enum gains a value in a
    // later migration and renders as a blank badge, or the component keeps a
    // value (LIVE, ISSUED) that is not in any enum and can never be reached.
    expect([...new Set(schemaValues)].sort()).toEqual(Object.keys(STATUS).sort());
  });

  it('gives every value a word as well as a tone', () => {
    // Colour alone must never carry meaning (spec 9.5). An empty label renders
    // a bare coloured pill, which passes a "renders without crashing" test.
    for (const value of schemaValues) {
      const entry = STATUS[value as keyof typeof STATUS];
      expect(entry.label.trim(), `${value} has no word`).not.toBe('');
      expect(entry.tone, `${value} has no tone`).toBeTruthy();
    }
  });

  it('distinguishes cancelled from confirmed by tone', () => {
    // Catches a copy-paste that maps every status to the same tone, which
    // still satisfies the completeness test above.
    expect(STATUS.CANCELLED.tone).not.toBe(STATUS.CONFIRMED.tone);
  });
});
