-- Occupancy rules and occupancy pricing, per room type, edited in the admin.
--
-- The hotel decides how many children and cots each room takes, how many
-- guests its rate includes, and what each extra adult or child costs a night.
-- None of it is ours to hard-code: these are the hotel's commercial terms, and
-- they differ by room (a Suite with a sofa bed is not a King).
--
-- Backward compatible, with no price or availability change on applying it:
--   - `maxChildren` = sleeps − 1 admits every party that fitted before (every
--     party has at least one adult);
--   - `maxInfants` = 1 is the value of the hotel-wide cot setting it replaces;
--   - extra-guest fees start at 0, so no stay costs more until the hotel sets
--     them. `baseOccupancy` = 2 (or fewer, for a room that sleeps one) is the
--     industry default for a double room's rate.

ALTER TABLE "room_types" ADD COLUMN "maxChildren" INTEGER;
UPDATE "room_types" SET "maxChildren" = "maxOccupancy" - 1;
ALTER TABLE "room_types" ALTER COLUMN "maxChildren" SET NOT NULL;

ALTER TABLE "room_types" ADD COLUMN "maxInfants" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "room_types" ADD COLUMN "baseOccupancy" INTEGER;
UPDATE "room_types" SET "baseOccupancy" = LEAST(2, "maxOccupancy");
ALTER TABLE "room_types" ALTER COLUMN "baseOccupancy" SET NOT NULL;

ALTER TABLE "room_types"
  ADD COLUMN "extraAdultFeeAed" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "extraChildFeeAed" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "room_types"
  ADD CONSTRAINT "room_types_max_children_within_occupancy"
  CHECK ("maxChildren" >= 0 AND "maxChildren" < "maxOccupancy");

ALTER TABLE "room_types"
  ADD CONSTRAINT "room_types_max_infants_range"
  CHECK ("maxInfants" >= 0 AND "maxInfants" <= 4);

-- The rate cannot include more guests than the room sleeps, nor nobody.
ALTER TABLE "room_types"
  ADD CONSTRAINT "room_types_base_occupancy_within_occupancy"
  CHECK ("baseOccupancy" >= 1 AND "baseOccupancy" <= "maxOccupancy");

ALTER TABLE "room_types"
  ADD CONSTRAINT "room_types_extra_guest_fees_non_negative"
  CHECK ("extraAdultFeeAed" >= 0 AND "extraChildFeeAed" >= 0);

-- Cots are now per room type. The hotel-wide setting would only disagree with
-- them, so it goes.
DELETE FROM "settings" WHERE "key" = 'guests_infants_per_room';
