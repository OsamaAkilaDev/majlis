import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Passw0rd!';
const LONG_PASSWORD = 'a-long-enough-password';

/** Serial, and one project: the student half takes a seat on a seeded event,
 *  so two concurrent runs answer each other's questions. */
test.describe.configure({ mode: 'serial' });

// Playwright reads the fixture names out of this destructuring pattern, so
// the first parameter cannot be a plain identifier however unused it is.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'This walk mutates seeded state; once is enough.');
});

async function signIn(page: Page, email: string) {
  // Cleared first: /login bounces a signed-in visitor, so switching persona
  // mid-test otherwise never reaches the form.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('University email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test('a registration reaches the inbox, badges the header bell, and marking it read clears both', async ({
  page,
}) => {
  // A fresh account: taking a seat from the one the a11y suite reads would
  // change what that suite sees.
  await page.context().clearCookies();
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Inbox Student');
  await page.getByLabel('University email').fill(`inbox-${Date.now()}@uni.ac.ae`);
  await page.getByLabel('Password', { exact: true }).fill(LONG_PASSWORD);
  await page.getByLabel('Confirm password').fill(LONG_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/home$/);

  // Catches a badge that renders the number in pixels alone and never
  // announces it.
  const bell = page.getByRole('link', { name: /^Notifications/ });
  await expect(bell).toHaveAccessibleName('Notifications');

  await page.goto('/events');
  await page.getByRole('link', { name: /Introduction to ROS 2/ }).click();
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByText('Confirmed')).toBeVisible();

  // Written in the same transaction as the seat, so it is there the moment
  // the registration is, with no sweep in between.
  await page.goto('/profile/notifications');
  const row = page.getByRole('listitem').filter({ hasText: 'Introduction to ROS 2' });
  await expect(row).toHaveText(/Registration confirmed/);
  // Unread is carried by more than a colour: the row announces it.
  await expect(row.getByText('Unread.')).toBeVisible();
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread');

  // Without the rollback the row looks read forever and nothing says it did
  // not save.
  await page.route('**/api/v1/me/notifications/*/read', (route) => route.abort('failed'));
  await row.getByRole('button', { name: /Mark .* read/ }).click();
  // By text, not by role: Next's route announcer is also role="alert".
  await expect(page.getByText('That did not save.')).toBeVisible();
  await expect(row.getByRole('button', { name: /Mark .* read/ })).toBeVisible();
  await expect(row.getByText('Unread.')).toBeVisible();

  await page.unroute('**/api/v1/me/notifications/*/read');
  await row.getByRole('button', { name: /Mark .* read/ }).click();

  // The badge following is the only proof the server took it.
  await expect(row.getByRole('button', { name: /Mark .* read/ })).toHaveCount(0);
  await expect(bell).toHaveAccessibleName('Notifications');

  await page.reload();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Introduction to ROS 2' }).getByText('Unread.'),
  ).toHaveCount(0);
});

test('an admin reads the audit log', async ({ page }) => {
  // The metrics and CSV-export halves went with those screens on 2026-09-16.
  // The charts they covered are asserted by the club report test below.
  await signIn(page, 'admin@uni.ac.ae');
  await expect(page).toHaveURL(/\/admin\/users$/);

  await page.goto('/admin/audit');
  await expect(page.getByRole('columnheader', { name: 'When (UTC)' })).toBeVisible();
  const rows = page.getByRole('row');
  expect(await rows.count()).toBeGreaterThan(1);

  // The filter goes to the server, not the rendered page: a type no row on
  // screen carries must still come back with its own rows.
  await page.getByLabel('Filter by entity type').click();
  await page.getByRole('option', { name: 'EventRegistration', exact: true }).click();

  const entityCells = page.locator('tbody tr td:nth-child(3)');
  await expect(entityCells.first()).toBeVisible();
  for (const text of await entityCells.allTextContents()) {
    // Catches a substring match, which passes against every type sharing a
    // prefix: exactly what a dropped filter returns.
    expect(text).toMatch(/^EventRegistration[0-9a-f]{8}$/);
  }
});

test('a club lead reads their own club report', async ({ page }) => {
  await signIn(page, 'lead@uni.ac.ae');
  const clubId = new URL(page.url()).pathname.split('/')[2];
  await page.goto(`/manage/${clubId}/reports`);

  await expect(page.getByRole('img', { name: /Attendance/ })).toBeVisible();
  await expect(page.getByText('Registrations')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Audit: this club/ })).toBeVisible();
});

test('forgot-password answers the same for a real address and an unknown one', async ({ page }) => {
  // The account-existence oracle: two addresses, one seeded, and the screen
  // must be indistinguishable between them.
  const said: string[] = [];
  for (const email of ['student@uni.ac.ae', `nobody-${Date.now()}@uni.ac.ae`]) {
    await page.context().clearCookies();
    await page.goto('/forgot-password');
    await page.getByLabel('University email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    said.push((await page.getByRole('status').textContent()) ?? '');
  }
  expect(said[0]).toBe(said[1]);
  expect(said[0]).toContain('If that address has an account');
});

test('a reset link that is no longer valid is a dead end, in the API words', async ({ page }) => {
  // This 401 must not be mistaken for a dead session: the visitor cannot sign
  // in, and /login throws away the only message explaining why. The link
  // resolves on the server so the refusal arrives before the form does.
  await page.context().clearCookies();
  await page.goto('/reset-password?token=not-a-real-token');

  await expect(page.getByText('That password reset link is no longer valid.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
  await expect(page.getByLabel('New password')).toHaveCount(0);
  await expect(page).toHaveURL(/\/reset-password/);
});

test('the reset screen never puts the token in a form control', async ({ page }) => {
  // Catches the token being the value of a visible, editable field again.
  //
  // Scoped to controls and visible text on purpose: the App Router serialises
  // the query string into the RSC payload, so a token in the URL is in the
  // page source whatever this screen renders. That is not "shown to the user".
  const token = 'a-token-that-should-never-be-rendered';
  await page.context().clearCookies();
  await page.goto(`/reset-password?token=${token}`);

  await expect(page.getByText('That password reset link is no longer valid.')).toBeVisible();

  const inControls = await page.evaluate(
    (t) =>
      [...document.querySelectorAll('input, textarea, select')].some(
        (el) => (el as HTMLInputElement).value === t,
      ),
    token,
  );
  expect(inControls).toBe(false);
  await expect(page.getByText(token)).toHaveCount(0);
});

test('a signed-in visitor is not bounced off a reset link', async ({ page }) => {
  // Requested on a phone, opened on a laptop still signed in. Bounced, the
  // token is never consumed and there is no other change-password screen.
  // The token is not real, so what this proves is the redirect that must NOT
  // happen: the visitor stays put and is told about the link.
  await signIn(page, 'student@uni.ac.ae');

  await page.goto('/reset-password?token=a-token-from-another-device');

  await expect(page).toHaveURL(/\/reset-password/);
  await expect(page.getByText('That password reset link is no longer valid.')).toBeVisible();
});

test('a reset URL with no token at all goes back to the start of the flow', async ({ page }) => {
  // There is no token field to type one into any more, so a bare
  // /reset-password is a screen that could do nothing but sit there.
  await page.context().clearCookies();
  await page.goto('/reset-password');

  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
});

test('the sign-in form reaches the reset flow', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
});
