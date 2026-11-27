import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * F-30 Accessibility regression suite.
 *
 * Runs axe-playwright against the key routes and asserts that no critical
 * violations are reported. Also verifies the skip-to-main-content link and
 * that modal dialogs trap focus and are dismissible via ESC.
 */

const KEY_ROUTES = ['/claims', '/policies'];

for (const route of KEY_ROUTES) {
  test(`axe: no critical violations on ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (violation) => violation.impact === 'critical',
    );

    expect(
      critical,
      `Critical a11y violations on ${route}:\n${JSON.stringify(critical, null, 2)}`,
    ).toEqual([]);
  });
}

test('skip link navigates to main content', async ({ page }) => {
  await page.goto('/claims');

  const skipLink = page.getByRole('link', { name: /skip to main content/i });
  await expect(skipLink).toBeVisible();

  await skipLink.focus();
  await page.keyboard.press('Enter');

  const main = page.locator('main#main-content');
  await expect(main).toBeVisible();
  await expect(main).toBeFocused();
});

test('modal traps focus and is dismissible with ESC', async ({ page }) => {
  await page.goto('/claims');

  const trigger = page.getByRole('button', { name: /vote/i }).first();
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Focus should move into the dialog.
  await expect(dialog).toBeFocused();

  // Tab cycles within the dialog (focus trap).
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Tab');
    const focusInside = await dialog.evaluate((node) =>
      node.contains(document.activeElement),
    );
    expect(focusInside).toBe(true);
  }

  // ESC dismisses the dialog.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
