-- AlterTable
ALTER TABLE "transit_line_calendar_exceptions" ADD COLUMN     "scopeId" TEXT;

-- AlterTable
ALTER TABLE "transit_vehicle_plans" ADD COLUMN     "baseDayTypeId" TEXT;

-- AddForeignKey
ALTER TABLE "transit_line_calendar_exceptions" ADD CONSTRAINT "transit_line_calendar_exceptions_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "transit_scopes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_vehicle_plans" ADD CONSTRAINT "transit_vehicle_plans_baseDayTypeId_fkey" FOREIGN KEY ("baseDayTypeId") REFERENCES "transit_day_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
