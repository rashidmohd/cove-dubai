/**
 * Reserving a room chosen before dates — the "Reserve" button on a room.
 *
 * The guest has already picked the room, so the flow must not make them pick
 * it again from a list of every room. Step 1 shows the room; when it suits the
 * stay the flow goes straight to their details, and when it does not they land
 * on the room list told why.
 *
 * Read-only: nothing here books, so it leaves no rows behind and consumes no
 * inventory. No room is named either — see `room-detail.spec.ts` for why a
 * test that pins one breaks when that room sells out or is taken off sale.
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

async function pickDates(page: Page) {
  await page.getByTestId('checkin-field').click();
  await navigateToMonth(page, CHECK_IN);
  await page.getByTestId(`day-${CHECK_IN}`).click();
  await page.getByTestId(`day-${CHECK_OUT}`).click();
}

/** Press "Reserve" on the first room the rooms page lists. */
async function reserveFromRoomPage(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/rooms`);
  await page.locator('[data-testid^="view-room-"]').first().click();
  await page.getByTestId('reserve-this-room').click();
  await expect(page).toHaveURL(/\/reserve\?room=/);
}

test.describe('reserving a chosen room', () => {
  test('shows the room in step 1 and skips the room list', async ({ page }) => {
    await reserveFromRoomPage(page);

    // The choice is visible, not silently held.
    await expect(page.getByTestId('chosen-room')).toBeVisible();

    await pickDates(page);
    await page.getByTestId('check-availability').click();

    // Straight to the guest's details — the room step is not shown again.
    await expect(page.getByTestId('guest-firstName')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid^="room-details-"]')).toHaveCount(0);

    // "Back" still reaches the list, with the chosen room ticked.
    const code = new URL(page.url()).searchParams.get('room');
    await page.getByRole('button', { name: /back/i }).click();
    await expect(page.getByTestId(`room-${code}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('"Change room" returns to the ordinary flow', async ({ page }) => {
    await reserveFromRoomPage(page);
    await page.getByTestId('change-room').click();
    await expect(page.getByTestId('chosen-room')).toBeHidden();

    await pickDates(page);
    await page.getByTestId('check-availability').click();

    await expect(
      page.locator('[data-testid^="room-details-"]').first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('says why when the party does not fit', async ({ page }) => {
    await reserveFromRoomPage(page);
    await pickDates(page);

    // Two adults and three children who each take a bed: more than any room
    // the hotel sells sleeps, so the reason cannot depend on which room it is.
    for (let child = 0; child < 3; child += 1) {
      await page.getByTestId('children-increase').click();
      await page.getByTestId(`child-age-${child}`).selectOption(String(6 + child));
    }
    await page.getByTestId('check-availability').click();

    await expect(page.getByTestId('room-notice')).toBeVisible({
      timeout: 20_000,
    });
    // Still on the room step, not carried past it with a room that cannot
    // take them.
    await expect(page.getByTestId('guest-firstName')).toBeHidden();
  });

  test('books two rooms when the family needs two', async ({ page }) => {
    // A room that sleeps two, so a family of four needs a pair of them. Named
    // here because the test is about exactly that capacity; it skips rather
    // than fails if the hotel has taken the room off sale.
    await page.goto('/en/rooms');
    const king = page.getByTestId('view-room-deluxe-king-room');
    test.skip((await king.count()) === 0, 'Deluxe King Room is not on sale');
    await king.click();
    await page.getByTestId('reserve-this-room').click();
    await pickDates(page);

    for (const [child, age] of [[0, '6'], [1, '9']] as const) {
      await page.getByTestId('children-increase').click();
      await page.getByTestId(`child-age-${child}`).selectOption(age);
    }
    await page.getByTestId('check-availability').click();

    // Straight to details — the room fits, as two rooms — and told so.
    await expect(page.getByTestId('guest-firstName')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('room-notice')).toContainText('2 ×');
    // And the summary prices both rooms, not one.
    await expect(
      page.getByText('2 × Deluxe King Room', { exact: true }),
    ).toBeVisible();
  });

  test('mirrors in Arabic', async ({ page }) => {
    await reserveFromRoomPage(page, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('chosen-room')).toBeVisible();
  });
});

test.describe('children', () => {
  test('asks each child’s age before searching', async ({ page }) => {
    await page.goto('/en/reserve');
    await pickDates(page);

    await page.getByTestId('children-increase').click();
    await expect(page.getByTestId('children-count')).toHaveText('1');

    await page.getByTestId('check-availability').click();
    await expect(page.getByText(/age for each child/i)).toBeVisible();
    await expect(page.getByTestId('child-age-0')).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    // A baby sleeps in a cot, so two adults and an infant still have rooms.
    await page.getByTestId('child-age-0').selectOption('0');
    await page.getByTestId('check-availability').click();
    await expect(
      page.locator('[data-testid^="room-details-"]').first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
