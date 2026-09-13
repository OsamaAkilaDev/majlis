import { z } from 'zod';

/**
 * Lowercased and trimmed at the boundary, and used for BOTH directions:
 * signup's INSERT and login's LOOKUP share this one schema.
 *
 * `user.email` carries a `CHECK (email = lower(email))` database constraint.
 * An un-normalised INSERT dies loudly on that constraint — annoying, but
 * self-announcing. An un-normalised LOOKUP has no such backstop: it just
 * fails to find the row and reports "invalid credentials," which reads like
 * a password bug for weeks. One schema for both closes that gap structurally
 * rather than by convention.
 *
 * Order is deliberate: `z.string().trim().email()` trims BEFORE validating
 * the email format, so " Foo@Bar.com " (leading/trailing space, as a pasted
 * address often carries) is accepted and normalised. `z.email().trim()` —
 * the form suggested when this was planned — was tried first and rejected:
 * verified directly against the installed zod@4.5.4, `.email()`'s format
 * check runs on the string as received, before `.trim()` gets a chance to
 * run, so a padded address fails validation before normalisation ever
 * happens. `z.string().trim().email()` was verified to behave correctly
 * (trims, then validates, then the transform below lowercases) and to
 * survive `createZodDto` + the OpenAPI generator without incident.
 */
export const emailSchema = z
  .string()
  .trim()
  .email()
  .transform((v) => v.toLowerCase());

/** Exported so the signup form states the rule from the schema that enforces it. */
export const PASSWORD_MIN = 12;

export const signupBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`),
  fullName: z.string().trim().min(1).max(120),
});

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
});

/**
 * A club role held by the acting user, scoped to one club. `role` is a plain
 * string rather than a strict enum — this schema is a response shape, not an
 * authorization decision (that's permissions.ts's job, which already pays
 * the cost of keeping a local role union in sync with Prisma's generated
 * enum). A second, differently-drifting copy of the same five-value union
 * here would buy nothing but another place for a renamed role to go unnoticed.
 */
export const sessionClubRoleSchema = z.object({
  clubId: z.string(),
  role: z.string(),
});

/**
 * What every authenticated response — signup, login, and Task 11's
 * `/auth/me` — sends back about the acting user. Never includes
 * `passwordHash`; this is the one shape every auth endpoint returns.
 */
export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  avatarUrl: z.string().nullable(),
  platformRole: z.enum(['STUDENT', 'ADMIN']),
  clubRoles: z.array(sessionClubRoleSchema),
});

export type SignupBody = z.infer<typeof signupBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type SessionClubRole = z.infer<typeof sessionClubRoleSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;

/**
 * POST /auth/forgot-password. Always answers 202, whether or not the address
 * resolves: an endpoint that answers differently is an account-existence
 * oracle. The timing is not equalised, which is a known and accepted limit;
 * the protection here is that the answer carries nothing.
 */
export const forgotPasswordBodySchema = z.object({ email: emailSchema });

/**
 * POST /auth/reset-password. The raw token comes back from the email link and
 * is never stored anywhere: only its sha256 lives in password_reset_token,
 * exactly as refresh_token already does.
 */
export const resetPasswordBodySchema = z.object({
  token: z.string().min(1, 'A reset token is required.'),
  password: z.string().min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`),
});

export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
