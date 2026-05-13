# ERP Architecture Reference

> Authoritative reference for the system architecture. For naming conventions and new-resource checklists, see `docs/architecture/conventions.md`.

---

## 1. Goals

| Goal | Description |
|------|-------------|
| **Zero manual registry** | Adding a resource requires zero edits outside its own files — sidebar, breadcrumb and discovery update automatically |
| **Convention over configuration** | Defaults applied automatically; explicit config only when deviating from the convention |
| **Maximum automation** | Prisma model + Zod schema + `BaseService` → full CRUD with validated API, metadata endpoint and auto-rendered UI |
| **Single source of truth** | Zod schema is the sole authority for DB types, API validation, UI forms, metadata and navigation |
| **Scalable by default** | PostgreSQL as production target; branch scoping built into the base layer |

---

## 2. Monorepo Structure

```
nyx/
├── apps/
│   ├── api/                        # NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema/             # Multi-file Prisma schema (one file per domain)
│   │   │   │   ├── _base.prisma    # generator + datasource (loads first alphabetically)
│   │   │   │   ├── core.prisma     # User, Company, Branch, UserBranch, UserPermission models
│   │   │   │   └── settings.prisma # PasswordPolicy model
│   │   │   └── migrations/         # Prisma migration history
│   │   ├── prisma.config.ts        # Prisma CLI config: schema folder, adapter, seed
│   │   └── src/
│   │       ├── core/               # Shared infrastructure (no business logic)
│   │       │   ├── base.service.ts
│   │       │   ├── base.controller.ts
│   │       │   ├── base.types.ts
│   │       │   ├── metadata.builder.ts
│   │       │   ├── resource-registry.ts   # Global registry — populated by BaseService
│   │       │   ├── domain-registry.ts     # Global registry + @Domain decorator
│   │       │   ├── pagination.interceptor.ts
│   │       │   └── exception.filter.ts
│   │       ├── auth/               # Cross-cutting: JWT, Guards, CASL
│   │       │   ├── auth.module.ts
│   │       │   ├── casl.module.ts
│   │       │   ├── casl.factory.ts
│   │       │   ├── jwt.strategy.ts
│   │       │   └── policies.guard.ts
│   │       └── modules/
│   │           ├── discovery/      # Discovery endpoint — no business logic
│   │           │   ├── discovery.controller.ts
│   │           │   └── discovery.module.ts
│   │           ├── core/
│   │           │   ├── core.module.ts      # @Domain({ label: 'Core', icon: 'Shield' })
│   │           │   ├── user/
│   │           │   ├── company/
│   │           │   ├── branch/
│   │           │   ├── user-permission/
│   │           │   └── user-branch/
│   │           └── settings/
│   │               ├── settings.module.ts  # No @Domain — all resources route under 'core'
│   │               └── password-policy/
│   └── web/                        # Next.js frontend
│       └── src/
│           ├── lib/
│           │   ├── icons.ts        # Single file with all Lucide imports; resolveIcon() helper
│           │   ├── auth.ts
│           │   ├── utils.ts
│           │   ├── csv.ts
│           │   └── keywatch/
│           ├── components/
│           │   ├── layout/
│           │   │   ├── app-layout.tsx
│           │   │   ├── topbar.tsx
│           │   │   ├── topbar-actions-context.tsx
│           │   │   ├── sidebar.tsx
│           │   │   └── sidebar-context.tsx
│           │   └── ui/
│           │       ├── button.tsx
│           │       ├── breadcrumb.tsx
│           │       ├── dropdown.tsx        # Portal-based, viewport-aware
│           │       └── tabs.tsx
│           ├── core/               # Shared frontend infrastructure
│           │   ├── AutoForm.tsx
│           │   ├── AutoList.tsx
│           │   ├── AutoBreadcrumb.tsx
│           │   ├── FieldRenderer.tsx
│           │   ├── useMetadata.ts
│           │   └── useDiscovery.ts  # Hook for GET /discovery — replaces static domains.ts
│           └── app/
│               ├── page.tsx
│               ├── [domain]/
│               │   ├── page.tsx
│               │   └── [resource]/
│               │       ├── page.tsx
│               │       └── [id]/page.tsx
│               └── login/page.tsx
├── packages/
│   ├── schemas/
│   │   ├── core/
│   │   ├── settings/
│   │   ├── with-meta.ts
│   │   ├── zod-meta.ts
│   │   └── index.ts
│   └── types/
│       └── index.ts                # Includes apiRoute() and navRoute() helpers, DiscoveryDomain/DiscoveryResource interfaces
└── docs/
```

