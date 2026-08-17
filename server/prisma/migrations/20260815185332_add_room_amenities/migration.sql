-- CreateEnum
CREATE TYPE "AmenityCategory" AS ENUM ('BATHROOM', 'COMFORT', 'TECHNOLOGY', 'SERVICES', 'ACCESSIBILITY');

-- CreateTable
CREATE TABLE "amenities" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "otaCode" INTEGER,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "category" "AmenityCategory" NOT NULL DEFAULT 'COMFORT',
    "iconKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "amenities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_type_amenities" (
    "roomTypeId" TEXT NOT NULL,
    "amenityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_type_amenities_pkey" PRIMARY KEY ("roomTypeId","amenityId")
);

-- CreateIndex
CREATE UNIQUE INDEX "amenities_code_key" ON "amenities"("code");

-- CreateIndex
CREATE INDEX "amenities_isActive_sortOrder_idx" ON "amenities"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "room_type_amenities_amenityId_idx" ON "room_type_amenities"("amenityId");

-- AddForeignKey
ALTER TABLE "room_type_amenities" ADD CONSTRAINT "room_type_amenities_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type_amenities" ADD CONSTRAINT "room_type_amenities_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "amenities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
