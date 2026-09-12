import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Passw0rd!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('University email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Without this, callers that read cookies or navigate right after race the
  // sign-in redirect and see an unauthenticated request.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test('/ redirects an anonymous visitor to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('an admin lands on /admin', async ({ page }) => {
  await signIn(page, 'admin@uni.ac.ae');
  await expect(page).toHaveURL(/\/admin\/metrics$/);
});

test('a student lands on /home', async ({ page }) => {
  await signIn(page, 'student@uni.ac.ae');
  await expect(page).toHaveURL(/\/home$/);
});

test('a student is refused the admin console', async ({ page }) => {
  // The IDOR case from spec 12. Hiding the link is presentation, never
  // protection, so this navigates directly.
  await signIn(page, 'student@uni.ac.ae');
  await page.goto('/admin/metrics');
  await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible();
});

test('a wrong password reports on the field in the API words, and no shell renders', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('University email').fill('student@uni.ac.ae');
  await page.getByLabel('Password').fill('wrong-password-here');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The exact server string, not a client paraphrase: a rewritten message
  // drifts silently the moment either side is reworded.
  const password = page.getByLabel('Password');
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await password.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toHaveText(/Email or password is incorrect\./);
  await expect(page).toHaveURL(/\/login$/);
});

test('a short password reports the rule the contract enforces, on the password field', async ({ page }) => {
  // The signup defect: the 12-character minimum was invisible until submit.
  await page.goto('/signup');
  await expect(page.getByText('12+ characters')).toBeVisible();

  await page.getByLabel('Full name').fill('Too Short');
  await page.getByLabel('University email').fill(`short-${Date.now()}@uni.ac.ae`);
  await page.getByLabel('Password').fill('Passw0rd!');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(/at least 12 characters/i)).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);
});

test('an existing account reports on the email field, not the password field', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Duplicate Student');
  await page.getByLabel('University email').fill('student@uni.ac.ae');
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Catches a status map that sends every auth failure to the password field:
  // the email is the value the user actually has to change.
  await expect(page.getByLabel('University email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Password')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('An account with this email already exists.')).toBeVisible();
});

test('a request that never reaches the server is reported on the form', async ({ page }) => {
  // A toast is missable and a silent failure reads as a broken button.
  await page.route('**/api/v1/auth/login', (route) => route.abort('failed'));
  await page.goto('/login');
  await page.getByLabel('University email').fill('student@uni.ac.ae');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Scoped to the form: Next's route announcer is also role="alert".
  await expect(page.locator('form').getByRole('alert')).toHaveText(/Could not reach the server/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

test('a new account can be created and lands in the student shell', async ({ page }) => {
  // Proves the 201 path end to end, which the invisible minimum made look broken.
  const email = `new-${Date.now()}@uni.ac.ae`;
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('New Student');
  await page.getByLabel('University email').fill(email);
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test('an expired session is refreshed on navigation rather than bounced', async ({ page, context }) => {
  // The defect Task 4 exists to fix. Clearing only the session cookie models
  // 15 minutes of idling; the 30-day refresh cookie stays.
  await signIn(page, 'student@uni.ac.ae');
  const kept = (await context.cookies()).filter((c) => c.name !== 'majlis_session');
  await context.clearCookies();
  await context.addCookies(kept);

  await page.goto('/events');
  await expect(page).toHaveURL(/\/events$/);
  // exact: true, or this also matches the "No events yet" empty-state heading.
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
});

test('signing in on a phone viewport shows the tab bar', async ({ page }) => {
  await signIn(page, 'student@uni.ac.ae');
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav).toBeVisible();
  await page.getByRole('link', { name: 'My QR' }).click();
  await expect(page.getByRole('link', { name: 'My QR' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Me', exact: true })).not.toHaveAttribute('aria-current', 'page');

  await page.goto('/me/registrations');
  await expect(page.getByRole('link', { name: 'Me', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'My QR' })).not.toHaveAttribute('aria-current', 'page');

  // Task 8 carry-forward: pb-[var(--safe-b)] sits on the whole <nav>, which a
  // reviewer flagged could compress the 56px tab row instead of padding
  // below it. Measure the rendered row on a real mobile viewport.
  const tabHeight = await page.getByRole('link', { name: 'Home' }).evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  console.warn(`[tab-row-height] ${tabHeight}px at viewport ${page.viewportSize()?.width}x${page.viewportSize()?.height}`);
  expect(tabHeight).toBeGreaterThanOrEqual(44);
});

test('signing out ends the session server-side, not only in the browser', async ({ page }) => {
  await signIn(page, 'student@uni.ac.ae');
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // The assertion that matters. Landing on /login proves only that the client
  // navigated; a sign-out that cleared nothing server-side would still let this
  // navigation through on the surviving refresh cookie.
  await page.goto('/home');
  await expect(page).toHaveURL(/\/login$/);
});

test('an admin who also leads a club can reach both shells from the menu', async ({ page }) => {
  // admin@ holds no club role, so lead@ is the multi-destination account here:
  // without a switcher an officer had no way back to the student shell.
  await signIn(page, 'lead@uni.ac.ae');
  await expect(page).toHaveURL(/\/manage\/[^/]+\/overview$/);
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Home' }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test('/login and /signup reach each other', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
