/**
 * The room detail page, and the path a guest takes to reach it mid-booking.
 *
 * The gap this closes: step 2 lists rooms by name and price alone, and a guest
 * who wants to know what they are choosing had nowhere to go. What matters here
 * is not that a page exists but that the *stay survives the detour* — the room
 * page must price the nights the guest already chose, and coming back must not
 * cost them their dates or their place in the flow.
 *
 * Read-only: nothing here books, so unlike `reserve.spec.ts` it leaves no rows
 * behind and consumes no inventory.
 *
 * Addressed by `data-testid` for the reason given in `reserve.spec.ts`: Arabic
 * mirrors English until the client's copy lands, so text selectors would pass
 * today and break the moment real translations arrive.
 */
import { expect, test, type Page } from '@playwright/test';

const DAYS_AHEAD = 320;

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const CHECK_IN = isoDaysFromNow(DAYS_AHEAD);
const CHECK_OUT = isoDaysFromNow(DAYS_AHEAD + 2);

async function navigateToMonth(page: Page, isoDate: string) {
  const today = new Date();
  const [year, month] = isoDate.split('-').map(Number) as [number, number];
  const monthsAhead =
    (year - today.getUTCFullYear()) * 12 + (month - 1 - today.getUTCMonth());

  for (let step = 0; step < monthsAhead; step += 1) {
    await page.getByTestId('next-month').click();
  }
}

/** Walk step 1 and land on the room list. */
async function reachRoomList(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/reserve`);
  await page.getByTestId('checkin-field').click();
  await navigateToMonth(page, CHECK_IN);
  await page.getByTestId(`day-${CHECK_IN}`).click();
  await page.getByTestId(`day-${CHECK_OUT}`).click();
  await page.getByTestId('check-availability').click();
  await expect(page.getByTestId('room-cove-suite')).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('room detail', () => {
  test('carries the stay from the room list onto the room page', async ({
    page,
  }) => {
    await reachRoomList(page);

    await page.getByTestId('room-details-cove-suite').click();

    await expect(page).toHaveURL(new RegExp(`/en/rooms/cove-suite`));
    await expect(page.getByTestId('room-detail-name')).toBeVisible();

    // The point of the whole exercise: the guest left a priced list, so the
    // room page must quote *their* nights rather than dropping them back to a
    // nightly "from" rate they have already moved past.
    const cta = page.getByTestId('stay-cta');
    await expect(cta).toHaveAttribute('data-mode', 'stay', { timeout: 20_000 });

    // And the detail that was missing from the card is actually here.
    await expect(page.getByText('96 m²')).toBeVisible();
  });

  test('returns to the flow with the room chosen and the dates intact', async ({
    page,
  }) => {
    await reachRoomList(page);
    await page.getByTestId('room-details-terrace-room').click();
    await expect(page.getByTestId('room-detail-name')).toBeVisible();

    await page.getByTestId('reserve-this-room').click();

    // Straight back to the room list — not to the date picker, which the guest
    // has already answered — with the room they were reading about selected.
    const room = page.getByTestId('room-terrace-room');
    await expect(room).toBeVisible({ timeout: 20_000 });
    await expect(room).toHaveAttribute('aria-pressed', 'true');

    // Dates survived the round trip, so the flow can be completed from here.
    await expect(page.getByTestId('continue-to-details')).toBeEnabled();
  });

  test('shows a nightly rate when no stay has been chosen yet', async ({
    page,
  }) => {
    // The other way in: the Rooms listing, where nobody has picked dates.
    await page.goto('/en/rooms');
    await page.getByRole('link', { name: 'View room' }).first().click();

    await expect(page.getByTestId('room-detail-name')).toBeVisible();
    await expect(page.getByTestId('stay-cta')).toHaveAttribute(
      'data-mode',
      'from',
    );
  });

  test('mirrors in Arabic', async ({ page }) => {
    await page.goto('/ar/rooms/cove-suite');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('room-detail-name')).toBeVisible();
    await expect(page.getByTestId('reserve-this-room')).toBeVisible();

    // `arabic-rtl`: a measurement must not be bidi-reordered into "m² 96".
    await expect(page.getByText('96 m²')).toBeVisible();
  });
});