**Navigation rule:** resources with `breadcrumb` in the schema are children — they do not appear in the sidebar or in the discovery response. Resources without `breadcrumb` are top-level and appear automatically.

---

## 3. Technology Stack

### Backend

| Technology | Role |
|------------|------|
| **NestJS** | Main framework — DI container, modules, route orchestration |
| **Prisma ORM 7** | Database access, migrations, type-safe queries — multi-file schema in `prisma/schema/` |
| **Zod** | Schema definition and validation (shared with frontend) |
| **Passport.js / @nestjs/jwt** | Authentication — JWT strategy and route guards |
| **CASL** | Ability-based authorization — `can('update', 'Company')` |

### Frontend

| Technology | Role |
|------------|------|
| **Next.js (App Router)** | UI framework — Server Components, file-based routing |
| **TanStack Query** | Server state management — cache, background sync, invalidation |
| **React Hook Form** | Form management, integrated with Zod via `zodResolver` |
| **Tailwind CSS** | Utility-first styling — design tokens via CSS custom properties |
| **Lucide React** | Icon library — resolved via `lib/icons.ts` (no direct imports in components) |

> **Planned upgrades (separate PRs):** Next.js 15, React 19, Tailwind CSS 4, NestJS 11, bcrypt → argon2.

**No external primitive libraries** (no Radix UI or similar). All UI components are hand-rolled in TypeScript + Tailwind. Accessibility (ARIA, keyboard nav) is implemented manually where needed.

### Database

| Environment | Driver |
|-------------|--------|
| **Dev** | SQLite via LibSQL adapter (`@prisma/adapter-libsql`) |
| **Prod** | PostgreSQL — `provider = "postgresql"` in `_base.prisma` |

All text searches use `mode: 'insensitive'` to ensure consistent case-insensitive behavior on PostgreSQL.

---

## 4. Architectural Patterns

### 4.1 Modular Monolith

The system is organized as a modular monolith: each business domain lives in its own NestJS module, but all modules run in the same process. Modules may import services from each other directly via NestJS DI. Modules marked as **extractable** follow stricter rules: cross-module communication via interfaces only, cross-references by ID only (no direct model joins).

### 4.2 Prisma Setup — Multi-File Schema

Prisma 7 supports folder-based schemas. All model files live in `apps/api/prisma/schema/`. The `prisma.config.ts` points to the folder:

```typescript
// apps/api/prisma.config.ts
export default defineConfig({
  schema: 'prisma/schema',   // folder — Prisma reads all *.prisma files inside
  ...
})
```

| File | Role |
|------|------|
| `prisma/schema/_base.prisma` | Generator config + datasource declaration (underscore ensures it loads first) |
| `prisma/schema/core.prisma` | User, Company, Branch, UserBranch, UserPermission, UserPasswordHistory models |
| `prisma/schema/settings.prisma` | PasswordPolicy model |
| `prisma/migrations/` | Migration history — unaffected by folder structure change |
| `prisma.config.ts` | Prisma CLI config: schema folder path, LibSQL adapter, seed |
| `src/prisma/prisma.service.ts` | NestJS service extending `PrismaClient`, injected globally |

**Convention:** one `.prisma` file per domain module. When adding a new domain, create `prisma/schema/<domain>.prisma`.

```bash
# After any schema change:
pnpm db:migrate   # in apps/api/ — applies migration and regenerates client
```

### 4.3 Clean Architecture (per module)

```
Request → Controller → Service → Prisma → Database
                          ↑
                    Business logic here only
```

Controllers are thin: they validate auth/permissions and delegate to the service. Services contain all business logic. Prisma queries live only in services.

### 4.4 BaseService & BaseController

