-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'CONFIRMED', 'CANCELLED', 'CHECKED_IN', 'CHECKED_OUT');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('EN', 'AR');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'STAFF');

-- CreateTable
CREATE TABLE "room_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "categoryEn" TEXT NOT NULL,
    "categoryAr" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL,
    "descriptionAr" TEXT NOT NULL,
    "baseRateAed" DECIMAL(10,2) NOT NULL,
    "maxOccupancy" INTEGER NOT NULL,
    "totalRooms" INTEGER NOT NULL,
    "imageKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_plans" (
    "id" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nightlyRateAed" DECIMAL(10,2) NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "minimumStayNights" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_type_inventory" (
    "id" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalRooms" INTEGER NOT NULL,
    "bookedRooms" INTEGER NOT NULL DEFAULT 0,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_type_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guests" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "nationality" TEXT,
    "idDocumentType" TEXT,
    "idDocumentNumber" TEXT,
    "preferredLocale" "Locale" NOT NULL DEFAULT 'EN',
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "bookingReference" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "roomsCount" INTEGER NOT NULL DEFAULT 1,
    "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "specialRequests" TEXT,
    "internalNotes" TEXT,
    "priceBreakdown" JSONB NOT NULL,
    "totalAmountAed" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "cancellationToken" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "room_types_code_key" ON "room_types"("code");

-- CreateIndex
CREATE INDEX "room_types_isActive_sortOrder_idx" ON "room_types"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "rate_plans_roomTypeId_isActive_startDate_endDate_idx" ON "rate_plans"("roomTypeId", "isActive", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "room_type_inventory_date_idx" ON "room_type_inventory"("date");

-- CreateIndex
CREATE UNIQUE INDEX "room_type_inventory_roomTypeId_date_key" ON "room_type_inventory"("roomTypeId", "date");

-- CreateIndex
CREATE INDEX "guests_email_idx" ON "guests"("email");

-- CreateIndex
CREATE INDEX "guests_lastName_firstName_idx" ON "guests"("lastName", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_bookingReference_key" ON "reservations"("bookingReference");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_cancellationToken_key" ON "reservations"("cancellationToken");

-- CreateIndex
CREATE INDEX "reservations_checkIn_checkOut_idx" ON "reservations"("checkIn", "checkOut");

-- CreateIndex
CREATE INDEX "reservations_status_checkIn_idx" ON "reservations"("status", "checkIn");

-- CreateIndex
CREATE INDEX "reservations_roomTypeId_checkIn_idx" ON "reservations"("roomTypeId", "checkIn");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type_inventory" ADD CONSTRAINT "room_type_inventory_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data-integrity constraints
--
-- Written by hand because Prisma's schema language cannot express CHECK
-- constraints. These are not belt-and-braces validation — they are the actual
-- guarantee the booking engine relies on. Application-level availability
-- checks exist for user experience; this is what makes overselling impossible
-- when two guests race for the last room.
-- ---------------------------------------------------------------------------

-- The double-booking guard. A reservation increments bookedRooms for every
-- night of the stay inside one transaction; if any night is already full this
-- fires and the whole transaction rolls back.
ALTER TABLE "room_type_inventory"
  ADD CONSTRAINT "room_type_inventory_booked_within_total"
  CHECK ("bookedRooms" >= 0 AND "bookedRooms" <= "totalRooms");

ALTER TABLE "room_type_inventory"
  ADD CONSTRAINT "room_type_inventory_total_non_negative"
  CHECK ("totalRooms" >= 0);

-- A stay must occupy at least one night. Guards against a zero- or
-- negative-length booking reaching the inventory ledger, where it would
-- silently touch no rows and therefore consume no inventory.
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_checkout_after_checkin"
  CHECK ("checkOut" > "checkIn");

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_occupancy_positive"
  CHECK ("adults" >= 1 AND "children" >= 0 AND "roomsCount" >= 1);

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_total_non_negative"
  CHECK ("totalAmountAed" >= 0);

-- Rates cannot be negative.
ALTER TABLE "room_types"
  ADD CONSTRAINT "room_types_base_rate_non_negative"
  CHECK ("baseRateAed" >= 0);

ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_nightly_rate_non_negative"
  CHECK ("nightlyRateAed" >= 0);

-- A seasonal plan must have both bounds or neither: one-sided windows are
-- ambiguous to price against. NULL on both sides means "always applicable".
ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_date_window_complete"
  CHECK (
    ("startDate" IS NULL AND "endDate" IS NULL)
    OR ("startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "endDate" >= "startDate")
  );

ALTER TABLE "rate_plans"
  ADD CONSTRAINT "rate_plans_minimum_stay_positive"
  CHECK ("minimumStayNights" >= 1);
