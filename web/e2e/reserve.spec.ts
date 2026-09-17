/**
 * The reserve flow, end to end, in both languages.
 *
 * `arabic-rtl` defines "done" for any UI change as: it works and looks right in
 * both /en and /ar. So the booking journey runs twice, and the Arabic pass is
 * not a smoke test — it checks the document actually mirrors and that dates
 * render in Arabic rather than falling back to English.
 *
 * Controls are addressed by `data-testid`, not by their visible text. Arabic
 * currently mirrors English while the client's translations are outstanding, so
 * text selectors would pass today and break the moment real copy lands —
 * exactly when the suite most needs to keep working.
 *
 * These hit the real API and write real reservations, so they book far in the
 * future under a marked email domain.
 */
import { expect, test, type Page } from '@playwright/test';

/** Far enough out not to collide with anything real. */
const DAYS_AHEAD = 320;

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const CHECK_IN = isoDaysFromNow(DAYS_AHEAD);
const CHECK_OUT = isoDaysFromNow(DAYS_AHEAD + 2);

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e-test.invalid`;
}

/**
 * Advance the calendar to the month containing `isoDate`.
 *
 * The click count is computed from the dates rather than read off the calendar
 * heading. Parsing the heading means parsing a localized month name, which
 * works in English and silently fails in Arabic.
 */
async function navigateToMonth(page: Page, isoDate: string) {
  const today = new Date();
  const [year, month] = isoDate.split('-').map(Number) as [number, number];
  const monthsAhead =
    (year - today.getUTCFullYear()) * 12 + (month - 1 - today.getUTCMonth());

  for (let step = 0; step < monthsAhead; step += 1) {
    await page.getByTestId('next-month').click();
  }
}

/** Walk step 1: open the calendar, pick both dates, search. */
async function chooseDates(
  page: Page,
  checkIn = CHECK_IN,
  checkOut = CHECK_OUT,
) {
  await page.getByTestId('checkin-field').click();
  await navigateToMonth(page, checkIn);
  await page.getByTestId(`day-${checkIn}`).click();
  // Picking check-in opens the check-out calendar automatically.
  await page.getByTestId(`day-${checkOut}`).click();
  await page.getByTestId('check-availability').click();
}

async function fillGuestDetails(page: Page, email: string) {
  await page.getByTestId('guest-firstName').fill('Playwright');
  await page.getByTestId('guest-lastName').fill('Guest');
  await page.getByTestId('guest-email').fill(email);
  await page.getByTestId('guest-phone').fill('+971 50 123 4567');
}

test.describe('reserve flow (English)', () => {
  test('books a stay end to end', async ({ page }) => {
    const email = uniqueEmail();

    await page.goto('/en/reserve');
    await chooseDates(page);

    const room = page.getByTestId('room-cove-suite');
    await expect(room).toBeVisible({ timeout: 20_000 });
    await room.click();
    await expect(room).toHaveAttribute('aria-pressed', 'true');

    // The fee breakdown the mockups omit. booking-engine requires the guest
    // sees the Tourism Dirham and VAT itemised before committing.
    await expect(page.getByText('Tourism Dirham')).toBeVisible();
    await expect(page.getByText(/VAT \(5%\)/)).toBeVisible();
    await expect(page.getByText(/pay at check-in/i).first()).toBeVisible();

    await page.getByTestId('continue-to-details').click();
    await fillGuestDetails(page, email);
    await page.getByTestId('confirm-reservation').click();

    // The reference is the guest's only handle on the booking — internal ids
    // are never exposed anywhere.
    await expect(page.getByText(/^CV-\d{4}-\d{6}$/)).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByText(email)).toBeVisible();
  });

  test('shows the total as room + Tourism Dirham + VAT', async ({ page }) => {
    await page.goto('/en/reserve');
    await chooseDates(page);

    await page.getByTestId('room-cove-suite').click();

    // Read the itemised lines and check they reconcile with the total shown.
    // A summary whose parts do not sum to its total is worse than no summary.
    const text = await page.locator('aside').innerText();
    const amounts = [...text.matchAll(/AED\s([\d,]+(?:\.\d+)?)/g)].map((m) =>
      Number((m[1] as string).replace(/,/g, '')),
    );

    expect(amounts.length).toBeGreaterThanOrEqual(4);
    const total = amounts[amounts.length - 1] as number;
    const parts = amounts.slice(-4, -1) as number[];
    expect(parts.reduce((sum, n) => sum + n, 0)).toBeCloseTo(total, 2);
  });

  test('validates guest details before calling the API', async ({ page }) => {
    await page.goto('/en/reserve');
    await chooseDates(page, CHECK_IN, isoDaysFromNow(DAYS_AHEAD + 1));

    // Whichever room is offered first, not a named one: this test is about
    // form validation and does not care which room it is. Studio Room was
    // withdrawn in the admin panel on 16 Sep 2026 and this line failed with it,
    // which told us nothing about guest details. The select controls are the
    // ones carrying `aria-pressed`; "View details" does not.
    await page.locator('button[aria-pressed]').first().click();
    await page.getByTestId('continue-to-details').click();

    await page.getByTestId('confirm-reservation').click();
    await expect(
      page.getByText('This field is required.').first(),
    ).toBeVisible();

    await page.getByTestId('guest-firstName').fill('A');
    await page.getByTestId('guest-lastName').fill('B');
    await page.getByTestId('guest-email').fill('not-an-email');
    await page.getByTestId('guest-phone').fill('+971500000000');
    await page.getByTestId('confirm-reservation').click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  });

  test('refuses a zero-night stay', async ({ page }) => {
    await page.goto('/en/reserve');

    await page.getByTestId('checkin-field').click();
    await navigateToMonth(page, CHECK_IN);
    await page.getByTestId(`day-${CHECK_IN}`).click();

    // The arrival day itself must be unselectable as a departure: a zero-night
    // booking would touch no inventory rows while still creating a reservation.
    await expect(page.getByTestId(`day-${CHECK_IN}`)).toBeDisabled();
  });

  test('keeps progress when navigating away and back', async ({ page }) => {
    await page.goto('/en/reserve');
    await chooseDates(page, CHECK_IN, isoDaysFromNow(DAYS_AHEAD + 3));

    await expect(page.getByTestId('room-cove-suite')).toBeVisible({
      timeout: 20_000,
    });

    await page.goto('/en');
    await page.goto('/en/reserve');

    // Back on the room step with the dates intact, and availability re-fetched
    // rather than left spinning — the session-persistence requirement.
    await expect(page.getByTestId('room-cove-suite')).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe('reserve flow (Arabic)', () => {
  test('mirrors the layout and books a stay', async ({ page }) => {
    const email = uniqueEmail();

    await page.goto('/ar/reserve');

    // Arabic is a mirrored layout, not English with the text swapped.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

    await page.getByTestId('checkin-field').click();

    // Month names must come from Intl in Arabic script, not an English
    // fallback. This is independent of the client's copy translations.
    await expect(page.locator('[role="dialog"] [aria-live]')).toHaveText(
      /[؀-ۿ]/,
    );

    await navigateToMonth(page, CHECK_IN);
    await page.getByTestId(`day-${CHECK_IN}`).click();
    await page.getByTestId(`day-${CHECK_OUT}`).click();
    await page.getByTestId('check-availability').click();

    const room = page.getByTestId('room-cove-suite');
    await expect(room).toBeVisible({ timeout: 20_000 });
    await room.click();

    await page.getByTestId('continue-to-details').click();
    await fillGuestDetails(page, email);
    await page.getByTestId('confirm-reservation').click();

    await expect(page.getByText(/^CV-\d{4}-\d{6}$/)).toBeVisible({
      timeout: 25_000,
    });
  });

  test('lays the summary out right-to-left', async ({ page }) => {
    await page.goto('/ar/reserve');
    await page.getByTestId('checkin-field').click();
    await navigateToMonth(page, CHECK_IN);
    await page.getByTestId(`day-${CHECK_IN}`).click();
    await page.getByTestId(`day-${CHECK_OUT}`).click();
    await page.getByTestId('check-availability').click();
    await page.getByTestId('room-cove-suite').click();

    // The summary sits on the left in Arabic and the form on the right — the
    // reverse of English. Comparing their measured positions catches a layout
    // that was translated but never actually mirrored.
    const summary = await page.locator('aside').boundingBox();
    const form = await page.locator('main > div > div').first().boundingBox();

    expect(summary).not.toBeNull();
    expect(form).not.toBeNull();
    expect((summary as { x: number }).x).toBeLessThan(
      (form as { x: number }).x,
    );
  });
});