```typescript
abstract class BaseService<T, CreateDTO, UpdateDTO> {
  constructor(
    prisma: PrismaService,
    modelName: string,
    schema: ZodObject<any>,
    domain: string,           // required — registers the resource in resourceRegistry
    scopeField?: string,      // optional — field used for automatic branch scoping
  )

  findAll(query: PaginationQuery): Promise<PaginatedResult<T>>
  findOne(id: string): Promise<T>
  create(dto: CreateDTO): Promise<T>
  update(id: string, dto: UpdateDTO): Promise<T>
  remove(id: string): Promise<void>
  getMetadata(): ResourceMetadata
  protected buildSearchWhere(search: string): Record<string, unknown>  // override for custom search
}
```

**Branch scoping:** when `scopeField` is declared (e.g., `'branchId'`), `BaseService.findAll()` automatically applies `{ [scopeField]: { in: user.branchIds } }` for non-admin roles.

**Auto-registration:** the `BaseService` constructor pushes `{ domain, resource, schema }` into `resourceRegistry`, which feeds the `DiscoveryController` and the `metadata.builder` for child derivation.

### 4.5 Convention → Configuration

| Layer | Convention (default) | Override |
|-------|---------------------|----------|
| Route prefix | `@Controller('core/<resource>')` | any string |
| Resource label | `camelCase → Title Case` | `withMeta(schema, { label: 'Company' })` |
| Resource label plural | `label + 's'` | `withMeta(schema, { labelPlural: 'Companies' })` |
| Resource icon | none (hidden from sidebar) | `withMeta(schema, { icon: 'Building' })` |
| Field label | `camelCase → Title Case` | `.meta({ label: 'Legal Name' })` |
| Top-level resource | `true` if schema has no `breadcrumb` | determined automatically |
| Field shown in list | `true` for non-relation, non-password fields | `.meta({ showInList: false })` |
| Field shown in form | `true` | `.meta({ showInForm: false })` |
| Sortable field | `true` for string/number/date/enum | `.meta({ sortable: false })` |
| Form component | derived from Zod type | `.meta({ widget: 'textarea' })` |
| Search mode | `insensitive` (PostgreSQL-safe) | fixed — no override |

### 4.6 Resource Registry and Domain Registry

```typescript
// apps/api/src/core/resource-registry.ts
export interface RegistryEntry {
  domain:   string
  resource: string
  schema:   ZodObject<any>
}
export const resourceRegistry: RegistryEntry[] = []
```

```typescript
// apps/api/src/core/domain-registry.ts
export interface DomainEntry {
  key:   string
  label: string
  icon:  string
}
const domainRegistry: DomainEntry[] = []

export function Domain(meta: { label: string; icon: string }): ClassDecorator {
  return (target) => {
    const key = target.name.replace(/Module$/, '').toLowerCase()
    domainRegistry.push({ key, ...meta })
  }
}

export function getDomainRegistry(): DomainEntry[] {
  return domainRegistry
}
```

Usage:
```typescript
@Domain({ label: 'Core', icon: 'Shield' })
@Module({ imports: [CompanyModule, BranchModule, ...] })
export class CoreModule {}
```

> **Settings module note:** `SettingsModule` does **not** carry `@Domain` because all its resources are routed under `core/` (e.g., `@Controller('core/password-policy')`). Each settings service registers directly in `resourceRegistry` with `domain: 'core'`, making those resources appear under the Core domain in discovery.

### 4.7 Discovery API

```
GET /discovery
```

Returns all domains with their top-level resources (those without `breadcrumb`):

```typescript
interface DiscoveryDomain {
  key:       string
  label:     string
  icon:      string
  resources: DiscoveryResource[]
}

interface DiscoveryResource {
  key:         string
  label:       string
  labelPlural: string
  icon:        string
}
```

Implemented in `DiscoveryController`, which reads `resourceRegistry` and `domainRegistry`:
- Filters out resources whose schema has `breadcrumb` (child resources — not shown in sidebar)
- Groups remaining resources by `domain`
- Extracts `label`, `labelPlural`, `icon` from the schema's `_schemaMeta`

The frontend caches this endpoint with `staleTime: Infinity` (production) via `useDiscovery()`.

