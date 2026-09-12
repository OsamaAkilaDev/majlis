import { randomBytes } from 'node:crypto';

/**
 * Crockford's base32 alphabet. The omissions are the whole point: I, L, O
 * and U are absent, so a code read aloud down a phone line or copied off a
 * printed certificate cannot be confused between 1 and I, 0 and O, or turn
 * into a word nobody wants to read out. Do not substitute RFC 4648's
 * alphabet, which includes all four.
 */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 32 divides 256 exactly, so `byte % 32` is uniform over the alphabet. This
 * is the one modulo in the codebase that carries no bias, and it only holds
 * because the alphabet is a power of two.
 */
function crockford(length: number): string {
  return Array.from(randomBytes(length), (b) => CROCKFORD[b % CROCKFORD.length]).join('');
}

const SERIAL_CHARS = 8;

/**
 * Six groups of five: 30 characters at five bits each is 150 bits, which
 * clears spec 5.1's 128-bit floor with room to spare and, unlike the 26
 * characters 128 bits would strictly need, divides evenly into groups a
 * person can read aloud.
 */
const CODE_GROUPS = 6;
const GROUP_SIZE = 5;

/** `MJL-<year>-<8 chars>`. Short enough to quote over a phone. */
export function serialNumber(now = new Date()): string {
  return `MJL-${now.getUTCFullYear()}-${crockford(SERIAL_CHARS)}`;
}

export function verificationCode(): string {
  return Array.from({ length: CODE_GROUPS }, () => crockford(GROUP_SIZE)).join('-');
}
