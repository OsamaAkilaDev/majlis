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

    test('signup has no violations', async ({ page }) => {
      // The only form carrying a constraint on a label and a segment meter,
      // both of which sit on the deep auth ground rather than a page surface.
      await page.goto('/signup');
      await expect(page.getByText('12+ characters')).toBeVisible();
      await scan(page);
    });

    test('a failed sign-in has no violations', async ({ page }) => {
      // The error colours and the aria wiring were never scanned in either
      // theme; a scan of the pristine form renders neither.
      await page.goto('/login');
      await page.getByLabel('University email').fill('student@uni.ac.ae');
      await page.getByLabel('Password').fill('wrong-password-here');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
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
      // Rows, not the empty state: Stage 6's seed registers this student for
      // two events so the scanner and the certificates have something to work
      // on, and a list with rows in it is the harder scan anyway.
      await signIn(page, 'student@uni.ac.ae');
      await page.goto('/profile/registrations');
      await expect(page.getByRole('link', { name: /Drone Build Night/ })).toBeVisible();
      await scan(page);
    });

    test('the student profile page has no violations', async ({ page }) => {
      await signIn(page, 'student@uni.ac.ae');
      await page.goto('/profile');
      await expect(page.getByRole('heading', { name: 'My clubs' })).toBeVisible();
      // The identity banner puts text on a tinted ground the rest of the
      // product never uses, and the theme control is three toggle buttons
      // whose only label is their own text. Both are in this scan.
      await expect(page.getByRole('group', { name: 'Theme' })).toBeVisible();
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

    test('the password reset request form has no violations', async ({ page }) => {
      await page.goto('/forgot-password');
      await scan(page);
    });

    test('the new password form has no violations', async ({ page }) => {
      // Carries the segment meter on a label, on the deep auth ground.
      await page.goto('/reset-password?token=whatever');
      await expect(page.getByText('12+ characters')).toBeVisible();
      await scan(page);
    });

    test('the student inbox has no violations', async ({ page }) => {
      await signIn(page, 'student@uni.ac.ae');
      await page.goto('/profile/notifications');
      await expect(page.getByRole('button', { name: 'Unread' })).toBeVisible();
      await scan(page);
    });

    test('the admin metrics charts have no violations', async ({ page }) => {
      // An inline SVG chart is where a graphic ends up with no accessible
      // name at all, which is a 1.1.1 failure a 'renders' test never sees.
      await signIn(page, 'admin@uni.ac.ae');
      await page.goto('/admin/metrics');
      await expect(page.getByRole('img', { name: /Clubs by status/ })).toBeVisible();
      await scan(page);
    });

    test('the admin exports screen has no violations', async ({ page }) => {
      await signIn(page, 'admin@uni.ac.ae');
      await page.goto('/admin/exports');
      await expect(page.getByRole('button', { name: 'Events' })).toBeVisible();
      await scan(page);
    });

    test('the admin audit log has no violations', async ({ page }) => {
      await signIn(page, 'admin@uni.ac.ae');
      await page.goto('/admin/audit');
      await expect(page.getByRole('columnheader', { name: 'When (UTC)' })).toBeVisible();
      await scan(page);
    });

    test('a club report has no violations', async ({ page }) => {
      await signIn(page, 'lead@uni.ac.ae');
      await page.goto(`/manage/${await officerClubId(page)}/reports`);
      await expect(page.getByRole('img', { name: /Attendance/ })).toBeVisible();
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

test('the header pair name themselves and announce which one is lit', async ({ page }) => {
  // Replaces the scan of the account dropdown, which no longer exists: the
  // avatar is a link to /profile and the bell a link to the inbox. Their risk
  // moved with them. Both are an icon or an image with no text, so the whole
  // accessible name is an aria-label, and the lit state is a tinted ground,
  // which is colour alone unless aria-current carries it too.
  await signIn(page, 'student@uni.ac.ae');
  const bell = page.getByRole('link', { name: /^Notifications/ });
  const avatar = page.getByRole('link', { name: 'Profile' });

  await expect(bell).toBeVisible();
  await expect(avatar).toBeVisible();
  await expect(bell).not.toHaveAttribute('aria-current', 'page');
  await expect(avatar).not.toHaveAttribute('aria-current', 'page');

  await avatar.click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(avatar).toHaveAttribute('aria-current', 'page');
  // Exactly one of the pair is ever lit, and the bell is not it here.
  await expect(bell).not.toHaveAttribute('aria-current', 'page');

  await bell.click();
  await expect(page).toHaveURL(/\/profile\/notifications$/);
  await expect(bell).toHaveAttribute('aria-current', 'page');
  await expect(avatar).not.toHaveAttribute('aria-current', 'page');
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

test('the student shell swaps the tab bar for a side nav above the breakpoint', async ({ page }) => {
  // Exactly one "Sections" landmark at any width. Two would mean a shell
  // rendering both navigations at once: duplicate links, an ambiguous
  // landmark, and every destination announced twice.
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'student@uni.ac.ae');

  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();

  // A narrow column at the top left, not a bar across the foot. Catches a shell
  // that keeps the tab bar and merely adds an empty sidebar beside it.
  const box = await nav.boundingBox();
  expect(box!.width).toBeLessThan(1440 / 2);
  expect(box!.y).toBeLessThan(900 / 2);
  await scan(page);
});

test('the student shell keeps the tab bar below the breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'student@uni.ac.ae');

  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav).toHaveCount(1);

  // The mirror image of the sidebar test: across the foot, not a column at
  // the side. And a dock, not a bar welded to the bottom edge, which is what
  // the tab bar was before: inset from both sides, centred, with clear space
  // under it. An edge-to-edge bar is 390 wide and ends at 844.
  const box = await nav.boundingBox();
  expect(box!.y).toBeGreaterThan(844 / 2);
  expect(box!.width).toBeLessThan(390);
  expect(box!.width).toBeGreaterThan(280);
  expect(box!.x).toBeCloseTo(390 - (box!.x + box!.width), 0);
  expect(box!.y + box!.height).toBeLessThan(844);
  await scan(page);
});

test('a console shows its side nav and no hamburger above the breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'admin@uni.ac.ae');

  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Clubs' })).toBeVisible();
  await scan(page);
});

test('a deep route keeps its section lit in the desktop side nav', async ({ page }) => {
  // The side nav used to match the path exactly, so a club page lit nothing at
  // all and left the viewer with no sense of place.
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'student@uni.ac.ae');
  await page.goto('/clubs/robotics-club');

  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('link', { name: 'Clubs' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Events' })).not.toHaveAttribute('aria-current', 'page');
});

test('the console navigation sheet has no violations while open', async ({ page }) => {
  // A modal sheet is where focus management and aria-hidden break, and it is the
  // one interactive overlay this suite did not cover.
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin@uni.ac.ae');
  // /admin is a redirect to /admin/metrics, and signIn only waits for "not
  // /login", which /admin already satisfies. Scanning from there caught the
  // document mid-redirect: no title, no landmarks, forty-odd violations that
  // said nothing about the sheet. Wait for the console the test is about.
  await page.waitForURL(/\/admin\/metrics$/);
  await expect(page.getByRole('heading', { name: 'Metrics' })).toBeVisible();

  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await scan(page);
});
