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

- **Backend:** NestJS · Prisma ORM 7 · SQLite (dev) · JWT · CASL (authorization)
- **Frontend:** Next.js 14 · React 18 · Tailwind CSS · TanStack Query/Table · React Hook Form · Zod
- **Tooling:** pnpm workspaces · Turborepo · TypeScript 5
