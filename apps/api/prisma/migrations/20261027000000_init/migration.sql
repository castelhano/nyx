-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'operator');

-- CreateEnum
CREATE TYPE "BranchUserRole" AS ENUM ('owner', 'manager', 'member');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('DIESEL', 'GASOLINE', 'ETHANOL', 'ELECTRIC', 'HYBRID', 'GNV');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('STANDARD', 'ARTICULATED', 'BI_ARTICULATED', 'MICRO_BUS', 'MINIBUS', 'VAN');

-- CreateEnum
CREATE TYPE "TransmissionType" AS ENUM ('MANUAL', 'AUTOMATIC', 'SEMI_AUTOMATIC');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'DOMESTIC_PARTNERSHIP');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('CLT', 'PJ', 'TEMPORARY', 'INTERNSHIP', 'APPRENTICE');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LineType" AS ENUM ('URBAN', 'METROPOLITAN', 'RURAL', 'SPECIAL');

-- CreateEnum
CREATE TYPE "RouteDirection" AS ENUM ('OUTBOUND', 'INBOUND', 'CIRCULAR');

-- CreateEnum
CREATE TYPE "TravelTimeSource" AS ENUM ('OSRM', 'MANUAL');

-- CreateEnum
CREATE TYPE "VehiclePlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LineScheduleStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "transit_deadrun_type" AS ENUM ('ACCESS', 'RETURN', 'DISPLACEMENT');

