-- Rename, not drop + add: keeps the scopes' OSO data
ALTER TABLE "transit_scopes" RENAME COLUMN "osoConfig" TO "serviceMetadata";

-- CreateTable
CREATE TABLE "transit_gtfs_exports" (
    "id" TEXT NOT NULL,
    "scopeOperatorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "plans" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_gtfs_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transit_gtfs_exports_scopeOperatorId_version_key" ON "transit_gtfs_exports"("scopeOperatorId", "version");

-- AddForeignKey
ALTER TABLE "transit_gtfs_exports" ADD CONSTRAINT "transit_gtfs_exports_scopeOperatorId_fkey" FOREIGN KEY ("scopeOperatorId") REFERENCES "transit_scope_operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
