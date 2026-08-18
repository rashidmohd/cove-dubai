-- Fix the empty-days constraint, which did not actually constrain anything.
--
-- The previous migration guarded the empty array with:
--
--   CHECK (array_length("daysOfWeek", 1) >= 1)
--
-- which does not work. `array_length('{}', 1)` returns **NULL**, not 0 — an
-- empty array has no first dimension to measure. `NULL >= 1` is NULL, and a
-- CHECK constraint *passes* when its expression evaluates to NULL. So the one
-- value the constraint existed to reject was the one value it let through.
--
-- `cardinality()` is the correct function here: it counts elements over all
-- dimensions and returns 0 for the empty array, so the comparison is a real
-- boolean and the constraint actually fires.
--
-- Why this matters rather than being tidy-up: the resolver treats a plan with
-- no day restriction as applying to every night. A plan saved with every
-- weekday checkbox cleared would therefore have priced *all seven* nights —
-- the exact opposite of what clearing them means — and it would have done it
-- silently, on the money path.
--
-- Safe to apply: `daysOfWeek` was added defaulted to all seven days and nothing
-- has written an empty array, so no existing row can violate this.
ALTER TABLE "rate_plans"
  DROP CONSTRAINT "rate_plans_days_of_week_not_empty";

ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_days_of_week_not_empty"
  CHECK (cardinality("daysOfWeek") >= 1);
