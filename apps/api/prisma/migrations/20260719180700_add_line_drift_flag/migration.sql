-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transit_vehicle_plan_lines" (
    "vehiclePlanId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "lineScheduleId" TEXT,
    "isDrifted" BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY ("vehiclePlanId", "lineId"),
    CONSTRAINT "transit_vehicle_plan_lines_vehiclePlanId_fkey" FOREIGN KEY ("vehiclePlanId") REFERENCES "transit_vehicle_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_vehicle_plan_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transit_vehicle_plan_lines_lineScheduleId_fkey" FOREIGN KEY ("lineScheduleId") REFERENCES "transit_line_schedules" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_transit_vehicle_plan_lines" ("lineId", "lineScheduleId", "vehiclePlanId") SELECT "lineId", "lineScheduleId", "vehiclePlanId" FROM "transit_vehicle_plan_lines";
DROP TABLE "transit_vehicle_plan_lines";
ALTER TABLE "new_transit_vehicle_plan_lines" RENAME TO "transit_vehicle_plan_lines";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
