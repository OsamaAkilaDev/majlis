import { createHmac, timingSafeEqual } from 'node:crypto';
import { parse as parseUuid, stringify as stringifyUuid } from 'uuid';

/**
 * Spec 7.5's QR pass. HMAC-SHA256 over a fixed 22-byte payload, signature
 * truncated to 16: 128 bits of forgery resistance, and a QR sparse enough to
 * decode at arm's length in a badly lit hall.
 *
 * The payload is a user id, a token version and epoch seconds, and NOTHING
 * else. No event data, no personal data: the pass is an identity, not a
 * ticket, which is why one works for every event its holder is registered
 * for.
 *
 * The signing key never reaches a log, an audit row or a response, and the
 * raw token is never stored: only `tokenVersion`, which the signature
 * commits to.
 */
const VERSION = 'v1';
const PAYLOAD_BYTES = 22;

/** Half a SHA-256: 128 bits is beyond any online forgery attempt against a
 *  scan endpoint, and every byte saved is QR density. */
const SIGNATURE_BYTES = 16;

const UUID_BYTES = 16;
const VERSION_OFFSET = UUID_BYTES;
const ISSUED_AT_OFFSET = UUID_BYTES + 2;

export interface PassPayload {
  userId: string;
  tokenVersion: number;
  /** Second precision: the token carries four bytes of epoch seconds. */
  issuedAt: Date;
}

/** Discriminated, not a bare boolean, so a caller cannot mistake a failure
 *  for a payload. Both failures answer INVALID_PASS; the distinction is for
 *  the logs, never the response. */
export type PassVerification =
  | { ok: true; payload: PassPayload }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' };

function encode(payload: PassPayload): Buffer {
  const buf = Buffer.alloc(PAYLOAD_BYTES);
  Buffer.from(parseUuid(payload.userId)).copy(buf, 0);
  // writeUInt16BE throws outside 0..65535, which is the guard wanted: wrapping
  // to 0 would revive a token retired 65536 rotations ago.
  buf.writeUInt16BE(payload.tokenVersion, VERSION_OFFSET);
  buf.writeUInt32BE(Math.floor(payload.issuedAt.getTime() / 1000), ISSUED_AT_OFFSET);
  return buf;
}

function sign(payload: Buffer, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest().subarray(0, SIGNATURE_BYTES);
}

export function signPass(payload: PassPayload, secret: string): string {
  const body = encode(payload);
  return `${VERSION}.${body.toString('base64url')}.${sign(body, secret).toString('base64url')}`;
}

/**
 * Never throws: everything here came from a camera pointed at whatever
 * someone chose to print, so a malformed token is an ordinary outcome and an
 * exception would be a 500 on the scanner screen instead of "invalid pass".
 *
 * `timingSafeEqual`, on buffers already checked to be the same length. That
 * check is on the DECODED signature, a property of the wire format, not a
 * byte-by-byte comparison that would leak the digest.
 */
export function verifyPass(token: string, secret: string): PassVerification {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: 'MALFORMED' };

  const body = Buffer.from(parts[1]!, 'base64url');
  const signature = Buffer.from(parts[2]!, 'base64url');
  if (body.length !== PAYLOAD_BYTES || signature.length !== SIGNATURE_BYTES) {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (!timingSafeEqual(signature, sign(body, secret))) return { ok: false, reason: 'BAD_SIGNATURE' };

  return {
    ok: true,
    payload: {
      userId: stringifyUuid(body.subarray(0, UUID_BYTES)),
      tokenVersion: body.readUInt16BE(VERSION_OFFSET),
      issuedAt: new Date(body.readUInt32BE(ISSUED_AT_OFFSET) * 1000),
    },
  };
}
