import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Passw0rd!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('University email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Without this, a caller that reads cookies or navigates straight after
  // races the sign-in redirect and sees an unauthenticated request.
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

test('a student lands on /events', async ({ page }) => {
  await signIn(page, 'student@uni.ac.ae');
  await expect(page).toHaveURL(/\/events$/);
});

test('a student is refused the admin console', async ({ page }) => {
  // Spec 12's IDOR case. Hiding the link is presentation, never protection,
  // so this navigates directly.
  await signIn(page, 'student@uni.ac.ae');
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible();
});

test('a wrong password reports on the field in the API words, and no shell renders', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('University email').fill('student@uni.ac.ae');
  await page.getByLabel('Password').fill('wrong-password-here');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The exact server string: a paraphrase drifts the moment either side is
  // reworded.
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
  // exact, here and everywhere below: "Confirm password" also contains the
  // word "Password", and getByLabel matches on substring.
  await page.getByLabel('Password', { exact: true }).fill('Passw0rd!');
  await page.getByLabel('Confirm password').fill('Passw0rd!');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByText(/at least 12 characters/i)).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);
});

test('an existing account reports on the email field, not the password field', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Duplicate Student');
  await page.getByLabel('University email').fill('student@uni.ac.ae');
  await page.getByLabel('Password', { exact: true }).fill('a-long-enough-password');
  await page.getByLabel('Confirm password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Catches a status map that sends every auth failure to the password field:
  // the email is the value the user actually has to change.
  await expect(page.getByLabel('University email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Password', { exact: true })).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
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
  await page.getByLabel('Password', { exact: true }).fill('a-long-enough-password');
  await page.getByLabel('Confirm password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/events$/);
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
  // exact: true, so a section heading on the screen cannot stand in for the
  // page's own title and hide a shell that never rendered.
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
});

test('signing in on a phone viewport shows the tab bar', async ({ page }) => {
  // Pinned: the desktop project is above the breakpoint where the tab bar is
  // replaced by the side nav, and would otherwise measure a sidebar row here.
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'student@uni.ac.ae');
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav).toBeVisible();
  await page.getByRole('link', { name: 'QR', exact: true }).click();
  await expect(page.getByRole('link', { name: 'QR', exact: true })).toHaveAttribute('aria-current', 'page');
  // The profile left the tab bar for the avatar in the header, and /profile/qr
  // is a tab in its own right, so standing on it must not light the avatar too.
  const avatar = page.getByRole('link', { name: 'Profile' });
  await expect(avatar).not.toHaveAttribute('aria-current', 'page');

  await page.goto('/profile/registrations');
  await expect(avatar).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'QR', exact: true })).not.toHaveAttribute('aria-current', 'page');
  // And nothing in the tab bar is lit there at all: a stray /profile entry in
  // TABS would light a tab and swallow /profile/qr with it.
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);

  // Task 8 carry-forward, still worth measuring now that the safe-area inset
  // moved from padding inside the <nav> to the dock's bottom offset: the tab
  // must stay a real 44px+ target and not be squeezed by the bar's own
  // padding. Measured on a real mobile viewport, not computed.
  const tabHeight = await nav.getByRole('link', { name: 'Events', exact: true }).evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  console.warn(`[tab-row-height] ${tabHeight}px at viewport ${page.viewportSize()?.width}x${page.viewportSize()?.height}`);
  expect(tabHeight).toBeGreaterThanOrEqual(44);
});

test('signing out ends the session server-side, not only in the browser', async ({ page }) => {
  // Signs up rather than reusing the seeded student, because logout stamps
  // sessionsInvalidatedAt on the whole user. Sharing an account with the 27
  // other tests that sign in as the seeded student made every one of them a
  // coin flip: whichever was mid-navigation when this ran bounced to /login.
  const email = `signout-${Date.now()}@uni.ac.ae`;
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Sign Out');
  await page.getByLabel('University email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('a-long-enough-password');
  await page.getByLabel('Confirm password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/events$/);

  // Through the avatar, which is now a link to /profile rather than a menu,
  // and the sign-out control lives on that screen.
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // The assertion that matters. Landing on /login proves only that the client
  // navigated; a sign-out that cleared nothing server-side would still let this
  // navigation through on the surviving refresh cookie.
  await page.goto('/events');
  await expect(page).toHaveURL(/\/login$/);
});

test('an officer lands in the student shell and is offered no console', async ({ page }) => {
  // Stage 9 closed the club console to everyone but an Admin. `landingFor`
  // sends every non-admin to /events, and `shellDestinations` answers an
  // officer with nothing, so the "Switch to" section on /profile is not
  // rendered at all rather than rendered empty. lead@ is the account that
  // proves it: they hold a club role and still get neither.
  await signIn(page, 'lead@uni.ac.ae');
  await expect(page).toHaveURL(/\/events$/);

  await page.goto('/profile');
  // Waited for first, or the absence below passes on a page that rendered
  // nothing at all.
  await expect(page.getByRole('heading', { name: 'My clubs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Switch to', exact: true })).toHaveCount(0);
});

test('/login and /signup reach each other', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('/setup is closed once the platform has an admin', async ({ page }) => {
  // The seeded database has one, so this is the state every deployment is in
  // after first use, forever. Catches a create-admin screen that stays
  // reachable: it is unauthenticated by design, and the redirect is the only
  // thing standing between a visitor and that form.
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('signup refuses a mistyped confirmation without ever calling the API', async ({ page }) => {
  // The comparison has to happen in the browser: the contract carries one
  // password field, so the server has nothing to compare against and never
  // will. Counting requests is what separates a real check from one that
  // submits anyway and happens to look right.
  let calls = 0;
  await page.route('**/api/v1/auth/signup', (route) => {
    calls += 1;
    return route.abort('failed');
  });

  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Typo Student');
  await page.getByLabel('University email').fill(`typo-${Date.now()}@uni.ac.ae`);
  await page.getByLabel('Password', { exact: true }).fill('a-long-enough-password');
  await page.getByLabel('Confirm password').fill('a-long-enough-passwodr');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText('Both passwords must match.')).toBeVisible();
  await expect(page.getByLabel('Confirm password')).toHaveAttribute('aria-invalid', 'true');
  expect(calls).toBe(0);
});
