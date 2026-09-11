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

test('a wrong password reports on the field, and the page never renders a shell', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('University email').fill('student@uni.ac.ae');
  await page.getByLabel('Password').fill('wrong-password-here');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/do not match/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
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

  // Task 8 carry-forward: pb-[var(--safe-b)] sits on the whole <nav>, which a
  // reviewer flagged could compress the 56px tab row instead of padding
  // below it. Measure the rendered row on a real mobile viewport.
  const tabHeight = await page.getByRole('link', { name: 'Home' }).evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  console.warn(`[tab-row-height] ${tabHeight}px at viewport ${page.viewportSize()?.width}x${page.viewportSize()?.height}`);
  expect(tabHeight).toBeGreaterThanOrEqual(44);
});