-- CreateEnum
CREATE TYPE "CrewPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CrewRole" AS ENUM ('DRIVER', 'FARE_COLLECTOR', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "DutyKind" AS ENUM ('STRAIGHT', 'SPLIT', 'TRIPPER', 'STANDBY');

-- CreateEnum
CREATE TYPE "DutyActivityType" AS ENUM ('SIGN_ON', 'SIGN_OFF', 'BREAK', 'TRAVEL', 'STANDBY');

-- CreateEnum
CREATE TYPE "ServiceRequirementKind" AS ENUM ('BOARDING', 'ALIGHTING');

-- CreateEnum
CREATE TYPE "TripStopPattern" AS ENUM ('LOCAL', 'LIMITED', 'EXPRESS');

-- CreateEnum
CREATE TYPE "OvertimePreference" AS ENUM ('LIKES', 'NEUTRAL', 'AVOIDS');

-- CreateEnum
CREATE TYPE "CrewLineAccess" AS ENUM ('ENABLED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CrewAbsenceEffect" AS ENUM ('ABSENCE', 'DAY_OFF', 'COMP_OFF');

-- CreateEnum
CREATE TYPE "CrewOccurrenceKind" AS ENUM ('ABSENCE', 'TIME_WINDOW');

-- CreateEnum
CREATE TYPE "CrewOccurrenceStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CrewOccurrenceOrigin" AS ENUM ('PORTAL', 'STAFF_ON_BEHALF', 'STAFF');

-- CreateEnum
CREATE TYPE "DailyStatus" AS ENUM ('PLANNED', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DailyEventKind" AS ENUM ('TRIP', 'DEADRUN', 'INTERVAL');

-- CreateEnum
CREATE TYPE "RosterEntryKind" AS ENUM ('DUTY', 'STANDBY', 'DAY_OFF', 'COMP_OFF');

-- CreateEnum
CREATE TYPE "HourBankEntryKind" AS ENUM ('OPENING', 'ADJUST', 'DAY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'operator',
    "preferences" JSONB,
    "lastLoginAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "forcePasswordChange" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "taxId" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "role" "BranchUserRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_password_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_password_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "input" JSONB,
    "output" JSONB,
    "outputFile" TEXT,
    "errors" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key","scope")
);

-- CreateTable
CREATE TABLE "vehicle_brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "renavam" TEXT,
    "chassis" TEXT,
    "brandId" TEXT,
    "modelId" TEXT,
    "year" INTEGER,
    "modelYear" INTEGER,
    "vehicleType" "VehicleType" NOT NULL DEFAULT 'STANDARD',
    "color" TEXT,
    "fuelType" "FuelType" NOT NULL DEFAULT 'DIESEL',
    "transmission" "TransmissionType",
    "seatedCapacity" INTEGER,
    "totalCapacity" INTEGER,
    "odometer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "acquisitionDate" TIMESTAMP(3),
    "acquisitionValue" DECIMAL(65,30),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_unavailabilities" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_unavailabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_titles" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "preferredName" TEXT,
    "taxId" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "maritalStatus" "MaritalStatus",
    "email" TEXT,
    "phone" TEXT,
    "photoUrl" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "hireDate" TIMESTAMP(3) NOT NULL,
    "terminationDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "jobTitleId" TEXT NOT NULL,
    "type" "ContractType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "salary" DECIMAL(65,30) NOT NULL,
    "weeklyHours" INTEGER NOT NULL DEFAULT 44,
    "workDaysPerWeek" INTEGER NOT NULL DEFAULT 6,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_localities" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "abbr" TEXT,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "isDepot" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "depot" JSONB,
    "snapInfo" JSONB,
    "externalCodes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_localities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_lines" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LineType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "scopeId" TEXT,
    "parentLineId" TEXT,
    "notes" TEXT,
    "metrics" JSONB,
    "vehicleTypes" JSONB,
    "externalCodes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_line_service_requirements" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "dayTypeId" TEXT NOT NULL,
    "direction" "RouteDirection" NOT NULL,
    "kind" "ServiceRequirementKind" NOT NULL,
    "localityId" TEXT,
    "earliestMinutes" INTEGER NOT NULL,
    "latestMinutes" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_line_service_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_routes" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "direction" "RouteDirection" NOT NULL,
    "name" TEXT NOT NULL,
    "originLocalityId" TEXT NOT NULL,
    "destinationLocalityId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "homeDepotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_route_localities" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "localityId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "sequence" INTEGER NOT NULL,
    "deltaMinutes" INTEGER,
    "deltaKm" DOUBLE PRECISION,
    "deltaSource" "TravelTimeSource" NOT NULL DEFAULT 'OSRM',
    "geometry" JSONB,
    "allowsCrewChange" BOOLEAN NOT NULL DEFAULT false,
    "allowsMealBreak" BOOLEAN NOT NULL DEFAULT false,
    "allowsVehicleStand" BOOLEAN NOT NULL DEFAULT false,
    "includeInOso" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_route_localities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_travel_times" (
    "id" TEXT NOT NULL,
    "originId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "baseMinutes" DOUBLE PRECISION NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "speedRatio" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" "TravelTimeSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_travel_times_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_day_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pattern" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_day_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_line_calendar_exceptions" (
    "id" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "sourceDayTypeId" TEXT,
    "overrideDayTypeId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_line_calendar_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_line_calendar_exception_lines" (
    "exceptionId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,

    CONSTRAINT "transit_line_calendar_exception_lines_pkey" PRIMARY KEY ("exceptionId","lineId")
);

-- CreateTable
CREATE TABLE "transit_line_schedules" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "dayTypeId" TEXT NOT NULL,
    "status" "LineScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" DATE,
    "validTo" DATE,
    "approvalRef" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_line_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_line_departures" (
    "id" TEXT NOT NULL,
    "lineScheduleId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "departureMinutes" INTEGER NOT NULL,
    "requiredVehicleType" "VehicleType",
    "stopPattern" "TripStopPattern" NOT NULL DEFAULT 'LOCAL',
    "notes" TEXT,
    "markings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_line_departures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_trips" (
    "id" TEXT NOT NULL,
    "vehiclePlanId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "dayTypeId" TEXT NOT NULL,
    "departureMinutes" INTEGER NOT NULL,
    "arrivalMinutes" INTEGER NOT NULL,
    "requiredVehicleType" "VehicleType",
    "stopPattern" "TripStopPattern" NOT NULL DEFAULT 'LOCAL',
    "constraints" JSONB,
    "notes" TEXT,
    "markings" JSONB,
    "bundleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_interval_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "minMinutes" INTEGER,
    "maxMinutes" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_interval_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_block_intervals" (
    "id" TEXT NOT NULL,
    "vehicleBlockId" TEXT NOT NULL,
    "intervalTypeId" TEXT NOT NULL,
    "departureMinutes" INTEGER NOT NULL,
    "arrivalMinutes" INTEGER NOT NULL,
    "bundleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_block_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_vehicle_plans" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "dayTypeId" TEXT NOT NULL,
    "description" TEXT,
    "status" "VehiclePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" DATE,
    "validTo" DATE,
    "summary" JSONB,
    "generatedAt" TIMESTAMP(3),
    "constraints" JSONB,
    "settings" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_vehicle_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_scopes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "osoConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_scope_operators" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "abbr" TEXT NOT NULL,
    "share" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_scope_operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_vehicle_plan_lines" (
    "vehiclePlanId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "lineScheduleId" TEXT,
    "isDrifted" BOOLEAN NOT NULL DEFAULT false,
    "hasAttributeDrift" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB,

    CONSTRAINT "transit_vehicle_plan_lines_pkey" PRIMARY KEY ("vehiclePlanId","lineId")
);

-- CreateTable
CREATE TABLE "transit_vehicle_blocks" (
    "id" TEXT NOT NULL,
    "vehiclePlanId" TEXT NOT NULL,
    "branchId" TEXT,
    "blockNumber" INTEGER NOT NULL,
    "depotId" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB,
    "constraints" JSONB,
    "issues" JSONB,
    "hasIssues" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_vehicle_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_line_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branchId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_line_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_line_group_lines" (
    "lineGroupId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,

    CONSTRAINT "transit_line_group_lines_pkey" PRIMARY KEY ("lineGroupId","lineId")
);

-- CreateTable
CREATE TABLE "transit_line_operators" (
    "lineId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "transit_line_operators_pkey" PRIMARY KEY ("lineId","branchId")
);

-- CreateTable
CREATE TABLE "transit_block_trips" (
    "id" TEXT NOT NULL,
    "vehicleBlockId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_block_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_block_deadruns" (
    "id" TEXT NOT NULL,
    "vehicleBlockId" TEXT NOT NULL,
    "type" "transit_deadrun_type" NOT NULL,
    "originLocalityId" TEXT NOT NULL,
    "destinationLocalityId" TEXT NOT NULL,
    "departureMinutes" INTEGER NOT NULL,
    "arrivalMinutes" INTEGER NOT NULL,
    "bundleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_block_deadruns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_shifts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startFloor" INTEGER NOT NULL,
    "startIdealMin" INTEGER NOT NULL,
    "startIdealMax" INTEGER NOT NULL,
    "startCeiling" INTEGER NOT NULL,
    "endFloor" INTEGER NOT NULL,
    "endIdealMin" INTEGER NOT NULL,
    "endIdealMax" INTEGER NOT NULL,
    "endCeiling" INTEGER NOT NULL,
    "allowSplit" BOOLEAN NOT NULL DEFAULT false,
    "restPatternId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_shift_branches" (
    "shiftId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "transit_crew_shift_branches_pkey" PRIMARY KEY ("shiftId","branchId")
);

-- CreateTable
CREATE TABLE "transit_rest_patterns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "anchorDate" DATE NOT NULL,
    "offOnHolidays" BOOLEAN NOT NULL DEFAULT false,
    "staggered" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_rest_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_members" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL DEFAULT 'DRIVER',
    "isRosterable" BOOLEAN NOT NULL DEFAULT true,
    "notBeforeMinutes" INTEGER,
    "notAfterMinutes" INTEGER,
    "restPatternId" TEXT,
    "restOffset" INTEGER NOT NULL DEFAULT 0,
    "blockedVehicleTypes" "VehicleType"[] DEFAULT ARRAY[]::"VehicleType"[],
    "preferredVehicleId" TEXT,
    "weeklyHours" INTEGER,
    "licenseCategory" TEXT,
    "licenseExpiresAt" DATE,
    "courseExpiresAt" DATE,
    "overtimePreference" "OvertimePreference" NOT NULL DEFAULT 'NEUTRAL',
    "standbyRank" INTEGER,
    "standbyBlocked" BOOLEAN NOT NULL DEFAULT false,
    "portalProfileId" TEXT,
    "portalOverride" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_member_shifts" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_member_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_member_lines" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "access" "CrewLineAccess",
    "rank" INTEGER,
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_member_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_absence_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requestable" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effect" "CrewAbsenceEffect" NOT NULL DEFAULT 'ABSENCE',
    "systemKey" TEXT,
    "externalCodes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_absence_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_occurrences" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "kind" "CrewOccurrenceKind" NOT NULL,
    "absenceTypeId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "startNotBefore" INTEGER,
    "endNotAfter" INTEGER,
    "requested" JSONB,
    "status" "CrewOccurrenceStatus" NOT NULL DEFAULT 'APPROVED',
    "origin" "CrewOccurrenceOrigin" NOT NULL DEFAULT 'STAFF',
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "reviewNotes" TEXT,
    "coverCrewMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_plans" (
    "id" TEXT NOT NULL,
    "vehiclePlanId" TEXT NOT NULL,
    "description" TEXT,
    "status" "CrewPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" DATE,
    "validTo" DATE,
    "summary" JSONB,
    "settings" JSONB,
    "constraints" JSONB,
    "generatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_duties" (
    "id" TEXT NOT NULL,
    "crewPlanId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL DEFAULT 'DRIVER',
    "dutyNumber" INTEGER NOT NULL,
    "kind" "DutyKind" NOT NULL DEFAULT 'STRAIGHT',
    "branchId" TEXT,
    "summary" JSONB,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "issues" JSONB,
    "hasIssues" BOOLEAN NOT NULL DEFAULT false,
    "constraints" JSONB,
    "shiftId" TEXT,
    "shiftPinned" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_duties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_duty_pieces" (
    "id" TEXT NOT NULL,
    "dutyId" TEXT NOT NULL,
    "vehicleBlockId" TEXT,
    "sequence" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "startLocalityId" TEXT NOT NULL,
    "endLocalityId" TEXT NOT NULL,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "staleReason" TEXT,
    "startAnchor" TEXT,
    "endAnchor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_duty_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_duty_activities" (
    "id" TEXT NOT NULL,
    "dutyId" TEXT NOT NULL,
    "type" "DutyActivityType" NOT NULL,
    "intervalTypeId" TEXT,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "originLocalityId" TEXT,
    "destinationLocalityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_duty_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_operations" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dayTypeId" TEXT NOT NULL,
    "status" "DailyStatus" NOT NULL DEFAULT 'PLANNED',
    "sources" JSONB NOT NULL,
    "summary" JSONB,
    "crewContext" JSONB,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_daily_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_blocks" (
    "id" TEXT NOT NULL,
    "dailyOperationId" TEXT NOT NULL,
    "sourceBlockId" TEXT,
    "blockNumber" INTEGER NOT NULL,
    "branchId" TEXT,
    "depotId" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "vehicleId" TEXT,
    "issues" JSONB,
    "hasIssues" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_daily_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_block_events" (
    "id" TEXT NOT NULL,
    "dailyOperationId" TEXT NOT NULL,
    "dailyBlockId" TEXT,
    "kind" "DailyEventKind" NOT NULL,
    "sourceId" TEXT,
    "lineId" TEXT,
    "routeId" TEXT,
    "deadrunType" "transit_deadrun_type",
    "intervalTypeId" TEXT,
    "originLocalityId" TEXT,
    "destinationLocalityId" TEXT,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "requiredVehicleType" "VehicleType",
    "bundleId" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_daily_block_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_duties" (
    "id" TEXT NOT NULL,
    "dailyOperationId" TEXT NOT NULL,
    "sourceDutyId" TEXT,
    "role" "CrewRole" NOT NULL,
    "dutyNumber" INTEGER NOT NULL,
    "kind" "DutyKind" NOT NULL,
    "branchId" TEXT,
    "shiftId" TEXT,
    "summary" JSONB,
    "issues" JSONB,
    "hasIssues" BOOLEAN NOT NULL DEFAULT false,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "standbyExtra" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_daily_duties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_duty_pieces" (
    "id" TEXT NOT NULL,
    "dailyDutyId" TEXT NOT NULL,
    "dailyBlockId" TEXT,
    "sequence" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "startLocalityId" TEXT NOT NULL,
    "endLocalityId" TEXT NOT NULL,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "staleReason" TEXT,

    CONSTRAINT "transit_daily_duty_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_duty_activities" (
    "id" TEXT NOT NULL,
    "dailyDutyId" TEXT NOT NULL,
    "type" "DutyActivityType" NOT NULL,
    "intervalTypeId" TEXT,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "originLocalityId" TEXT,
    "destinationLocalityId" TEXT,

    CONSTRAINT "transit_daily_duty_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_roster_entries" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "RosterEntryKind" NOT NULL,
    "dailyDutyId" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "absenceTypeId" TEXT,
    "crewOccurrenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_roster_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_roster_generations" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "params" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "assigned" INTEGER NOT NULL,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_roster_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_daily_change_logs" (
    "id" TEXT NOT NULL,
    "dailyOperationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "crewMemberIds" TEXT[],
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_daily_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_hour_bank_entries" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "HourBankEntryKind" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "payMinutes" INTEGER NOT NULL DEFAULT 0,
    "holidayMinutes" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "occurrence" TEXT,
    "notes" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_hour_bank_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_hour_bank_closings" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "userId" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_hour_bank_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_hour_bank_lots" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "credit" INTEGER NOT NULL,
    "debit" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "payout" INTEGER NOT NULL,
    "pay" INTEGER NOT NULL,
    "holiday" INTEGER NOT NULL,
    "forgiven" INTEGER NOT NULL,
    "negative" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_hour_bank_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_timesheet_imports" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "fileName" TEXT NOT NULL,
    "userId" TEXT,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_crew_timesheet_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_timesheet_days" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "occurrence" TEXT NOT NULL,
    "extraMinutes" INTEGER NOT NULL,
    "shortMinutes" INTEGER NOT NULL,
    "workedMinutes" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_timesheet_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_role_job_titles" (
    "id" TEXT NOT NULL,
    "jobTitleId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_role_job_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_roster_adjustments" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "role" "CrewRole" NOT NULL,
    "kind" TEXT NOT NULL,
    "effective" DATE NOT NULL,
    "rule" JSONB,
    "items" JSONB NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_roster_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_access" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "mustChangePin" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_crew_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_portal_profiles" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transit_portal_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transit_crew_notifications" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "changeLogId" TEXT,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transit_crew_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "companies_taxId_key" ON "companies"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "branches_name_key" ON "branches"("name");

-- CreateIndex
CREATE UNIQUE INDEX "branches_taxId_key" ON "branches"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "user_branches_userId_branchId_key" ON "user_branches"("userId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "user_permissions_userId_resource_action_key" ON "user_permissions"("userId", "resource", "action");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_branchId_key" ON "holidays"("date", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_brands_name_key" ON "vehicle_brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_models_name_brandId_key" ON "vehicle_models"("name", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_code_key" ON "vehicles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_renavam_key" ON "vehicles"("renavam");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_chassis_key" ON "vehicles"("chassis");

-- CreateIndex
CREATE INDEX "vehicle_unavailabilities_vehicleId_startDate_idx" ON "vehicle_unavailabilities"("vehicleId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "job_titles_name_key" ON "job_titles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_code_key" ON "employees"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_taxId_key" ON "employees"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_localities_code_key" ON "transit_localities"("code");

-- CreateIndex
CREATE UNIQUE INDEX "transit_lines_code_key" ON "transit_lines"("code");

-- CreateIndex
CREATE INDEX "transit_line_service_requirements_lineId_dayTypeId_idx" ON "transit_line_service_requirements"("lineId", "dayTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_routes_lineId_direction_ordinal_key" ON "transit_routes"("lineId", "direction", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "transit_route_localities_routeId_sequence_key" ON "transit_route_localities"("routeId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "transit_travel_times_originId_destinationId_key" ON "transit_travel_times"("originId", "destinationId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_day_types_code_key" ON "transit_day_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "transit_line_schedules_lineId_dayTypeId_approvalRef_key" ON "transit_line_schedules"("lineId", "dayTypeId", "approvalRef");

-- CreateIndex
CREATE INDEX "transit_trips_bundleId_idx" ON "transit_trips"("bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_interval_types_code_key" ON "transit_interval_types"("code");

-- CreateIndex
CREATE INDEX "transit_block_intervals_bundleId_idx" ON "transit_block_intervals"("bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_scopes_name_key" ON "transit_scopes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "transit_scope_operators_scopeId_branchId_key" ON "transit_scope_operators"("scopeId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_vehicle_blocks_vehiclePlanId_blockNumber_key" ON "transit_vehicle_blocks"("vehiclePlanId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "transit_line_groups_name_key" ON "transit_line_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "transit_block_trips_vehicleBlockId_sequence_key" ON "transit_block_trips"("vehicleBlockId", "sequence");

-- CreateIndex
CREATE INDEX "transit_block_deadruns_bundleId_idx" ON "transit_block_deadruns"("bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_shifts_code_key" ON "transit_crew_shifts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "transit_rest_patterns_name_key" ON "transit_rest_patterns"("name");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_members_employeeId_key" ON "transit_crew_members"("employeeId");

-- CreateIndex
CREATE INDEX "transit_crew_member_shifts_crewMemberId_validFrom_idx" ON "transit_crew_member_shifts"("crewMemberId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_member_lines_crewMemberId_lineId_key" ON "transit_crew_member_lines"("crewMemberId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_member_lines_crewMemberId_rank_key" ON "transit_crew_member_lines"("crewMemberId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_absence_types_code_key" ON "transit_crew_absence_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_absence_types_systemKey_key" ON "transit_crew_absence_types"("systemKey");

-- CreateIndex
CREATE INDEX "transit_crew_occurrences_crewMemberId_startDate_idx" ON "transit_crew_occurrences"("crewMemberId", "startDate");

-- CreateIndex
CREATE INDEX "transit_crew_occurrences_coverCrewMemberId_startDate_idx" ON "transit_crew_occurrences"("coverCrewMemberId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "transit_duties_crewPlanId_role_dutyNumber_key" ON "transit_duties"("crewPlanId", "role", "dutyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "transit_duty_pieces_dutyId_sequence_key" ON "transit_duty_pieces"("dutyId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "transit_daily_operations_scopeId_date_key" ON "transit_daily_operations"("scopeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "transit_daily_blocks_dailyOperationId_blockNumber_key" ON "transit_daily_blocks"("dailyOperationId", "blockNumber");

-- CreateIndex
CREATE INDEX "transit_daily_block_events_dailyOperationId_idx" ON "transit_daily_block_events"("dailyOperationId");

-- CreateIndex
CREATE INDEX "transit_daily_block_events_dailyBlockId_idx" ON "transit_daily_block_events"("dailyBlockId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_daily_duties_dailyOperationId_role_dutyNumber_key" ON "transit_daily_duties"("dailyOperationId", "role", "dutyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "transit_daily_duty_pieces_dailyDutyId_sequence_key" ON "transit_daily_duty_pieces"("dailyDutyId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "transit_roster_entries_dailyDutyId_key" ON "transit_roster_entries"("dailyDutyId");

-- CreateIndex
CREATE INDEX "transit_roster_entries_crewMemberId_date_idx" ON "transit_roster_entries"("crewMemberId", "date");

-- CreateIndex
CREATE INDEX "transit_roster_entries_date_idx" ON "transit_roster_entries"("date");

-- CreateIndex
CREATE INDEX "transit_roster_generations_branchId_role_fromDate_toDate_idx" ON "transit_roster_generations"("branchId", "role", "fromDate", "toDate");

-- CreateIndex
CREATE INDEX "transit_daily_change_logs_dailyOperationId_createdAt_idx" ON "transit_daily_change_logs"("dailyOperationId", "createdAt");

-- CreateIndex
CREATE INDEX "transit_hour_bank_entries_crewMemberId_date_idx" ON "transit_hour_bank_entries"("crewMemberId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "transit_hour_bank_closings_branchId_month_key" ON "transit_hour_bank_closings"("branchId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "transit_hour_bank_lots_crewMemberId_month_key" ON "transit_hour_bank_lots"("crewMemberId", "month");

-- CreateIndex
CREATE INDEX "transit_crew_timesheet_imports_branchId_fromDate_idx" ON "transit_crew_timesheet_imports"("branchId", "fromDate");

-- CreateIndex
CREATE INDEX "transit_crew_timesheet_days_date_idx" ON "transit_crew_timesheet_days"("date");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_timesheet_days_crewMemberId_date_key" ON "transit_crew_timesheet_days"("crewMemberId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_role_job_titles_jobTitleId_key" ON "transit_crew_role_job_titles"("jobTitleId");

-- CreateIndex
CREATE INDEX "transit_roster_adjustments_branchId_role_createdAt_idx" ON "transit_roster_adjustments"("branchId", "role", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_access_crewMemberId_key" ON "transit_crew_access"("crewMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_portal_profiles_branchId_name_key" ON "transit_portal_profiles"("branchId", "name");

-- CreateIndex
CREATE INDEX "transit_crew_notifications_crewMemberId_readAt_idx" ON "transit_crew_notifications"("crewMemberId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "transit_crew_notifications_crewMemberId_changeLogId_key" ON "transit_crew_notifications"("crewMemberId", "changeLogId");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_password_history" ADD CONSTRAINT "user_password_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "vehicle_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "vehicle_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_unavailabilities" ADD CONSTRAINT "vehicle_unavailabilities_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_titles" ADD CONSTRAINT "job_titles_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_lines" ADD CONSTRAINT "transit_lines_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "transit_scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_lines" ADD CONSTRAINT "transit_lines_parentLineId_fkey" FOREIGN KEY ("parentLineId") REFERENCES "transit_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_service_requirements" ADD CONSTRAINT "transit_line_service_requirements_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_service_requirements" ADD CONSTRAINT "transit_line_service_requirements_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_service_requirements" ADD CONSTRAINT "transit_line_service_requirements_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "transit_localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_routes" ADD CONSTRAINT "transit_routes_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_routes" ADD CONSTRAINT "transit_routes_originLocalityId_fkey" FOREIGN KEY ("originLocalityId") REFERENCES "transit_localities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_routes" ADD CONSTRAINT "transit_routes_destinationLocalityId_fkey" FOREIGN KEY ("destinationLocalityId") REFERENCES "transit_localities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_routes" ADD CONSTRAINT "transit_routes_homeDepotId_fkey" FOREIGN KEY ("homeDepotId") REFERENCES "transit_localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_route_localities" ADD CONSTRAINT "transit_route_localities_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "transit_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_route_localities" ADD CONSTRAINT "transit_route_localities_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "transit_localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_travel_times" ADD CONSTRAINT "transit_travel_times_originId_fkey" FOREIGN KEY ("originId") REFERENCES "transit_localities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_travel_times" ADD CONSTRAINT "transit_travel_times_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "transit_localities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_calendar_exceptions" ADD CONSTRAINT "transit_line_calendar_exceptions_sourceDayTypeId_fkey" FOREIGN KEY ("sourceDayTypeId") REFERENCES "transit_day_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_calendar_exceptions" ADD CONSTRAINT "transit_line_calendar_exceptions_overrideDayTypeId_fkey" FOREIGN KEY ("overrideDayTypeId") REFERENCES "transit_day_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_calendar_exception_lines" ADD CONSTRAINT "transit_line_calendar_exception_lines_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "transit_line_calendar_exceptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_calendar_exception_lines" ADD CONSTRAINT "transit_line_calendar_exception_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_schedules" ADD CONSTRAINT "transit_line_schedules_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_schedules" ADD CONSTRAINT "transit_line_schedules_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_departures" ADD CONSTRAINT "transit_line_departures_lineScheduleId_fkey" FOREIGN KEY ("lineScheduleId") REFERENCES "transit_line_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_departures" ADD CONSTRAINT "transit_line_departures_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "transit_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_trips" ADD CONSTRAINT "transit_trips_vehiclePlanId_fkey" FOREIGN KEY ("vehiclePlanId") REFERENCES "transit_vehicle_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_trips" ADD CONSTRAINT "transit_trips_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "transit_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_trips" ADD CONSTRAINT "transit_trips_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_block_intervals" ADD CONSTRAINT "transit_block_intervals_vehicleBlockId_fkey" FOREIGN KEY ("vehicleBlockId") REFERENCES "transit_vehicle_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_block_intervals" ADD CONSTRAINT "transit_block_intervals_intervalTypeId_fkey" FOREIGN KEY ("intervalTypeId") REFERENCES "transit_interval_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_vehicle_plans" ADD CONSTRAINT "transit_vehicle_plans_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "transit_scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_vehicle_plans" ADD CONSTRAINT "transit_vehicle_plans_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_scope_operators" ADD CONSTRAINT "transit_scope_operators_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "transit_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_scope_operators" ADD CONSTRAINT "transit_scope_operators_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_vehicle_plan_lines" ADD CONSTRAINT "transit_vehicle_plan_lines_vehiclePlanId_fkey" FOREIGN KEY ("vehiclePlanId") REFERENCES "transit_vehicle_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_vehicle_plan_lines" ADD CONSTRAINT "transit_vehicle_plan_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_vehicle_plan_lines" ADD CONSTRAINT "transit_vehicle_plan_lines_lineScheduleId_fkey" FOREIGN KEY ("lineScheduleId") REFERENCES "transit_line_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_vehicle_blocks" ADD CONSTRAINT "transit_vehicle_blocks_vehiclePlanId_fkey" FOREIGN KEY ("vehiclePlanId") REFERENCES "transit_vehicle_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_vehicle_blocks" ADD CONSTRAINT "transit_vehicle_blocks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_vehicle_blocks" ADD CONSTRAINT "transit_vehicle_blocks_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "transit_localities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_groups" ADD CONSTRAINT "transit_line_groups_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_group_lines" ADD CONSTRAINT "transit_line_group_lines_lineGroupId_fkey" FOREIGN KEY ("lineGroupId") REFERENCES "transit_line_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_group_lines" ADD CONSTRAINT "transit_line_group_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_operators" ADD CONSTRAINT "transit_line_operators_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_line_operators" ADD CONSTRAINT "transit_line_operators_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_block_trips" ADD CONSTRAINT "transit_block_trips_vehicleBlockId_fkey" FOREIGN KEY ("vehicleBlockId") REFERENCES "transit_vehicle_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_block_trips" ADD CONSTRAINT "transit_block_trips_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "transit_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_block_deadruns" ADD CONSTRAINT "transit_block_deadruns_vehicleBlockId_fkey" FOREIGN KEY ("vehicleBlockId") REFERENCES "transit_vehicle_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_block_deadruns" ADD CONSTRAINT "transit_block_deadruns_originLocalityId_fkey" FOREIGN KEY ("originLocalityId") REFERENCES "transit_localities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_block_deadruns" ADD CONSTRAINT "transit_block_deadruns_destinationLocalityId_fkey" FOREIGN KEY ("destinationLocalityId") REFERENCES "transit_localities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_shifts" ADD CONSTRAINT "transit_crew_shifts_restPatternId_fkey" FOREIGN KEY ("restPatternId") REFERENCES "transit_rest_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_shift_branches" ADD CONSTRAINT "transit_crew_shift_branches_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "transit_crew_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_shift_branches" ADD CONSTRAINT "transit_crew_shift_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_members" ADD CONSTRAINT "transit_crew_members_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_members" ADD CONSTRAINT "transit_crew_members_restPatternId_fkey" FOREIGN KEY ("restPatternId") REFERENCES "transit_rest_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_members" ADD CONSTRAINT "transit_crew_members_preferredVehicleId_fkey" FOREIGN KEY ("preferredVehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_members" ADD CONSTRAINT "transit_crew_members_portalProfileId_fkey" FOREIGN KEY ("portalProfileId") REFERENCES "transit_portal_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_member_shifts" ADD CONSTRAINT "transit_crew_member_shifts_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_member_shifts" ADD CONSTRAINT "transit_crew_member_shifts_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "transit_crew_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_member_lines" ADD CONSTRAINT "transit_crew_member_lines_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_member_lines" ADD CONSTRAINT "transit_crew_member_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_occurrences" ADD CONSTRAINT "transit_crew_occurrences_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_occurrences" ADD CONSTRAINT "transit_crew_occurrences_absenceTypeId_fkey" FOREIGN KEY ("absenceTypeId") REFERENCES "transit_crew_absence_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_occurrences" ADD CONSTRAINT "transit_crew_occurrences_coverCrewMemberId_fkey" FOREIGN KEY ("coverCrewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_plans" ADD CONSTRAINT "transit_crew_plans_vehiclePlanId_fkey" FOREIGN KEY ("vehiclePlanId") REFERENCES "transit_vehicle_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duties" ADD CONSTRAINT "transit_duties_crewPlanId_fkey" FOREIGN KEY ("crewPlanId") REFERENCES "transit_crew_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duties" ADD CONSTRAINT "transit_duties_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duties" ADD CONSTRAINT "transit_duties_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "transit_crew_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_pieces" ADD CONSTRAINT "transit_duty_pieces_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "transit_duties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_pieces" ADD CONSTRAINT "transit_duty_pieces_vehicleBlockId_fkey" FOREIGN KEY ("vehicleBlockId") REFERENCES "transit_vehicle_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_pieces" ADD CONSTRAINT "transit_duty_pieces_startLocalityId_fkey" FOREIGN KEY ("startLocalityId") REFERENCES "transit_localities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_pieces" ADD CONSTRAINT "transit_duty_pieces_endLocalityId_fkey" FOREIGN KEY ("endLocalityId") REFERENCES "transit_localities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_activities" ADD CONSTRAINT "transit_duty_activities_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "transit_duties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_activities" ADD CONSTRAINT "transit_duty_activities_intervalTypeId_fkey" FOREIGN KEY ("intervalTypeId") REFERENCES "transit_interval_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_activities" ADD CONSTRAINT "transit_duty_activities_originLocalityId_fkey" FOREIGN KEY ("originLocalityId") REFERENCES "transit_localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_duty_activities" ADD CONSTRAINT "transit_duty_activities_destinationLocalityId_fkey" FOREIGN KEY ("destinationLocalityId") REFERENCES "transit_localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_operations" ADD CONSTRAINT "transit_daily_operations_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "transit_scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_operations" ADD CONSTRAINT "transit_daily_operations_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_blocks" ADD CONSTRAINT "transit_daily_blocks_dailyOperationId_fkey" FOREIGN KEY ("dailyOperationId") REFERENCES "transit_daily_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_blocks" ADD CONSTRAINT "transit_daily_blocks_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_block_events" ADD CONSTRAINT "transit_daily_block_events_dailyOperationId_fkey" FOREIGN KEY ("dailyOperationId") REFERENCES "transit_daily_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_block_events" ADD CONSTRAINT "transit_daily_block_events_dailyBlockId_fkey" FOREIGN KEY ("dailyBlockId") REFERENCES "transit_daily_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_duties" ADD CONSTRAINT "transit_daily_duties_dailyOperationId_fkey" FOREIGN KEY ("dailyOperationId") REFERENCES "transit_daily_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_duty_pieces" ADD CONSTRAINT "transit_daily_duty_pieces_dailyDutyId_fkey" FOREIGN KEY ("dailyDutyId") REFERENCES "transit_daily_duties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_duty_pieces" ADD CONSTRAINT "transit_daily_duty_pieces_dailyBlockId_fkey" FOREIGN KEY ("dailyBlockId") REFERENCES "transit_daily_blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_duty_activities" ADD CONSTRAINT "transit_daily_duty_activities_dailyDutyId_fkey" FOREIGN KEY ("dailyDutyId") REFERENCES "transit_daily_duties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_roster_entries" ADD CONSTRAINT "transit_roster_entries_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_roster_entries" ADD CONSTRAINT "transit_roster_entries_dailyDutyId_fkey" FOREIGN KEY ("dailyDutyId") REFERENCES "transit_daily_duties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_roster_entries" ADD CONSTRAINT "transit_roster_entries_absenceTypeId_fkey" FOREIGN KEY ("absenceTypeId") REFERENCES "transit_crew_absence_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_roster_entries" ADD CONSTRAINT "transit_roster_entries_crewOccurrenceId_fkey" FOREIGN KEY ("crewOccurrenceId") REFERENCES "transit_crew_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_daily_change_logs" ADD CONSTRAINT "transit_daily_change_logs_dailyOperationId_fkey" FOREIGN KEY ("dailyOperationId") REFERENCES "transit_daily_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_hour_bank_entries" ADD CONSTRAINT "transit_hour_bank_entries_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_hour_bank_lots" ADD CONSTRAINT "transit_hour_bank_lots_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_timesheet_days" ADD CONSTRAINT "transit_crew_timesheet_days_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_role_job_titles" ADD CONSTRAINT "transit_crew_role_job_titles_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "job_titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_access" ADD CONSTRAINT "transit_crew_access_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_portal_profiles" ADD CONSTRAINT "transit_portal_profiles_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transit_crew_notifications" ADD CONSTRAINT "transit_crew_notifications_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "transit_crew_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- System absence types: the roster's own days off and férias (may name a ferista)
INSERT INTO "transit_crew_absence_types" ("id", "code", "name", "requestable", "isActive", "effect", "systemKey", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'FS', 'Folga semanal (DSR)', false, true, 'DAY_OFF',  'WEEKLY_OFF', now(), now()),
  (gen_random_uuid(), 'FC', 'Folga compensada',    false, true, 'COMP_OFF', 'COMP_OFF',   now(), now()),
  (gen_random_uuid(), 'FE', 'Férias',              false, true, 'ABSENCE',  'VACATION',   now(), now());
