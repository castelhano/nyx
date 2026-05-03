# ERP Architecture Reference

> This document is the authoritative reference for the ERP codebase. It describes the monorepo structure, technology stack, architectural patterns, naming conventions, and the automation strategy. Any AI or developer working on this codebase should read this document before writing code.

---

## 1. Goals

| Goal | Description |
|------|-------------|
| **Modular & scalable** | Independent domain modules that communicate via interfaces, separable into microservices without rewriting |
| **Convention over configuration** | The framework auto-applies defaults; explicit config only when deviating from convention |
| **Maximum automation** | Declaring a Prisma model + Zod schema + extending `BaseService` produces a fully functional CRUD resource with validated API, metadata endpoint, and auto-rendered UI |
| **Strict standardization** | All models, methods, routes, file names, and variables in **English** |
| **Type safety end-to-end** | A single Zod schema is the source of truth for DB types, API validation, and frontend forms |

---

## 2. Monorepo Structure

```
erp-monorepo/
├── apps/
│   ├── api/                        # NestJS backend
│   │   └── src/
│   │       ├── core/               # Shared infrastructure (never touches business logic)
│   │       │   ├── base.service.ts
│   │       │   ├── base.controller.ts
│   │       │   ├── base.types.ts
│   │       │   ├── metadata.builder.ts
│   │       │   ├── pagination.interceptor.ts
│   │       │   └── exception.filter.ts
│   │       ├── auth/               # Cross-cutting: JWT, Guards, CASL
│   │       │   ├── auth.module.ts
│   │       │   ├── jwt.strategy.ts
│   │       │   ├── casl.factory.ts
│   │       │   └── policies.guard.ts
│   │       └── modules/            # Business domain modules
│   │           ├── identity/       # Domain: users & authentication
│   │           │   ├── identity.module.ts
│   │           │   └── user/
│   │           │       ├── user.module.ts
│   │           │       ├── user.controller.ts
│   │           │       ├── user.service.ts
│   │           │       └── user.routes.ts
│   │           └── crm/            # Domain: company & contacts
│   │               ├── crm.module.ts
│   │               └── company/
│   │                   ├── company.module.ts
│   │                   ├── company.controller.ts
│   │                   ├── company.service.ts
│   │                   └── company.routes.ts
│   └── web/                        # Next.js frontend
│       └── src/
│           ├── core/               # Shared frontend infrastructure
│           │   ├── AutoForm.tsx
│           │   ├── AutoList.tsx
│           │   ├── FieldRenderer.tsx
│           │   └── useMetadata.ts
│           └── modules/            # Pages mirroring API modules
│               ├── identity/
│               │   └── user/
│               │       ├── page.tsx
│               │       └── [id]/page.tsx
│               └── crm/
│                   └── company/
│                       ├── page.tsx
│                       └── [id]/page.tsx
├── packages/
│   ├── schemas/                    # Zod schemas — shared by api and web
│   │   ├── identity/
│   │   │   └── user.schema.ts
│   │   └── crm/
│   │       └── company.schema.ts
│   └── types/
│       └── index.ts                # z.infer<> exports for all schemas
└── docs/
    ├── architecture/               # ADRs, patterns, dev standards
    │   ├── ARCHITECTURE.md         # This file
    │   ├── conventions.md
    │   └── decisions/              # Architecture Decision Records (ADRs)
    └── user-manual/                # End-user documentation per module
        ├── identity/
        └── crm/
```

**Rule:** the directory name of a model (e.g. `company`) determines its API route prefix (`/crm/company`), its Zod schema file (`packages/schemas/crm/company.schema.ts`), and its frontend page path (`modules/crm/company/page.tsx`). No extra configuration needed.

---

## 3. Technology Stack

### Backend

