/**
 * The home page stay search, and the handover to the reserve flow.
 *
 * The whole value of the search is that the guest enters their dates once. That
 * claim spans two pages and a query string, so it cannot be proved by a unit
 * test: this walks the real hero, picks real days, and checks the reserve flow
 * opens already holding them.
 *
 * Nothing here books anything. It stops at step 1 of the flow, so unlike
 * `reserve.spec.ts` it writes no reservations and needs no cleanup.
 *
 * `arabic-rtl` defines "done" as working in both languages, so the walk runs
 * twice and the Arabic pass checks the bar actually mirrors.
 */
import { expect, test, type Page } from '@playwright/test';

/** Far enough out to be bookable, and in one month so no paging is needed. */
const DAYS_AHEAD = 320;

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const CHECK_IN = isoDaysFromNow(DAYS_AHEAD);
const CHECK_OUT = isoDaysFromNow(DAYS_AHEAD + 3);

/** The three hero treatments all mount the same search component. */
const VARIANTS = ['still', 'editorial', 'gallery'] as const;

/**
 * Advance the calendar to the month containing `isoDate`.
 *
 * Counted from the dates rather than read off the heading: parsing the heading
 * means parsing a localized month name, which works in English and silently
 * fails in Arabic.
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

test.describe('home page stay search', () => {
  for (const variant of VARIANTS) {
    test(`the ${variant} hero hands its dates to the reserve flow`, async ({
      page,
    }) => {
      await page.goto(`/en/preview/${variant}`);

      await page.getByTestId('stay-search-checkin').click();
      await navigateToMonth(page, CHECK_IN);
      await page.getByTestId(`day-${CHECK_IN}`).click();
      // Picking an arrival opens the departure calendar automatically.
      await page.getByTestId(`day-${CHECK_OUT}`).click();

      await page.getByTestId('stay-search-guests').selectOption('3');
      await page.getByTestId('stay-search-submit').click();

      // The stay travels in the URL, so it survives a reload and a shared link.
      await page.waitForURL(/\/en\/reserve\?/);
      const url = new URL(page.url());
      expect(url.searchParams.get('checkIn')).toBe(CHECK_IN);
      expect(url.searchParams.get('checkOut')).toBe(CHECK_OUT);
      expect(url.searchParams.get('adults')).toBe('3');

      // And it is actually in the form, not merely in the address bar.
      await expect(page.getByTestId('checkin-field')).not.toContainText(
        'Select date',
      );
      await expect(page.getByTestId('checkout-field')).not.toContainText(
        'Select date',
      );
    });
  }

  test('an empty search opens the calendar instead of navigating', async ({
    page,
  }) => {
    await page.goto('/en/preview/still');

    await page.getByTestId('stay-search-submit').click();

    // Saying what is missing beats an error under an empty field — and the
    // guest must not land on a booking form with nothing filled in.
    await expect(page.getByRole('dialog', { name: 'Check in' })).toBeVisible();
    expect(page.url()).toContain('/preview/still');
  });

  test('a stay in the query string fills the reserve flow', async ({
    page,
  }) => {
    await page.goto(
      `/en/reserve?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=4`,
    );

    await expect(page.getByTestId('checkin-field')).not.toContainText(
      'Select date',
    );
    await expect(page.getByText('4', { exact: true }).first()).toBeVisible();
  });

  test('a stay in the past is refused rather than carried through', async ({
    page,
  }) => {
    // A bookmarked or shared link goes stale. It must degrade to an empty date
    // field, never to a request the API rejects for reasons the guest cannot
    // see or act on.
    await page.goto('/en/reserve?checkIn=2020-01-01&checkOut=2020-01-04');

    await expect(page.getByTestId('checkin-field')).toContainText(
      'Select date',
    );
  });

  test('the bar mirrors in Arabic', async ({ page }) => {
    await page.goto('/ar/preview/still');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const search = page.getByTestId('stay-search');
    await expect(search).toBeVisible();

    // In RTL the check-in field is the RIGHTMOST of the two, not the leftmost.
    // This is the check that catches a layout faked with a transform.
    const checkIn = await page.getByTestId('stay-search-checkin').boundingBox();
    const checkOut = await page
      .getByTestId('stay-search-checkout')
      .boundingBox();

    expect(checkIn).not.toBeNull();
    expect(checkOut).not.toBeNull();
    expect(checkIn!.x).toBeGreaterThan(checkOut!.x);
  });
});

/**
 * The calendar has to be reachable without scrolling.
 *
 * It used to be pinned below its field, and every field we have sits low on the
 * screen — the hero search on the lower third, the reserve flow's own picker
 * below the fold on a short laptop window. A guest was asked to scroll blind to
 * reach the days, which on a booking form is a lost booking.
 *
 * Each case below is a viewport that was measured as broken. Opening a calendar
 * writes nothing, so none of these touch the database.
 */
test.describe('the calendar opens where it can be reached', () => {
  /** Fails with how far off screen it went, rather than just "false". */
  async function expectFullyOnScreen(page: Page, label: string) {
    const box = await page.getByRole('dialog').boundingBox();
    expect(box, `${label}: the calendar should be rendered`).not.toBeNull();

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    const overflowBottom = Math.round(box!.y + box!.height - viewport!.height);
    const overflowTop = Math.round(-box!.y);

    expect(overflowBottom, `${label}: ran off the bottom`).toBeLessThanOrEqual(
      0,
    );
    expect(overflowTop, `${label}: ran off the top`).toBeLessThanOrEqual(0);
  }

  for (const variant of VARIANTS) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const label = `${variant} at ${viewport.width}x${viewport.height}`;

      test(`the ${label} hero keeps its calendar on screen`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await page.goto(`/en/preview/${variant}`);

        await page.getByTestId('stay-search-checkin').click();
        await expectFullyOnScreen(page, label);

        // And the departure calendar too — it is a second popover on a second
        // field, and only the first one was ever looked at by hand.
        await page.getByTestId('stay-search-checkout').click();
        await expectFullyOnScreen(page, `${label} (check-out)`);
      });
    }
  }

  test('the reserve flow keeps its calendar on screen on a short window', async ({
    page,
  }) => {
    // 1440x620 — a 13-inch laptop with browser chrome. Measured at 271px below
    // the fold before this was fixed.
    await page.setViewportSize({ width: 1440, height: 620 });
    await page.goto('/en/reserve');

    await page.getByTestId('checkin-field').click();
    await expectFullyOnScreen(page, 'reserve at 1440x620');
  });

  test('the reserve flow keeps its calendar on screen on a phone', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/reserve');

    await page.getByTestId('checkin-field').click();
    await expectFullyOnScreen(page, 'reserve at 390x844');
  });

  test('a flipped calendar still picks the day it was asked for', async ({
    page,
  }) => {
    // Placement is presentation, but it is applied by the same component that
    // handles the click. This proves moving the popover did not break using it.
    await page.goto('/en/preview/still');

    await page.getByTestId('stay-search-checkin').click();
    await expectFullyOnScreen(page, 'still (before navigating)');
    await navigateToMonth(page, CHECK_IN);
    await page.getByTestId(`day-${CHECK_IN}`).click();
    await page.getByTestId(`day-${CHECK_OUT}`).click();

    await page.getByTestId('stay-search-submit').click();
    await page.waitForURL(/\/en\/reserve\?/);
    expect(new URL(page.url()).searchParams.get('checkIn')).toBe(CHECK_IN);
  });
});
