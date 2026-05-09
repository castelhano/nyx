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
erp-monorepo/
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
│   │       │   ├── jwt.strategy.ts
│   │       │   ├── casl.factory.ts
│   │       │   └── policies.guard.ts
│   │       └── modules/            # Business domain modules
│   │           ├── identity/
│   │           │   ├── identity.module.ts
│   │           │   └── user/
│   │           │       ├── user.module.ts
│   │           │       ├── user.controller.ts
│   │           │       ├── user.service.ts
│   │           │       └── user.routes.ts
│   │           └── crm/
│   │               ├── crm.module.ts
│   │               └── company/
│   │                   ├── company.module.ts
│   │                   ├── company.controller.ts
│   │                   ├── company.service.ts
│   │                   └── company.routes.ts
│   └── web/                        # Next.js frontend
│       └── src/
│           ├── lib/
│           │   └── keywatch/       # Keyboard shortcut manager
│           ├── components/
│           │   ├── layout/
│           │   │   ├── app-layout.tsx
│           │   │   ├── topbar.tsx
│           │   │   ├── topbar-actions-context.tsx  # page → topbar slot injection
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
│           │   └── domains.ts      # domain label map (identity → "Identidade")
│           └── app/                # Next.js App Router
│               ├── [domain]/
│               │   └── [resource]/
│               │       ├── page.tsx        # list — handles any resource
│               │       └── [id]/page.tsx   # form — handles any resource
│               └── login/page.tsx
├── packages/
│   ├── schemas/                    # Zod schemas — shared by api and web
│   │   ├── identity/
│   │   │   └── user.schema.ts
│   │   └── crm/
│   │       └── company.schema.ts
│   └── types/
│       └── index.ts                # z.infer<> exports for all schemas
└── docs/
    ├── architecture/
    │   ├── ARCHITECTURE.md         # This file
    │   ├── conventions.md          # Naming, Zod schemas, checklists
    │   └── decisions/              # Architecture Decision Records (ADRs)
    └── user-manual/
        ├── identity/
        └── crm/
```

**Rule:** the directory name of a model (e.g. `company`) determines the API route prefix (`/crm/company`) and the Zod schema file (`packages/schemas/crm/company.schema.ts`). The frontend is handled automatically by the dynamic routes `[domain]/[resource]` — no page files required. To override with custom UI for a specific resource, create `app/<domain>/<resource>/page.tsx`; Next.js will prefer the static route over the dynamic one.

---

## 3. Technology Stack

### Backend

| Technology | Role |
|------------|------|
| **NestJS** | Main framework — DI container, modules, route orchestration |
| **Prisma ORM** | Database access, migrations, type-safe queries |
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

---

## 4. Architectural Patterns

### 4.1 Modular Monolith

The codebase is organized as a **modular monolith**: all modules live in the same repository and process. In the common case, modules may import each other's services directly. For modules marked as **extractable** (microservice candidates), stricter rules apply: communication via service interfaces, cross-references by ID only, no imports of internal implementation.

### 4.2 Clean Architecture (per module)

```
Request → Controller → Service → Prisma → Database
                          ↑
                    Business logic here only
```

- **Controller** — input parsing, route definition, calls service, returns response. No business logic.
- **Service** — all business logic. Calls Prisma directly. No HTTP concepts.
- **Prisma** — data access layer.

### 4.3 BaseService & BaseController

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
  @Get()           findAll()
  @Get(':id')      findOne()
  @Post()          create()
  @Patch(':id')    update()
  @Delete(':id')   remove()
  @Get('metadata') getMetadata()
}
```

### 4.4 Convention → Configuration

At each layer, the system checks: *is there explicit configuration?* If yes, uses it. If not, applies the convention:

| Layer | Convention (default) | Override |
|-------|---------------------|----------|
| Route prefix | derived from directory path | `@Controller('custom-path')` |
| Resource label | `camelCase → Title Case` | `schema.meta({ label: 'Empresa' })` |
| Resource label plural | `label + 's'` | `schema.meta({ labelPlural: 'Empresas' })` |
| Field label | `camelCase → Title Case` | `.meta({ label: 'Razão Social' })` |
| Field shown in list | `true` for non-relation, non-password | `.meta({ showInList: false })` |
| Field shown in form | `true` | `.meta({ showInForm: false })` |
| Sortable field | `true` for string/number/date/enum | `.meta({ sortable: false })` |
| Form component | derived from Zod type | `.meta({ widget: 'textarea' })` |
| Field placeholder | none | `.meta({ placeholder: 'Ex: João Silva' })` |
| Field help text | none | `.meta({ helpText: 'Texto de ajuda abaixo do campo' })` |
| Field width | `w-full` (fills grid column) | `.meta({ width: 'w-48' })` — any Tailwind width class |

### 4.5 Metadata API

Every resource exposes `GET /<domain>/<resource>/metadata`, generated automatically by `BaseController` from the Zod schema. The frontend consumes this endpoint to render `AutoForm` and `AutoList` without resource-specific HTML.

```typescript
interface ResourceMetadata {
  resource:    string
  label:       string        // singular  — "Usuário"
  labelPlural: string        // plural    — "Usuários"
  nameField:   string        // display field for breadcrumb — default: "name"
  permissions: { create: boolean; read: boolean; update: boolean; delete: boolean }
  fields:      MetadataField[]
  actions:     ResourceAction[]
}
```

`label`, `labelPlural` and `nameField` are read from `schema._fieldMeta` (set via `schema.meta({...})`); all fall back to convention if not declared. `useMetadata` caches the response with `staleTime: Infinity` in production and `staleTime: 0` in development.

### 4.6 AutoForm, AutoList & AutoBreadcrumb

Higher-order components that consume the Metadata API:

- **AutoForm** — iterates `fields` with `showInForm: true`, delegates each field to `FieldRenderer`. Layout is a responsive CSS grid: `[label] [control]` side-by-side on `md+`, stacked on mobile. `placeholder`, `helpText` and `width` from metadata are applied automatically. When `defaultValues` change (edit page fetch), the form resets via `react-hook-form`'s `reset()`. Accepts an optional `formId` prop: when set, the `<form>` element gets that `id` and the internal submit button is hidden — the external button (e.g. in the topbar) takes ownership via the HTML5 `form` attribute.
- **AutoList** — iterates `fields` with `showInList: true` to render the table. `sortable: true` on a field enables server-side sorting: clicking the column header sends `sortField` and `sortOrder` to `BaseService.findAll`, which applies them via Prisma `orderBy`.
- **AutoBreadcrumb** — reads the URL segments, resolves labels from `domains.ts` (domain) and `useMetadata` (resource), and renders `Início > Domain > Resource > Record`. The `[id]/page.tsx` fetches the record and passes `record[meta.nameField]` as `recordName` — one fetch feeds both the form `defaultValues` and the breadcrumb label. Customize per segment via the `overrides` prop (label, dropdown items).

```tsx
// default — zero config
<AutoBreadcrumb domain={domain} resource={resource} id={id} recordName={name} />

// with dropdown on a segment
<AutoBreadcrumb domain={domain} resource={resource}
  overrides={{ user: { items: [{ label: 'Admins', href: '/identity/user?role=admin' }] } }}
/>
```

The ~20% of resources that need custom UI replace these components with hand-crafted alternatives — the metadata contract does not enforce its use.

---

## 5. Initial Modules

### 5.1 `identity`

**Purpose:** user management and authentication.

`User` — `id`, `name`, `email` (unique), `passwordHash` (hidden), `role` (admin | operator | viewer), `isActive`, `createdAt`, `updatedAt`

Extras: `changePassword(id, dto)`, `deactivate(id)`.

**Auth flow:** `POST /auth/login` → validates credentials → returns JWT. All other routes require the JWT guard. CASL abilities derived from `user.role`.

