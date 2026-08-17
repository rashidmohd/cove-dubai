/**
 * Admin panel end-to-end.
 *
 * Drives a real browser against the real API, because the parts of the panel
 * most likely to break are the ones no unit test sees: whether the browser
 * actually keeps the cross-origin session cookie, whether the CSRF token
 * reaches the server on a write, and whether Arabic genuinely mirrors.
 *
 * Needs the API running and `E2E_ADMIN_PASSWORD` set to the password of
 * `E2E_ADMIN_EMAIL` (default `admin@covedubai.local`). Set one with:
 *
 *   cd server && npm run admin:password -- admin@covedubai.local '<password>'
 *
 * The whole file skips when the password is absent, so the suite still runs
 * for anyone without admin credentials to hand.
 */
import { expect, test } from '@playwright/test';

const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@covedubai.local';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.skip(
  !PASSWORD,
  'Set E2E_ADMIN_PASSWORD to run the admin end-to-end tests.',
);

async function signIn(page: import('@playwright/test').Page, locale = 'en') {
  await page.goto(`/${locale}/admin`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
}

test('the panel is not reachable without signing in', async ({ page }) => {
  await page.goto('/en/admin');

  // The login form, not the dashboard.
  await expect(page.getByLabel(/password/i)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /dashboard/i }),
  ).toBeHidden();
});

test('a wrong password is refused', async ({ page }) => {
  await page.goto('/en/admin');
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill('definitely-not-the-password');
  await page.getByRole('button', { name: /sign in/i }).click();

  // Matched by text rather than by `role=alert`: Next's own route announcer is
  // also an alert region, so the role alone is ambiguous.
  await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
});

test('signing in reaches the dashboard and keeps the session across a reload', async ({
  page,
}) => {
  await signIn(page);

  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

  // The real check: reload and stay signed in. If the cross-origin cookie were
  // being dropped, this is where it would show.
  await page.reload();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
});

test('the reservations screen lists bookings and can filter them', async ({
  page,
}) => {
  await signIn(page);

  await page.getByRole('link', { name: /reservations/i }).click();
  await expect(
    page.getByRole('heading', { name: /reservations/i }),
  ).toBeVisible();

  // A reference column proves the list rendered rows rather than an error.
  await expect(page.getByRole('columnheader', { name: /reference/i })).toBeVisible();

  await page.getByRole('searchbox', { name: /search/i }).fill('no-such-guest-xyz');
  await page.getByRole('button', { name: /apply/i }).click();

  await expect(page.getByText(/no reservations match/i)).toBeVisible();
});

test('a write succeeds, which proves the CSRF token is being sent', async ({
  page,
}) => {
  await signIn(page);

  await page.getByRole('link', { name: /settings/i }).click();
  await expect(page.getByText(/vat_rate_percent/i)).toBeVisible();

  // Change VAT to its existing value: the request is a genuine authenticated
  // write, but a failure here cannot leave the hotel quoting a wrong price.
  const row = page
    .locator('div')
    .filter({ hasText: /^vat_rate_percent/ })
    .first();

  const input = row.getByRole('textbox');
  await input.fill('5.0');
  await row.getByRole('button', { name: /save/i }).click();

  // Without the X-CSRF-Token header the server answers 403 and this would read
  // as an error instead.
  await expect(page.getByRole('status')).toContainText(/updated/i);

  // Put the canonical value back.
  await input.fill('5');
  await row.getByRole('button', { name: /save/i }).click();
});

test('signing out ends the session', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByLabel(/password/i)).toBeVisible();

  // And it is really gone server-side, not just cleared in the page.
  await page.reload();
  await expect(page.getByLabel(/password/i)).toBeVisible();
});

test('the panel mirrors in Arabic', async ({ page }) => {
  await signIn(page, 'ar');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  // Measured rather than asserted from CSS: the sidebar must sit to the right
  // of the content in Arabic, which is the whole point of a logical layout.
  const sidebar = page.locator('aside').first();
  const main = page.locator('main').first();

  const sidebarBox = await sidebar.boundingBox();
  const mainBox = await main.boundingBox();

  expect(sidebarBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(sidebarBox!.x).toBeGreaterThan(mainBox!.x);
});