### 4.8 Children — Automatic Derivation

Children are **never** declared in the parent schema. Instead, `metadata.builder` scans `resourceRegistry` at request time:

**Rule:** when building metadata for a resource, the builder looks for all schemas in the registry that declare `breadcrumb: [{ resource: '<parent>' }]`. For each match, it builds a `ChildResourceDef`:

```typescript
// Auto-derived — no declaration needed in the parent schema
{
  resource:     'branch',
  domain:       'core',
  label:        'Branches',        // = child.labelPlural
  contextField: 'companyId',       // = breadcrumb[].contextField
  keybind:      'f9',              // = breadcrumb[].keybind (declared in child)
}
```

**`keybind` in the child's `BreadcrumbDef`:** declares the shortcut for the button the **parent** renders to navigate to this child. Semantically: "when my parent references me, use this key."

```typescript
breadcrumb: [
  { resource: 'company', contextField: 'companyId', listLabel: 'Companies', nameField: 'legalName', keybind: 'f9' }
]
```

### 4.9 Metadata API

The `GET /<domain>/<resource>/metadata` endpoint returns:

```typescript
interface ResourceMetadata {
  resource:    string
  label:       string
  labelPlural: string
  nameField:   string
  allowCsv?:   boolean
  permissions: { create: boolean; read: boolean; update: boolean; delete: boolean }
  fields:      MetadataField[]
  groups?:     TabGroup[]
  children?:   ChildResourceDef[]   // computed automatically via resourceRegistry
  breadcrumb?: BreadcrumbDef[]      // declared in the child schema, passed through as-is
}
```

`children` is always derived — it never comes from the parent schema directly.

### 4.10 AutoForm, AutoList & AutoBreadcrumb

These components consume the `GET /metadata` response to render their UI without any hardcoded field definitions.

- **AutoList** — renders a filterable, sortable, paginated table. Columns are derived from fields with `showInList: true`. Supports CSV export when `allowCsv` is set. Row actions navigate to the detail page.
- **AutoForm** — renders a validated form using React Hook Form + `zodResolver`. Fields are derived from fields with `showInForm: true`. Groups become tabs when `groups` is set. Read-only fields (from `contextParams`) are rendered as disabled inputs.
- **AutoBreadcrumb** — renders a navigation trail from the resource's `breadcrumb` declarations. Fetches parent record names via the API using the `nameField` from each breadcrumb entry. Uses `useDiscovery()` to resolve domain labels.

### 4.11 Frontend — Icon Resolution

Icons are centralized in `apps/web/src/lib/icons.ts`. No component imports Lucide directly — only `icons.ts` does.

```typescript
// apps/web/src/lib/icons.ts
import { Shield, Users, Building, GitBranch, Lock, Settings, LayoutGrid, type LucideIcon } from 'lucide-react'

export const Icons: Record<string, LucideIcon> = {
  Shield, Users, Building, GitBranch, Lock, Settings,
  Default: LayoutGrid,
}

export function resolveIcon(name?: string | null): LucideIcon {
  return (name && Icons[name]) ? Icons[name] : Icons.Default
}
```

When adding a new icon: import it in `icons.ts` and add it to the `Icons` map. No other file needs to change.

### 4.12 Frontend — useDiscovery

```typescript
// apps/web/src/core/useDiscovery.ts
export function useDiscovery(): DiscoveryDomain[] {
  const { data } = useQuery<DiscoveryDomain[]>({
    queryKey:  ['discovery'],
    queryFn:   async () => { const r = await apiFetch('/discovery'); return r.json() },
    staleTime: process.env.NODE_ENV === 'production' ? Infinity : 0,
    initialData: [],
  })
  return data
}
```

Used by: `Sidebar`, `app/page.tsx`, `app/[domain]/page.tsx`, `AutoBreadcrumb`.

### 4.13 Route Helpers

In `packages/types/index.ts`:

```typescript
// API route (backend): /core/company, /core/company/abc123
export const apiRoute = (domain: string, resource: string, suffix?: string) =>
  `/${domain}/${resource}${suffix ? `/${suffix}` : ''}`

// Navigation route (frontend): /core/company, /core/company/new
export const navRoute = (domain: string, resource: string, suffix?: string) =>
  `/${domain}/${resource}${suffix ? `/${suffix}` : ''}`
```