### 5.2 `crm`

**Purpose:** company records (customer/supplier/partner).

`Company` — `id`, `legalName`, `tradeName` (nullable), `taxId` (CNPJ, unique), `type` (client | supplier | partner | other), `isActive`, `createdAt`, `updatedAt`

Extras: `deactivate(id)`.

---

## 6. UI Components

### How components are built — critical for AI

**This project does NOT use the Shadcn CLI.** There is no `components.json` and `npx shadcn add` must never be run. Components follow the Shadcn visual design and API conventions but are written by hand.

**Rule:** when creating a new UI component, model it after `apps/web/src/components/ui/button.tsx`:
- Plain TypeScript + Tailwind — no Radix, no external primitives unless already present in the project
- Use `cn()` from `@/lib/utils` for class merging
- Use Lucide React for icons
- Consume design tokens via Tailwind utilities (`bg-primary`, `text-muted-foreground`, `border-ring`, etc.) — never hardcode colors

**Existing components:**

| Component | File | Notes |
|-----------|------|-------|
| `Button` | `components/ui/button.tsx` | variants: default, destructive, outline, ghost, rowAction |
| `Breadcrumb` | `components/ui/breadcrumb.tsx` | segments array, optional dropdown per item |

When a new interaction primitive is needed (modal, toast, select, etc.), build it following this same pattern — do not install additional UI libraries.

---

## 7. Design System

The frontend uses HSL CSS custom properties organized by semantic layer, defined in `apps/web/src/app/globals.css` and mapped to Tailwind utilities in `tailwind.config.ts`.

### Token layers

| Group | Tokens | Usage |
|-------|--------|-------|
| **App** | `--background`, `--foreground` | body, main content area |
| **Surfaces** | `--card`, `--popover` (+ foregrounds) | cards/panels, dropdowns/modals |
| **Actions** | `--primary`, `--accent`, `--muted`, `--destructive` (+ foregrounds) | buttons and interactive states |
| **Controls** | `--input-bg`, `--input`, `--ring` | inputs, selects, textareas, focus |
| **Structure** | `--border`, `--radius` | card borders, dividers, global border-radius |
| **Sidebar** | `--sidebar-bg`, `--sidebar-fg`, `--sidebar-border`, `--sidebar-accent`, `--sidebar-accent-fg` | sidebar-exclusive tokens |

### Theme system

User-selectable themes are applied as a class on `<html>` (e.g. `theme-eucalyptus`) alongside `dark`. A theme overrides exactly three tokens:

| Token | Role |
|-------|------|
| `--accent` / `--accent-foreground` | hover color for ghost/icon buttons — the visible "brand" of the theme |
| `--ring` | focus ring on all Shadcn controls + active sort column border |

All Shadcn components inherit theme changes automatically via these tokens. `--primary` (action buttons, links) is stable and does not change with the theme.

```css
.dark.theme-eucalyptus {
  --accent:            158 18% 26%;
  --accent-foreground: 155 15% 88%;
  --ring:              158 38% 50%;
}
```

### Critical rules

- **`--accent`** is the theme color — ghost/icon button hover. Neutral by default; overridden by theme class.
- **`--ring`** follows the theme — used for focus rings and active sort column highlight. Do not hardcode `--primary` in these roles.
- **`--sidebar-accent`** is a structural elevation token — always neutral, independent of the theme. Must not be equated to `--accent`.
- **`--input`** (interactive control border) must have higher contrast than **`--border`** (passive structural borders). They are semantically distinct.
- `--input-bg` is applied automatically via `@layer base` to `input`, `select` and `textarea`.

---

## 8. Keywatch — Keyboard Shortcuts

Cross-cutting frontend infrastructure for keyboard shortcut management.

**Location:** `apps/web/src/lib/keywatch/`

