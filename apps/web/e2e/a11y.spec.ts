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
    });

    test('login has no violations', async ({ page }) => {
      await page.goto('/login');
      await scan(page);
    });

    test('student shell has no violations', async ({ page }) => {
      await signIn(page, 'student@uni.ac.ae');
      await scan(page);
    });

    test('admin console has no violations', async ({ page }) => {
      await signIn(page, 'admin@uni.ac.ae');
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
