/**
 * Booking with a discount code, end to end.
 *
 * The arithmetic and the concurrency guarantees are covered by the server
 * suite. What only a browser can prove is the part in between: that the code a
 * guest types reaches the API, that the discount they are *shown* is the one
 * they are *charged*, and that the summary still reconciles with the code
 * applied.
 *
 * Needs the API running. Creates its own code over the admin API and removes it
 * afterwards, so it cannot disturb a real campaign.
 */
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:4000';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@covedubai.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

/** Marked so cleanup is exact, and so it can never collide with a real code. */
const CODE = 'ZZE2E-TWENTY';

const DAYS_AHEAD = 360;

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const CHECK_IN = isoDaysFromNow(DAYS_AHEAD);
const CHECK_OUT = isoDaysFromNow(DAYS_AHEAD + 2);

test.skip(
  !ADMIN_PASSWORD,
  'Set E2E_ADMIN_PASSWORD to run the discount-code end-to-end tests.',
);

/** Sign in to the admin API and return a context that carries the session. */
async function adminSession(request: APIRequestContext) {
  const login = await request.post(`${API}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const { csrfToken } = (await login.json()) as { csrfToken: string };
  return { csrfToken };
}

async function navigateToMonth(page: Page, isoDate: string) {
  const today = new Date();
  const [year, month] = isoDate.split('-').map(Number) as [number, number];
  const monthsAhead =
    (year - today.getUTCFullYear()) * 12 + (month - 1 - today.getUTCMonth());
  for (let step = 0; step < monthsAhead; step += 1) {
    await page.getByTestId('next-month').click();
  }
}

async function chooseDatesAndRoom(page: Page) {
  await page.getByTestId('checkin-field').click();
  await navigateToMonth(page, CHECK_IN);
  await page.getByTestId(`day-${CHECK_IN}`).click();
  await page.getByTestId(`day-${CHECK_OUT}`).click();
  await page.getByTestId('check-availability').click();

  await page.getByTestId('room-studio-room').click();
}

/**
 * Every AED figure in the summary, in order.
 *
 * Read out of the rendered text rather than from test ids, matching how
 * `reserve.spec.ts` already checks the breakdown — what is under test is what
 * the guest can actually see.
 */
async function summaryAmounts(page: Page): Promise<number[]> {
  const text = await page.locator('aside').innerText();
  return [...text.matchAll(/AED\s([\d,]+(?:\.\d+)?)/g)].map((match) =>
    Number((match[1] as string).replace(/,/g, '')),
  );
}

/** The grand total is the last figure in the summary. */
async function summaryTotal(page: Page): Promise<number> {
  const amounts = await summaryAmounts(page);
  return amounts[amounts.length - 1] as number;
}

test.beforeAll(async ({ request }) => {
  const { csrfToken } = await adminSession(request);

  await request.delete(`${API}/api/admin/vouchers/${CODE}`, {
    headers: { 'X-CSRF-Token': csrfToken },
  });

  const created = await request.post(`${API}/api/admin/vouchers`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: {
      code: CODE,
      name: { en: 'End-to-end twenty', ar: 'End-to-end twenty' },
      discountType: 'percentage',
      discountValue: 20,
    },
  });
  expect(created.ok()).toBeTruthy();
});

test.afterAll(async ({ request }) => {
  const { csrfToken } = await adminSession(request);
  await request.delete(`${API}/api/admin/vouchers/${CODE}`, {
    headers: { 'X-CSRF-Token': csrfToken },
  });
});

test('applying a code lowers the total and still reconciles', async ({
  page,
}) => {
  await page.goto('/en/reserve');
  await chooseDatesAndRoom(page);

  const before = await summaryTotal(page);
  expect(before).toBeGreaterThan(0);

  await page.getByLabel(/discount code/i).fill(CODE);
  await page.getByRole('button', { name: /^apply$/i }).click();

  await expect(page.getByText(/applied/i)).toBeVisible();

  const after = await summaryTotal(page);
  expect(after).toBeLessThan(before);

  // The lines must still reconcile with a discount among them. Room total,
  // discount, Tourism Dirham and VAT are the four before the total — and the
  // discount subtracts, which is the whole point of checking.
  const amounts = await summaryAmounts(page);
  const total = amounts[amounts.length - 1] as number;
  const [roomTotal = 0, discount = 0, tourismDirham = 0, vat = 0] =
    amounts.slice(-5, -1);

  expect(roomTotal - discount + tourismDirham + vat).toBeCloseTo(total, 2);
});

test('a code the hotel does not recognise is refused inline', async ({
  page,
}) => {
  await page.goto('/en/reserve');
  await chooseDatesAndRoom(page);

  const before = await summaryTotal(page);

  await page.getByLabel(/discount code/i).fill('ZZ-NO-SUCH-CODE');
  await page.getByRole('button', { name: /^apply$/i }).click();

  await expect(page.getByText(/not recognised/i)).toBeVisible();
  // The price must not move on a rejected code.
  expect(await summaryTotal(page)).toBe(before);
});

test('removing a code puts the price back', async ({ page }) => {
  await page.goto('/en/reserve');
  await chooseDatesAndRoom(page);

  const before = await summaryTotal(page);

  await page.getByLabel(/discount code/i).fill(CODE);
  await page.getByRole('button', { name: /^apply$/i }).click();
  await expect(page.getByText(/applied/i)).toBeVisible();
  expect(await summaryTotal(page)).toBeLessThan(before);

  await page.getByRole('button', { name: /^remove$/i }).click();
  await expect(page.getByLabel(/discount code/i)).toBeVisible();
  expect(await summaryTotal(page)).toBe(before);
});