`apiRoute` and `navRoute` share the same implementation — the distinction is semantic. The `/api` prefix is added by the Next.js proxy, not the helper.

---

## 5. Auth & Permissions

### Authentication Flow

1. `POST /auth/login` — validates credentials, returns JWT
2. JWT payload: `{ sub: userId, role: UserRole, branchIds: string[] }`
3. All protected routes use `JwtAuthGuard` (validates token, attaches user to request)
4. `PoliciesGuard` checks CASL abilities after `JwtAuthGuard`

### Authorization — CASL

Abilities are built per-request by `CaslAbilityFactory` based on the user's `role` and explicit `UserPermission` rows:

| Role | Default access |
|------|---------------|
| `admin` | All actions on all resources; bypasses branch scoping |
| `operator` | CRUD on resources within assigned branches |
| `viewer` | Read-only on resources within assigned branches |

Explicit `UserPermission` rows can grant or extend access beyond the default role.

### Branch Scoping

When `scopeField` is declared in `BaseService`, `findAll()` automatically filters to the user's assigned branches:

```typescript
// Automatic — declare scopeField in the BaseService constructor
super(prisma, 'order', orderSchema, 'sales', 'branchId')
// findAll applies: { branchId: { in: user.branchIds } } for non-admin roles
```

### Password Policy

`PasswordPolicy` is a global singleton (single DB row). It governs minimum length, character requirements, history count and expiry. Enforced at password change time.

---

## 6. Data Models

Models are defined in `apps/api/prisma/schema/` using Prisma 7's multi-file schema. One file per domain:

| File | Models |
|------|--------|
| `schema/core.prisma` | `User`, `Company`, `Branch`, `UserBranch`, `UserPermission`, `UserPasswordHistory` |
| `schema/settings.prisma` | `PasswordPolicy` |

**Enums** (`UserRole`, `BranchUserRole`) live in the same file as the models that reference them.

All models follow these conventions:
- `id String @id @default(uuid())`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt` (where applicable)
- Table names are `@@map("snake_case_plural")`

---

## 7. UI Components

**Rule:** no Radix UI or any external primitive library. All components are written in TypeScript + Tailwind. Accessibility (ARIA, keyboard nav) is implemented manually where needed.

**Reference model:** `apps/web/src/components/ui/button.tsx` — TypeScript + Tailwind + `cn()` + Lucide via `resolveIcon()`.

| Component | File | Notes |
|-----------|------|-------|
| `Button` | `components/ui/button.tsx` | variants: default, destructive, outline, ghost, rowAction |
| `Breadcrumb` | `components/ui/breadcrumb.tsx` | segments array, optional dropdown per item |
| `Tabs` | `components/ui/tabs.tsx` | all panels mounted (`hidden` attr); focuses first enabled field on tab change |
| `Dropdown` | `components/ui/dropdown.tsx` | `createPortal` to `document.body` + `getBoundingClientRect()` fixed positioning — escapes `overflow:hidden` containers; configurable `side`, `align`, `sideOffset` |
| `Collapsible` | — | implemented inline with `useState` + CSS transition — no separate component |

### Dropdown — Portal Architecture

The `Dropdown` component renders its menu into `document.body` via `createPortal`, computing position from the trigger's `getBoundingClientRect()`. This allows it to escape `overflow:hidden` containers (e.g., the sidebar).

Key behaviors:
- `visibility: hidden` until position is computed (prevents flash on first render)
- Viewport boundary correction — clamps to 8px from all edges
- Closes on `pointerdown` outside, `Escape` key, and scroll
- Repositions on window resize
- Props: `side: 'top'|'bottom'|'left'|'right'`, `align: 'start'|'center'|'end'`, `sideOffset` (px gap from trigger, default 0)

Sub-components: `DropdownItem` (supports `destructive`, `disabled`), `DropdownSeparator`, `DropdownLabel`.

---

## 8. Design System

Tokens are defined as HSL custom properties in `globals.css` and mapped in `tailwind.config.ts`. This allows full theme switching by changing a single CSS layer.

Token categories: `background`, `foreground`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar-*`.

