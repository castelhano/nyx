# ERP Architecture Reference

> Authoritative reference for the system architecture. Describes structure, stack, patterns and cross-cutting infrastructure. Read this document before writing code. For naming conventions, schemas and new-resource checklists, see `conventions.md`.

---

## 1. Goals

| Goal | Description |
|------|-------------|
| **Modular & scalable** | Independent domain modules, extractable into microservices without rewriting |
| **Convention over configuration** | The framework applies defaults automatically; explicit configuration only when deviating |
| **Maximum automation** | Prisma model + Zod schema + `BaseService` → full CRUD resource with validated API, metadata endpoint and auto-rendered UI |
| **Type safety end-to-end** | A single Zod schema is the source of truth for DB types, API validation and frontend forms |

---

## 2. Monorepo Structure

```
nyx/
├── apps/
│   ├── api/                        # NestJS backend
│   │   └── src/
│   │       ├── core/               # Shared infrastructure (no business logic)
│   │       │   ├── base.service.ts
│   │       │   ├── base.controller.ts
│   │       │   ├── base.types.ts
│   │       │   ├── metadata.builder.ts
│   │       │   ├── pagination.interceptor.ts
│   │       │   └── exception.filter.ts
│   │       ├── auth/               # Cross-cutting: JWT, Guards, CASL
│   │       │   ├── auth.module.ts
│   │       │   ├── casl.module.ts  # isolated — no circular deps
│   │       │   ├── casl.factory.ts
│   │       │   ├── jwt.strategy.ts
│   │       │   └── policies.guard.ts
│   │       └── modules/
│   │           ├── core/           # All business resources (single domain)
│   │           │   ├── core.module.ts
│   │           │   ├── user/
│   │           │   ├── company/
│   │           │   ├── branch/
│   │           │   ├── user-permission/
│   │           │   ├── user-branch/
│   │           │   └── password-policy/ → lives in settings/, routed as core/
│   │           └── settings/
│   │               └── password-policy/
│   │                   ├── password-policy.controller.ts  # @Controller('core/password-policy')
│   │                   ├── password-policy.service.ts
│   │                   ├── password-policy.module.ts
│   │                   └── password-policy.routes.ts
│   └── web/                        # Next.js frontend
│       └── src/
│           ├── lib/
│           │   └── keywatch/       # Keyboard shortcut manager
│           ├── components/
│           │   ├── layout/
│           │   │   ├── app-layout.tsx
│           │   │   ├── topbar.tsx
│           │   │   ├── topbar-actions-context.tsx
│           │   │   ├── sidebar.tsx
│           │   │   └── sidebar-context.tsx
│           │   └── ui/
│           │       ├── button.tsx
│           │       └── breadcrumb.tsx
│           ├── core/               # Shared frontend infrastructure
│           │   ├── AutoForm.tsx
│           │   ├── AutoList.tsx
│           │   ├── AutoBreadcrumb.tsx
│           │   ├── FieldRenderer.tsx
│           │   ├── useMetadata.ts
│           │   └── domains.ts      # domain registry (label, icon, resources)
│           └── app/                # Next.js App Router
│               ├── page.tsx                    # home — domain selection
│               ├── [domain]/
│               │   ├── page.tsx                # domain dashboard
│               │   └── [resource]/
│               │       ├── page.tsx            # list — handles any resource
│               │       └── [id]/page.tsx       # form — handles any resource
│               └── login/page.tsx
├── packages/
│   ├── schemas/                    # Zod schemas — shared by api and web
│   │   ├── core/
│   │   │   ├── user.schema.ts
│   │   │   ├── user-permission.schema.ts
│   │   │   ├── user-branch.schema.ts
│   │   │   ├── company.schema.ts
│   │   │   └── branch.schema.ts
│   │   ├── settings/
│   │   │   └── password-policy.schema.ts
│   │   ├── with-meta.ts
│   │   ├── zod-meta.ts
│   │   └── index.ts
│   └── types/
│       └── index.ts                # shared interfaces (AuthUser, ResourceMetadata, etc.)
└── docs/
    └── architecture/
        ├── ARCHITECTURE.md
        ├── conventions.md
        └── decisions/
```

