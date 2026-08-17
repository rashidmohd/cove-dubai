-- CreateEnum
CREATE TYPE "GuestTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- AlterTable
ALTER TABLE "rate_plans" ADD COLUMN     "descriptionAr" TEXT,
ADD COLUMN     "descriptionEn" TEXT,
ADD COLUMN     "isPublicOffer" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "guest_accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "preferredLocale" "Locale" NOT NULL DEFAULT 'EN',
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_account_tokens" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "GuestTokenPurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_account_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "validFrom" DATE,
    "validTo" DATE,
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "minimumNights" INTEGER NOT NULL DEFAULT 1,
    "minimumSpend" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_room_types" (
    "voucherId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,

    CONSTRAINT "voucher_room_types_pkey" PRIMARY KEY ("voucherId","roomTypeId")
);

-- CreateTable
CREATE TABLE "voucher_redemptions" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "discountAed" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guest_accounts_email_key" ON "guest_accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "guest_account_tokens_tokenHash_key" ON "guest_account_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "guest_account_tokens_accountId_purpose_idx" ON "guest_account_tokens"("accountId", "purpose");

-- CreateIndex
CREATE INDEX "guest_account_tokens_expiresAt_idx" ON "guest_account_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_code_key" ON "vouchers"("code");

-- CreateIndex
CREATE INDEX "vouchers_isActive_validFrom_validTo_idx" ON "vouchers"("isActive", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "voucher_room_types_roomTypeId_idx" ON "voucher_room_types"("roomTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_redemptions_reservationId_key" ON "voucher_redemptions"("reservationId");

-- CreateIndex
CREATE INDEX "voucher_redemptions_voucherId_idx" ON "voucher_redemptions"("voucherId");

-- CreateIndex
CREATE INDEX "rate_plans_isPublicOffer_isActive_idx" ON "rate_plans"("isPublicOffer", "isActive");

-- AddForeignKey
ALTER TABLE "guest_account_tokens" ADD CONSTRAINT "guest_account_tokens_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "guest_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_room_types" ADD CONSTRAINT "voucher_room_types_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_room_types" ADD CONSTRAINT "voucher_room_types_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data-integrity constraints
--
-- Written by hand for the same reason as the ones in the initial migration:
-- Prisma's schema language cannot express a CHECK, and these are the actual
-- guarantee rather than belt-and-braces validation.
-- ---------------------------------------------------------------------------

-- The redemption ledger, and the exact counterpart of
-- `room_type_inventory_booked_within_total`. Redemption increments the counter
-- inside the booking transaction; this is what makes two guests racing for the
-- last use of a single-use code impossible to both win. A null
-- `maxRedemptions` means unlimited, so the constraint does not apply.
ALTER TABLE "vouchers"
  ADD CONSTRAINT "vouchers_redemptions_within_max"
  CHECK ("redemptionCount" >= 0
         AND ("maxRedemptions" IS NULL OR "redemptionCount" <= "maxRedemptions"));

ALTER TABLE "vouchers"
  ADD CONSTRAINT "vouchers_max_redemptions_positive"
  CHECK ("maxRedemptions" IS NULL OR "maxRedemptions" >= 1);

-- A percentage discount above 100 would produce a negative accommodation
-- charge; a negative one would silently raise the price.
ALTER TABLE "vouchers"
  ADD CONSTRAINT "vouchers_discount_value_sane"
  CHECK ("discountValue" >= 0
         AND ("discountType" <> 'PERCENTAGE' OR "discountValue" <= 100));

ALTER TABLE "vouchers"
  ADD CONSTRAINT "vouchers_validity_window_ordered"
  CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validTo" >= "validFrom");

ALTER TABLE "vouchers"
  ADD CONSTRAINT "vouchers_minimum_nights_positive"
  CHECK ("minimumNights" >= 1);

-- A discount is money off, never money on.
ALTER TABLE "voucher_redemptions"
  ADD CONSTRAINT "voucher_redemptions_discount_non_negative"
  CHECK ("discountAed" >= 0);

-- Codes are matched case-insensitively, so two rows differing only by case
-- would be a genuine ambiguity about which one a guest redeemed.
CREATE UNIQUE INDEX "vouchers_code_upper_key" ON "vouchers" (UPPER("code"));

-- Guest account emails are matched case-insensitively too: nobody should be
-- able to register Guest@example.com alongside guest@example.com.
CREATE UNIQUE INDEX "guest_accounts_email_lower_key"
  ON "guest_accounts" (LOWER("email"));
