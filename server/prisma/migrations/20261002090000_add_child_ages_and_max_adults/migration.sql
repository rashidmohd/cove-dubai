-- Children, by age.
--
-- Until now a room type had one capacity number and a reservation one child
-- count. That cannot express the rules every hotel actually has: an infant in
-- a cot does not take a bed, a 14-year-old does and counts as an adult, and a
-- room that sleeps three may take only two adults. The age rules themselves
-- are operational settings (`guests_*`), applied in the API; these columns are
-- the data they need.
--
-- Backward compatible: every room type keeps exactly the capacity it had
-- (`maxAdults` = `maxOccupancy` admits the same parties as before), and every
-- existing reservation gets an empty age list, which reads as "ages not
-- recorded". Applying this migration changes no availability answer.

ALTER TABLE "room_types" ADD COLUMN "maxAdults" INTEGER;
UPDATE "room_types" SET "maxAdults" = "maxOccupancy";
ALTER TABLE "room_types" ALTER COLUMN "maxAdults" SET NOT NULL;

-- A room cannot take more adults than it has beds, nor none at all — every
-- booking has at least one adult.
ALTER TABLE "room_types"
  ADD CONSTRAINT "room_types_max_adults_within_occupancy"
  CHECK ("maxAdults" >= 1 AND "maxAdults" <= "maxOccupancy");

ALTER TABLE "reservations"
  ADD COLUMN "childAges" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- Children are under 18; anything else is a typo that would be classified as
-- an adult and quietly change which rooms fit.
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_child_ages_in_range"
  CHECK ("childAges" <@ ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]);

-- Ages, when recorded, are one per child. An empty list stays allowed for
-- bookings made before ages were asked.
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_child_ages_match_count"
  CHECK (cardinality("childAges") = 0 OR cardinality("childAges") = "children");