**Navigation hierarchy:** `/ (home)` → `/{domain} (dashboard)` → `/{domain}/{resource} (list)` → `/{domain}/{resource}/{id} (form)`. The breadcrumb follows this path exactly; `Alt+V` navigates up one level.

**Route convention:** all API routes are **singular** — `GET /core/user`, `GET /core/company`. The frontend never auto-pluralizes. The key in `domains.ts` must match the controller prefix exactly: `key: 'company'` → `@Controller('core/company')`.

**Custom UI override:** to replace the generic list or form for a specific resource, create `app/core/company/page.tsx`; Next.js prefers the static route over `[domain]/[resource]`.

---

## 3. Technology Stack

### Backend

| Technology | Role |
|------------|------|
| **NestJS** | Main framework — DI container, modules, route orchestration |
| **Prisma ORM 7** | Database access, migrations, type-safe queries — Rust-free, LibSQL adapter |
| **Zod** | Schema definition and validation (shared with frontend) |
| **Passport.js / @nestjs/jwt** | Authentication — JWT strategy and route guards |
| **CASL** | Ability-based authorization — `can('update', 'Company')` |

### Frontend

| Technology | Role |
|------------|------|
| **Next.js (App Router)** | UI framework — Server Components, Server Actions, file-based routing |
| **TanStack Query** | Server state management — cache, background sync, invalidation |
| **React Hook Form** | Form management, integrated with Zod via `zodResolver` |
| **Tailwind CSS** | Utility-first styling — design tokens via CSS custom properties |
| **Lucide React** | Icon library used across all components |

### Monorepo

| Technology | Role |
|------------|------|
| **pnpm workspaces** | Package manager and workspace orchestration |
| **Turborepo** | Build pipeline, task caching across apps and packages |
| **TypeScript** | Strict mode across all apps and packages |
| **Node.js >= 22.12** | Minimum version required by Prisma 7 |

---

## 4. Architectural Patterns

### 4.1 Modular Monolith

All modules live in the same repository and process. Modules may import each other's services directly. For modules marked as **extractable** (microservice candidates), stricter rules apply: communication via service interfaces, cross-references by ID only, no imports of internal implementation.

### 4.2 Prisma Setup

The project uses **Prisma ORM 7** with the LibSQL (SQLite) driver adapter.

| File | Role |
|------|------|
| `apps/api/prisma/schema.prisma` | Data model and generator config |
| `apps/api/prisma.config.ts` | Prisma CLI config: datasource URL, LibSQL adapter, seed script |
| `apps/api/src/generated/prisma/` | Generated Prisma Client — gitignored |
| `apps/api/src/prisma/prisma.service.ts` | NestJS service extending `PrismaClient`, injected globally |

**After any schema change:**
```bash
pnpm db:migrate   # from apps/api/ — applies migration + regenerates client
```

---

### 4.3 Clean Architecture (per module)

```
Request → Controller → Service → Prisma → Database
                          ↑
                    Business logic here only
```

- **Controller** — input parsing, route definition, calls service. No business logic.
- **Service** — all business logic. Calls Prisma directly. No HTTP concepts.
- **Prisma** — data access layer.

### 4.4 BaseService & BaseController

Every resource extends generic base classes that implement standard CRUD automatically:

```typescript
abstract class BaseService<T, CreateDTO, UpdateDTO> {
  findAll(query: PaginationQuery): Promise<PaginatedResult<T>>
  findOne(id: string): Promise<T>
  create(dto: CreateDTO): Promise<T>
  update(id: string, dto: UpdateDTO): Promise<T>
  remove(id: string): Promise<void>
  getMetadata(): ResourceMetadata
}

abstract class BaseController<T, CreateDTO, UpdateDTO> {
  constructor(service, caslFactory?: CaslAbilityFactory)

  @Get('metadata') async getMetadata(@Req() req)  // returns real permissions for req.user
  @Get()           findAll()
  @Get(':id')      findOne()
  @Post()          create()
  @Patch(':id')    update()
  @Delete(':id')   remove()
}
```

