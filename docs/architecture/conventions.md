# ERP Conventions Reference

> Naming conventions, Zod schemas and new resource checklist. Read alongside `ARCHITECTURE.md`. This document is the source of truth for repetitive code decisions.

---

## 1. Naming & Language

**General rule:** code in English, UI labels in pt-BR.

| Artifact | Convention | Example |
|----------|------------|---------|
| Files and directories | `kebab-case` | `company.service.ts`, `crm/` |
| Classes and interfaces | `PascalCase` | `CompanyService`, `BaseController` |
| Variables and functions | `camelCase` | `findAll`, `taxId` |
| Global constants | `UPPER_SNAKE_CASE` | `ROUTES`, `DEFAULT_PAGE_SIZE` |
| Prisma / Zod fields | `camelCase` | `legalName`, `isActive` |
| API routes | `kebab-case` | `/crm/company`, `/identity/user` |
| CSS variables | `--kebab-case` | `--sidebar-accent`, `--input-bg` |

### Route constants

Prefer typed constants over literal strings scattered throughout the code:

```typescript
// packages/types/routes.ts
export const ROUTES = {
  identity: {
    user: {
      list:   '/identity/user',
      detail: (id: string) => `/identity/user/${id}`,
    },
  },
  crm: {
    company: {
      list:   '/crm/company',
      detail: (id: string) => `/crm/company/${id}`,
    },
  },
} as const
```

---

## 2. Zod Schema Pattern

The Zod schema is the **single source of truth** for DB types, API validation and frontend forms. Lives in `packages/schemas/<domain>/<resource>.schema.ts`.

```typescript
// packages/schemas/crm/company.schema.ts
import { z } from 'zod'

// ── Enums ──────────────────────────────────────────────────────────────────

export const CompanyTypeEnum = z.enum(['client', 'supplier', 'partner', 'other'])

// ── Base (always-present fields) ──────────────────────────────────────────

const companyBase = z.object({
  legalName:  z.string().min(2).meta({ label: 'Razão Social' }),
  tradeName:  z.string().nullable().optional().meta({ label: 'Nome Fantasia' }),
  taxId:      z.string().length(14).meta({ label: 'CNPJ' }),
  type:       CompanyTypeEnum.meta({ label: 'Tipo', widget: 'select' }),
  isActive:   z.boolean().default(true).meta({ label: 'Ativo', showInForm: false }),
})

// ── DTOs ──────────────────────────────────────────────────────────────────

export const createCompanySchema = companyBase

export const updateCompanySchema = companyBase.partial()

// ── Full entity (API response) ────────────────────────────────────────────

export const companySchema = companyBase.extend({
  id:        z.string().uuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

// ── Inferred types ────────────────────────────────────────────────────────

export type Company       = z.infer<typeof companySchema>
export type CreateCompany = z.infer<typeof createCompanySchema>
export type UpdateCompany = z.infer<typeof updateCompanySchema>
```

### Available `.meta()` options

| Property | Type | Default | Effect |
|----------|------|---------|--------|
| `label` | `string` | `camelCase → Title Case` | Label in forms and columns |
| `showInList` | `boolean` | `true` (non-relation, non-password) | Includes field in `AutoList` |
| `showInForm` | `boolean` | `true` | Includes field in `AutoForm` |
| `sortable` | `boolean` | `true` for string/number/date | Enables column sorting |
| `widget` | `string` | derived from Zod type | Form component: `'textarea'`, `'select'`, `'date'`, etc. |

---

## 3. Adding a New Resource

Minimum checklist for adding a resource to the ERP. Each step produces an artifact; none are optional.

### Step 1 — Zod Schema

Create `packages/schemas/<domain>/<resource>.schema.ts` following the pattern in section 2. Export the types in `packages/types/index.ts`.

### Step 2 — Prisma model

Add the model to `apps/api/prisma/schema.prisma`, then run from `apps/api/`:

```bash
pnpm db:migrate   # prisma migrate dev + prisma generate (chained — Prisma 7 no longer auto-generates)
```

To prototype without a migration file (dev only):

```bash
pnpm db:push      # prisma db push + prisma generate
```

### Step 3 — Service

Create `apps/api/src/modules/<domain>/<resource>/<resource>.service.ts` extending `BaseService`:

```typescript
@Injectable()
export class CompanyService extends BaseService<Company, CreateCompany, UpdateCompany> {
  constructor(private prisma: PrismaService) {
    super(companySchema, prisma.company)
  }
}
```

### Step 4 — Controller & Module

Create `<resource>.controller.ts` extending `BaseController` and `<resource>.module.ts` registering both. Register the module in the domain module (`crm.module.ts`).

### Step 5 — Frontend

Create the pages `apps/web/src/modules/<domain>/<resource>/page.tsx` and `[id]/page.tsx`. Use `AutoList` and `AutoForm` consuming the metadata endpoint:

```tsx
// page.tsx
const { data: metadata } = useMetadata('/crm/company/metadata')
return <AutoList metadata={metadata} />

// [id]/page.tsx
const { data: metadata } = useMetadata('/crm/company/metadata')
return <AutoForm metadata={metadata} defaultValues={company} onSubmit={save} />
```

Add the route to `ROUTES` (`packages/types/routes.ts`) and the navigation item to the `NAV` array in the sidebar.