| File | Responsibility |
|------|---------------|
| `core.ts` | Registry + event matching, zero DOM — instantiable in any context |
| `context.tsx` | React Provider: registers event listeners, manages modal state |
| `use-shortcut.ts` | `useShortcut` and `useShortcutContext` — bind/unbind via component lifecycle |
| `modal.tsx` | `ShortcutsModal` — lists all active shortcuts with a debug metadata panel |
| `index.ts` | Public exports |

**Integration:** `KeywatchProvider` wraps `AppLayout`. Any component registers shortcuts via hook:

```tsx
useShortcut('ctrl+s', save, { desc: 'Save', origin: 'ClientForm' })
useShortcut('alt+n',  openNew, { desc: 'New', icon: PlusCircle, origin: 'List', context: 'all' })
useShortcutContext('modal') // pushes context on mount, restores on unmount
```

**`useShortcut` options:** `desc` (modal label), `icon` (React component — e.g. Lucide icon), `origin` (source identifier), `context` (`'default'` | `'all'` | custom), `order` (modal ordering), `group` (collective cleanup), `preventDefault`, `enabled`.

**`Alt+K`** opens the modal listing all shortcuts for the current context.

**Input behavior (composed pattern):** when the cursor is in a form field, the shortcut does not fire immediately — it stays pending until a confirmation key (`;` by default) is pressed, preventing accidental triggers while typing.

**Alt modifier exception:** `alt+*` shortcuts bypass the composed pattern and fire immediately even inside form inputs. `alt` combos are unlikely to conflict with typing, so no confirmation step is needed. Use `context: 'all'` alongside to ensure the shortcut fires regardless of active Keywatch context (e.g. `alt+g` → save record).

**Contexts:** shortcuts can be scoped by context (e.g. `'default'`, `'modal'`). The `'all'` context always responds, regardless of the active context.

---

## 9. TopbarActionsContext — Topbar Slot

Cross-cutting frontend infrastructure for injecting page-specific controls into the topbar center slot.

**Location:** `apps/web/src/components/layout/topbar-actions-context.tsx`

**Pattern:** same model as `useSidebar` — a React context with a provider in `AppLayout` and a hook for pages. The topbar renders whatever `ReactNode` the active page has set; nothing when no page has registered actions.

**Topbar layout:** `[sidebar-toggle] [actions — right-aligned] [system-buttons]`

**API:**

```tsx
useTopbarActions(node: ReactNode, deps: DependencyList)
```

Sets the topbar slot on mount and whenever `deps` changes. Clears the slot on unmount. The `deps` array follows the same convention as `useEffect` — list every value the `node` closes over that can change.

**Standard usage — form detail page:**

```tsx
const FORM_ID = 'record-form'
const [isPending, setIsPending] = useState(false)

useTopbarActions(
  <Button type="submit" form={FORM_ID} size="sm" disabled={isPending}>
    <Save className="w-3.5 h-3.5" />
    {isPending ? 'Salvando…' : 'Salvar'}
  </Button>,
  [isPending],
)

useShortcut('alt+g', () => {
  (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
}, { desc: 'Salvar registro', context: 'all' })
```

`AutoForm` is passed `formId={FORM_ID}`, which sets `id` on `<form>` and hides its internal submit button. The topbar button submits the form via HTML5's `form` attribute; `alt+g` calls `requestSubmit()` programmatically — both trigger react-hook-form's `handleSubmit` and its validation.

---

## 10. Documentation Structure

```
docs/
├── architecture/
│   ├── ARCHITECTURE.md          # This file — architecture overview
│   ├── conventions.md           # Naming, Zod schemas, new resource checklist
│   ├── keyboard-shortcuts.md    # Global key map and shortcut registration rules
│   └── decisions/               # Architecture Decision Records (ADRs)
│       └── ADR-001-monorepo.md
└── user-manual/
    ├── identity/
    │   └── users.md
    └── crm/
        └── companies.md
```

**ADRs** follow the format: context → decision → consequences. Create one for each significant architectural choice.
