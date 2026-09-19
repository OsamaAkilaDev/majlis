import { z } from 'zod';

/**
 * Spec 6.1: "Every Admin override requires a recorded reason and writes an
 * audit row in the same transaction as the overridden action."
 *
 * Always optional on the wire, because the same body is sent by club officers
 * acting in their own capacity, for whom the action is not an override at all.
 * Which it is, is decided server-side by `overrideReasonFor`.
 */
export const overrideReasonSchema = z.string().trim().min(1).max(500);

/**
 * The whole body of an action that carries nothing but an override reason.
 *
 * Defaulted rather than merely optional: Express leaves `req.body` undefined
 * when a request sends none at all, and a bare object schema would answer 400
 * to every POST /publish and DELETE that has nothing to say.
 */
export const overrideBodySchema = z
  .object({ overrideReason: overrideReasonSchema.optional() })
  .optional()
  .default({});

