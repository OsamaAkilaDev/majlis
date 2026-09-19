import { z } from 'zod';
import { PASSWORD_MIN } from '../constants';

export { PASSWORD_MIN };

/**
 * Lowercased and trimmed at the boundary, and used for BOTH directions:
 * signup's INSERT and login's LOOKUP share this one schema.
 *
 * `user.email` carries a `CHECK (email = lower(email))` database constraint.
 * An un-normalised INSERT dies loudly on that constraint: annoying, but
 * self-announcing. An un-normalised LOOKUP has no such backstop: it just
 * fails to find the row and reports "invalid credentials," which reads like
 * a password bug for weeks. One schema for both closes that gap structurally
 * rather than by convention.
 *
 * Order is deliberate: `z.string().trim().email()` trims BEFORE validating
 * the email format, so " Foo@Bar.com " (leading/trailing space, as a pasted
 * address often carries) is accepted and normalised. `z.email().trim()`
 * (the form suggested when this was planned) was tried first and rejected:
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
 * A club role held by the acting user, scoped to one club. `clubName` rides
 * along so the shell can name the console it is offering: an officer of two
 * clubs otherwise sees two rows both reading "Officer", with the club ID the
 * only thing telling them apart. `role` is a plain
 * string rather than a strict enum: this schema is a response shape, not an
 * authorization decision (that's permissions.ts's job, which already pays
 * the cost of keeping a local role union in sync with Prisma's generated
 * enum). A second, differently-drifting copy of the same five-value union
 * here would buy nothing but another place for a renamed role to go unnoticed.
 */
export const sessionClubRoleSchema = z.object({
  clubId: z.string(),
  clubName: z.string(),
  role: z.string(),
});

/**
 * What every authenticated response (signup, login, and Task 11's
 * `/auth/me`) sends back about the acting user. Never includes
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

/**
 * GET /auth/reset-password. Resolves a link to the address it was sent to, so
 * the screen can name the account it is about to change without ever putting
 * the token in front of the user.
 *
 * Deliberately does not consume the token: the screen resolves the link on
 * first paint, and a preview that spent it would make every reset fail at the
 * moment the user pressed the button.
 *
 * Disclosing the address costs nothing. Whoever holds this token can take the
 * account outright, so the email tells them nothing they could not already
 * take. Unknown, expired, used and suspended all answer 401 with the one
 * RESET_LINK_INVALID string, exactly as the POST does.
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
 * GET /auth/bootstrap. One bit, and deliberately only one: the setup screen
 * needs to know whether a platform admin exists, and an unauthenticated
 * caller has no business learning anything else about the account table.
 *
 * `true` means the deployment has never had an admin and the create-admin
 * screen is open. It flips to `false` for good the moment one exists, and
 * no route anywhere flips it back.
 */
export const bootstrapStatusSchema = z.object({ needsAdmin: z.boolean() });
export type BootstrapStatus = z.infer<typeof bootstrapStatusSchema>;

/**
 * The 409 detail POST /auth/bootstrap answers with once the platform has an
 * admin. Shared rather than duplicated because the setup screen matches on
 * it: that 409 means the screen the visitor is looking at no longer exists,
 * which is a redirect, while the OTHER 409 that route can answer (the email
 * is taken) is a message on the email field. A second copy of this string
 * in the web app would turn a one-word server-side edit into a silent
 * mis-routing of both.
 */
export const ADMIN_ALREADY_EXISTS = 'This platform already has an administrator.';