All components reference tokens via Tailwind classes (`bg-primary`, `text-foreground`, etc.) — no hardcoded color values.

---

## 9. Keywatch — Keyboard Shortcuts

Shortcuts are declared with `useShortcut()` in any component. The `KeywatchCore` instance (held in `useKeywatch().coreRef`) maintains a registry of all active bindings, their descriptions, icons, groups and display order — used to render the shortcut help overlay.

Key concepts:
- `origin` — identifies the source file (for deduplication across re-renders)
- `context: 'all'` — shortcut is always active; default is active only when no input is focused
- `group` — groups shortcuts in the help overlay
- `display: false` — shortcut is registered but not shown in the overlay

Dynamic bindings (e.g., child navigation buttons from schema metadata) are managed via `core.bind()` / `core.unbindGroup()` in `useEffect`.

---

## 10. TopbarActionsContext — Topbar Slot

Page components declare their topbar buttons via `useTopbarActions()`. The `TopbarActionsContext` holds the current action list and renders it in the topbar.

```typescript
interface TopbarAction {
  label:    string
  icon:     LucideIcon
  onClick?: () => void
  type?:    'button' | 'submit'
  form?:    string                // id of the form to submit
  disabled?: boolean
  primary?:  boolean
  variant?:  'ghost' | 'default' | 'destructive'
  keybind?:  string               // shortcut hint shown in the button title (e.g., 'ALT+F9')
}
```

When `keybind` is set, the button's `title` attribute shows `"<label> (<keybind>)"` — providing a native tooltip shortcut hint without any additional UI. The keybind string is display-only at this layer; actual shortcut binding is done separately via `useShortcut()`.

---

## 11. Adding a New Resource — Checklist

Minimum required. Standard resources need **4 files**. Resources with custom logic may need more.

### Step 1 — Zod Schema

`packages/schemas/<domain>/<resource>.schema.ts`:

```typescript
export const productSchema = withMeta(
  z.object({
    id:   z.string().uuid(),
    name: z.string().min(2).meta({ label: 'Name', showInList: true }),
    // ...
    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Product',
    labelPlural: 'Products',
    nameField:   'name',
    icon:        'Package',   // string — resolved by the frontend via icons.ts
  },
)
```

Export it from `packages/schemas/index.ts`. Add `'Package'` to `apps/web/src/lib/icons.ts` if it's a new icon.

### Step 2 — Prisma Model

Add the model to `apps/api/prisma/schema/<domain>.prisma`, then:
```bash
pnpm db:migrate   # in apps/api/
```

### Step 3 — Service

```typescript
@Injectable()
export class ProductService extends BaseService<Product, CreateProductDto, UpdateProductDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'product', productSchema, 'core')  // domain is required
  }

  protected buildSearchWhere(search: string) {
    return { OR: [{ name: { contains: search, mode: 'insensitive' as const } }] }
  }
}
```

### Step 4 — Controller + Module

```typescript
@Controller('core/product')
@UseGuards(JwtAuthGuard)
export class ProductController extends BaseController<Product, CreateProductDto, UpdateProductDto> {
  constructor(service: ProductService, casl: CaslAbilityFactory) {
    super(service, casl)
  }
}

@Module({
  imports:     [CaslModule],
  controllers: [ProductController],
  providers:   [ProductService],
  exports:     [ProductService],
})
export class ProductModule {}
```

Register `ProductModule` in `CoreModule`.

**Result:** the resource appears automatically in the sidebar, breadcrumb and discovery. No edits to any config file or frontend registry.

### Child Resource

Declare only in the child schema:
```typescript
withMeta(z.object({ ... }), {
  label:       'Variant',
  labelPlural: 'Variants',
  nameField:   'name',
  // icon omitted — children do not appear in the sidebar
  breadcrumb: [
    { resource: 'product', contextField: 'productId', listLabel: 'Products', nameField: 'name', keybind: 'v' }
  ],
})
```

The parent discovers children automatically — no edit to the parent schema needed.
