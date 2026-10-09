-- Spa and dining requests: a menu of things a guest can ask for (spa
-- treatments, restaurant tables) and the requests themselves, which the team
-- confirms or declines. Additive only — no existing table is touched.

CREATE TYPE "ServiceKind" AS ENUM ('SPA', 'DINING');
CREATE TYPE "ServiceRequestStatus" AS ENUM ('NEW', 'CONFIRMED', 'DECLINED', 'CANCELLED');

CREATE TABLE "service_offerings" (
    "id" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descriptionEn" TEXT,
    "descriptionAr" TEXT,
    "durationMinutes" INTEGER,
    "priceAed" DECIMAL(10,2),
    "firstSlot" TEXT NOT NULL,
    "lastSlot" TEXT NOT NULL,
    "maxGuests" INTEGER NOT NULL DEFAULT 4,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_offerings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL,
    "offeringId" TEXT NOT NULL,
    "preferredDate" DATE NOT NULL,
    "preferredTime" TEXT NOT NULL,
    "guests" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "notes" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'EN',
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'NEW',
    "confirmedTime" TEXT,
    "responseNote" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_offerings_kind_code_key" ON "service_offerings"("kind", "code");
CREATE INDEX "service_offerings_kind_isActive_sortOrder_idx" ON "service_offerings"("kind", "isActive", "sortOrder");
CREATE UNIQUE INDEX "service_requests_reference_key" ON "service_requests"("reference");
CREATE INDEX "service_requests_kind_status_preferredDate_idx" ON "service_requests"("kind", "status", "preferredDate");
CREATE INDEX "service_requests_email_idx" ON "service_requests"("email");

ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_offeringId_fkey"
  FOREIGN KEY ("offeringId") REFERENCES "service_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express these; they are what keeps a bad row out whatever
-- writes it.
ALTER TABLE "service_offerings"
  ADD CONSTRAINT "service_offerings_code_format" CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "service_offerings_slots_format"
    CHECK ("firstSlot" ~ '^([01][0-9]|2[0-3]):[03]0$' AND "lastSlot" ~ '^([01][0-9]|2[0-3]):[03]0$'),
  ADD CONSTRAINT "service_offerings_slots_order" CHECK ("lastSlot" >= "firstSlot"),
  ADD CONSTRAINT "service_offerings_max_guests" CHECK ("maxGuests" BETWEEN 1 AND 50),
  ADD CONSTRAINT "service_offerings_duration_positive" CHECK ("durationMinutes" IS NULL OR "durationMinutes" > 0),
  ADD CONSTRAINT "service_offerings_price_non_negative" CHECK ("priceAed" IS NULL OR "priceAed" >= 0);

ALTER TABLE "service_requests"
  ADD CONSTRAINT "service_requests_guests_positive" CHECK ("guests" >= 1),
  ADD CONSTRAINT "service_requests_time_format" CHECK ("preferredTime" ~ '^([01][0-9]|2[0-3]):[03]0$'),
  ADD CONSTRAINT "service_requests_confirmed_time_format"
    CHECK ("confirmedTime" IS NULL OR "confirmedTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
