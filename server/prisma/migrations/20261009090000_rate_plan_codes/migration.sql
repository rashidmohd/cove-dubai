-- Rate plans become editable in the admin panel, which needs two things.
--
-- 1. A public identity. The admin API addresses a plan by room type plus a
--    code (`summer-escape`), never by row id (`pms-readiness`), and every PMS
--    identifies rate plans by a code too. Existing plans get a slug of their
--    English name with a few characters of the id appended, so two plans that
--    share a name still get distinct codes.
--
-- 2. Removing the seeded "Standard Rate" plans. Each one had no date window,
--    every day of the week, priority 0, and the room type's base rate as its
--    nightly rate. Pricing falls back to the base rate when no plan covers a
--    night, so these priced every night exactly as the base rate already did.
--    But they also *outranked* the base rate: once the base rate was edited in
--    the admin, the plan kept charging the old figure, and the edit changed
--    nothing a guest paid. Only rows that still exactly mirror their room's
--    base rate are deleted, so no stay is priced differently after this runs.
--    A plan anyone has edited (a different rate, a minimum stay, an offer flag)
--    is kept.

DELETE FROM "rate_plans" AS plan
USING "room_types" AS room
WHERE plan."roomTypeId" = room."id"
  AND plan."nameEn" = 'Standard Rate'
  AND plan."startDate" IS NULL
  AND plan."endDate" IS NULL
  AND cardinality(plan."daysOfWeek") = 7
  AND plan."priority" = 0
  AND plan."minimumStayNights" = 1
  AND plan."isPublicOffer" = false
  AND plan."nightlyRateAed" = room."baseRateAed";

ALTER TABLE "rate_plans" ADD COLUMN "code" TEXT;

UPDATE "rate_plans"
SET "code" = concat_ws(
  '-',
  nullif(trim(BOTH '-' FROM regexp_replace(lower("nameEn"), '[^a-z0-9]+', '-', 'g')), ''),
  right("id", 6)
);

ALTER TABLE "rate_plans" ALTER COLUMN "code" SET NOT NULL;

-- The same slug shape the API validates, so a hand-inserted row cannot hold a
-- code the admin screen could never address.
ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_code_format"
  CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("code") <= 60);

CREATE UNIQUE INDEX "rate_plans_roomTypeId_code_key" ON "rate_plans"("roomTypeId", "code");
