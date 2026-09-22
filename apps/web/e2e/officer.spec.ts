import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Passw0rd!';

/**
 * Every selector here is anchored on a seed row whose facts cannot move with
 * the clock (apps/api/prisma/seed.ts):
 *
 * - `lead@uni.ac.ae` is Yousef Rahman, platform role STUDENT (seed.ts:41).
 * - Robotics Club is seeded with slug `robotics-club` (seed.ts:69-79) and
 *   membershipPolicy APPROVAL_REQUIRED (seed.ts:79).
 * - lead@ holds an ACTIVE LEAD appointment in it plus an ordinary ACTIVE
 *   membership, both written by the loop at seed.ts:101-131.
 * - `student@uni.ac.ae` is Layla Hassan (seed.ts:43), who holds no club role
 *   anywhere, which is what makes the negative half of this file mean anything.
 *
 * No event title is named and no date is read: this walk is about capability,
 * and the seeded events move with the seed run.
 */
const CLUB = 'robotics-club';

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

test('a Lead reaches Members from their own club page, through the Manage sheet', async ({
  page,
}) => {
  // The whole Stage 9 premise in one walk: a club officer is a student who
  // holds powers over one club, and the way in is the club page, not a console.
  await signIn(page, 'lead@uni.ac.ae');
  await expect(page).toHaveURL(/\/events$/);

  await page.goto('/clubs');
  // The role chip is what marks a club the viewer runs. Scoped to the row, or
  // this passes on any "Lead" text anywhere on the screen.
  const row = page.getByRole('link', { name: /Robotics Club/ });
  await expect(row).toContainText('Lead');
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/clubs/${CLUB}$`));

  await page.getByRole('button', { name: /^Manage/ }).click();
  const sheet = page.getByRole('dialog');
  // All four of a Lead's sections, and only those four. Certificates is
  // deliberately absent: certificate:manage carries no club role.
  for (const label of ['Edit club', 'Members', 'Team', 'Reports']) {
    await expect(sheet.getByRole('link', { name: label })).toBeVisible();
  }
  await expect(sheet.getByRole('link', { name: 'Certificates' })).toHaveCount(0);

  await sheet.getByRole('link', { name: 'Members' }).click();
  await expect(page).toHaveURL(new RegExp(`/clubs/${CLUB}/members$`));
  await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Members', level: 2 })).toBeVisible();
});

test('the Manage sheet is reachable and dismissable by keyboard alone', async ({ page }) => {
  // A sheet that opens only to a pointer is the sort of thing every click-based
  // assertion above passes over.
  await signIn(page, 'lead@uni.ac.ae');
  await page.goto(`/clubs/${CLUB}`);

  await page.getByRole('button', { name: /^Manage/ }).focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();

  // Focus has to be inside the sheet, or a keyboard reader is left behind on
  // the page underneath it. The sheet itself counts: Radix moves focus to the
  // content element when nothing inside it is autofocused.
  expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('a student sees the club page with no officer control on it at all', async ({ page }) => {
  // The other half of "identical for every viewer until one button appears".
  // Without this, a Manage button rendered for everybody would pass the walk
  // above unchanged.
  await signIn(page, 'student@uni.ac.ae');
  await page.goto(`/clubs/${CLUB}`);

  // Waited for first, or the absences below pass on a page that rendered
  // nothing at all.
  await expect(page.getByRole('heading', { name: 'Robotics Club' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Manage/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'New event' })).toHaveCount(0);

  // And the routes themselves, which is the part that is protection rather
  // than presentation.
  for (const path of ['members', 'team', 'reports', 'edit', 'events/new']) {
    await page.goto(`/clubs/${CLUB}/${path}`);
    await expect(page).toHaveURL(new RegExp(`/clubs/${CLUB}$`));
  }
});