`CaslAbilityFactory` is optional in `BaseController`. When provided, `getMetadata` computes real `permissions` for the authenticated user via CASL. When omitted, permissions default to all `true` (backward compatible).

### 4.5 Convention → Configuration

| Layer | Convention (default) | Override |
|-------|---------------------|----------|
| Route prefix | `@Controller('core/<resource>')` | any string |
| Resource label | `camelCase → Title Case` | `schema.meta({ label: 'Empresa' })` |
| Resource label plural | `label + 's'` | `withMeta(schema, { labelPlural: 'Empresas' })` |
| Field label | `camelCase → Title Case` | `.meta({ label: 'Razão Social' })` |
| Field shown in list | `true` for non-relation, non-password | `.meta({ showInList: false })` |
| Field shown in form | `true` | `.meta({ showInForm: false })` |
| Sortable field | `true` for string/number/date/enum | `.meta({ sortable: false })` |
| Form component | derived from Zod type | `.meta({ widget: 'textarea' })` |
| Field placeholder | none | `.meta({ placeholder: 'Ex: João Silva' })` |
| Field help text | none | `.meta({ helpText: 'Texto de ajuda' })` |
| Field width | `w-full` | `.meta({ width: 'w-48' })` — any Tailwind width class |

### 4.6 Metadata API

Every resource exposes `GET /core/<resource>/metadata`, computed by `BaseController` from the Zod schema and the user's CASL abilities.

```typescript
interface ResourceMetadata {
  resource:    string
  label:       string
  labelPlural: string
  nameField:   string
  allowCsv?:   boolean
  permissions: { create: boolean; read: boolean; update: boolean; delete: boolean }
  fields:      MetadataField[]    // includes listVisibility, defaultValue, mask, widget, resource, labelField
  groups?:     TabGroup[]
  children?:   ChildResourceDef[] // { resource, domain, label, contextField }
  breadcrumb?: BreadcrumbDef[]    // { resource, contextField, listLabel, nameField }
}
```

`permissions` reflects the **actual abilities of the authenticated user** — the frontend uses this to show/hide action buttons (New, Save, Delete) without additional permission checks.

`defaultValue` on each field is extracted automatically from Zod's `.default()` by `metadata.builder.ts`.

`useMetadata(domain, resource)` caches with `staleTime: Infinity` in production and `staleTime: 0` in development.

### 4.7 AutoForm, AutoList & AutoBreadcrumb

Higher-order components that consume the Metadata API:

- **AutoForm** — iterates `fields` with `showInForm: true`, delegates each to `FieldRenderer`. Schema `defaultValue`s are merged with `defaultValues` prop on metadata load. Supports `readonlyFields` (field names rendered as non-editable), `formId` (external submit button via HTML5 `form` attribute), and `resetSignal` (force-reset). When `groups` is present, renders a tabbed layout via `Tabs` — tab switching moves focus imperatively to the first non-disabled field.
- **AutoList** — TanStack Table (`@tanstack/react-table`) with server-side sorting and pagination. Column visibility is driven by `listVisibility`: `visible` = shown by default, `hidden` = hidden by default (user can toggle), `never` = excluded from picker. Accepts `filters` prop (passed as query params to `BaseService.findAll`). CSV download available when `allowCsv: true`.
- **AutoBreadcrumb** — resolves parent labels using `meta.breadcrumb` and `useQueries` for parallel fetches. Accepts `contextParams` to propagate URL context through the breadcrumb links.

- **FieldRenderer** — renders the correct widget per field type: plain input, masked input (`react-imask`), relation select (fetches `GET /{domain}/{resource}?pageSize=999`), switch, textarea, etc. Supports `readonly` prop (visual + functional lock).

The ~20% of resources that need custom UI replace these with hand-crafted components.

---

## 5. Auth & Permissions

### 5.1 Authentication — JWT

```
POST /auth/login  →  validates credentials  →  returns JWT
```

