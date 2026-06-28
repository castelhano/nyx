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

API routes are always **singular**. Never auto-pluralize.

```
controller prefix  →  URL
'core/company'     →  GET /core/company
'core/branch'      →  GET /core/branch
```

---

## 2. Zod Schema Pattern

The Zod schema is the **single source of truth** for DB types, API validation and frontend forms. Lives in `packages/schemas/<domain>/<resource>.schema.ts`.

```typescript
// packages/schemas/core/company.schema.ts
export const companySchema = withMeta(
  z.object({
    id:        z.string().uuid(),
    legalName: z.string().min(2).meta({ label: 'Razão Social', listVisibility: 'visible' }),
    tradeName: z.string().nullable().optional().meta({ label: 'Nome Fantasia', listVisibility: 'visible' }),
    taxId:     z.string().length(8).meta({ label: 'CNPJ Raiz', mask: 'cnpj-base', listVisibility: 'hidden' }),
    type:      z.enum(['client', 'supplier', 'partner', 'other']).meta({ label: 'Tipo', widget: 'select' }),
    isActive:  z.boolean().default(true).meta({ label: 'Ativo' }),
    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Empresa',
    labelPlural: 'Empresas',
    nameField:   'legalName',
    groups: {
      'Contato': ['phone', 'email', 'website'],
    },
  },
)
```

### Available `.meta()` field options

| Property | Type | Default | Effect |
|----------|------|---------|--------|
| `label` | `string` | `camelCase → Title Case` | Label in forms and list columns |
| `listVisibility` | `'visible' \| 'hidden' \| 'never'` | computed | `visible` = shown by default; `hidden` = hidden by default, user can toggle; `never` = not in picker or table |
| `showInForm` | `boolean` | `true` | Includes field in `AutoForm` |
| `sortable` | `boolean` | `true` for string/number/date/enum | Enables server-side column sorting |
| `widget` | `string` | derived from Zod type | Form component: `'textarea'`, `'select'`, `'switch'`, `'datepicker'`, `'password'`, `'combobox'` |
| `mask` | `string` | none | Input mask: `'cnpj'`, `'cnpj-base'` (8-digit root), `'cpf'`, `'phone'`, `'cep'` |
| `placeholder` | `string` | none | Input placeholder text |
| `helpText` | `string` | none | Help text rendered below the field |
| `className` | `string` | none | Any Tailwind class(es) applied to the field wrapper — e.g. `'w-24'`, `'w-full md:w-60'` |
| `resource` | `string` | none | For `widget: 'select'` — API resource to fetch options from (e.g. `'company'`) |
| `labelField` | `string` | none | Field used as display label for relation select options |
| `keybind` | `string` | none | Single lowercase letter (`a–z`). Registers `Ctrl+Shift+[key]` to focus this field from anywhere in the form (including other inputs or other tabs). Renders a `⌃⇧K` hint inside the control. Avoid `z` and browser-reserved letters. |

`defaultValue` is automatically extracted from Zod's `.default()` and pre-filled in `AutoForm`.

### Available `withMeta()` schema options

| Property | Type | Effect |
|----------|------|--------|
| `label` | `string` | Singular label — "Empresa" |
| `labelPlural` | `string` | Plural label — "Empresas" (default: `label + 's'`) |
| `nameField` | `string` | Field used as display name in breadcrumb (default: `'name'`) |
| `allowCsv` | `boolean` | Adds CSV download button to list topbar (rendered as `primary: false` — icon-only on mobile via overflow menu) |
| `groups` | `Record<string, string[]>` | Tab groups for `AutoForm` — `{ 'Tab label': ['field1', 'field2'] }` |
| `breadcrumb` | `BreadcrumbDef[]` | Declares this resource as a child — used by `AutoBreadcrumb` to resolve the parent chain; also removes this resource from sidebar and discovery |

