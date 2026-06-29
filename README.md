# Nyx

Full-stack monorepo with NestJS (API) and Next.js (Web), managed via pnpm workspaces and Turborepo.

## Structure

```
nyx/
├── apps/
│   ├── api/        # NestJS + Prisma 7 + SQLite (backend)
│   └── web/        # Next.js 14 + Tailwind (frontend)
├── packages/
│   ├── schemas/    # Shared Zod schemas
│   └── types/      # Shared TypeScript types
└── docs/           # Architecture and user documentation
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22.12 — required by Prisma 7
- [pnpm](https://pnpm.io/) >= 10 — install with `npm install -g pnpm`

## First-time setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env`:

```env
DATABASE_URL="file:./dev.db"        # SQLite file path (development)
JWT_SECRET="change-in-production"   # secret used to sign JWT tokens
```

To generate a strong `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

> **Important:** never commit `.env`. It is already listed in `.gitignore`.

### 3. Apply migrations and generate the Prisma client

```bash
cd apps/api
pnpm db:migrate
```

> `db:migrate` runs `prisma migrate dev && prisma generate`. The generated client (`src/generated/prisma/`) is gitignored and must always be built locally — it is never committed to the repository.
>
> In Prisma 7, `migrate dev` no longer runs the seed automatically. You must seed manually (step 4).

### 4. Seed the database

```bash
cd apps/api
pnpm db:seed
```

This creates the default administrator account:

| Field    | Value     |
|----------|-----------|
| username | `admin`   |
| password | `admin123` |

> Change the password after the first login.

### 5. Start the development environment

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

> **Recommended approach: clone fresh.** The SQLite database is gitignored and recreated by the seed, so there is nothing to lose by starting clean.

### 1. Prerequisites

Ensure **Node.js >= 22.12** is installed (required by Prisma 7). To upgrade on Ubuntu/Debian:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # should print v22.x.x
```

### 2. Clone and set up

```bash
git clone <repository-url>
cd nyx
pnpm install
cp apps/api/.env.example apps/api/.env   # then edit DATABASE_URL and JWT_SECRET
cd apps/api
pnpm db:migrate   # creates the database, applies migrations, generates Prisma client
pnpm db:seed      # creates the admin user
```

### If you prefer to update an existing clone

```bash
git pull
pnpm install          # picks up new dependencies (Prisma 7, libsql adapter, etc.)
cd apps/api
pnpm db:migrate       # applies any new migrations and regenerates the client
```

> The generated Prisma client (`src/generated/prisma/`) is gitignored — `db:migrate` always rebuilds it. Never copy it manually between machines.

---

## Database — SQLite (dev) and PostgreSQL

By default the project runs on **SQLite via LibSQL** (zero-setup, file at `apps/api/dev.db`). PostgreSQL is also supported without code changes — `PrismaService` and all seed files select the correct adapter based on the `DATABASE_URL` prefix automatically.

### Switching to PostgreSQL

Requires [Docker](https://docs.docker.com/get-docker/).

**1. Edit two files** to switch the provider and connection URL:

`apps/api/prisma/schema/_base.prisma`:
```prisma
datasource db {
  // provider = "sqlite"
  provider = "postgresql"
}
```

`apps/api/.env`:
```env
# DATABASE_URL="file:./dev.db"
DATABASE_URL="postgresql://nyx:nyx@localhost:5432/nyx"
```

**2. Start the PostgreSQL container** (from project root):
```bash
docker compose -f docker-compose.pg.yml up -d
```

**3. Push the schema** (`db:migrate` doesn't work when switching provider):
```bash
cd apps/api && pnpm db:push
```

**4. Seed:**
```bash
pnpm db:seed       # admin user
pnpm db:seed-core  # optional: sample companies/branches
```

> **Why `db:push` and not `db:migrate`:** `prisma/migrations/migration_lock.toml` records the `sqlite` provider. Prisma blocks `migrate dev` when the provider changes. `db:push` syncs the schema directly without a migration history — suitable for testing. To maintain a proper PostgreSQL migration history, delete `prisma/migrations/` and start fresh with `db:migrate`.

### Switching back to SQLite

Revert both files (uncomment SQLite lines, comment out PostgreSQL lines), then regenerate the client:

```bash
cd apps/api && pnpm db:generate
```

The PostgreSQL container (`nyx-postgres`) persists data in a Docker volume (`nyx_nyx_pg_data`). Stop it with `docker compose -f docker-compose.pg.yml down` and remove the volume with `docker volume rm nyx_nyx_pg_data` when no longer needed.

---

## OSRM — travel time matrix

The transit planning module uses [OSRM](https://project-osrm.org/) to automatically generate the travel-time/distance matrix between localities. It is an **optional** dependency — without it, the matrix can be filled manually through the UI.

When running, OSRM must be reachable at the URL defined by `OSRM_URL` in `apps/api/.env` (default: `http://localhost:5000`).

### Setup (Docker)

**1. Download the OSM map for your region** (from [Geofabrik](https://download.geofabrik.de/)):

```bash
# Example: Centro-Oeste region (~185 MB, covers Mato Grosso/Cuiabá)
wget https://download.geofabrik.de/south-america/brazil/centro-oeste-latest.osm.pbf

# Full Brazil (~1.9 GB, slow to process — use only if needed)
# wget https://download.geofabrik.de/south-america/brazil-latest.osm.pbf
```

**2. Pre-process the map** (run from the folder containing the `.pbf` file):

```bash
docker run -t -v "$(pwd):/data" ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/centro-oeste-latest.osm.pbf

docker run -t -v "$(pwd):/data" ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/centro-oeste-latest.osrm

docker run -t -v "$(pwd):/data" ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/centro-oeste-latest.osrm
```

> Pre-processing only needs to run once. The resulting `.osrm.*` files can be reused across restarts.

**3. Start the routing server:**

```bash
docker run -d -p 5000:5000 -v "$(pwd):/data" ghcr.io/project-osrm/osrm-backend \
  osrm-routed --algorithm mld /data/centro-oeste-latest.osrm
```

**Quick test:**

```bash
curl "http://localhost:5000/table/v1/driving/-56.097,-15.601;-56.090,-15.595?annotations=duration,distance"
```

### Generating the matrix

Once OSRM is running, open the **Matriz de Tempos** list in the app and click **Gerar Matriz** in the topbar. Only localities that have both `lat` and `lng` coordinates set are included. Entries with source `MANUAL` are never overwritten.

> The `car.lua` profile (car speeds) is a good approximation for urban bus planning. The matrix generation also triggers automatically whenever a locality is created or updated.

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

| Command           | Description                                          |
|-------------------|------------------------------------------------------|
| `pnpm db:migrate` | Apply pending migrations and regenerate Prisma client |
| `pnpm db:push`    | Push schema changes without a migration file (prototyping only) |
| `pnpm db:generate`| Regenerate the Prisma client after manual schema edits |
| `pnpm db:seed`    | Populate the database with initial data              |
| `pnpm build`      | Compile NestJS for production                        |

> `db:migrate` chains `prisma migrate dev && prisma generate` because Prisma 7 no longer runs `generate` automatically after migrations.

---

## Tech stack

- **Backend:** NestJS · Prisma ORM 7 · SQLite/LibSQL (dev) · PostgreSQL (prod/test) · JWT · CASL (authorization)
- **Frontend:** Next.js 14 · React 18 · Tailwind CSS · TanStack Query/Table · React Hook Form · Zod
- **Tooling:** pnpm workspaces · Turborepo · TypeScript 5
