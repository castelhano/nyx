-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'operator',
    "preferences" JSONB,
    "lastLoginAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "forcePasswordChange" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "branches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_branches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_branches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_password_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_password_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "durationMs" INTEGER,
    "input" JSONB,
    "output" JSONB,
    "outputFile" TEXT,
    "errors" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("key", "scope")
);

-- CreateTable
CREATE TABLE "vehicle_brands" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "vehicle_models" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "vehicle_models_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "vehicle_brands" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "renavam" TEXT,
    "chassis" TEXT,
    "brandId" TEXT,
    "modelId" TEXT,
    "year" INTEGER,
    "modelYear" INTEGER,
    "vehicleType" TEXT NOT NULL DEFAULT 'BUS',
    "color" TEXT,
    "fuelType" TEXT NOT NULL DEFAULT 'DIESEL',
    "transmission" TEXT,
    "seatedCapacity" INTEGER,
    "totalCapacity" INTEGER,
    "odometer" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "acquisitionDate" DATETIME,
    "acquisitionValue" DECIMAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "vehicles_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "vehicles_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "vehicle_brands" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "vehicles_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_models" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "job_titles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "job_titles_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "preferredName" TEXT,
    "taxId" TEXT NOT NULL,
    "dateOfBirth" DATETIME,
    "gender" TEXT,
    "maritalStatus" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "photoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "hireDate" DATETIME NOT NULL,
    "terminationDate" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "employees_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "jobTitleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "salary" DECIMAL NOT NULL,
    "weeklyHours" INTEGER NOT NULL DEFAULT 44,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "contracts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contracts_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "job_titles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_localities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "abbr" TEXT,
    "name" TEXT NOT NULL,
    "lat" REAL,
    "lng" REAL,
    "isDepot" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "transit_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "metrics" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "transit_routes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originLocalityId" TEXT NOT NULL,
    "destinationLocalityId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_routes_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transit_routes_originLocalityId_fkey" FOREIGN KEY ("originLocalityId") REFERENCES "transit_localities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transit_routes_destinationLocalityId_fkey" FOREIGN KEY ("destinationLocalityId") REFERENCES "transit_localities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_route_localities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routeId" TEXT NOT NULL,
    "localityId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "deltaMinutes" INTEGER,
    "deltaKm" REAL,
    "allowsCrewChange" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_route_localities_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "transit_routes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_route_localities_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "transit_localities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_travel_times" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "baseMinutes" REAL NOT NULL,
    "distanceKm" REAL NOT NULL,
    "peakMultiplier" REAL NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_travel_times_originId_fkey" FOREIGN KEY ("originId") REFERENCES "transit_localities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "transit_travel_times_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "transit_localities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_day_types" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pattern" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "transit_line_calendar_exceptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME,
    "sourceDayTypeId" TEXT,
    "overrideDayTypeId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_line_calendar_exceptions_sourceDayTypeId_fkey" FOREIGN KEY ("sourceDayTypeId") REFERENCES "transit_day_types" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transit_line_calendar_exceptions_overrideDayTypeId_fkey" FOREIGN KEY ("overrideDayTypeId") REFERENCES "transit_day_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_line_calendar_exception_lines" (
    "exceptionId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,

    PRIMARY KEY ("exceptionId", "lineId"),
    CONSTRAINT "transit_line_calendar_exception_lines_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "transit_line_calendar_exceptions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_line_calendar_exception_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_trips" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routeId" TEXT NOT NULL,
    "departureMinutes" INTEGER NOT NULL,
    "arrivalMinutes" INTEGER NOT NULL,
    "requiredVehicleType" TEXT,
    "constraints" JSONB,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_trips_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "transit_routes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_trip_day_types" (
    "tripId" TEXT NOT NULL,
    "dayTypeId" TEXT NOT NULL,

    PRIMARY KEY ("tripId", "dayTypeId"),
    CONSTRAINT "transit_trip_day_types_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "transit_trips" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_trip_day_types_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_vehicle_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dayTypeId" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "summary" JSONB,
    "generatedAt" DATETIME,
    "constraints" JSONB,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_vehicle_plans_dayTypeId_fkey" FOREIGN KEY ("dayTypeId") REFERENCES "transit_day_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_vehicle_plan_lines" (
    "vehiclePlanId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,

    PRIMARY KEY ("vehiclePlanId", "lineId"),
    CONSTRAINT "transit_vehicle_plan_lines_vehiclePlanId_fkey" FOREIGN KEY ("vehiclePlanId") REFERENCES "transit_vehicle_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_vehicle_plan_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_vehicle_blocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehiclePlanId" TEXT NOT NULL,
    "branchId" TEXT,
    "blockNumber" INTEGER NOT NULL,
    "depotId" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB,
    "constraints" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_vehicle_blocks_vehiclePlanId_fkey" FOREIGN KEY ("vehiclePlanId") REFERENCES "transit_vehicle_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_vehicle_blocks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transit_vehicle_blocks_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "transit_localities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_line_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "branchId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_line_groups_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_line_group_lines" (
    "lineGroupId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,

    PRIMARY KEY ("lineGroupId", "lineId"),
    CONSTRAINT "transit_line_group_lines_lineGroupId_fkey" FOREIGN KEY ("lineGroupId") REFERENCES "transit_line_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_line_group_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "transit_lines" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transit_block_trips" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleBlockId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "isDeadhead" BOOLEAN NOT NULL DEFAULT false,
    "deadheadMinutes" INTEGER,
    "deadheadKm" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transit_block_trips_vehicleBlockId_fkey" FOREIGN KEY ("vehicleBlockId") REFERENCES "transit_vehicle_blocks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transit_block_trips_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "transit_trips" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "companies_taxId_key" ON "companies"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "branches_taxId_key" ON "branches"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "user_branches_userId_branchId_key" ON "user_branches"("userId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "user_permissions_userId_resource_action_key" ON "user_permissions"("userId", "resource", "action");

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
CREATE UNIQUE INDEX "employees_code_key" ON "employees"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_taxId_key" ON "employees"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_localities_code_key" ON "transit_localities"("code");

-- CreateIndex
CREATE UNIQUE INDEX "transit_lines_code_key" ON "transit_lines"("code");

-- CreateIndex
CREATE UNIQUE INDEX "transit_route_localities_routeId_sequence_key" ON "transit_route_localities"("routeId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "transit_route_localities_routeId_localityId_key" ON "transit_route_localities"("routeId", "localityId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_travel_times_originId_destinationId_key" ON "transit_travel_times"("originId", "destinationId");

-- CreateIndex
CREATE UNIQUE INDEX "transit_day_types_code_key" ON "transit_day_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "transit_vehicle_blocks_vehiclePlanId_blockNumber_key" ON "transit_vehicle_blocks"("vehiclePlanId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "transit_block_trips_vehicleBlockId_sequence_key" ON "transit_block_trips"("vehicleBlockId", "sequence");