| Technology | Role |
|------------|------|
| **NestJS** | Main framework — DI container, module system, route orchestration |
| **Prisma ORM** | Database access, migrations, type-safe queries |
| **Zod** | Schema definition and validation (shared with frontend) |
| **Passport.js / @nestjs/jwt** | Authentication — JWT strategy and route guards |
| **CASL** | Ability-based authorization — `can('update', 'Company')` |

### Frontend

| Technology | Role |
|------------|------|
| **Next.js (App Router)** | UI framework — Server Components, Server Actions, file-based routing |
| **TanStack Query** | Server state management — caching, background sync, invalidation |
| **TanStack Table** | Headless table engine for `AutoList` — sorting, filtering, pagination |
| **React Hook Form** | Form state management, integrated with Zod via `zodResolver` |
| **Shadcn/ui + Tailwind CSS** | Design system — standardized components for the entire ERP |

### Monorepo

| Technology | Role |
|------------|------|
| **pnpm workspaces** | Package manager and workspace orchestration |
| **Turborepo** | Build pipeline, task caching across apps and packages |
| **TypeScript** | Strict mode across all apps and packages |

---

## 4. Architectural Patterns

### 4.1 Modular Monolith

The codebase is organized as a **modular monolith**: all modules live in the same repo and process. In the common case, modules may import each other's services directly — this is the pragmatic default and keeps development fast. For modules explicitly marked as **extractable** (i.e., candidates for future microservice extraction), stricter rules apply: communication goes through well-defined service interfaces only, cross-module references use entity IDs instead of Prisma foreign key joins, and no internal implementation details are imported directly. Whether a module is extractable is a deliberate architectural decision, documented per module.

### 4.2 Clean Architecture (within each module)

```
Request → Controller → Service → Prisma → Database
                          ↑
                    Business logic lives here only
```

- **Controller** — input parsing, route definition, calls service, returns response. No business logic.
- **Service** — all business logic. Calls Prisma directly. No HTTP concepts (no `req`, `res`).
- **Prisma** — data access layer. Models defined in `prisma/schema.prisma`.

### 4.3 BaseService & BaseController (Generics)

Every resource inherits from generic base classes that implement standard CRUD automatically:

```typescript
// packages/types — generic contract
interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

// apps/api/src/core/base.service.ts
abstract class BaseService<T, CreateDTO, UpdateDTO> {
  findAll(query: PaginationQuery): Promise<PaginatedResult<T>>
  findOne(id: string): Promise<T>
  create(dto: CreateDTO): Promise<T>
  update(id: string, dto: UpdateDTO): Promise<T>
  remove(id: string): Promise<void>
  getMetadata(): ResourceMetadata   // auto-generated from Zod schema
}

// apps/api/src/core/base.controller.ts
abstract class BaseController<T, CreateDTO, UpdateDTO> {
  @Get()           findAll()
  @Get(':id')      findOne()
  @Post()          create()
  @Patch(':id')    update()
  @Delete(':id')   remove()
  @Get('metadata') getMetadata()   // consumed by AutoForm / AutoList
}
```

A new resource only needs to declare what is unique to it:

```typescript
// apps/api/src/modules/crm/company/company.service.ts
@Injectable()
export class CompanyService extends BaseService<Company, CreateCompanyDto, UpdateCompanyDto> {
  constructor(private prisma: PrismaService) {
    super(prisma, 'company', companySchema)
  }

  // Only the 20% that is specific to this resource
  async deactivate(id: string): Promise<Company> { ... }
}
```

### 4.4 Convention → Configuration

At every layer, the system checks: *is there explicit configuration?* If yes, use it. If no, apply the convention. This rule is enforced across all layers:

| Layer | Convention (default) | Override (configuration) |
|-------|---------------------|--------------------------|
| Route prefix | derived from directory path | `@Controller('custom-path')` |
| Metadata field label | `camelCase → Title Case` | `.meta({ label: 'Custom Label' })` on Zod field |
| Field shown in list | `true` for non-relation, non-password fields | `.meta({ showInList: false })` |
| Field shown in form | `true` | `.meta({ showInForm: false })` |
| Field sortable | `true` for string/number/date | `.meta({ sortable: false })` |
| AutoForm component | derived from Zod type | `.meta({ widget: 'textarea' })` |
| Page title | derived from resource name | override in `page.tsx` |