> **Children are auto-derived — the parent declares nothing.** When a child schema declares `breadcrumb: [{ resource: 'company', ... }]`, the metadata builder scans `resourceRegistry` and automatically adds `branch` to `company`'s `children` list. No field in the parent schema is needed.

---

## 3. Adding a New Resource

Minimum checklist. Each step is mandatory.

### Step 1 — Zod Schema

Create `packages/schemas/<domain>/<resource>.schema.ts` following the pattern in section 2. Export from `packages/schemas/index.ts`.

### Step 2 — Prisma model

Add the model to `apps/api/prisma/schema/<domain>.prisma`, then from `apps/api/`:

```bash
pnpm db:migrate   # applies migration + regenerates client
# or, for dev-only prototyping without a migration file:
pnpm db:push
```

### Step 3 — Service

Create `apps/api/src/modules/<domain>/<resource>/<resource>.service.ts` extending `BaseService`:

```typescript
@Injectable()
export class CompanyService extends BaseService<Company, CreateCompanyDto, UpdateCompanyDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'company', companySchema, 'core')
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

Register in the parent domain module (e.g. `CoreModule`).

**Result:** the resource appears automatically in the sidebar and discovery. No frontend registry files to update — the `BaseService` constructor pushes to `resourceRegistry`, which feeds the sidebar, breadcrumb and discovery endpoint.

---

## 4. Parent-Child Resource Pattern

Used when a resource only makes sense in the context of a parent (e.g. Branch → Company). No custom pages required for either side.

### Parent schema — no changes needed

The parent schema requires **no extra declaration**. Child resources are discovered automatically at runtime by scanning `resourceRegistry` for schemas that declare `breadcrumb[].resource === '<parent>'`. The parent's `getMetadata()` response includes `children` computed automatically.

### Child schema — declare `breadcrumb`

```typescript
// packages/schemas/core/branch.schema.ts
withMeta(z.object({
  companyId: z.string().uuid().meta({
    label: 'Empresa',
    widget: 'select',
    resource: 'company',
    labelField: 'legalName',
    listVisibility: 'hidden',
  }),
  ...
}), {
  breadcrumb: [
    { resource: 'company', contextField: 'companyId', listLabel: 'Empresas', nameField: 'legalName', keybind: 'f9' },
  ],
})
```

Effect of `breadcrumb`:
- **Removes this resource from the sidebar and discovery** (it's a child, accessed only through the parent)
- **Builds the navigation trail** in `AutoBreadcrumb` — fetches parent record name and renders the full chain
- **Registers a shortcut button** on the parent detail page (`keybind: 'f9'`) that navigates to the child list filtered by parent

### URL context params convention

When navigating from parent to child list or form, the parent ID is passed as a query param:

| Param form | Behavior |
|-----------|----------|
| `?companyId=xxx` | Pre-fills `companyId` field as **readonly** in new records; filters child list to that parent |
| `?_taxId=00.000.000` | Pre-fills `taxId` field as **editable** default (underscore prefix = derived default) |

The list page propagates context params to the "New" button and the edit row links, so context is never lost while navigating within a parent's children.

### `Alt+V` behavior

| Location | Destination |
|----------|-------------|
| Child list (`/core/branch?companyId=xxx`) | Parent record (`/core/company/xxx`) |
| Child form (`/core/branch/yyy?companyId=xxx`) | Child list with context preserved (`/core/branch?companyId=xxx`) |
| Child form accessed directly without context param | Child list with context derived from the loaded record's `companyId` field |

### Breadcrumb trail links

`AutoBreadcrumb` builds the full trail including correct links at every level:

```
Início / Core / Empresas / Acme / Filiais / Filial SP
         ↑       ↑           ↑       ↑           ↑
        /core  /core/company /core/company/xxx  /core/branch?companyId=xxx  (current, no link)
```

The "Filiais" segment always links to `/core/branch?companyId=xxx` — context is preserved at every point in the trail.
