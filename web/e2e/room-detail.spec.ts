/**
 * Room detail, on both surfaces.
 *
 * The gap this closes: step 2 lists rooms by name and price alone, and a guest
 * who wants to know what they are choosing had nowhere to go.
 *
 * There are two answers, and they are not alternatives. **In the booking flow
 * it is a dialog** — a guest comparing rooms is mid-decision, and navigating
 * away ends the comparison. **On the marketing site it is a page**, because a
 * room page is the strongest thing a hotel has to show a searcher and a modal
 * has no URL. Both render the same `RoomDetailBody`, so what is tested here is
 * largely that neither surface shows less than the other.
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

test.describe('room detail in the booking flow', () => {
  test('opens the details in place, without leaving step 2', async ({
    page,
  }) => {
    await reachRoomList(page);
    const url = page.url();

    await page.getByTestId('room-details-cove-suite').click();

    const dialog = page.getByTestId('room-detail-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('room-detail-name')).toBeVisible();

    // The point of a dialog over a page: the guest has not gone anywhere.
    expect(page.url()).toBe(url);

    // The detail that was missing from the card is actually here.
    await expect(dialog.getByText('96 m²')).toBeVisible();

    // And it quotes the stay, not a nightly rate — the card behind it already
    // priced these nights and the dialog must not disagree with it.
    const cardPrice = await page.getByTestId('room-cove-suite').textContent();
    const dialogPrice = await page
      .getByTestId('room-detail-amount')
      .textContent();
    expect(cardPrice).toContain(dialogPrice?.trim());
  });

  test('selects the room and returns to the list', async ({ page }) => {
    await reachRoomList(page);
    await page.getByTestId('room-details-terrace-room').click();
    await page.getByTestId('room-detail-select').click();

    await expect(page.getByTestId('room-detail-dialog')).toBeHidden();

    const room = page.getByTestId('room-terrace-room');
    await expect(room).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('continue-to-details')).toBeEnabled();
  });

  test('closes on Escape without choosing anything', async ({ page }) => {
    await reachRoomList(page);
    await page.getByTestId('room-details-studio-room').click();
    await expect(page.getByTestId('room-detail-dialog')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByTestId('room-detail-dialog')).toBeHidden();
    // Looking is not choosing.
    await expect(page.getByTestId('room-studio-room')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('mirrors in Arabic', async ({ page }) => {
    await reachRoomList(page, 'ar');
    await page.getByTestId('room-details-cove-suite').click();

    await expect(page.getByTestId('room-detail-dialog')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // `arabic-rtl`: a measurement must not be bidi-reordered into "m² 96".
    await expect(
      page.getByTestId('room-detail-dialog').getByText('96 m²'),
    ).toBeVisible();
  });
});

test.describe('room detail page', () => {
  test('is reachable from the listing and leads into the flow', async ({
    page,
  }) => {
    await page.goto('/en/rooms');
    await page.getByRole('link', { name: 'View room' }).first().click();

    await expect(page).toHaveURL(/\/en\/rooms\/[a-z-]+$/);
    await expect(page.getByTestId('room-detail-name')).toBeVisible();
    await expect(page.getByTestId('stay-cta')).toBeVisible();

    // `?room=` is what makes the choice survive into the booking flow — it
    // silently did nothing until 16 Sep 2026, so it is asserted rather than
    // assumed.
    await page.getByTestId('reserve-this-room').click();
    await expect(page).toHaveURL(/\/reserve\?room=/);
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
