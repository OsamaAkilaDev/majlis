import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const PASSWORD = 'Passw0rd!';
const STUDENT = 'student@uni.ac.ae';

/**
 * Serial, and one project. Every test here walks the same seeded rows through
 * the same state machine: a check-in, a correction, a revocation. Run in
 * parallel, or run twice at two viewports at once, they answer each other's
 * questions and the failures read as flake rather than as the race they are.
 *
 * The mobile requirement is met inside the file instead, by the one test that
 * sets a phone viewport explicitly and measures the scanner's controls.
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

/** A club officer's landing is /manage/{clubId}, so the id comes from the URL. */
async function officerClubId(page: Page): Promise<string> {
  const clubId = new URL(page.url()).pathname.split('/')[2];
  expect(clubId).toBeTruthy();
  return clubId!;
}

/** admin@ holds no club role, so its club id comes from the admin club list. */
async function adminClubId(page: Page): Promise<string> {
  await page.goto('/admin/clubs');
  await page.getByRole('link', { name: /Robotics Club/ }).click();
  await page.waitForURL(/\/admin\/clubs\/[0-9a-f-]{36}/);
  return new URL(page.url()).pathname.split('/').pop()!;
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

/**
 * The camera cannot be driven from Playwright, and headless Chromium carries no
 * BarcodeDetector at all, which is exactly the branch that falls through to the
 * email form. Both paths render the same verdict from the same response, so
 * this drives the form.
 */
async function openScanner(page: Page, eventTitle: string) {
  const clubId = await officerClubId(page);
  await page.goto(`/manage/${clubId}/scan`);
  await page.getByRole('button', { name: new RegExp(eventTitle) }).click();
  await expect(page.getByLabel('Email')).toBeVisible();
  return clubId;
}

async function checkIn(page: Page, email: string, reason: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Reason').fill(reason);
  await page.getByRole('button', { name: 'Check in' }).click();
}

async function pickCertificateEvent(page: Page, clubId: string) {
  await page.goto(`/manage/${clubId}/certificates`);
  await page.getByLabel('Event').click();
  await page.getByRole('option', { name: 'Line Follower Sprint' }).click();
  await expect(page.getByRole('cell', { name: 'Layla Hassan' }).first()).toBeVisible();
}

/**
 * The student's own verification code. It reaches the world on the PDF's QR
 * rather than through any screen, so the test collects it the same way nothing
 * in the UI does.
 *
 * limit=100, not a handful: every run of this file leaves one more revoked
 * certificate behind, ids are uuid v7 and the page is ordered by id, so the
 * live one is the LAST row and a short page stops containing it.
 */
async function verificationCode(page: Page): Promise<string> {
  const code = await page.evaluate(async () => {
    const res = await fetch('/api/v1/me/certificates?limit=100', { credentials: 'same-origin' });
    const body = (await res.json()) as { items: { status: string; verificationCode: string }[] };
    return body.items.find((c) => c.status === 'ACTIVE')?.verificationCode ?? null;
  });
  expect(code).toBeTruthy();
  return code!;
}

/** The Attendance table, which shares its people with the Registrations one. */
function attendanceRow(page: Page, name: string): Locator {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Attendance' }) })
    .getByRole('row', { name: new RegExp(name) });
}

/**
 * Puts the seeded student back to "not arrived yet", through the product,
 * so this walk starts in the same place on every run instead of passing once
 * and then asserting against the state its own first run left behind.
 *
 * Drone Build Night is ONGOING, so the correction window is open and no
 * override reason is needed.
 */
async function clearCheckIn(page: Page) {
  await signIn(page, 'lead@uni.ac.ae');
  const clubId = await officerClubId(page);
  await page.goto(`/manage/${clubId}/events`);
  await page.getByRole('link', { name: 'Drone Build Night' }).click();
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();

  const row = attendanceRow(page, 'Layla Hassan');
  await expect(row).toBeVisible();
  const absent = row.getByRole('button', { name: 'Mark absent' });
  if (!(await absent.isVisible())) return;

  await absent.click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Clearing the state this walk asserts on');
  await page.getByRole('dialog').getByRole('button', { name: 'Mark absent' }).click();
  await expect(row.getByRole('button', { name: 'Mark present' })).toBeVisible();
}

test('an operator checks a student in and the verdict names them', async ({ page }) => {
  await clearCheckIn(page);

  // ops@ holds club OPERATIONS, which is spec 6.1's "Scan QR / check in" row
  // and nothing else on this screen.
  await signIn(page, 'ops@uni.ac.ae');
  await openScanner(page, 'Drone Build Night');

  await checkIn(page, STUDENT, 'Camera would not focus');

  const verdict = page.getByRole('status');
  await expect(verdict).toContainText('Checked in');
  // The name and the email, because eyeballing the person against them is the
  // task. A verdict that only said "checked in" would pass a status assertion
  // and be useless in a hall.
  await expect(verdict).toContainText('Layla Hassan');
  await expect(verdict).toContainText(STUDENT);

  // The same person again. Not a success, and carrying the ORIGINAL time: a
  // rewritten timestamp answers the operator's actual question wrongly.
  await verdict.getByRole('button', { name: 'Next' }).click();
  await checkIn(page, STUDENT, 'Camera would not focus');
  await expect(page.getByRole('status')).toContainText('Already checked in');
});

test('the scanner counter follows the roster permission, not the scan permission', async ({
  page,
}) => {
  // registration:read is a bulk read of attendee personal data and club
  // OPERATIONS does not hold it, so the same screen shows the same operator a
  // counter or no counter depending on the club role they hold. A test that
  // only signed in as Lead would pass against a screen showing everyone the
  // counter.
  await signIn(page, 'ops@uni.ac.ae');
  await openScanner(page, 'Drone Build Night');
  await expect(page.getByText(/^\d+ \/ \d+$/)).toHaveCount(0);

  await signIn(page, 'lead@uni.ac.ae');
  await openScanner(page, 'Drone Build Night');
  await expect(page.getByText(/^\d+ \/ \d+$/).first()).toBeVisible();
});

test('an unregistered address is refused without naming anybody', async ({ page }) => {
  // Spec 7.5's disclosure rule. A refusal that leaked a name would let whoever
  // holds the scanner enumerate the directory one address at a time.
  await signIn(page, 'ops@uni.ac.ae');
  await openScanner(page, 'Drone Build Night');

  await checkIn(page, 'nobody-at-all@uni.ac.ae', 'Reading the address off a badge');
  const verdict = page.getByRole('status');
  await expect(verdict).toContainText('Not registered');
  await expect(verdict).not.toContainText('@uni.ac.ae');
});

test('the scanner controls stay within a thumb of the bottom edge', async ({ page }) => {
  // One-handed reach, spec 9.4, and the mobile-viewport pass. A control bar
  // that drifted into a header would pass every other assertion in this file.
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'ops@uni.ac.ae');
  await openScanner(page, 'Drone Build Night');

  const submit = page.getByRole('button', { name: 'Check in' });
  const box = (await submit.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.y).toBeGreaterThan(844 / 2);

  const change = page.getByRole('button', { name: 'Change event' });
  expect((await change.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('an officer corrects attendance and the roster follows', async ({ page }) => {
  await signIn(page, 'lead@uni.ac.ae');
  const clubId = await officerClubId(page);
  await page.goto(`/manage/${clubId}/events`);
  await page.getByRole('link', { name: 'Drone Build Night' }).click();
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();

  const row = attendanceRow(page, 'Layla Hassan');
  await row.getByRole('button', { name: 'Mark absent' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Left before the session started');
  await page.getByRole('dialog').getByRole('button', { name: 'Mark absent' }).click();

  // The control flips, which is the only proof the write landed rather than
  // the dialog merely closing.
  await expect(row.getByRole('button', { name: 'Mark present' })).toBeVisible();

  await row.getByRole('button', { name: 'Mark present' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Confirmed from the door log');
  await page.getByRole('dialog').getByRole('button', { name: 'Mark present' }).click();
  await expect(row.getByRole('button', { name: 'Mark absent' })).toBeVisible();
});

test('a correction past the window is refused in the API words, inside the dialog', async ({
  page,
}) => {
  // Line Follower Sprint ended 72 hours ago, so the 48-hour window has shut and
  // an Admin needs a recorded reason. Catches a screen that sends the override
  // reason on every action, or on none.
  await signIn(page, 'admin@uni.ac.ae');
  await page.goto('/admin/events');
  await page.getByRole('link', { name: 'Line Follower Sprint' }).click();
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();

  await attendanceRow(page, 'Layla Hassan').getByRole('button', { name: 'Mark absent' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason').fill('Registry query');
  await dialog.getByRole('button', { name: 'Mark absent' }).click();
  await expect(dialog).toContainText(
    'Correcting attendance after the window has closed requires an override reason.',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('an officer sees the certificate list and none of its controls', async ({ page }) => {
  // certificate:manage ticks no club role at all (spec 6.1), which is what
  // keeps a certificate an institutional record rather than a thing a club
  // hands out. Hiding the controls is presentation; the API is the gate.
  await signIn(page, 'lead@uni.ac.ae');
  await pickCertificateEvent(page, await officerClubId(page));

  await expect(page.getByRole('button', { name: 'Issue certificates' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
});

test('an admin issues, and the student reaches the document', async ({ page }) => {
  await signIn(page, 'admin@uni.ac.ae');
  await pickCertificateEvent(page, await adminClubId(page));
  await page.getByRole('button', { name: 'Issue certificates' }).click();

  // Issuance is idempotent by design, so a second press has to report the
  // totals rather than look like nothing happened.
  await expect(page.getByText(/^Issued \d+\. \d+ active\.$/)).toBeVisible();

  await signIn(page, STUDENT);
  await page.goto('/profile');
  // The tile's accessible name carries its count, so this is matched loosely.
  await page.getByRole('link', { name: /Certificates$/ }).click();
  // .first(): every reissue in this file leaves the holder one more revoked
  // document, and they all name the same event.
  await expect(page.getByText('Line Follower Sprint').first()).toBeVisible();

  // The URL the button reaches for, not the download: the browser takes the
  // PDF out of the page's hands the moment it arrives.
  const pdf = page.waitForResponse((r) => r.url().includes('/pdf') && r.status() === 200);
  await page.getByRole('button', { name: 'Download' }).first().click();
  expect(((await (await pdf).json()) as { pdfUrl: string }).pdfUrl).toContain('.pdf');
});

test('a signed-out visitor verifies a certificate, and a revoked one still answers', async ({
  page,
}) => {
  await signIn(page, STUDENT);
  const code = await verificationCode(page);

  await page.context().clearCookies();
  await page.goto(`/verify/${code}`);
  await expect(page.getByRole('heading', { name: 'Valid certificate' })).toBeVisible();
  await expect(page.getByText('Layla Hassan')).toBeVisible();
  await expect(page.getByText('Line Follower Sprint')).toBeVisible();
  await expect(page.getByText('Robotics Club')).toBeVisible();
  // Holder, event, club, issued. No email, no user id, no serial, no event id.
  await expect(page.locator('dt')).toHaveCount(4);

  // No way back into the product from a page an employer is reading.
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account' })).toHaveCount(0);

  // Reissue rather than revoke: it revokes this row and inserts a replacement
  // in one transaction, so the old code stays verifiable, the student is not
  // left with nothing, and a second run of this file starts where the first
  // one did.
  await signIn(page, 'admin@uni.ac.ae');
  await pickCertificateEvent(page, await adminClubId(page));
  await page.getByRole('button', { name: 'Reissue' }).first().click();
  await page
    .getByRole('dialog')
    .getByLabel('Reason')
    .fill('Holder name corrected from the registry');
  await page.getByRole('dialog').getByRole('button', { name: 'Reissue' }).click();

  // One live document and one withdrawn one, which is what "both remain
  // verifiable" (spec 7.6) means on screen.
  await expect(page.getByRole('row', { name: /Revoked/ }).first()).toBeVisible();
  await expect(page.getByRole('row', { name: /Active/ }).first()).toBeVisible();

  // Revoked answers REVOKED with its date rather than vanishing: an employer
  // holding a withdrawn document has to be able to learn that it was withdrawn.
  await page.context().clearCookies();
  await page.goto(`/verify/${code}`);
  await expect(page.getByRole('heading', { name: 'Revoked' })).toBeVisible();
  await expect(page.getByText('Layla Hassan')).toBeVisible();
  // The fifth term is the revocation date. A page that dropped it would still
  // say "Revoked" and leave the reader unable to date the withdrawal.
  await expect(page.locator('dt')).toHaveCount(5);
});

test.describe('with a camera', () => {
  // The fake device itself is in playwright.config.ts: launchOptions cannot be
  // set per describe block without forcing a new worker.
  test.use({ permissions: ['camera'] });

  test('a scanned pass checks its holder in, and records that it was scanned', async ({ page }) => {
    // The other branch. Headless Chromium ships no BarcodeDetector, so every
    // other test in this file goes through the email form and none of them
    // touch getUserMedia, the detect loop or the token path at all.
    await clearCheckIn(page);

    await signIn(page, STUDENT);
    const token = await page.evaluate(async () => {
      const res = await fetch('/api/v1/me/qr-pass', { credentials: 'same-origin' });
      return ((await res.json()) as { token: string }).token;
    });
    expect(token).toBeTruthy();

    await signIn(page, 'ops@uni.ac.ae');
    const clubId = await officerClubId(page);
    await page.addInitScript((raw) => {
      class FakeBarcodeDetector {
        detect() {
          return Promise.resolve([{ rawValue: raw }]);
        }
      }
      Object.defineProperty(window, 'BarcodeDetector', {
        value: FakeBarcodeDetector,
        configurable: true,
      });
    }, token);

    await page.goto(`/manage/${clubId}/scan`);
    await page.getByRole('button', { name: /Drone Build Night/ }).click();

    const verdict = page.getByRole('status');
    await expect(verdict).toContainText('Checked in', { timeout: 15_000 });
    await expect(verdict).toContainText('Layla Hassan');

    // QR_SCAN, not MANUAL. This is the assertion that separates the two
    // branches: everything above is identical on both.
    await signIn(page, 'lead@uni.ac.ae');
    await page.goto(`/manage/${clubId}/events`);
    await page.getByRole('link', { name: 'Drone Build Night' }).click();
    await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();
    await expect(attendanceRow(page, 'Layla Hassan')).toContainText('Scan');
  });
});

test('an unknown code is answered, not left blank', async ({ page }) => {
  await page.goto('/verify/MJL-NOT-A-REAL-CODE');
  await expect(
    page.getByRole('heading', { name: 'No certificate matches this code' }),
  ).toBeVisible();
  await expect(page.getByText('MJL-NOT-A-REAL-CODE')).toBeVisible();
});

test('a failed load reaches the error boundary, not a skeleton that never resolves', async ({
  page,
}) => {
  // The gap the Stage 5 handoff names first. A promise rejected inside a
  // load() effect reaches no React error boundary at all, so shipping error.tsx
  // without also rethrowing during render would leave this screen on its
  // skeleton forever and this test red.
  await signIn(page, 'admin@uni.ac.ae');
  await page.goto('/manage/not-a-club/certificates');
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      // The default theme is light, so emulating the OS preference alone no
      // longer switches themes: next-themes follows it only when chosen.
      await page.addInitScript((chosen) => window.localStorage.setItem('theme', chosen), theme);
    });

    test('the QR pass has no violations', async ({ page }) => {
      await signIn(page, STUDENT);
      await page.goto('/profile/qr');
      await expect(page.getByRole('img', { name: 'Your check-in pass' })).toBeVisible();
      await axe(page);
    });

    test('the student certificate list has no violations', async ({ page }) => {
      await signIn(page, STUDENT);
      await page.goto('/profile/certificates');
      await expect(page.getByRole('button', { name: 'Download' }).first()).toBeVisible();
      await axe(page);
    });

    test('the scanner has no violations, picker and session', async ({ page }) => {
      // The one screen that forces the dark palette whatever the theme is, so
      // the light run is what would catch a pair that only works on paper.
      await signIn(page, 'ops@uni.ac.ae');
      const clubId = await officerClubId(page);
      await page.goto(`/manage/${clubId}/scan`);
      await expect(page.getByRole('heading', { name: 'Pick an event' })).toBeVisible();
      await axe(page);

      await page.getByRole('button', { name: /Drone Build Night/ }).click();
      await expect(page.getByLabel('Email')).toBeVisible();
      await axe(page);
    });

    test('a scan verdict has no violations', async ({ page }) => {
      // The oversized result is its own surface with its own colour pair, and a
      // scan of the idle screen renders none of it.
      await signIn(page, 'ops@uni.ac.ae');
      await openScanner(page, 'Drone Build Night');
      await checkIn(page, 'nobody-at-all@uni.ac.ae', 'Reading the address off a badge');
      await expect(page.getByRole('status')).toContainText('Not registered');
      await axe(page);
    });

    test('the club certificate console has no violations', async ({ page }) => {
      await signIn(page, 'admin@uni.ac.ae');
      await pickCertificateEvent(page, await adminClubId(page));
      await axe(page);
    });

    test('the public verification page has no violations while signed out', async ({ page }) => {
      await signIn(page, STUDENT);
      const code = await verificationCode(page);
      await page.context().clearCookies();
      await page.goto(`/verify/${code}`);
      await expect(page.getByRole('heading', { name: 'Valid certificate' })).toBeVisible();
      await axe(page);
    });

    test('an error boundary has no violations', async ({ page }) => {
      await signIn(page, 'admin@uni.ac.ae');
      await page.goto('/manage/not-a-club/certificates');
      await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
      await axe(page);
    });
  });
}