### 4.5 Metadata API

Every resource exposes `GET /<domain>/<resource>/metadata`. This endpoint is auto-generated by `BaseController` by inspecting the Zod schema. The frontend consumes it to render `AutoForm` and `AutoList` without writing HTML.

**Payload shape:**

```typescript
interface ResourceMetadata {
  resource: string            // "company"
  label: string               // "Company"
  permissions: {
    create: boolean
    read: boolean
    update: boolean
    delete: boolean
  }
  fields: MetadataField[]
  actions: ResourceAction[]
}

interface MetadataField {
  name: string                // "tradeName"
  label: string               // "Trade Name"
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'relation'
  required: boolean
  options?: string[]          // for enum fields
  resource?: string           // for relation fields: "city"
  labelField?: string         // for relation fields: "name"
  mask?: string               // e.g. "cnpj", "phone"
  showInList: boolean
  showInForm: boolean
  sortable: boolean
  searchable: boolean
}

interface ResourceAction {
  key: string                 // "deactivate"
  label: string               // "Deactivate"
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string                // "/deactivate"
  icon?: string
}
```

### 4.6 AutoForm & AutoList

`AutoForm` and `AutoList` are high-order frontend components that consume the Metadata API and render full UIs without resource-specific HTML:

- **AutoForm** — iterates `fields` where `showInForm: true`, delegates each field to `FieldRenderer` which maps `field.type` to a Shadcn component (`string → Input`, `enum → Select`, `relation → ComboBox`, `boolean → Switch`). Applies Zod validation via `zodResolver`.
- **AutoList** — iterates `fields` where `showInList: true` to build `ColumnDef[]` for TanStack Table. `sortable` and `searchable` flags activate column header clicks and toolbar filters automatically. `actions` become toolbar buttons, each checked against CASL before rendering.

For the ~20% of resources that need custom UI, the resource page can replace `AutoForm` or `AutoList` with a hand-crafted component — the metadata contract does not mandate their use.

---

## 5. Initial Modules

### 5.1 `identity` domain

**Purpose:** user management and authentication.

**Models:**

`User`
- `id` — UUID, PK
- `name` — string
- `email` — string, unique
- `passwordHash` — string, hidden from API responses and metadata
- `role` — enum: `admin | operator | viewer`
- `isActive` — boolean, default `true`
- `createdAt` / `updatedAt` — timestamps

**Services beyond BaseService:**
- `UserService.changePassword(id, dto)` — hashes password before saving
- `UserService.deactivate(id)` — sets `isActive: false`

**Auth flow:** `POST /auth/login` accepts `{ email, password }`, validates credentials via `UserService`, returns a signed JWT. All other routes require the JWT guard. CASL abilities are derived from `user.role`.

### 5.2 `crm` domain

**Purpose:** company (client/supplier/partner) records.

**Models:**

`Company`
- `id` — UUID, PK
- `legalName` — string
- `tradeName` — string, nullable
- `taxId` — string, unique (CNPJ)
- `type` — enum: `client | supplier | partner | other`
- `isActive` — boolean, default `true`
- `createdAt` / `updatedAt` — timestamps

**Services beyond BaseService:**
- `CompanyService.deactivate(id)` — sets `isActive: false`

---

## 6. Naming Conventions

### Language rule

| Layer | Language |
|-------|----------|
| Code — models, modules, functions, methods, variables, routes, DB columns | **English** |
| Labels and UI — `.meta({ label })`, page titles, messages, field placeholders | **pt-BR** |

This means the field is named `legalName` in code, Prisma, and the API, but its label in the UI is `"Razão Social"`.

### Identifiers

