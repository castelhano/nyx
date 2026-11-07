-- CreateTable
CREATE TABLE "transit_gtfs_export_day_types" (
    "id" TEXT NOT NULL,
    "gtfsExportId" TEXT NOT NULL,
    "scopeOperatorId" TEXT NOT NULL,
    "dayTypeId" TEXT NOT NULL,
    "vehiclePlanId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "transit_gtfs_export_day_types_pkey" PRIMARY KEY ("id")
);

-- Past exports keep the version already in their service_id
INSERT INTO "transit_gtfs_export_day_types" ("id", "gtfsExportId", "scopeOperatorId", "dayTypeId", "vehiclePlanId", "version")
SELECT gen_random_uuid()::text, e."id", e."scopeOperatorId", p->>'dayTypeId', p->>'vehiclePlanId', e."version"
FROM "transit_gtfs_exports" e, jsonb_array_elements(e."plans") p;

-- CreateIndex
CREATE UNIQUE INDEX "transit_gtfs_export_day_types_scopeOperatorId_dayTypeId_ver_key" ON "transit_gtfs_export_day_types"("scopeOperatorId", "dayTypeId", "version");

-- AddForeignKey
ALTER TABLE "transit_gtfs_export_day_types" ADD CONSTRAINT "transit_gtfs_export_day_types_gtfsExportId_fkey" FOREIGN KEY ("gtfsExportId") REFERENCES "transit_gtfs_exports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_gtfs_export_day_types" ADD CONSTRAINT "transit_gtfs_export_day_types_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropIndex
DROP INDEX "transit_gtfs_exports_scopeOperatorId_version_key";

-- AlterTable
ALTER TABLE "transit_gtfs_exports" DROP COLUMN "plans",
DROP COLUMN "version";
