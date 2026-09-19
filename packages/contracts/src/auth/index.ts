import { z } from 'zod';
import { PASSWORD_MIN } from '../constants';

export { PASSWORD_MIN };

/**
 * One schema for signup's INSERT and login's LOOKUP both. `user.email` has a
 * `CHECK (email = lower(email))`, so an un-normalised INSERT dies loudly; an
 * un-normalised LOOKUP has no backstop and reports "invalid credentials",
 * which reads as a password bug for weeks.
 *
 * Order matters: `.string().trim().email()` trims before validating, so a
 * pasted " Foo@Bar.com " is accepted. `.email().trim()` validates the string
 * as received and rejects it. Verified against zod@4.5.4.
 */
export const emailSchema = z
  .string()
  .trim()
  .email()
  .transform((v) => v.toLowerCase());

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
 * `role` is a plain string, not an enum, on purpose: this is a response
 * shape, not an authorization decision. permissions.ts already pays to keep
 * one role union in step with Prisma's; a second copy here would only add
 * another place for a renamed role to go unnoticed.
 */
export const sessionClubRoleSchema = z.object({
  clubId: z.string(),
  clubName: z.string(),
  role: z.string(),
});

/** The one shape every auth endpoint returns. Never includes `passwordHash`. */
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
export type SessionUser = z.infer<typeof sessionUserSchema>;

/**
 * Always answers 202, resolved or not: anything else is an account-existence
 * oracle. Timing is not equalised, a known and accepted limit.
 */
export const forgotPasswordBodySchema = z.object({ email: emailSchema });

/** The raw token is never stored: only its sha256 lives in
 *  password_reset_token, as refresh_token already does. */
export const resetPasswordBodySchema = z.object({
  token: z.string().min(1, 'A reset token is required.'),
  password: z.string().min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`),
});

/**
 * Deliberately does NOT consume the token: the screen resolves the link on
 * first paint, and a preview that spent it would fail every reset at the
 * moment the button was pressed.
 *
 * Disclosing the address costs nothing: whoever holds the token can take the
 * account outright. Unknown, expired, used and suspended all answer 401 with
 * the one RESET_LINK_INVALID string, as the POST does.
 */
export const resetPasswordPreviewQuerySchema = z.object({
  token: z.string().min(1, 'A reset token is required.'),
});

export const resetPasswordPreviewSchema = z.object({ email: z.string() });

export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
export type ResetPasswordPreviewQuery = z.infer<typeof resetPasswordPreviewQuerySchema>;
export type ResetPasswordPreview = z.infer<typeof resetPasswordPreviewSchema>;

/**
 * One bit, and deliberately only one: an unauthenticated caller has no
 * business learning anything else about the account table. Flips to `false`
 * for good the moment an admin exists; no route flips it back.
 */
export const bootstrapStatusSchema = z.object({ needsAdmin: z.boolean() });
export type BootstrapStatus = z.infer<typeof bootstrapStatusSchema>;

/**
 * Shared, never duplicated: the setup screen MATCHES on this string to tell
 * "the screen no longer exists" (a redirect) from the other 409 that route
 * answers, "the email is taken" (a field message). A second copy in the web
 * app turns a one-word server edit into a silent mis-routing of both.
 */
export const ADMIN_ALREADY_EXISTS = 'This platform already has an administrator.';
