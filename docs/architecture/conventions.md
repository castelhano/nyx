# ERP Conventions Reference

> Naming conventions, Zod schemas and new resource checklist. Read alongside `ARCHITECTURE.md`. This document is the source of truth for repetitive code decisions.

---

## 1. Naming & Language

**General rule:** code in English, UI labels in pt-BR.

| Artifact | Convention | Example |
|----------|------------|---------|
| Files and directories | `kebab-case` | `company.service.ts`, `core/` |
| Classes and interfaces | `PascalCase` | `CompanyService`, `BaseController` |
| Variables and functions | `camelCase` | `findAll`, `taxId` |
| Global constants | `UPPER_SNAKE_CASE` | `ROUTES`, `DEFAULT_PAGE_SIZE` |
| Prisma / Zod fields | `camelCase` | `legalName`, `isActive` |
| API routes | `kebab-case`, **singular** | `/core/company`, `/core/user` |
| CSS variables | `--kebab-case` | `--sidebar-accent`, `--input-bg` |

### Route convention — always singular

API routes and `domains.ts` keys are always **singular**. Never auto-pluralize.

```
domains.ts key  →  controller prefix  →  URL
'user'          →  'core/user'        →  GET /core/user
'company'       →  'core/company'     →  GET /core/company
'branch'        →  'core/branch'      →  GET /core/branch
```

### Routes file

Every resource has a `<resource>.routes.ts` with typed path constants used by the frontend for non-metadata calls (deactivate, custom endpoints, etc.):

```typescript
// apps/api/src/modules/core/company/company.routes.ts
export const CompanyRoutes = {
  root:       '/core/company',
  metadata:   '/core/company/metadata',
  byId:       (id: string) => `/core/company/${id}`,
  deactivate: (id: string) => `/core/company/${id}/deactivate`,
} as const
```

---

## 2. Zod Schema Pattern

The Zod schema is the **single source of truth** for DB types, API validation and frontend forms. Lives in `packages/schemas/<domain>/<resource>.schema.ts`.

```typescript
// packages/schemas/core/company.schema.ts
import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const companySchema = withMeta(
  z.object({
    id:        z.string().uuid(),
    legalName: z.string().min(2).meta({ label: 'Razão Social', showInList: true }),
    tradeName: z.string().nullable().optional().meta({ label: 'Nome Fantasia' }),
    taxId:     z.string().length(14).meta({ label: 'CNPJ', mask: 'cnpj' }),
    type:      z.enum(['client', 'supplier', 'partner', 'other']).meta({ label: 'Tipo', widget: 'select' }),
    isActive:  z.boolean().default(true).meta({ label: 'Ativo' }),
    createdAt: z.date().meta({ showInForm: false }),
    updatedAt: z.date().meta({ showInForm: false }),
  }),
  {
    label:       'Empresa',
    labelPlural: 'Empresas',
    nameField:   'legalName',
    groups: {
      'Identificação': ['legalName', 'tradeName', 'taxId', 'type', 'isActive'],
      'Contato':       ['phone', 'email', 'website'],
    },
  },
)

export const createCompanySchema = companySchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCompanySchema = createCompanySchema.partial()

export type Company          = z.infer<typeof companySchema>
export type CreateCompanyDto = z.infer<typeof createCompanySchema>
export type UpdateCompanyDto = z.infer<typeof updateCompanySchema>
```

### Available `.meta()` field options

| Property | Type | Default | Effect |
|----------|------|---------|--------|
| `label` | `string` | `camelCase → Title Case` | Label in forms and list columns |
| `showInList` | `boolean` | `true` (non-id, non-password, non-timestamp) | Includes field in `AutoList` |
| `showInForm` | `boolean` | `true` | Includes field in `AutoForm` |
| `sortable` | `boolean` | `true` for string/number/date/enum | Enables server-side column sorting |
| `searchable` | `boolean` | `false` | Marks field for search filtering |
| `widget` | `string` | derived from Zod type | Form component: `'textarea'`, `'select'`, `'switch'`, `'datepicker'`, `'password'`, `'combobox'` |
| `mask` | `string` | none | Input mask: `'cnpj'`, `'cpf'`, `'phone'`, `'cep'` |
| `placeholder` | `string` | none | Input placeholder text |
| `helpText` | `string` | none | Help text rendered below the field |
| `width` | `string` | `w-full` | Any Tailwind width class — controls field width in the form grid |

### Available `withMeta()` schema options

| Property | Type | Effect |
|----------|------|--------|
| `label` | `string` | Singular label — "Empresa" |
| `labelPlural` | `string` | Plural label — "Empresas" (default: `label + 's'`) |
| `nameField` | `string` | Field used as display name in breadcrumb (default: `'name'`) |
| `groups` | `Record<string, string[]>` | Tab groups for `AutoForm` — `{ 'Tab label': ['field1', 'field2'] }` |

---

## 3. Adding a New Resource

Minimum checklist. Each step is mandatory.

### Step 1 — Zod Schema

Create `packages/schemas/core/<resource>.schema.ts` following the pattern in section 2. Export from `packages/schemas/index.ts`.

### Step 2 — Prisma model

Add the model to `apps/api/prisma/schema.prisma`, then from `apps/api/`:

```bash
pnpm db:migrate   # applies migration + regenerates client
# or, for dev-only prototyping without a migration file:
pnpm db:push
```

### Step 3 — Service

Create `apps/api/src/modules/core/<resource>/<resource>.service.ts` extending `BaseService`:

```typescript
@Injectable()
export class CompanyService extends BaseService<Company, CreateCompanyDto, UpdateCompanyDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'company', companySchema)
  }

  protected buildSearchWhere(search: string) {
    return { OR: [{ legalName: { contains: search } }] }
  }
}
```

### Step 4 — Controller

Create `<resource>.controller.ts` extending `BaseController`. Always pass `CaslAbilityFactory` to `super()` so `getMetadata` returns real permissions:

```typescript
@Controller('core/company')
@UseGuards(JwtAuthGuard)
export class CompanyController extends BaseController<Company, CreateCompanyDto, UpdateCompanyDto> {
  constructor(
    private readonly companyService: CompanyService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(companyService, caslFactory)
  }
}
```

### Step 5 — Module

Create `<resource>.module.ts` importing `CaslModule`:

```typescript
@Module({
  imports:     [CaslModule],
  controllers: [CompanyController],
  providers:   [CompanyService],
  exports:     [CompanyService],
})
export class CompanyModule {}
```

Register in `CoreModule`.

### Step 6 — Routes file

Create `<resource>.routes.ts` with typed path constants (see section 1).

### Step 7 — Frontend registry

Add the resource to `domains.ts`. The `key` must match the controller prefix segment exactly:

```typescript
// apps/web/src/core/domains.ts
core: {
  resources: [
    { key: 'company', label: 'Empresas', icon: Building },
  ],
}
```

The sidebar and breadcrumb update automatically. No page files required for standard CRUD — the dynamic routes `[domain]/[resource]` and `[domain]/[resource]/[id]` handle it.

To override with custom UI, create `app/core/<resource>/page.tsx`.
