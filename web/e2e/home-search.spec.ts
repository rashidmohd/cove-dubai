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