| Artifact | Convention | Example |
|----------|-----------|---------|
| File names | `kebab-case` | `company.service.ts` |
| Class names | `PascalCase` | `CompanyService` |
| Variables / functions | `camelCase` | `findAll`, `taxId` |
| Database columns (Prisma) | `camelCase` → auto-mapped to `snake_case` | `legalName` → `legal_name` |
| API routes | `kebab-case`, plural resource | `/crm/companies` |
| Zod schemas | `camelCase` object, exported as `<Resource>Schema` | `companySchema` |
| DTO types | inferred from Zod — `CreateCompanyDto`, `UpdateCompanyDto` | |
| Frontend pages | mirrors API path | `modules/crm/company/page.tsx` |
| Routes constants file | `<resource>.routes.ts` | `company.routes.ts` |

**Routes constants** — each model exports a typed routes object to eliminate magic strings:

```typescript
// company.routes.ts
export const CompanyRoutes = {
  root:       '/crm/companies',
  metadata:   '/crm/companies/metadata',
  byId:       (id: string) => `/crm/companies/${id}`,
  deactivate: (id: string) => `/crm/companies/${id}/deactivate`,
} as const
```

---

## 7. Zod Schema Pattern

Schemas live in `packages/schemas/<domain>/<resource>.schema.ts` and are imported by both `apps/api` and `apps/web`.

```typescript
// packages/schemas/crm/company.schema.ts
import { z } from 'zod'

export const companySchema = z.object({
  id:          z.string().uuid(),
  legalName:   z.string().min(2).meta({ label: 'Legal Name', showInList: true }),
  tradeName:   z.string().nullable().meta({ label: 'Trade Name', showInList: true }),
  taxId:       z.string().meta({ label: 'Tax ID', mask: 'cnpj', searchable: true }),
  type:        z.enum(['client', 'supplier', 'partner', 'other'])
                 .meta({ label: 'Type', showInList: true }),
  isActive:    z.boolean().default(true).meta({ showInList: true }),
  createdAt:   z.date().meta({ showInForm: false }),
  updatedAt:   z.date().meta({ showInForm: false }),
})

export const createCompanySchema = companySchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCompanySchema = createCompanySchema.partial()

export type Company          = z.infer<typeof companySchema>
export type CreateCompanyDto = z.infer<typeof createCompanySchema>
export type UpdateCompanyDto = z.infer<typeof updateCompanySchema>
```

---

## 8. Adding a New Resource (Checklist)

1. Add Prisma model to `prisma/schema.prisma` and run `prisma migrate dev`
2. Create `packages/schemas/<domain>/<resource>.schema.ts` with Zod schema and DTO types
3. Create `apps/api/src/modules/<domain>/<resource>/` with four files:
   - `<resource>.module.ts` — NestJS module, imports `PrismaModule`
   - `<resource>.controller.ts` — `extends BaseController`
   - `<resource>.service.ts` — `extends BaseService`, add custom methods
   - `<resource>.routes.ts` — typed route constants
4. Register the resource module in its domain module (`<domain>.module.ts`)
5. Create `apps/web/src/modules/<domain>/<resource>/page.tsx` — use `<AutoList resource="<resource>" />` for the listing and `<AutoForm resource="<resource>" />` for create/edit (or write custom UI for the 20% that needs it)

That is the complete implementation for ~80% of resources.

---

## 9. Documentation Structure

```
docs/
├── architecture/
│   ├── ARCHITECTURE.md          # This file — system overview and conventions
│   ├── conventions.md           # Detailed coding standards and patterns
│   └── decisions/               # Architecture Decision Records
│       └── ADR-001-monorepo.md  # One file per significant decision
└── user-manual/
    ├── identity/
    │   └── users.md             # How to manage users
    └── crm/
        └── companies.md         # How to manage companies
```

**Architecture Decision Records (ADRs)** follow this format: context → decision → consequences. Create one for every significant architectural choice so future contributors understand *why* things are the way they are, not just *how* they work.