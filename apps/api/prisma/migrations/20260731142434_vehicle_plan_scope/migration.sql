-- Backfill: LineSchedule.approvalRef becomes required/business-key (approval-ref proposal).
-- Dev-only data — 31 rows have no approvalRef yet, tag them as legacy placeholders.
UPDATE "transit_line_schedules" SET "approvalRef" = 'LEGACY-' || substr("id", 1, 8) WHERE "approvalRef" IS NULL OR "approvalRef" = '';

-- CreateTable
CREATE TABLE "transit_scopes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "transit_scope_operators" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "abbr" TEXT NOT NULL,
    "share" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_scope_operators_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "transit_scopes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_scope_operators_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "transit_scope_operators_scopeId_branchId_key" ON "transit_scope_operators"("scopeId", "branchId");

-- Backfill: default Scope covering all VehiclePlan/TransitLine data that predates
-- the Scope model — only created if there's actually a pre-existing VehiclePlan to
-- backfill (a fresh/empty database has nothing to migrate, so this is a no-op then).
INSERT INTO "transit_scopes" ("id", "name", "description", "createdAt", "updatedAt")
SELECT '4206e46c-7357-4a81-90ee-223bb314c5d8', 'Escopo padrão (migração)', 'Criado automaticamente ao introduzir o modelo Scope — associa os planos e linhas já existentes.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "transit_vehicle_plans");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transit_line_schedules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineId" TEXT NOT NULL,
    "dayTypeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "validFrom" DATETIME,
    "validTo" DATETIME,
    "approvalRef" TEXT NOT NULL,
    "approvedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_line_schedules_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transit_line_schedules_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_transit_line_schedules" ("approvalRef", "approvedAt", "createdAt", "dayTypeId", "id", "lineId", "notes", "status", "updatedAt", "validFrom", "validTo") SELECT "approvalRef", "approvedAt", "createdAt", "dayTypeId", "id", "lineId", "notes", "status", "updatedAt", "validFrom", "validTo" FROM "transit_line_schedules";
DROP TABLE "transit_line_schedules";
ALTER TABLE "new_transit_line_schedules" RENAME TO "transit_line_schedules";
CREATE UNIQUE INDEX "transit_line_schedules_lineId_dayTypeId_approvalRef_key" ON "transit_line_schedules"("lineId", "dayTypeId", "approvalRef");
CREATE TABLE "new_transit_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "scopeId" TEXT,
    "notes" TEXT,
    "metrics" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_lines_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "transit_scopes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_transit_lines" ("code", "createdAt", "id", "isActive", "metrics", "name", "notes", "type", "updatedAt", "scopeId")
SELECT "code", "createdAt", "id", "isActive", "metrics", "name", "notes", "type", "updatedAt",
  CASE WHEN "id" IN (SELECT DISTINCT "lineId" FROM "transit_vehicle_plan_lines") THEN '4206e46c-7357-4a81-90ee-223bb314c5d8' ELSE NULL END
FROM "transit_lines";
DROP TABLE "transit_lines";
ALTER TABLE "new_transit_lines" RENAME TO "transit_lines";
CREATE UNIQUE INDEX "transit_lines_code_key" ON "transit_lines"("code");
CREATE TABLE "new_transit_vehicle_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeId" TEXT NOT NULL,
    "dayTypeId" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "summary" JSONB,
    "generatedAt" DATETIME,
    "constraints" JSONB,
    "metrics" JSONB,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_vehicle_plans_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "transit_scopes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transit_vehicle_plans_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_transit_vehicle_plans" ("scopeId", "constraints", "createdAt", "dayTypeId", "description", "generatedAt", "id", "metrics", "notes", "status", "summary", "updatedAt")
SELECT '4206e46c-7357-4a81-90ee-223bb314c5d8', "constraints", "createdAt", "dayTypeId", "description", "generatedAt", "id", "metrics", "notes", "status", "summary", "updatedAt" FROM "transit_vehicle_plans";
DROP TABLE "transit_vehicle_plans";
ALTER TABLE "new_transit_vehicle_plans" RENAME TO "transit_vehicle_plans";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
