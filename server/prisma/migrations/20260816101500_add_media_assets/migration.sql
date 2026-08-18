-- Room photography.
--
-- The bytes live in object storage; these tables record where they are and what
-- they mean. `storageKey` is a key inside the bucket, never an absolute URL —
-- the public origin is configuration, so moving the bucket or putting a CDN in
-- front of it is one environment variable rather than a migration over every
-- row.

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "altEn" TEXT NOT NULL,
    "altAr" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_type_images" (
    "id" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_type_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storageKey_key" ON "media_assets"("storageKey");

-- CreateIndex
CREATE INDEX "room_type_images_roomTypeId_sortOrder_idx" ON "room_type_images"("roomTypeId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "room_type_images_roomTypeId_assetId_key" ON "room_type_images"("roomTypeId", "assetId");

-- AddForeignKey
ALTER TABLE "room_type_images" ADD CONSTRAINT "room_type_images_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type_images" ADD CONSTRAINT "room_type_images_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data-integrity constraints
--
-- Hand-written, as elsewhere in this schema, because Prisma cannot express
-- CHECK constraints. These are cheap and they close off states that would only
-- ever be the result of a bug.
-- ---------------------------------------------------------------------------

-- An image with no pixels is not an image. Zero dimensions would also defeat
-- the point of storing them: the front-end reserves layout space from these,
-- and a 0x0 reservation reflows exactly as an absent one does.
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_dimensions_positive"
  CHECK ("width" > 0 AND "height" > 0);

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_byte_size_positive"
  CHECK ("byteSize" > 0);

-- Ordering is what identifies the primary image (lowest wins), so a negative
-- value would let a row sort ahead of a deliberate 0 by accident.
ALTER TABLE "room_type_images"
  ADD CONSTRAINT "room_type_images_sort_order_non_negative"
  CHECK ("sortOrder" >= 0);
