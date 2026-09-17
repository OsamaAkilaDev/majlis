import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Passw0rd!';
const LONG_PASSWORD = 'a-long-enough-password';

/**
 * Serial, and one project. The student half signs up an account and registers
 * it for a seeded event; run twice at two viewports at once, the two runs
 * answer each other's questions and the failures read as flake.
 */
test.describe.configure({ mode: 'serial' });

// Playwright reads the fixture names out of this destructuring pattern, so
// the first parameter cannot be a plain identifier however unused it is.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'This walk mutates seeded state; once is enough.');
});

async function signIn(page: Page, email: string) {
  // Cleared first: /login bounces a signed-in visitor to their own landing,
  // so switching persona mid-test otherwise never reaches the form.
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
  // A fresh account, not student@: this registers for a seeded event, and
  // taking a seat from the account the accessibility suite reads would change
  // what that suite sees.
  await page.context().clearCookies();
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Inbox Student');
  await page.getByLabel('University email').fill(`inbox-${Date.now()}@uni.ac.ae`);
  await page.getByLabel('Password', { exact: true }).fill(LONG_PASSWORD);
  await page.getByLabel('Confirm password').fill(LONG_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/home$/);

  // The count rides on the bell's accessible name, so a badge that renders
  // the number in pixels alone and never announces it goes red here.
  const bell = page.getByRole('link', { name: /^Notifications/ });
  await expect(bell).toHaveAccessibleName('Notifications');

  await page.goto('/events');
  await page.getByRole('link', { name: /Introduction to ROS 2/ }).click();
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByText('Confirmed')).toBeVisible();

  // The notification row is written in the same transaction as the seat, so
  // it is there the moment the registration is, with no sweep in between.
  await page.goto('/profile/notifications');
  const row = page.getByRole('listitem').filter({ hasText: 'Introduction to ROS 2' });
  await expect(row).toHaveText(/Registration confirmed/);
  // Unread is carried by more than a colour: the row announces it.
  await expect(row.getByText('Unread.')).toBeVisible();
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread');

  // The optimistic update's other half first. Without the rollback the row
  // stays looking read forever and nothing tells the reader it did not save.
  await page.route('**/api/v1/me/notifications/*/read', (route) => route.abort('failed'));
  await row.getByRole('button', { name: /Mark .* read/ }).click();
  // By text, not by role: Next's route announcer is also role="alert".
  await expect(page.getByText('That did not save.')).toBeVisible();
  await expect(row.getByRole('button', { name: /Mark .* read/ })).toBeVisible();
  await expect(row.getByText('Unread.')).toBeVisible();

  await page.unroute('**/api/v1/me/notifications/*/read');
  await row.getByRole('button', { name: /Mark .* read/ }).click();

  // The control goes, and the badge follows, which only happens if the server
  // actually took it.
  await expect(row.getByRole('button', { name: /Mark .* read/ })).toHaveCount(0);
  await expect(bell).toHaveAccessibleName('Notifications');

  await page.reload();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Introduction to ROS 2' }).getByText('Unread.'),
  ).toHaveCount(0);
});

test('an admin reads the audit log', async ({ page }) => {
  // The metrics and CSV-export halves of this test went with those two
  // screens on 2026-09-16. The charts they covered still run on the officer
  // console's own report, which 'a club lead reads their own club report'
  // below asserts.
  await signIn(page, 'admin@uni.ac.ae');
  await expect(page).toHaveURL(/\/admin\/users$/);

  await page.goto('/admin/audit');
  await expect(page.getByRole('columnheader', { name: 'When (UTC)' })).toBeVisible();
  const rows = page.getByRole('row');
  expect(await rows.count()).toBeGreaterThan(1);

  // The filter goes to the server, not to the rendered page: an entity type
  // no row on screen carries must still come back with its own rows.
  await page.getByLabel('Filter by entity type').click();
  await page.getByRole('option', { name: 'EventRegistration', exact: true }).click();

  const entityCells = page.locator('tbody tr td:nth-child(3)');
  await expect(entityCells.first()).toBeVisible();
  for (const text of await entityCells.allTextContents()) {
    // The entity type followed by the row's short id, and nothing else. A
    // substring match would pass against every other type sharing a prefix,
    // which is exactly what a filter dropped on the floor would return.
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
  // The account-existence oracle. Two addresses, one of them seeded, and the
  // screen has to be indistinguishable between them.
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
  // The 401 this page answers must not be mistaken for a dead session: the
  // visitor cannot sign in, and being sent to /login throws away the only
  // message that explains why.
  //
  // The link now resolves on the server, so the refusal arrives before the
  // form does. That is the point: choosing a password twice and only then
  // being told the link was spent is work thrown away.
  await page.context().clearCookies();
  await page.goto('/reset-password?token=not-a-real-token');

  await expect(page.getByText('That password reset link is no longer valid.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
  await expect(page.getByLabel('New password')).toHaveCount(0);
  await expect(page).toHaveURL(/\/reset-password/);
});

test('the reset screen never puts the token in a form control', async ({ page }) => {
  // The defect this change exists to remove: the token used to be the value
  // of a visible, editable field. Reverting that puts it back, and this goes
  // red on the input value rather than on anything cosmetic.
  //
  // Scoped to controls and to visible text on purpose, not to the whole
  // document. The App Router serialises the route's own query string into
  // the RSC flight payload, so a token that travels in the URL is in the
  // page source no matter what this screen renders. That is the cost of the
  // link being a link, and it is not what "shown to the user" means.
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
  // Requested on a phone, opened on the laptop the holder is still signed in
  // on. Bounced to their landing page, the token is never consumed and there
  // is no change-password screen anywhere else to reach.
  //
  // The token here is not a real one, so what this proves is the redirect
  // that must not happen: the visitor stays on /reset-password and is told
  // about the link, rather than landing on /home with no explanation.
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
