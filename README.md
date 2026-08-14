# Nyx

Full-stack monorepo with NestJS (API) and Next.js (Web), managed via pnpm workspaces and Turborepo.

## Structure

```
nyx/
├── apps/
│   ├── api/        # NestJS + Prisma 7 + PostgreSQL (backend)
│   └── web/        # Next.js 14 + Tailwind (frontend)
├── packages/
│   ├── schemas/    # Shared Zod schemas
│   └── types/      # Shared TypeScript types
└── docs/           # Architecture and user documentation
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22.12 — required by Prisma 7
- [pnpm](https://pnpm.io/) >= 10 — install with `npm install -g pnpm`
- [Docker](https://docs.docker.com/get-docker/) — runs the local PostgreSQL & OSRM instances

## First-time setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` to use the PostgreSQL connection (the committed schema's provider — see [Database](#database--postgresql)):

```env
DATABASE_URL="postgresql://nyx:nyx@localhost:5432/nyx"
JWT_SECRET="change-in-production"   # secret used to sign JWT tokens
```

To generate a strong `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

> **Important:** never commit `.env`. It is already listed in `.gitignore`.

### 3. Start PostgreSQL

```bash
docker compose -f docker-compose.pg.yml up -d
```

### 4. Apply migrations and generate the Prisma client

```bash
cd apps/api
pnpm db:migrate
```

> `db:migrate` runs `prisma migrate dev && prisma generate`. The generated client (`src/generated/prisma/`) is gitignored and must always be built locally — it is never committed to the repository.

### 5. Seed the database

```bash
cd apps/api
pnpm db:seed             # creates the default admin account
pnpm db:seed-core        # sample companies/branches
pnpm db:import-transit   # restores the transit payload fixture, if apps/api/prisma/fixtures/transit.json exists
```

The admin account created by `db:seed`:

| Field    | Value     |
|----------|-----------|
| username | `admin`   |
| password | `admin123` |

> Change the password after the first login.

### 6. Start the development environment

From the monorepo root:

```bash
pnpm dev
```

Turbo starts both apps in parallel:

| App | Default URL           |
|-----|-----------------------|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |

---

## Setting up on another machine / after a major upgrade

### Fresh clone

```bash
git clone <repository-url>
cd nyx
pnpm install
cp apps/api/.env.example apps/api/.env   # then edit DATABASE_URL and JWT_SECRET, see step 2 above
docker compose -f docker-compose.pg.yml up -d
cd apps/api
pnpm db:migrate         # creates the database, applies migrations, generates Prisma client
pnpm db:seed            # admin user
pnpm db:seed-core       # companies/branches
pnpm db:import-transit  # transit cadastro data, if apps/api/prisma/fixtures/transit.json exists
```

### Updating an existing clone

```bash
git pull
pnpm install          # picks up new dependencies
cd apps/api
pnpm db:migrate       # applies any new migrations and regenerates the client
```

> If the pull included a migration squash (see below), `db:migrate` won't work — your local `_prisma_migrations` history will have diverged from the new single baseline migration. Use `pnpm db:reset` instead; it's built for exactly this case.

> The generated Prisma client (`src/generated/prisma/`) is gitignored — `db:migrate` always rebuilds it. Never copy it manually between machines.

---

## Database — PostgreSQL

The project runs on PostgreSQL, both in development (via the `docker-compose.pg.yml` container) and in production. `PrismaService` and all seed/fixture scripts pick the right Prisma adapter automatically from the `DATABASE_URL` prefix, so the same code also works against SQLite if you ever need it locally (see below) — but the committed schema (`apps/api/prisma/schema/_base.prisma`) currently declares `provider = "postgresql"`, and the migration history was generated against it.

The container persists data in a Docker volume (`nyx_pg_data`). Stop it with `docker compose -f docker-compose.pg.yml down` and remove the volume with `docker volume rm nyx_pg_data` when no longer needed.

### Using SQLite instead

Only useful for fully offline/local experiments — the checked-in migrations target PostgreSQL, so switching providers means starting a fresh migration history.

**1.** Edit `apps/api/prisma/schema/_base.prisma`:
```prisma
datasource db {
  provider = "sqlite"
  // provider = "postgresql"
}
```

**2.** Edit `apps/api/.env`:
```env
DATABASE_URL="file:./dev.db"
# DATABASE_URL="postgresql://nyx:nyx@localhost:5432/nyx"
```

**3.** Push the schema (`db:migrate` won't work across a provider change — `migration_lock.toml` records the current provider and Prisma blocks it):
```bash
cd apps/api && pnpm db:push
```

To go back to PostgreSQL, revert both files and run `pnpm db:generate`.

---

## Syncing payload data between machines

The transit payload (localities, lines, routes, route trajectories, day types, scope/operators) is edited live through the app, not through the seed scripts — so it needs its own sync path, separate from schema migrations. Only one machine is ever the "active" writer at a time, so there's no merge/conflict logic: whichever fixture was exported and pushed last is authoritative.

### Day-to-day sync (no schema change)

**Source machine** (has the up-to-date data):
```bash
cd apps/api
pnpm db:export-transit
git add prisma/fixtures/transit.json
git commit -m "sync: transit fixture"
git push
```

**Destination machine:**
```bash
git pull
cd apps/api
pnpm db:import-transit
```

`db:export-transit` / `db:import-transit` read and write `apps/api/prisma/fixtures/transit.json`, keyed by natural keys (locality/line codes, route direction) rather than database ids — so it survives a `migrate reset` and imports cleanly regardless of which machine generated the ids. Both scripts are safe to re-run (upsert-based).

`db:import-transit` requires `db:seed-core` to have already run at least once (it resolves `ScopeOperator` branches by tax id).

### Periodic migration squash

1. **Export the current data**
   ```bash
   cd apps/api
   pnpm db:export-transit
   ```

2. **Delete the old migrations** — keep `migration_lock.toml`
   ```bash
   rm -rf apps/api/prisma/migrations/*/
   ```

3. **Wipe the database**
   `--skip-seed` avoids Prisma's automatic seed hook would otherwise try to run against a schema that doesn't exist yet
   ```bash
   pnpm exec prisma migrate reset --force --skip-seed
   ```

4. **Generate the new single migration** — diffs `schema.prisma` against the now-empty database
   ```bash
   pnpm exec prisma migrate dev --name init
   ```

5. **Restore the saved data**
   ```bash
   pnpm db:seed-core && pnpm db:import-transit
   ```

6. **Commit and push** — the new migration and the fixture must travel together; that's what the other machine pulls in the next step
   ```bash
   git add apps/api/prisma/migrations apps/api/prisma/fixtures/transit.json
   git commit -m "chore: squash migrations"
   git push
   ```

### Picking up a squash on another machine

```bash
git pull
cd apps/api
pnpm db:reset   # migrate reset --force + db:seed + db:seed-core + db:import-transit, in one shot
```

---

## OSRM — travel time matrix

The transit planning module uses [OSRM](https://project-osrm.org/) to automatically generate the travel-time/distance matrix between localities. It is an **optional** dependency — without it, the matrix can be filled manually through the UI.

When running, OSRM must be reachable at the URL defined by `OSRM_URL` in `apps/api/.env` (default: `http://localhost:5000`).

### Setup (Docker Compose)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/) running.

**1. Download the OSM map for your region** (from [Geofabrik](https://download.geofabrik.de/)) into `osrm/data/` (gitignored):

```bash
# Example: Centro-Oeste region (~185 MB, covers Mato Grosso/Cuiabá)
curl -o osrm/data/centro-oeste-latest.osm.pbf https://download.geofabrik.de/south-america/brazil/centro-oeste-latest.osm.pbf

# Full Brazil (~1.9 GB, slow to process — use only if needed)
# curl -o osrm/data/brazil-latest.osm.pbf https://download.geofabrik.de/south-america/brazil-latest.osm.pbf
```

Any single `.osm.pbf` file works — the scripts pick it up by extension, no renaming needed.

**2. Start OSRM** (from project root):

```bash
docker compose -f docker-compose.osrm.yml up
```

This runs two services:
- `osrm-prepare` — runs `osrm-extract`, `osrm-partition`, and `osrm-customize` once against the `.pbf` in `osrm/data/`, then exits. On subsequent runs it detects the already-processed `.osrm.mldgr` file and skips straight to the next step.
- `osrm-routed` — starts the routing server on port 5000 once `osrm-prepare` finishes successfully.

Add `-d` to run in the background. Pre-processing a regional extract like Centro-Oeste takes a few minutes; stop the stack with `docker compose -f docker-compose.osrm.yml down`.

**Quick test:**

```bash
curl "http://localhost:5000/table/v1/driving/-56.097,-15.601;-56.090,-15.595?annotations=duration,distance"
```

### Generating the matrix

Once OSRM is running, open the **Matriz de Tempos** list in the app and click **Gerar Matriz** in the topbar. Only localities that have both `lat` and `lng` coordinates set are included. Entries with source `MANUAL` are never overwritten.

> The `car.lua` profile (car speeds) is a good approximation for urban bus planning. The matrix generation also triggers automatically whenever a locality is created or updated.

### Checking for updates

Geofabrik republishes each regional extract periodically (roughly weekly). To check whether the `.osm.pbf` in `osrm/data/` is current, resolve the region's `-latest.osm.pbf` redirect and compare the dated filename it points to against your local file:

```bash
curl -sI https://download.geofabrik.de/south-america/brazil/centro-oeste-latest.osm.pbf | grep -i location
```

The `Location` header shows the current filename, e.g. `centro-oeste-260813.osm.pbf` — the `YYMMDD` suffix is the extract date. If that date is newer than the one in your local file's name, an update is available. Swap the URL path if you're using a different region/extract.

### Updating the map

1. Download the new extract into `osrm/data/` (same command as step 1 in setup above).
2. Remove the old `.osm.pbf` and its processed `.osrm*` artifacts from `osrm/data/` — `osrm-prepare` skips processing whenever a `.osrm.mldgr` file already exists, so stale data is never regenerated automatically.
3. Re-run `docker compose -f docker-compose.osrm.yml up osrm-prepare` to process the new extract.
4. Restart `osrm-routed`: `docker compose -f docker-compose.osrm.yml up -d`.
5. Re-generate the travel-time matrix from the UI (**Matriz de Tempos** → **Gerar Matriz**) so it reflects the updated road network.

---

## Available scripts

### Root (monorepo)

| Command      | Description                              |
|--------------|------------------------------------------|
| `pnpm dev`   | Start all apps in development mode       |
| `pnpm build` | Build all apps for production            |
| `pnpm lint`  | Run the linter across all workspaces     |

### API (`apps/api/`)

Run these from `apps/api/` or prefix with `pnpm --filter @nyx/api`.

| Command                 | Description                                              |
|--------------------------|-----------------------------------------------------------|
| `pnpm db:migrate`        | Apply pending migrations and regenerate Prisma client      |
| `pnpm db:push`           | Push schema changes without a migration file (prototyping/provider switch only) |
| `pnpm db:generate`       | Regenerate the Prisma client after manual schema edits      |
| `pnpm db:seed`           | Create the default admin account                           |
| `pnpm db:seed-core`      | Create sample companies/branches                            |
| `pnpm db:export-transit` | Export the transit cadastro tables to `prisma/fixtures/transit.json` |
| `pnpm db:import-transit` | Import `prisma/fixtures/transit.json` back into the database |
| `pnpm db:reset`          | Destructive: wipe the database, reapply migrations, and restore all seed data + the transit fixture |
| `pnpm build`             | Compile NestJS for production                               |

> `db:migrate` chains `prisma migrate dev && prisma generate` because Prisma 7 no longer runs `generate` automatically after migrations.

---

## Tech stack

- **Backend:** NestJS · Prisma ORM 7 · PostgreSQL · JWT · CASL (authorization)
- **Frontend:** Next.js 14 · React 18 · Tailwind CSS · TanStack Query/Table · React Hook Form · Zod
- **Tooling:** pnpm workspaces · Turborepo · TypeScript 5