**JWT payload:**
```typescript
{ sub: string; role: string; branchIds: string[] }
```

`branchIds` is computed at login time from `UserBranch`. Storing it in the token avoids a DB query on every request. Trade-off: branch assignment changes take effect only after re-login.

`JwtStrategy.validate()` maps the payload to `AuthUser`:
```typescript
interface AuthUser { id: string; role: string; branchIds: string[] }
```

`req.user` is `AuthUser` on every authenticated route.

### 5.2 Authorization — CASL

`CaslAbilityFactory.createForUser(user)` (async) builds abilities in two layers:

1. **Role baseline** — applied first, by `user.role`:
   - `admin` → `can('manage', 'all')` (bypasses everything)
   - `operator` → `can('read'/'create'/'update', 'all')`
   - `viewer` → `can('read', 'all')`

2. **Explicit permissions** — loaded from `UserPermission` table, override the baseline:
   ```typescript
   // { userId, resource: 'Company', action: 'delete' }
   can(p.action, p.resource)
   ```

CASL subject names match PascalCase model names: `'User'`, `'Company'`, `'Branch'`.

`CaslModule` is a standalone module (no dependencies on business modules) imported by any module that needs `CaslAbilityFactory`, avoiding circular dependencies.

### 5.3 Branch Scoping

The data hierarchy is `Company → Branch → UserBranch ← User`. Users are scoped to branches, not companies directly. `branchIds` from the JWT is used in service-layer filters:

```typescript
// operator/viewer: filter to assigned branches
prisma.someModel.findMany({ where: { branchId: { in: user.branchIds } } })
// admin: no filter
```

### 5.4 Password Policy

`PasswordPolicy` is a **singleton** table (one row). `PasswordPolicyService.validate(password, userId?)` accumulates all violations and throws `BadRequestException` with the full list. Called by `UserService.create()` and `UserService.changePassword()`.

`UserPasswordHistory` stores bcrypt hashes of previous passwords. When `historyCount > 0`, validation rejects any password matching the last N hashes.

---

## 6. Data Models

### Core domain (`/core/`)

| Model | Key fields | Notes |
|-------|-----------|-------|
| `User` | `username` (unique), `email` (unique), `role` (enum), `preferences` (Json), `lastLoginAt` | `passwordHash` never returned by API |
| `Company` | `taxId` (CNPJ, unique), `type` (enum), contact + address fields | `onDelete: Restrict` from Branch |
| `Branch` | `companyId`, `name`, `taxId` (optional, unique) | `onDelete: Restrict` — cannot delete company with branches |
| `UserBranch` | `userId`, `branchId`, `role` (enum) | `@@unique([userId, branchId])` — `onDelete: Cascade` both sides |
| `UserPermission` | `userId`, `resource`, `action` | `@@unique([userId, resource, action])` — `onDelete: Cascade` |

### Settings domain (`/core/password-policy`)

| Model | Key fields | Notes |
|-------|-----------|-------|
| `PasswordPolicy` | `minLength`, `requireUppercase`, `requireNumbers`, `requireSpecial`, `historyCount`, `expiresInDays` | Singleton — always use `findFirst()` |
| `UserPasswordHistory` | `userId`, `passwordHash`, `createdAt` | Trimmed to `historyCount` on each write |

### Enums (defined in Prisma schema)

| Enum | Values |
|------|--------|
| `UserRole` | `admin`, `operator`, `viewer` |
| `BranchUserRole` | `owner`, `manager`, `member` |
| `CompanyType` | `client`, `supplier`, `partner`, `other` |

---

## 7. UI Components

**This project does NOT use the Shadcn CLI.** There is no `components.json` and `npx shadcn add` must never be run. Components follow the Shadcn visual design and API conventions but are written by hand.

**Rule:** model new UI components after `apps/web/src/components/ui/button.tsx`:
- Plain TypeScript + Tailwind — no Radix, no external primitives unless already in the project
- Use `cn()` from `@/lib/utils` for class merging
- Use Lucide React for icons
- Consume design tokens via Tailwind utilities — never hardcode colors

