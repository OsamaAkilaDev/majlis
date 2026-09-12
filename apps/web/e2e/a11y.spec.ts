import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Passw0rd!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('University email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

/** A club officer's landing is /manage/{clubId}, so the id comes from the URL
 *  rather than from a nav click, which lives behind a sheet on mobile. */
async function officerClubId(page: Page): Promise<string> {
  const clubId = new URL(page.url()).pathname.split('/')[2];
  expect(clubId).toBeTruthy();
  return clubId!;
}

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      // The default theme is light, so emulating the OS preference alone no
      // longer switches themes: next-themes follows it only when chosen.
      await page.addInitScript((chosen) => window.localStorage.setItem('theme', chosen), theme);
    });

    test('actually renders in this theme', async ({ page }) => {
      // Without this the dark scans quietly become a second light-theme run:
      // the default theme is light now, and axe passes either way.
      await page.goto('/login');
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
    });

    test('login has no violations', async ({ page }) => {
      await page.goto('/login');
      await scan(page);
    });

    test('student shell has no violations', async ({ page }) => {
      await signIn(page, 'student@uni.ac.ae');
      await scan(page);
    });

    test('officer console has no violations', async ({ page }) => {
      // Spec 9 names all three shells; only this one was never scanned.
      await signIn(page, 'lead@uni.ac.ae');
      await scan(page);
    });

    test('admin console has no violations', async ({ page }) => {
      await signIn(page, 'admin@uni.ac.ae');
      await scan(page);
    });

    test('an authorization refusal page has no violations', async ({ page }) => {
      // PageError previously rendered no main landmark at all.
      await signIn(page, 'student@uni.ac.ae');
      await page.goto('/admin/metrics');
      await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible();
      await scan(page);
    });

    test('the student club list has no violations', async ({ page }) => {
      await signIn(page, 'student@uni.ac.ae');
      await page.goto('/clubs');
      await expect(page.getByRole('link', { name: /Robotics Club/ })).toBeVisible();
      await scan(page);
    });

    test('a club detail with an actionable join control has no violations', async ({ page }) => {
      await signIn(page, 'student@uni.ac.ae');
      await page.goto('/clubs/robotics-club');
      await expect(page.getByRole('button', { name: 'Request to join' })).toBeEnabled();
      await scan(page);
    });

    test('a club detail with a refused join control has no violations', async ({ page }) => {
      // A disabled control still needs an accessible name carrying the
      // reason, or the refusal exists only in the layout and a screen
      // reader user learns nothing about why they cannot act.
      await signIn(page, 'student@uni.ac.ae');
      await page.goto('/clubs/chess-club');
      await expect(
        page.getByRole('button', { name: 'This club is not accepting members' }),
      ).toBeDisabled();
      await scan(page);
    });

    test('the student event list has no violations', async ({ page }) => {
      await signIn(page, 'student@uni.ac.ae');
      await page.goto('/events');
      await expect(page.getByRole('link', { name: /Introduction to ROS 2/ })).toBeVisible();
      await scan(page);
    });

    test('an event detail with an actionable register control has no violations', async ({ page }) => {
      await signIn(page, 'student@uni.ac.ae');
      await page.goto('/events');
      await page.getByRole('link', { name: /Introduction to ROS 2/ }).click();
      await expect(page.getByRole('button', { name: 'Register', exact: true })).toBeEnabled();
      await scan(page);
    });

    test('an event detail with a refused register control has no violations', async ({ page }) => {
      // A disabled control still needs an accessible name carrying the reason,
      // or the refusal exists only in the layout and a screen reader user
      // learns nothing about why they cannot act.
      await signIn(page, 'student@uni.ac.ae');
      await page.goto('/events');
      await page.getByRole('link', { name: /Robotics Showcase/ }).click();
      await expect(
        page.getByRole('button', { name: 'This event is full and has no waitlist' }),
      ).toBeDisabled();
      await scan(page);
    });

    test('the student registrations page has no violations', async ({ page }) => {
      await signIn(page, 'student@uni.ac.ae');
      await page.goto('/me/registrations');
      await expect(page.getByRole('link', { name: 'Browse events' })).toBeVisible();
      await scan(page);
    });

    test('the student me page has no violations', async ({ page }) => {
      await signIn(page, 'student@uni.ac.ae');
      await page.goto('/me');
      await expect(page.getByRole('heading', { name: 'My clubs' })).toBeVisible();
      await scan(page);
    });

    test('admin departments has no violations', async ({ page }) => {
      await signIn(page, 'admin@uni.ac.ae');
      await page.goto('/admin/departments');
      await scan(page);
    });

    test('the admin club creation form has no violations', async ({ page }) => {
      await signIn(page, 'admin@uni.ac.ae');
      await page.goto('/admin/clubs/new');
      await scan(page);
    });

    test("the club's event list has no violations", async ({ page }) => {
      await signIn(page, 'lead@uni.ac.ae');
      await page.goto(`/manage/${await officerClubId(page)}/events`);
      await expect(page.getByRole('link', { name: 'Introduction to ROS 2' })).toBeVisible();
      await scan(page);
    });

    test('the event editor has no violations', async ({ page }) => {
      await signIn(page, 'lead@uni.ac.ae');
      await page.goto(`/manage/${await officerClubId(page)}/events`);
      await page.getByRole('link', { name: 'Introduction to ROS 2' }).click();
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
      await scan(page);
    });

    test('an event editor with fields the viewer may not change has no violations', async ({ page }) => {
      // Operations holds venue and capacity but not the title, so this is the
      // only scan that covers a disabled input. A disabled input still needs
      // an accessible name.
      await signIn(page, 'ops@uni.ac.ae');
      await page.goto(`/manage/${await officerClubId(page)}/events`);
      await page.getByRole('link', { name: 'Introduction to ROS 2' }).click();
      await expect(page.getByLabel('Title', { exact: true })).toBeDisabled();
      await expect(page.getByLabel('Capacity')).toBeEnabled();
      await scan(page);
    });

    test('the admin event overview has no violations', async ({ page }) => {
      await signIn(page, 'admin@uni.ac.ae');
      await page.goto('/admin/events');
      await expect(page.getByRole('link', { name: 'Introduction to ROS 2' })).toBeVisible();
      await scan(page);
    });
  });
}

