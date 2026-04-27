/**
 * Axe accessibility checks for targeted routes.
 * Fails CI on any critical or serious violations (WCAG 2.1 AA).
 *
 * Requires: @axe-core/playwright, @playwright/test
 * Install:  npm install -D @axe-core/playwright @playwright/test
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Helper: run axe with WCAG 2.1 AA tags and assert no critical/serious issues
// ---------------------------------------------------------------------------
async function checkA11y(page: Parameters<typeof AxeBuilder>[0]['page'], path: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );

  expect(
    blocking,
    `Axe violations on ${path}:\n` +
      blocking
        .map(
          (v) =>
            `  [${v.id}] (${v.impact}) ${v.description}\n    ` +
            v.nodes.map((n) => n.html).join('\n    '),
        )
        .join('\n'),
  ).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Core page checks
// ---------------------------------------------------------------------------
const ROUTES = [
  { name: 'home',          path: '/' },
  { name: 'quote',         path: '/quote' },
  { name: 'policy',        path: '/policy' },
  { name: 'claims board',  path: '/claims' },
  { name: 'policy detail', path: '/policy/1' },
  { name: 'claim detail',  path: '/claims/1' },
];

for (const route of ROUTES) {
  test(`no critical/serious axe violations on ${route.name} page`, async ({ page }) => {
    await page.goto(`${BASE_URL}${route.path}`);
    await checkA11y(page, route.path);
  });
}

// ---------------------------------------------------------------------------
// Claims board — status badge color contrast
// ---------------------------------------------------------------------------
test('claims board status badges pass color contrast', async ({ page }) => {
  await page.goto(`${BASE_URL}/claims`);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2aa'])
    .include('[aria-label^="Status:"]')
    .analyze();

  const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast');
  expect(
    contrastViolations,
    `Color contrast violations in status badges:\n` +
      contrastViolations.map((v) => v.nodes.map((n) => n.html).join('\n')).join('\n'),
  ).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Vote panel — accessible labels and tally
// ---------------------------------------------------------------------------
test('vote panel has no critical/serious axe violations', async ({ page }) => {
  await page.goto(`${BASE_URL}/claims/1`);
  await checkA11y(page, '/claims/1');
});

// ---------------------------------------------------------------------------
// Wallet connection flow — dialog accessibility
// ---------------------------------------------------------------------------
test('wallet connect dialog has correct ARIA attributes', async ({ page }) => {
  await page.goto(`${BASE_URL}/`);

  // Open the wallet connect dialog
  const connectBtn = page.getByRole('button', { name: /connect wallet/i });
  await connectBtn.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Dialog must have an accessible name
  const labelledBy = await dialog.getAttribute('aria-labelledby');
  const label = await dialog.getAttribute('aria-label');
  expect(labelledBy || label, 'Dialog must have aria-labelledby or aria-label').toBeTruthy();

  // Run axe on the open dialog
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .include('[role="dialog"]')
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(blocking, `Dialog axe violations: ${JSON.stringify(blocking, null, 2)}`).toHaveLength(0);
});

test('wallet connect dialog closes on ESC', async ({ page }) => {
  await page.goto(`${BASE_URL}/`);

  const connectBtn = page.getByRole('button', { name: /connect wallet/i });
  await connectBtn.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('wallet connect dialog traps focus', async ({ page }) => {
  await page.goto(`${BASE_URL}/`);

  const connectBtn = page.getByRole('button', { name: /connect wallet/i });
  await connectBtn.click();

  await expect(page.getByRole('dialog')).toBeVisible();

  // Tab through all focusable elements — focus must stay inside the dialog
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
    expect(focused, `Focus escaped the dialog after ${i + 1} Tab presses`).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Vote confirm modal — focus trap and ESC dismiss
// ---------------------------------------------------------------------------
test('vote confirm modal closes on ESC', async ({ page }) => {
  await page.goto(`${BASE_URL}/claims/1`);

  // Click Approve to open the confirm modal (only available when vote is open)
  const approveBtn = page.getByRole('button', { name: /vote to approve/i });
  if (await approveBtn.isVisible()) {
    await approveBtn.click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  }
});

test('vote confirm modal traps focus', async ({ page }) => {
  await page.goto(`${BASE_URL}/claims/1`);

  const approveBtn = page.getByRole('button', { name: /vote to approve/i });
  if (await approveBtn.isVisible()) {
    await approveBtn.click();

    await expect(page.getByRole('dialog')).toBeVisible();

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      );
      expect(focused, `Focus escaped the vote modal after ${i + 1} Tab presses`).toBe(true);
    }
  }
});

// ---------------------------------------------------------------------------
// Claim wizard — keyboard operability
// ---------------------------------------------------------------------------
test('claim wizard is keyboard operable', async ({ page }) => {
  await page.goto(`${BASE_URL}/policy/1/claim`);

  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
});

// ---------------------------------------------------------------------------
// Policy detail — interactive elements have accessible labels
// ---------------------------------------------------------------------------
test('policy detail interactive elements have accessible labels', async ({ page }) => {
  await page.goto(`${BASE_URL}/policy/1`);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const labelViolations = results.violations.filter((v) =>
    ['button-name', 'link-name', 'label', 'aria-required-attr'].includes(v.id),
  );

  expect(
    labelViolations,
    `Missing accessible labels on policy detail:\n` +
      labelViolations.map((v) => `[${v.id}] ${v.nodes.map((n) => n.html).join(', ')}`).join('\n'),
  ).toHaveLength(0);
});