**Existing components:**

| Component | File | Notes |
|-----------|------|-------|
| `Button` | `components/ui/button.tsx` | variants: default, destructive, outline, ghost, rowAction |
| `Breadcrumb` | `components/ui/breadcrumb.tsx` | segments array, optional dropdown per item |
| `Tabs` | `components/ui/tabs.tsx` | all panels stay mounted (`hidden` attr); focuses first non-disabled field on tab change |

---

## 8. Design System

HSL CSS custom properties organized by semantic layer, defined in `globals.css` and mapped to Tailwind in `tailwind.config.ts`.

| Group | Tokens | Usage |
|-------|--------|-------|
| **App** | `--background`, `--foreground` | body, main content area |
| **Surfaces** | `--card`, `--popover` (+ foregrounds) | cards/panels, dropdowns/modals |
| **Actions** | `--primary`, `--accent`, `--muted`, `--destructive` (+ foregrounds) | buttons, interactive states |
| **Controls** | `--input-bg`, `--input`, `--ring` | inputs, selects, textareas, focus |
| **Structure** | `--border`, `--radius` | card borders, dividers, global border-radius |
| **Sidebar** | `--sidebar-bg`, `--sidebar-fg`, `--sidebar-border`, `--sidebar-accent`, `--sidebar-accent-fg` | sidebar-exclusive |

**Theme system:** a theme class on `<html>` (e.g. `dark theme-eucalyptus`) overrides `--accent`, `--accent-foreground`, and `--ring`. All other tokens are stable.

**Critical rules:**
- `--accent` is the theme color — ghost/icon hover. Never use for primary actions.
- `--ring` follows the theme — focus rings and active sort column. Do not hardcode `--primary` here.
- `--sidebar-accent` is a structural elevation token — always neutral, never equals `--accent`.
- `--input` (control border) must have higher contrast than `--border` (structural). They are semantically distinct.

---

## 9. Keywatch — Keyboard Shortcuts

**Location:** `apps/web/src/lib/keywatch/`

| File | Responsibility |
|------|---------------|
| `core.ts` | Registry + event matching, zero DOM |
| `context.tsx` | React Provider: event listeners, modal state |
| `use-shortcut.ts` | `useShortcut` / `useShortcutContext` hooks |
| `modal.tsx` | `ShortcutsModal` — lists active shortcuts |
| `index.ts` | Public exports |

```tsx
useShortcut('alt+n', openNew, { desc: 'Novo registro', icon: Plus, origin: 'List' })
useShortcut('alt+g', save,    { desc: 'Salvar',        icon: Save, origin: 'Form', context: 'all' })
```

**`alt+*` shortcuts** fire immediately even inside form inputs — no confirmation step needed. Always pair with `context: 'all'`. **`Alt+K`** opens the shortcuts modal.

---

## 10. TopbarActionsContext — Topbar Slot

**Location:** `apps/web/src/components/layout/topbar-actions-context.tsx`

```tsx
useTopbarActions(node: ReactNode, deps: DependencyList)
```

Sets the topbar center slot on mount, updates on `deps` change, clears on unmount.

**Rule:** primary page actions (New, Save, etc.) always live in the topbar — never inline inside `AutoList`, `AutoForm`, or other core components.

**Standard usage — list page:**
```tsx
useTopbarActions(
  <Button onClick={() => router.push(`/${domain}/${resource}/new`)} size="sm">
    <Plus className="w-3.5 h-3.5" /> Novo
  </Button>,
  [],
)
```

**Standard usage — form page:**
```tsx
const FORM_ID = 'record-form'
useTopbarActions(
  <Button type="submit" form={FORM_ID} size="sm" disabled={isPending}>
    <Save className="w-3.5 h-3.5" /> {isPending ? 'Gravando…' : 'Gravar'}
  </Button>,
  [isPending],
)
```

`AutoForm` receives `formId={FORM_ID}` — hides its internal submit button and lets the topbar button own the submission via the HTML5 `form` attribute.