test('sign-in is reachable by keyboard alone', async ({ page }) => {
  // Catches a custom control that is clickable but not focusable, which every
  // mouse-driven check passes.
  await page.goto('/login');
  await page.keyboard.press('Tab'); // skip link
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.getByLabel('University email').focus();
  await page.keyboard.type('student@uni.ac.ae');
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/home$/);
});

test('the account menu has no violations while open', async ({ page }) => {
  // A dropdown is where focus management and aria wiring break, and a scan of
  // the closed shell never renders the menu at all.
  await signIn(page, 'student@uni.ac.ae');
  await page.getByRole('button', { name: 'Account' }).click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await scan(page);
});

test('the event creation panel has no violations while open', async ({ page }) => {
  // The largest form in the product, and the only screen carrying a Select
  // built from the runtime's whole tz database.
  await signIn(page, 'lead@uni.ac.ae');
  await page.goto(`/manage/${await officerClubId(page)}/events`);
  await page.getByRole('button', { name: 'New event' }).click();
  await expect(page.getByRole('button', { name: 'Create event' })).toBeVisible();
  await scan(page);
});

test('the admin override dialog has no violations while open', async ({ page }) => {
  // A modal is where focus management and aria-hidden break.
  await signIn(page, 'admin@uni.ac.ae');
  await page.goto('/admin/events');
  await page.getByRole('button', { name: 'Register someone for Introduction to ROS 2' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await scan(page);
});

test('the console navigation sheet has no violations while open', async ({ page }) => {
  // A modal sheet is where focus management and aria-hidden break, and it is the
  // one interactive overlay this suite did not cover.
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin@uni.ac.ae');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await scan(page);
});
