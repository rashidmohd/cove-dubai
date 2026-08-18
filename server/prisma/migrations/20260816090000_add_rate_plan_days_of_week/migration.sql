-- Day-of-week pricing on rate plans.
--
-- A dated season alone cannot express what a hotel actually charges. Dubai city
-- hotels price Thursday, Friday and Saturday nights above midweek, and that
-- pattern repeats inside every season — so before this column, a "weekend rate"
-- meant hand-creating one dated plan per weekend, forever.
--
-- Numbering is 0 = Sunday … 6 = Saturday, matching JavaScript's `getUTCDay()`,
-- which is what the inventory calendar and the pricing resolver already use.
--
-- Backward compatible on purpose: every existing row gets all seven days, which
-- is exactly the behaviour it had when the column did not exist. Applying this
-- migration cannot change a single quoted price.
ALTER TABLE "rate_plans"
  ADD COLUMN "daysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6];

-- "No days" must be impossible rather than quietly meaning "every day".
--
-- This is the constraint that matters. An empty array is the one value that
-- reads as harmless and misprices rooms: the resolver treats a plan with no day
-- restriction as always-applicable, so a plan saved with every checkbox cleared
-- would silently apply to all seven nights — the opposite of what whoever
-- cleared them intended. The database refuses it so the resolver never has to
-- guess.
ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_days_of_week_not_empty"
  CHECK (array_length("daysOfWeek", 1) >= 1);

-- Days are days. Guards against an off-by-one numbering mistake (ISO-8601 uses
-- 1 = Monday … 7 = Sunday) reaching the table, where a stray 7 would simply
-- never match a night and the plan would look inexplicably inert.
ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_days_of_week_in_range"
  CHECK ("daysOfWeek" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);
