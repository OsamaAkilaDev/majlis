import { createHmac, timingSafeEqual } from 'node:crypto';
import { parse as parseUuid, stringify as stringifyUuid } from 'uuid';

/**
 * The QR pass token of spec 7.5. HMAC-SHA256 over a fixed 22-byte payload,
 * signature truncated to 16 bytes: 128 bits of forgery resistance, and a
 * wire form short enough that the QR stays sparse enough to decode at arm's
 * length in a badly lit hall.
 *
 * The payload is 16 bytes of user id, 2 bytes of token version and 4 bytes
 * of epoch seconds, and nothing else. No event data, no personal data. The
 * pass is an identity, not a ticket, which is why one pass works for every
 * event the holder is registered for.
 *
 * The signing key is a parameter here and a private field on the one service
 * that holds it. It never appears in a log line, in an audit row, or in a
 * response, and the raw token is never stored: only `tokenVersion`, which
 * the signature commits to.
 */
const VERSION = 'v1';
const PAYLOAD_BYTES = 22;

/**
 * Half a SHA-256. 128 bits is well beyond what an online forgery attempt
 * against a scan endpoint could reach, and every byte saved here is QR
 * density the operator's camera does not have to resolve.
 */
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

/**
 * Discriminated rather than a bare boolean so a caller cannot mistake a
 * verification failure for a payload. `MALFORMED` and `BAD_SIGNATURE` are
 * both answered to the operator as INVALID_PASS; the distinction exists for
 * the logs, not for the response.
 */
export type PassVerification =
  | { ok: true; payload: PassPayload }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' };

function encode(payload: PassPayload): Buffer {
  const buf = Buffer.alloc(PAYLOAD_BYTES);
  Buffer.from(parseUuid(payload.userId)).copy(buf, 0);
  // writeUInt16BE throws on anything outside 0..65535, which is the only
  // guard a token version needs: reaching 65536 rotations means something
  // is rotating in a loop, and silently wrapping to 0 would revive a token
  // retired 65536 rotations ago.
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
 * Never throws. Everything reaching this arrived from a camera pointed at
 * whatever someone chose to print, so a malformed token is an ordinary
 * outcome and a thrown exception there would be a 500 on the scanner screen
 * instead of "invalid pass".
 *
 * The signature is compared with `timingSafeEqual`, on buffers already
 * checked to be the same length. The length check is on the DECODED
 * signature, so it is a property of the wire format rather than a
 * byte-by-byte comparison that would leak the real digest.
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
