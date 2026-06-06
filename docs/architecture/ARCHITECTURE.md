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
│   │   │   │   └── core.prisma     # User, Company, Branch, UserBranch, UserPermission, Settings models
│   │   │   └── migrations/         # Prisma migration history
│   │   ├── prisma.config.ts        # Prisma CLI config: schema folder, adapter, seed
│   │   └── src/
│   │       ├── core/               # Shared infrastructure (no business logic)
│   │       │   ├── base.service.ts
│   │       │   ├── base.controller.ts
│   │       │   ├── base.types.ts
│   │       │   ├── base-settings.service.ts    # Abstract base for settings resources
│   │       │   ├── base-settings.controller.ts # Abstract base for settings controllers
│   │       │   ├── metadata.builder.ts
│   │       │   ├── resource-registry.ts        # Global registry — populated by BaseService and BaseSettingsService
│   │       │   ├── settings-registry.ts        # Settings-specific registry — populated by BaseSettingsService
│   │       │   ├── domain-registry.ts          # Global registry + @Domain decorator
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
│   │           ├── upload/         # File upload — POST /upload/image (JWT-protected)
│   │           │   ├── upload.controller.ts
│   │           │   └── upload.module.ts
│   │           ├── core/
│   │           │   ├── core.module.ts      # @Domain({ label: 'Controle', icon: 'Shield' })
│   │           │   ├── user/
│   │           │   ├── company/
│   │           │   ├── branch/
│   │           │   ├── user-permission/
│   │           │   ├── user-branch/
│   │           │   ├── job/                # Background jobs — JobService.run() + fire-and-forget
│   │           │   └── settings/           # Part of core domain — no separate @Domain
│   │           │       ├── settings.module.ts
│   │           │       └── password-policy/    # Extends BaseSettingsService/Controller
│   │           └── hr/
│   │               ├── hr.module.ts        # @Domain({ label: 'RH', icon: 'Briefcase' })
│   │               ├── employee/
│   │               ├── contract/
│   │               ├── department/
│   │               └── job-title/
│   └── web/                        # Next.js frontend
│       └── src/
│           ├── lib/
│           │   ├── icons.ts        # Single file with all Lucide imports; resolveIcon() helper
│           │   ├── auth.ts
│           │   ├── auth-context.tsx    # AuthProvider + useAuth() — fetches /auth/me, applies theme
│           │   ├── utils.ts
│           │   ├── csv.ts
│           │   ├── query.ts        # httpError() and httpRetry() — shared fetch error primitives
│           │   └── keywatch/
│           ├── components/
│           │   ├── layout/
│           │   │   ├── app-layout.tsx
│           │   │   ├── topbar.tsx
│           │   │   ├── topbar-actions-context.tsx
│           │   │   ├── sidebar.tsx
│           │   │   ├── sidebar-context.tsx
│           │   │   ├── global-shortcuts.tsx    # date field shortcuts + app-wide keybinds
│           │   │   └── global-search.tsx       # F3 resource search overlay
│           │   └── ui/
│           │       ├── button.tsx
│           │       ├── breadcrumb.tsx
│           │       ├── dropdown.tsx        # Portal-based, viewport-aware; DropdownItem supports href
│           │       ├── tabs.tsx
│           │       ├── theme-card.tsx      # Reusable theme selector card with color swatch
│           │       ├── forbidden.tsx       # Shown on 403 / create permission missing on /new
│           │       └── not-found.tsx       # Shown on 404 or any other metadata error
│           ├── core/               # Shared frontend infrastructure
│           │   ├── AutoForm.tsx
│           │   ├── AutoList.tsx
│           │   ├── AutoBreadcrumb.tsx
│           │   ├── SettingsPanel.tsx   # Template for singleton resources (isSingleton: true)
│           │   ├── FieldRenderer.tsx
│           │   ├── ObjectEditorWidget.tsx  # SubObjectEditor, SubArrayEditor, ObjectEditorWidget — importable by custom pages
│           │   ├── PolicyIndicator.tsx # Password policy hint strip — reused in user/[id] and password page
│           │   ├── useMetadata.ts
│           │   ├── useDiscovery.ts    # Hook for GET /discovery — replaces static domains.ts
│           │   ├── usePageGuard.ts    # Resolves guardNode + permission flags for any page
│           │   └── useRecordQuery.ts  # Standard useQuery wrapper for single-record fetches by ID
│           └── app/
│               ├── page.tsx
│               ├── [domain]/
│               │   ├── page.tsx
│               │   └── [resource]/
│               │       ├── page.tsx         # delegates to SettingsPanel when isSingleton
│               │       └── [id]/page.tsx    # generic detail page (AutoForm)
│               ├── core/
│               │   └── user/
│               │       ├── [id]/page.tsx           # custom detail page (overrides generic)
│               │       ├── preferences/page.tsx    # user preferences (theme, sidebar, dateFormat)
│               │       └── password/page.tsx       # self-service change password
│               └── login/page.tsx
├── packages/
│   ├── schemas/
│   │   ├── core/
│   │   ├── hr/
│   │   ├── settings/
│   │   ├── with-meta.ts
│   │   ├── zod-meta.ts
│   │   └── index.ts
│   └── types/
│       └── index.ts                # apiRoute/navRoute helpers; DiscoveryDomain/DiscoveryResource; AuthUser; UserPreferences/CurrentUser/ThemeName
└── docs/
```

**Navigation rule:** resources with `breadcrumb` in the schema are children — they do not appear in the sidebar or in the discovery response. Resources without `breadcrumb` are top-level and appear automatically.

---

## 3. Technology Stack

### Backend

| Technology | Role |
|------------|------|
| **NestJS 11** | Main framework — DI container, modules, route orchestration |
| **Prisma ORM 7** | Database access, migrations, type-safe queries — multi-file schema in `prisma/schema/` |
| **Zod 4** | Schema definition and validation (shared with frontend) — field metadata via native `.meta()` |
| **Passport.js / @nestjs/jwt** | Authentication — JWT strategy and route guards |
| **CASL 7** | Ability-based authorization — `can('update', 'Company')` |
| **argon2** | Password hashing for all user credentials |

### Frontend

| Technology | Role |
|------------|------|
| **Next.js 16 (App Router)** | UI framework — client pages read dynamic route segments via `useParams()` |
| **React 19** | UI rendering |
| **TanStack Query 5** | Server state management — cache, background sync, invalidation |
| **React Hook Form 7** | Form management — `AutoForm` uses uncontrolled validation; `zodResolver` not applied |
| **Tailwind CSS 4** | Utility-first styling — CSS-first config via `@theme` in `globals.css`; no `tailwind.config.ts` |
| **Lucide React 1.x** | Icon library — resolved via `lib/icons.ts` (no direct imports in components) |

**Runtime:** Node.js 22 LTS · TypeScript 6 · pnpm 10 workspaces.

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

**`sanitizeDto` — automatic payload cleanup:** `create` and `update` run the DTO through `sanitizeDto` before passing it to Prisma. It rebuilds the object from scratch using only fields declared in the Zod schema, strips immutable fields (`id`, `createdAt`, `updatedAt`), converts date strings (`"YYYY-MM-DD"`) to `Date` objects, and removes empty strings for optional date fields. This means the frontend can safely send back the full record object (including nested relations from `include`) without causing Prisma errors.

**CASL enforcement in `BaseController`:** every data endpoint checks the user's ability before delegating to the service. `ForbiddenException` (HTTP 403) is thrown if the check fails.

| Endpoint | Required ability |
|---|---|
| `GET /` (list) | `read` |
| `GET /:id` (detail) | `read` |
| `POST /` (create) | `create` |
| `PATCH /:id` (update) | `update` |
| `DELETE /:id` (delete) | `delete` |

`BaseSettingsController` follows the same pattern: `GET /` requires `read`, `PUT /` requires `update`.

The check is implemented as a private `assertAbility(user, action)` method — one CASL ability build (one DB query) per request. The `getMetadata()` endpoint never throws 403; it always returns the permissions object so the frontend can adapt its UI.

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

> **Zod 4 — `.meta()` must be the last call in the chain.** It clones the type and stores data in Zod's `globalRegistry`. The `metadata.builder` reads it back via `field.meta()` (zero-arg call). Wrapping with `.optional()` or `.default()` *after* `.meta()` creates a new type with no metadata registered — always chain as `z.string().[validators].meta({...})`.
>
> Enum options are in `_def.entries` (object, not array). Default values are in `_def.defaultValue` directly (not a function). Array element schema is in `_def.element` (not `_def.type` as in Zod v3 — `_def.type` is a string tag in v4).
| Field shown in list | `visible` for non-id, non-password, non-timestamp fields | `.meta({ listVisibility: 'hidden' })` or `.meta({ listVisibility: 'never' })` |
| Field shown in form | `true` | `.meta({ showInForm: false })` |
| Sortable field | `true` for string/number/date/enum | `.meta({ sortable: false })` |
| Form component | derived from Zod type | `.meta({ widget: 'textarea' })` |
| Avatar / photo upload | — | `.meta({ widget: 'avatar' })` — renders a circular preview button; on click opens a file picker; on form submit the file is uploaded to `POST /upload/image` and the returned URL replaces the field value before the record is saved |
| Field default value | none | `.meta({ defaultValue: 'ACTIVE' })` — static default pre-populated in `AutoForm` for new records; also supports the token `'$today'` which resolves to today's date as `YYYY-MM-DD` at render time (use on `z.date()` fields to pre-fill with today's date dynamically) |
| Relation select (FK field) | — | `.meta({ widget: 'select', resource: 'department', domain: 'hr', labelField: 'name' })` — `domain` obrigatório quando o resource não pertence ao domínio `core` (default) |
| Relation include (auto) | all `widget: 'select'` fields with `labelField` | `BaseService` auto-builds Prisma `include`; convention `fooId → foo` (strip `Id`) — see §4.5.1 |
| Extra relation fields | `labelField` only | `.meta({ relatedDisplayFields: ['code', 'location'] })` — additional fields selected in the `include` |
| Filter on include | no filter | `.meta({ relatedWhere: { isActive: true } })` — applied as Prisma `include where`; parent record still appears, `row.relation` returns `null` if not matched |
| Dependent select | — | `.meta({ dependsOn: 'parentFieldName' })` — re-fetches options with `?f_<dependsOn>=<value>` when the parent field changes; clears own value on parent change; disabled only when both parent and child are empty (enabled unfiltered in edit mode when child already has a value) — see §4.5.2 |
| Virtual field | — | `.meta({ virtual: true })` — rendered in the form for UX purposes (e.g. a company selector that filters a branch selector) but excluded from API payloads; `listVisibility` forced to `'never'` — see §4.5.2 |
| Nested JSON editor | — | `.meta({ widget: 'object-editor', showInForm: true, listVisibility: 'never' })` on an optional `ZodObject` — `metadata.builder` recursively serializes the shape into `MetadataField.fields` (objects) and `MetadataField.itemFields` (array items); `FieldRenderer` renders `ObjectEditorWidget` spanning both AutoForm columns; custom pages can import `ObjectEditorWidget` from `core/ObjectEditorWidget.tsx` directly |
| Locked relation (lazy edit) | — | `.meta({ lazyEdit: true })` — in edit mode, shows the related record's label as read-only text with an edit button instead of fetching all options up front; fetches only `GET /<domain>/<resource>/:id` (one lightweight call) until the user clicks the edit button, then switches to the full `RelationSelect`; in create mode always renders the full select immediately — see §4.5.3 |
| Default sort | `createdAt: 'desc'` | `withMeta(schema, { defaultSort: { field: 'name', order: 'asc' } })` — applied by `BaseService` when no `sortField` in query |
| Post-create redirect | resource list | `withMeta(schema, { afterCreate: '/core/branch?companyId={id}' })` — template string with `{fieldName}` placeholders interpolated from the created record; the generic `[id]/page.tsx` redirects there instead of the list after a successful `POST` |
| Default list filters | none | `withMeta(schema, { defaultFilters: { status: 'ACTIVE' } })` — pre-applies filters when the list loads; user can change or clear them normally; keys use field names (no `f_` prefix — `AutoList` adds it); propagated via the metadata endpoint at no extra cost |
| Search mode | `insensitive` (PostgreSQL-safe) | fixed — no override |
| List filter | none | `.meta({ filter: true })` (auto-derived) or `.meta({ filter: { type: 'date_range' } })` (explicit) |
| Row actions | none | `withMeta(schema, { rowActions: [...] })` — see §4.13 |

**Settings resources (singleton):** use `BaseSettingsService` — see §4.17.

### 4.5.1 Relation Includes — FK Display in AutoList

When a field declares `widget: 'select'` + `labelField`, `BaseService` automatically builds a Prisma `include` for that relation in both `findAll()` and `findOne()`. AutoList renders the `labelField` of the related object **in place of the UUID** in the FK field cell.

**Name convention:** `fooId → foo` (strip trailing `Id`). Must match the Prisma relation name.

**Basic case — zero extra config:**
```typescript
departmentId: z.uuid().meta({
  widget: 'select', resource: 'department', domain: 'hr', labelField: 'name',
})
// backend → include: { department: { select: { id: true, name: true } } }
// AutoList → departmentId cell renders department.name (fallback: raw UUID if null)
```

**Additional relation fields (`relatedDisplayFields`):**
```typescript
departmentId: z.uuid().meta({
  widget: 'select', resource: 'department', domain: 'hr', labelField: 'name',
  relatedDisplayFields: ['code', 'location'],
})
// → include: { department: { select: { id, name, code, location } } }
// AutoList still renders labelField; extras are available in row.department
// for use in rowActions or custom pages
```

**Filter on the include (`relatedWhere`):**
```typescript
departmentId: z.uuid().meta({
  widget: 'select', resource: 'department', domain: 'hr', labelField: 'name',
  relatedWhere: { isActive: true },
})
// → include: { department: { select: { ... }, where: { isActive: true } } }
// If the related record does not match: row.department = null → AutoList renders empty string
// The parent record (e.g. jobTitle) still appears in the list
```

> **Note:** `relatedWhere` filters the *included* object, not the parent records. To exclude parent records when the related record does not match a condition, use a `contextFilter` in the service's `findAll()` instead.

### 4.5.2 Dependent Selects — `virtual` + `dependsOn`

Two field-level metadata flags enable cascading select fields declaratively.

**`virtual: true`** — the field exists in the form for UX purposes but is never sent to the API. `AutoForm` strips all virtual fields from the payload before calling `onSubmit`. The metadata builder forces `listVisibility: 'never'` automatically.

**`dependsOn: 'fieldName'`** — when the named sibling field changes, `RelationSelect` re-fetches options using `?f_<dependsOn>=<value>`. The child value is cleared whenever the parent changes. Fetch and enable rules:

| Parent value | Child value | Behaviour |
|---|---|---|
| empty | empty | disabled — no fetch (blank creation form) |
| empty | set | enabled — fetch **unfiltered** (edit mode, virtual parent not yet selected) |
| set | any | enabled — fetch filtered by parent |

**Schema declaration (company → branch example):**

```typescript
// The company field is virtual — it narrows the branch list but is not stored.
companyId: z.string().optional().meta({
  label: 'Company',
  widget: 'select', resource: 'company', domain: 'core', labelField: 'legalName',
  virtual: true,
}),

// branchId is stored; options are filtered by the selected company.
branchId: z.string().meta({
  label: 'Branch',
  widget: 'select', resource: 'branch', domain: 'core', labelField: 'name',
  dependsOn: 'companyId',   // → re-fetches with ?f_companyId=<value>
}),
```

**How it works — `AutoForm` path:**
- `RelationSelect` calls `useWatch` on both the `dependsOn` field and its own field to observe the parent value and whether the child already has a value.
- It delegates the fetch to `useFieldOptions` (see §4.15.1), which appends `?f_<dependsOn>=<value>` when the parent is set, or fetches unfiltered when the child already has a value but the parent is empty (edit mode where the virtual parent starts unpopulated).
- `RelationSelectControl` (inner component) runs a `useEffect` that calls `ctrl.onChange('')` whenever the parent changes to a *different* non-empty value, preventing stale child selections. It does not clear on initial render.
- On submit, `AutoForm` removes all `virtual` fields from the payload.

**Edit mode — ideal UX via `relatedDisplayFields`:**

When the stored field uses `relatedDisplayFields` to include the parent FK, the page can pre-populate the virtual field from the loaded record at zero extra cost:

```typescript
// schema: branchId.meta({ relatedDisplayFields: ['companyId'] })
// API returns: { branchId: 'X', branch: { id: 'X', name: 'Filial SP', companyId: 'ABC' } }

defaultValues = { ...record, companyId: record.branch?.companyId }
// → virtual companyId pre-populated → branch select opens filtered to company ABC
```

**Custom pages path — `useFieldOptions`:**

Custom pages call `useFieldOptions` directly, passing the watched parent value and whether the child already has a value:

```typescript
const companyId    = watch('companyId')
const branchId     = watch('branchId')
const { options: branchOptions } = useFieldOptions(
  branchField,
  companyId || undefined,
  { hasCurrentValue: !!branchId },
)
```

**Backend contract:** the options endpoint must support `f_<dependsOn>` as a filter. For `BaseService` resources this works automatically via `buildFilterWhere` — the only requirement is that the parent field is declared with `filter: true` (or `filter: { type: 'relation', ... }`) in the child resource's schema.

**Chains:** the pattern composes — a field can depend on another that is itself a child. Each level only needs `dependsOn` pointing to its immediate parent.

### 4.5.3 Locked Relation Fields — `lazyEdit`

Some FK fields rarely change after creation (e.g., which company and branch an employee belongs to). Eagerly fetching all options for these fields on every form load wastes bandwidth and triggers unnecessary render cycles.

**`lazyEdit: true`** defers the options fetch until the user explicitly decides to edit the field.

**Behaviour by mode:**

| Mode | Behaviour |
|---|---|
| **Create** (`id === 'new'`, field value empty) | Full `RelationSelect` rendered immediately — options fetched normally |
| **Edit** (field has a value, user has not clicked edit) | `LockedDisplay` — fetches only `GET /<domain>/<resource>/:id` to show the label; no bulk options fetch |
| **Edit** (user clicks the edit button) | Switches to full `RelationSelect`; bulk options fetch fires at this point |
| **Read-only** (no update permission) | `LockedDisplay` without the edit button — options never fetched |

**Parent-change cascade:** when a `lazyEdit` field declares `dependsOn` and its parent field changes to a different value, the child automatically unlocks and clears its value, prompting the user to pick a new option filtered by the new parent.

**Single-record fetch:** `LockedDisplay` uses `queryKey: ['relation-single', domain, resource, id]` with `staleTime: 60_000`. The result is shared across all locked displays pointing to the same record — navigating between employees of the same company costs one fetch total.

**Schema declaration:**
```typescript
// Virtual parent — rarely changed after creation
companyId: z.string().optional().meta({
  label: 'Company', widget: 'select', resource: 'company', domain: 'core',
  labelField: 'legalName', virtual: true,
  lazyEdit: true,
}),

// Real FK — rarely changed; depends on virtual parent
branchId: z.uuid().meta({
  label: 'Branch', widget: 'select', resource: 'branch', domain: 'core',
  labelField: 'name', dependsOn: 'companyId', relatedDisplayFields: ['companyId'],
  lazyEdit: true,
}),
```

**When to use:** apply `lazyEdit: true` to relation fields where the current value is almost never changed after record creation (e.g., organizational FK fields). Do not apply it to fields that users frequently update in-place (e.g., status, category).

**Custom pages:** `LockedRelationSelect` uses `useFormContext()` internally and therefore requires the form to be wrapped in RHF's `FormProvider`. `AutoForm` provides this automatically. Custom pages must wrap their `<form>` manually:

```typescript
const methods = useForm({ values: defaultValues })
return (
  <FormProvider {...methods}>
    <form onSubmit={methods.handleSubmit(onSubmit)}>
      {/* FieldRenderer with lazyEdit fields works here */}
    </form>
  </FormProvider>
)
```

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

> **Settings module note:** `SettingsModule` lives inside `CoreModule` (`modules/core/settings/`) and is part of the Core domain. It does **not** carry `@Domain` — `CoreModule` owns the domain declaration. Each settings resource (e.g. `PasswordPolicyService`) registers itself in `resourceRegistry` and `settingsRegistry` via `BaseSettingsService` — see §4.17.

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
  key:                 string
  label:               string
  labelPlural:         string
  icon:                string
  isSingleton?:        boolean  // settings resource — no list, create or delete
  privatePermissions?: boolean  // child resource requiring explicit grants — not shown in sidebar
}
```

Implemented in `DiscoveryController`, which reads `resourceRegistry` and `domainRegistry`:
- Includes **top-level resources** (no `breadcrumb`) that the user can `read`
- Also includes **child resources with `privatePermissions: true`** that the user can `read` — these require explicit grants and must appear in the permission management UI (`CheckboxGroup`)
- Excludes regular child resources (those inherit permissions automatically — see §5 Permission Inheritance)
- Filters out domains that have no visible resources after the permission filter
- Groups remaining resources by `domain`
- Extracts `label`, `labelPlural`, `icon` from the schema's `_schemaMeta`

The frontend caches this endpoint per user via `useDiscovery()` (`staleTime: Infinity` in production). The cache is scoped to `['discovery', userId]` so different users never share results. On logout, `queryClient.clear()` wipes the cache.

### 4.8 Children — Automatic Derivation

Children are **never** declared in the parent schema. Instead, `metadata.builder` scans `resourceRegistry` at request time:

**Rule:** when building metadata for a resource, the builder looks for all schemas in the registry that declare `breadcrumb: [{ resource: '<parent>' }]`. For each match, it builds a `ChildResourceDef`:

```typescript
// Auto-derived — no declaration needed in the parent schema
{
  resource:            'branch',
  domain:              'core',
  label:               'Branches',   // = child.labelPlural
  contextField:        'companyId',  // = breadcrumb[].contextField
  keybind:             'f9',         // = breadcrumb[].keybind (declared in child)
  privatePermissions?: true,         // present only when child declares privatePermissions: true
}
```

**`keybind` in the child's `BreadcrumbDef`:** declares the shortcut for the button the **parent** renders to navigate to this child. Semantically: "when my parent references me, use this key."

**`nameFirstWord`** — by default, `AutoBreadcrumb` shows only the first word of the parent's name (splitting on space) to keep the trail short. Set `nameFirstWord: false` in the `BreadcrumbDef` to display the full name:

```typescript
breadcrumb: [
  { resource: 'transit-route', contextField: 'routeId', listLabel: 'Sentidos', nameField: 'name', nameFirstWord: false, keybind: 'f9' }
]
```

The same flag can be set at the `withMeta` top level (`nameFirstWord: false`) to control the **current record's** label in the breadcrumb trail. This is read from `ResourceMetadata.nameFirstWord` by `AutoBreadcrumb` — no prop needed on the component.

### 4.9 Metadata API

The `GET /<domain>/<resource>/metadata` endpoint returns:

```typescript
interface ResourceMetadata {
  resource:     string
  label:        string
  labelPlural:  string
  nameField:    string
  allowCsv?:    boolean
  permissions:  { create: boolean; read: boolean; update: boolean; delete: boolean }
  fields:       MetadataField[]
  groups?:      TabGroup[]
  children?:    ChildResourceDef[]   // computed automatically via resourceRegistry
  breadcrumb?:  BreadcrumbDef[]      // declared in the child schema, passed through as-is
  afterCreate?: string               // {fieldName} template — redirect target after POST; omit to fall back to list
}
```

`children` is always derived — it never comes from the parent schema directly.

### 4.10 Custom Resource Pages

When a resource requires behaviour that `AutoForm` / `AutoList` cannot express (multi-endpoint save, conditional password block, many-to-many tabs, etc.), create a **static route** that shadows the generic dynamic one:

```
app/core/user/[id]/page.tsx   ← takes priority over
app/[domain]/[resource]/[id]/page.tsx
```

Next.js App Router resolves static segments before dynamic ones, so no configuration is needed — the file just takes precedence.

**Conventions for custom pages:**

Every custom detail page follows this hook pattern:

```typescript
// 1. fetch the primary record — useRecordQuery handles retry and error shape
const { data: foo, error: fooError } = useRecordQuery(
  ['domain', 'foo', id],
  `/domain/foo/${id}`,
  { enabled: !isNew, staleTime: 30_000 },
)

// 2. guard — covers metadata errors, permission checks, and record 404
const { guardNode, canCreate, canUpdate, canDelete } = usePageGuard('domain', 'foo', isNew, fooError ?? undefined)

// ... all remaining hooks (useDiscovery, useQuery for related data, useEffect, useTopbarActions, useShortcut) ...

// 3. single guard exit — no page-level Forbidden/NotFound imports needed
if (guardNode) return guardNode
```

- `useRecordQuery` must be called **before** `usePageGuard` so `fooError` is in scope
- `usePageGuard` returns `guardNode` (`null` | `<Forbidden />` | `<NotFound />`) and the resolved permission flags
- Related-data queries (collections, associations) use plain `useQuery` — their errors do not trigger `guardNode`
- Keep the same topbar pattern (`useTopbarActions` + `FORM_ID` + `form.requestSubmit()`)
- Keep the same shortcuts (`alt+g` save, `alt+v` back)
- Keep `AutoBreadcrumb` — pass `domain`, `resource`, `id`, `recordName`
- Data outside the main form (related entities, associations) is held in `useState`; refs guard one-time initialisation from query data
- Multi-endpoint saves run in `Promise.all()` where order allows

**Standalone pages** (not tied to a domain/resource list — e.g., preferences, change password) differ from custom resource pages in two ways:
- Use `<Breadcrumb>` directly with custom segments (e.g. `[{ label: 'Início', href: '/' }, { label: 'Preferências' }]`) instead of `AutoBreadcrumb`, which always builds the domain → resource trail from the URL
- `alt+v` and post-save navigation go to `/` (home), not to a resource list

### 4.11 AutoForm, AutoList & AutoBreadcrumb

These components consume the `GET /metadata` response to render their UI without any hardcoded field definitions.

- **AutoList** — renders a sortable, paginated table with a typed filter system. Columns are derived from fields with `listVisibility: 'visible'` or `'hidden'`. Supports CSV export when `allowCsv` is set. Filter controls are auto-rendered from `filter` definitions in the metadata: inline on desktop, collapsed behind a button with active-count badge on mobile. Accepts a `filters` prop for static context filters injected by parent pages (e.g. `{ companyId: 'abc' }`). Accepts an `onAction` prop as an escape hatch for row actions that cannot be expressed declaratively in the schema (see §4.13). **Date formatting:** `type: 'date'` cells are formatted using the authenticated user's `preferences.dateFormat` (e.g. `DD/MM/YYYY`); falls back to `DD/MM/YYYY` when the preference is unset.
- **AutoForm** — renders a validated form using React Hook Form. Fields are derived from fields with `showInForm: true`. Groups become tabs when `groups` is set. Read-only fields (from `contextParams`) are rendered as disabled inputs. **Date normalization:** ISO strings from the server (`2026-05-06T00:00:00.000Z`) are converted to `YYYY-MM-DD` for `<input type="date">` fields automatically. **File uploads:** fields with `widget: 'avatar'` store a `File` object in RHF state until submit; on submit, the file is uploaded and the URL replaces the value before `onSubmit` is called — no upload happens on file selection. **Required validation:** RHF rules use the string `'Campo obrigatório'` (not boolean `true`) so errors render visibly next to the field.
- **AutoBreadcrumb** — renders a navigation trail from the resource's `breadcrumb` declarations. Fetches parent record names via the API using the `nameField` from each breadcrumb entry. Uses `useDiscovery()` to resolve domain labels.

**Error states** — all pages (generic and custom) use `usePageGuard` + `useRecordQuery` to resolve guard state before rendering. `<Forbidden />` and `<NotFound />` are never imported directly by pages — they are returned as `guardNode`.

| Condition | Outcome |
|---|---|
| Metadata returns 403, or `permissions.read` is false | `<Forbidden />` |
| `id === 'new'` and `permissions.create` is false | `<Forbidden />` |
| Any other metadata error (e.g. 404 — resource key does not exist) | `<NotFound />` |
| Record fetch returns any non-2xx (e.g. 404 — record ID does not exist) | `<NotFound />` |

**`lib/query.ts` — shared fetch error primitives** used by `useMetadata` and `useRecordQuery`:
- `httpError(status)` — creates an `Error` with a `status` property, used as the thrown value for non-ok responses
- `httpRetry(attempt, err)` — TanStack Query `retry` function; retries only on network errors or 5xx; skips all 4xx immediately

### 4.12 Filter System

Typed, schema-driven filters for AutoList. Two sides: declaration (schema) and execution (backend + frontend).

**Declaration — `FieldMeta.filter`:**

```typescript
// Auto-derived from Zod type when filter: true
role:      z.enum([...]).meta({ filter: true })        // → select (enum values as options)
isActive:  z.boolean().meta({ filter: true })           // → boolean (Sim / Não)
salary:    z.number().meta({ filter: true })            // → number_range (min / max)
createdAt: z.date().meta({ filter: true })              // → date_range (from / to)
name:      z.string().meta({ filter: true })            // → text (contains, insensitive)

// Explicit for relation filters (cannot be auto-derived)
branchId: z.string().optional().meta({
  filter: { type: 'relation', endpoint: 'core/branch', labelField: 'name', dependsOn: 'companyId' }
})
```

**`FilterDef` union (from `@nyx/types`):**
`'text' | 'select' | 'boolean' | 'number_range' | 'date_range' | { type: 'relation'; endpoint; labelField; dependsOn? }`

**Backend — `apps/api/src/core/filter.builder.ts`:**
- `resolveFilterDef(field, meta.filter)` — auto-derives `FilterDef` from Zod type when `filter: true`
- `buildFilterWhere(schema, query)` — reads `f_*` query params and translates to Prisma `where` conditions
- Called from `BaseService.findAll()`; `f_*` params are excluded from `contextFilters`

**Query param format:**
- Simple: `f_role=admin`, `f_isActive=true`
- Range: `f_salary_min=1000&f_salary_max=5000`, `f_createdAt_from=2024-01-01&f_createdAt_to=2024-12-31`

**Frontend — `FilterBar` (inside `AutoList.tsx`):**
- Reads `filter` from each `MetadataField` in the metadata response
- Renders appropriate control per type (select, boolean toggle, text, range inputs, relation combobox)
- `relation` type fetches options from `endpoint`; re-fetches and clears when `dependsOn` field changes
- Responsive: inline on `md+`, collapsed behind icon button with active-count badge on mobile

**Adding a filter to any field:**
```typescript
// packages/schemas/<domain>/<resource>.schema.ts
fieldName: z.enum([...]).meta({ filter: true })   // done — no other files to edit
```

### 4.13 Row Actions

Per-row contextual actions declared in the schema and executed by `AutoList` automatically.

**Declaration** — in `withMeta`, alongside every other resource-level option:

```typescript
rowActions: [
  {
    action:     'viewBranches',
    label:      'View branches',
    icon:       'GitBranch',
    group:      'nav',
    permission: 'read',                              // maps to metadata.permissions
    href:       (row) => `/core/branch?companyId=${row.id}`,
  },
  {
    action:     'deactivate',
    label:      'Deactivate',
    icon:       'Ban',
    group:      'danger',
    variant:    'destructive',
    permission: 'update',
    method:     'PATCH',
    endpoint:   (row) => `/core/company/${row.id}`,
    body:       { isActive: false },
  },
]
```

**Execution model** — `AutoList` resolves every action internally:

| Declaration | Execution |
|---|---|
| `href` | `router.push(resolved url)` |
| `method + endpoint` | `apiFetch(resolved endpoint, { method, body })` + `queryClient.invalidateQueries` |
| neither | `onAction?.(action, row)` — escape hatch for the parent page |

**Permission filtering** — `metadata.permissions[action.permission]` evaluated on the frontend; the backend re-validates on the actual API call.

**Rendering** — handled by `RowActionsCell` (`apps/web/src/core/RowActionsCell.tsx`):

| Visible actions | Rendering |
|---|---|
| 0 | `null` — column not rendered |
| 1 | Inline `<Button variant="rowAction">` with icon + label |
| 2+ | `<MoreHorizontal>` button opening the portal `Dropdown` |

**Groups** — actions with the same `group` value are rendered together; a `DropdownSeparator` is inserted at every group boundary.

**`href`/`endpoint` functions** are called once at metadata-build time via a Proxy that converts field accesses to `{fieldName}` placeholders. Keep these functions as simple string templates — conditional logic belongs in `onAction`.

Adding a row action requires editing **one file** (`packages/schemas/<domain>/<resource>.schema.ts`) for the standard case. See `docs/proposals/rowaction-proposal.md` for the full specification.

### 4.14 Frontend — Icon Resolution

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

### 4.15 Frontend — useDiscovery

```typescript
// apps/web/src/core/useDiscovery.ts
export function useDiscovery() {
  const { user } = useAuth()
  return useQuery<DiscoveryDomain[]>({
    queryKey:    ['discovery', user?.id],   // scoped per user — different users never share cache
    queryFn:     async () => { const r = await apiFetch('/discovery'); return r.json() },
    staleTime:   process.env.NODE_ENV === 'production' ? Infinity : 0,
    initialData: [],
    enabled:     !!user,                   // never fetches before auth resolves
  })
}
```

Used by: `Sidebar`, `app/page.tsx`, `app/[domain]/page.tsx`, `AutoBreadcrumb`.

### 4.15.1 Frontend — useFieldOptions

```typescript
// apps/web/src/core/useFieldOptions.ts
export function useFieldOptions(
  field: Pick<MetadataField, 'resource' | 'domain' | 'dependsOn'>,
  dependsOnValue?: string,
  { hasCurrentValue }: { hasCurrentValue?: boolean } = {},
): { options: Record<string, unknown>[]; isLoading: boolean }
```

Fetches options for a `widget: 'select'` field. Used internally by `RelationSelect` inside `FieldRenderer` — custom pages can import it directly when they need the same data.

- When `dependsOn` is set, the query key includes `dependsOnValue` so TanStack Query caches per parent value.
- `hasCurrentValue: true` enables the query even when `dependsOnValue` is empty, fetching all options unfiltered — covers edit mode where the virtual parent field starts unpopulated.
- `staleTime: 30_000` for static relations; `staleTime: 0` for dependent ones.

### 4.16 Route Helpers

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

**Proxy setup** — `apps/web/next.config.js` rewrites `/api/:path*` to the NestJS server:

```js
async rewrites() {
  return [{ source: '/api/:path*', destination: `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001/api'}/:path*` }]
}
```

This means the browser always calls the Next.js host (same origin), and Next.js forwards to NestJS. No hardcoded IP needed for multi-device dev. `API_INTERNAL_URL` can be set in `.env.local` if NestJS runs on a different port or host (e.g., containers). In production, route `/api` directly to NestJS at the infrastructure level (nginx / load balancer) and remove the rewrite.

---

### 4.17 Settings Architecture

Settings resources are singleton configurations managed by a centralised infrastructure. They appear in the sidebar and domain grid like any other resource, but have no list, no create and no delete — only a form page that reads and writes a single record.

#### Storage

A single generic `Settings` table in `core.prisma` stores all settings as JSON keyed by `(key, scope)`:

```prisma
model Settings {
  key       String
  scope     String   @default("global")  // 'global' | branchId
  value     Json
  updatedAt DateTime @updatedAt
  @@id([key, scope])
  @@map("settings")
}
```

`scope: 'global'` = single value for the whole system. `scope: branchId` = one value per branch (per-branch settings).

#### Data Consistency — Lazy Defaults

When `get()` fetches a row, it always applies `schema.parse(row?.value ?? {})` before returning. Zod fills any field that is missing from the stored JSON with the declared `.default()` value. This means:

- Adding a new field with `.default()` requires zero migration — old rows receive the default on the next read.
- Removing a field leaves its value in the JSON column but the app ignores it (Zod strips unknown keys by default).

**Convention:** every field in a settings schema **must** declare a `.default()`. `BaseSettingsService` registers the schema so violations surface immediately at startup as Zod parse errors in dev.

> ⚠️ **Pending review:** destructive changes (field rename, field removal with data migration, or type change) are not handled automatically. A manual migration script is required in these cases. Define a convention for this before the first production deployment with live settings data.

#### BaseSettingsService

```typescript
// apps/api/src/core/base-settings.service.ts
abstract class BaseSettingsService<T> {
  constructor(
    prisma:  PrismaService,
    key:     string,        // 'password-policy' — matches the route segment
    domain:  string,        // 'core'
    schema:  ZodObject<any>,
    scope:   'global' | 'branch' = 'global',
  )

  get(branchId?: string):           Promise<T>   // reads + schema.parse (fills defaults)
  put(dto: unknown, branchId?: string): Promise<T>   // validates + upserts
  getMetadata():                    ResourceMetadata
}
```

The constructor:
1. Mutates `schema._schemaMeta.isSingleton = true` so `metadata.builder` and `discovery` propagate the flag.
2. Pushes to `settingsRegistry` (internal settings list).
3. Pushes to `resourceRegistry` (discovery + sidebar + metadata API).

#### BaseSettingsController

```typescript
// apps/api/src/core/base-settings.controller.ts
abstract class BaseSettingsController<T> {
  @Get('metadata')  getMetadata(): ResourceMetadata
  @Get()            get():         Promise<T>
  @Put()            put(dto):      Promise<T>
}
```

No `findAll`, `findOne`, `create`, `update`, `remove` — settings have no list or identity.

#### Registries

| Registry | File | Populated by |
|---|---|---|
| `resourceRegistry` | `core/resource-registry.ts` | `BaseService` and `BaseSettingsService` constructors |
| `settingsRegistry` | `core/settings-registry.ts` | `BaseSettingsService` constructor only |

#### Frontend — SettingsPanel

`SettingsPanel` (`apps/web/src/core/SettingsPanel.tsx`) is the dedicated template for singleton settings pages. It is **not** AutoForm — it has its own layout and widget set tuned for settings UX.

- Fetches current values via `GET /<domain>/<resource>`
- Renders fields grouped by `meta.groups` as labelled card sections
- Saves via `PUT /<domain>/<resource>` on topbar Save / `alt+g`
- Uses `AutoBreadcrumb` (no `id` — trail ends at the resource label)
- Widget rendering in `SettingsField`:
  - `widget: 'switch'` or `type: 'boolean'` → toggle switch
  - `widget: 'stepper'` or `type: 'number'` → stepper with `min`/`max` from field metadata
  - default → text input

`[domain]/[resource]/page.tsx` delegates to `SettingsPanel` when `meta.isSingleton === true`, using an inner-component pattern to avoid hook-ordering conflicts between the list page and the settings page.

#### Adding a New Settings Resource

Minimum required: **3 files** (schema + service + controller).

**Step 1 — Schema** (`packages/schemas/<domain>/<key>.schema.ts`):
```typescript
export const emailConfigSchema = withMeta(
  z.object({
    fromAddress: z.string().email().default('no-reply@example.com').meta({ label: 'Remetente' }),
    smtpHost:    z.string().default('').meta({ label: 'Servidor SMTP' }),
  }),
  { label: 'Config. de E-mail', labelPlural: 'Config. de E-mail', nameField: 'fromAddress', icon: 'Mail' },
)
export type EmailConfig = z.infer<typeof emailConfigSchema>
```

**Step 2 — Service** (`apps/api/src/modules/<domain>/settings/<key>/<key>.service.ts`):
```typescript
@Injectable()
export class EmailConfigService extends BaseSettingsService<EmailConfig> {
  constructor(prisma: PrismaService) {
    super(prisma, 'email-config', 'core', emailConfigSchema, 'global')
  }
}
```

**Step 3 — Controller + Module**:
```typescript
@Controller('core/email-config')
@UseGuards(JwtAuthGuard)
export class EmailConfigController extends BaseSettingsController<EmailConfig> {
  constructor(service: EmailConfigService) { super(service) }
}
```

Register the module in `SettingsModule` (and export the service if other modules need it).

**Result:** `email-config` appears in the sidebar under Core, has `GET /core/email-config/metadata`, `GET /core/email-config` and `PUT /core/email-config`, and renders via `SettingsPanel` at `/core/email-config` with no extra frontend files.

---

### 4.18 Job Queue — Background Processing

Long-running operations (ERP sync, PDF generation, etc.) run as background jobs tracked in the database. No Redis or external queue — all state lives in the `Job` table.

#### Model

```prisma
// apps/api/prisma/schema/core.prisma
model Job {
  id          String    @id @default(uuid())
  type        String    // e.g. 'employee-sync', 'pdf-report'
  domain      String
  resource    String
  status      JobStatus @default(PENDING)
  createdById String
  startedAt   DateTime?
  completedAt DateTime?
  durationMs  Int?
  input       Json?     // parameters passed to the job
  output      Json?     // structured result: { created, updated, errors, ... }
  outputFile  String?   // path to a generated file (PDF, CSV, etc.)
  errors      Json?     // per-record errors — do not abort the job
  error       String?   // catastrophic error that aborted the process
  createdAt   DateTime  @default(now())
}
enum JobStatus { PENDING RUNNING COMPLETED FAILED }
```

**`errors` vs `error`:** `errors: Json?` collects per-line/per-record failures that don't abort the process (e.g. invalid CPF on line 14). `error: String?` holds the message of a catastrophic exception that stopped execution. A job can finish with `status: COMPLETED` and still have entries in `errors`.

#### JobService — generic infrastructure

`apps/api/src/modules/core/job/job.service.ts` extends `BaseService`. It adds:

```typescript
// Creates a job record and returns it immediately (caller gets the jobId)
createJob(data: { type, domain, resource, createdById, input? }): Promise<Job>

// Fires handler in the background — does NOT await; returns void immediately
run(jobId: string, handler: () => Promise<unknown>): Promise<void>
```

`run` calls `executeAsync` (private) which: marks RUNNING → awaits handler → marks COMPLETED with output, or marks FAILED with error message. Duration is computed automatically.

#### JobController — custom (does not extend BaseController)

`GET /core/job/metadata` — always returns `permissions.create/update/delete: false`; jobs are never created or edited via the API.
`GET /core/job` — delegates to `findAllForUser`: admin sees all, operator sees only their own jobs (`createdById = user.id`).
`GET /core/job/:id` — returns the job if admin or owner; 403 otherwise.

#### Implementing a sync handler

Each domain implements its own handler. The handler owns all business logic — parsing, upsert strategy, and what to do with records absent from the file.

```typescript
// apps/api/src/modules/hr/employee/employee-sync.service.ts
async sync(file: Buffer, userId: string): Promise<{ jobId: string }> {
  const job = await this.jobService.createJob({
    type: 'employee-sync', domain: 'hr', resource: 'employee', createdById: userId,
  })
  // intentional fire-and-forget
  this.jobService.run(job.id, () => this.execute(file))
  return { jobId: job.id }
}

private async execute(file: Buffer) {
  const rows   = parseEmployeeTxt(file)   // format-specific parser
  const errors = []
  // upsert present records; soft-delete absent ones
  return { created, updated, deactivated, errors }
}
```

**ERP sync rule:** the ERP is always the source of truth for synced models. All fields are overwritten on upsert. Records absent from the file receive domain-specific treatment (e.g. `status: INACTIVE` for employees) — this logic is hardcoded per model, not abstracted.

**Identifier field:** each synced model has a natural unique identifier that serves as the upsert key (e.g. `Employee.code` for matricula, `Vehicle.plate` for plate number). No generic `erpCode` field is added — the existing field is used directly.

#### Frontend

The `POST /:domain/:resource/sync` endpoint returns `{ jobId }` with 202 immediately. The caller polls using the `useJobProgress` hook (`apps/web/src/lib/use-job-progress.ts`):

```typescript
const { job, isRunning, isCompleted, isFailed } = useJobProgress(jobId, (j) => {
  // called once when status transitions to COMPLETED or FAILED
  if (j.status === 'COMPLETED') queryClient.invalidateQueries({ queryKey: [domain, resource] })
})
```

`useJobProgress` wraps `useQuery` with `refetchInterval: 2000` while the job is active, stops polling on terminal status, and fires the `onDone` callback exactly once. It accepts `jobId: string | null` — passing `null` disables polling entirely.

**`JobProgressBar`** (`apps/web/src/components/ui/job-progress-bar.tsx`) renders the job state inline on a list page. It shows a spinner while running (or a progress bar when `job.output.progress` is set), a green check on completion, and a red error message on failure. Pass the values returned by `useJobProgress` directly:

```tsx
{(isRunning || isCompleted || isFailed) && (
  <JobProgressBar job={job} isRunning={isRunning} isCompleted={isCompleted} isFailed={isFailed} />
)}
```

Both `useJobProgress` and `JobProgressBar` are also used by `SyncModal` — `SyncModal` calls `useJobProgress(jobId, onDone)` and renders its own progress UI from the same `job` object.

The list page at `/core/job` renders via `AutoList`. The detail page at `/core/job/:id` is a custom read-only page that displays the status badge, timing info, `output` and `errors` as formatted JSON, and a download link when `outputFile` is set.

#### When to consider BullMQ / Redis

The Job Table covers the current needs with zero extra infrastructure. Migrate only if the system requires: exponential backoff retries, cron-scheduled jobs, controlled concurrency (max N parallel), or priority queues. The `Job` table and per-handler pattern remain unchanged in that scenario — only the execution layer changes.

---

### 4.19 File Upload

**Endpoint:** `POST /api/upload/image` (JWT-protected)

- Accepts `multipart/form-data` with a single `file` field
- Validates that the file is an image (`image/*` MIME type); rejects all other types with 400
- 5 MB size limit
- Saves the file to `apps/api/uploads/<folder>/` where `folder` comes from the optional `?folder=` query param (e.g. `hr/employees`); falls back to the root `uploads/` when omitted — **convention: always pass `?folder=<domain>/<resource>s`**
- Returns `{ url: '/api/uploads/<folder>/<uuid>.<ext>' }`

**Static file serving:** `main.ts` configures `NestExpressApplication.useStaticAssets()` with `prefix: '/api/uploads'`, so uploaded files are served at `/api/uploads/<filename>`. The Next.js rewrite proxies `/api/*` to NestJS, making images accessible from the browser at `http://localhost:3000/api/uploads/<filename>` without CORS issues.

**Frontend integration:** `lib/auth.ts` exports `uploadFile(path, formData)` — a bare `fetch` that sends only the `Authorization` header (no `Content-Type`), allowing the browser to set the correct `multipart/form-data` boundary automatically. The `avatar` widget in `FieldRenderer` and `AutoForm`'s submit handler use this function.

**Storage note:** `apps/api/uploads/` is tracked in git via `.gitkeep` but its contents are gitignored. For production, replace local disk storage with an object store (S3, R2, etc.) and update `UploadController` accordingly.

---

## 5. Auth & Permissions

### Authentication Flow

1. `POST /auth/login` — validates credentials, returns JWT
2. JWT payload: `{ sub: userId, username, role: UserRole, branchIds: string[] }`
3. All protected routes use `JwtAuthGuard` (validates token, attaches user to request)
4. `PoliciesGuard` checks CASL abilities after `JwtAuthGuard`

**Self-service endpoints** (require only a valid JWT, no resource-level permission):

| Endpoint | Description |
|---|---|
| `GET /auth/me` | Returns `{ id, name, username, role, branchIds, preferences, forcePasswordChange }` for the logged-in user |
| `PATCH /auth/me/preferences` | Merges the request body into `User.preferences` (Json) |

### Frontend — AuthProvider and useAuth

`AuthProvider` (`apps/web/src/lib/auth-context.tsx`) wraps the app inside `QueryClientProvider`. It:

- Fetches `GET /auth/me` once on mount (when a token exists); `staleTime: 300_000`
- Applies the user's `theme` preference as a CSS class on `<html>` (e.g. `theme-lavender`) whenever `user.preferences.theme` changes
- Redirects to `/core/user/password` (via `router.replace`) when `user.forcePasswordChange` is true and the current path is not already that page
- Exposes `useAuth()` → `{ user: CurrentUser | null, updatePreferences(patch) }`
- `updatePreferences` does an optimistic cache update first, then `PATCH /auth/me/preferences`

**JWT intentionally stays lean** — it carries only security-relevant claims (`sub`, `role`, `branchIds`). `name`, `preferences` and `forcePasswordChange` are fetched separately via `/auth/me` to avoid stale data after updates.

**Cache invalidation:**
- Login page — calls `queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })` after `login()` so the incoming user's data is always fetched fresh, regardless of who was logged in before.
- Logout — calls `queryClient.clear()` to wipe all cached queries before redirecting to `/login`.
- Password change page — calls `queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })` after a successful change so `forcePasswordChange: false` is reflected immediately.

> **TanStack Query note:** do **not** use `initialData` on the `['auth', 'me']` query. With `staleTime > 0`, `initialData` is treated as fresh for the full `staleTime` window, preventing the initial fetch entirely.

### Authorization — CASL

Abilities are built per-request by `CaslAbilityFactory` based on the user's `role` and explicit `UserPermission` rows.

**Model: deny-by-default + explicit grants**

| Role | Access |
|------|--------|
| `admin` | `can('manage', 'all')` — full access, no restrictions |
| `operator` | Deny-by-default — only what `UserPermission` rows explicitly grant |

`UserPermission { userId, resource, action }` stores individual grants (e.g. `{ resource: 'user', action: 'read' }`). The `resource` field uses the lowercase resource key; `CaslAbilityFactory` capitalizes it to match the CASL subject convention (`'user'` → `'User'`).

A user with no `UserPermission` rows sees an empty sidebar and receives `403 Forbidden` on any data endpoint. Self-service endpoints (`GET /auth/me`, `PATCH /auth/me/preferences`, `PATCH /core/user/:id/change-password`) are exempt — they require only a valid JWT.

### Permission Inheritance

Child resources declared via `breadcrumb` automatically inherit permissions from their parent. Granting any action on a parent resource implicitly grants the same action on all descendants — recursively, across any number of levels.

**Default behavior (auto-inherit):**
```typescript
// Granting company.read also grants branch.read (direct child)
// and any of branch's non-private children transitively
{ resource: 'company', action: 'read' }  →  can('read', 'Company'), can('read', 'Branch'), …
```

**`privatePermissions: true` — opt-out:**
A child resource that requires an explicit, independent grant declares `privatePermissions: true` in `withMeta()`. It is excluded from the inheritance chain entirely and must be granted separately.

```typescript
// packages/schemas/hr/medical-certificate.schema.ts
withMeta(schema, {
  label: 'Medical Certificate',
  privatePermissions: true,  // not inherited from Employee — requires explicit grant
})
```

`privatePermissions: true` resources:
- Do **not** inherit from parent
- Appear in the `GET /discovery` response (so they show up in the `CheckboxGroup` permission UI)
- Do **not** appear in the sidebar navigation

**Implementation — precomputed transitive closure:**

On first use, `CaslAbilityFactory` builds a `Map<string, string[]>` from `resourceRegistry` that maps each parent resource to **all** its descendants (direct and transitive), excluding `privatePermissions` nodes. This is computed once and cached for the lifetime of the process.

```
// Example map (computed at startup, reused on every request)
'company'  → ['branch']
'employee' → ['dependent', 'contract', 'contract-item']  // transitive
'contract' → ['contract-item']
```

Per-request cost: one DB query (fetch `UserPermission` rows) + O(1) map lookups. The registry traversal happens only once at startup.

**Frontend — `visibleChildren` in the detail page:**

Child navigation buttons (topbar + keyboard shortcuts) are filtered before rendering:
- **Regular children** (`!privatePermissions`): always shown — backend guarantees access via inheritance as long as the parent page is accessible
- **`privatePermissions` children**: shown only if the resource appears in the `useDiscovery()` response (meaning the user holds an explicit `read` grant)

The backend re-validates on every API call regardless of what the frontend shows.

### Branch Scoping

When `scopeField` is declared in `BaseService`, `findAll()` automatically filters to the user's assigned branches:

```typescript
// Automatic — declare scopeField in the BaseService constructor
super(prisma, 'order', orderSchema, 'sales', 'branchId')
// findAll applies: { branchId: { in: user.branchIds } } for non-admin roles
```

### forcePasswordChange

`User.forcePasswordChange` (`Boolean @default(false)`) signals that the user must change their password before accessing anything else.

| Operation | Effect on `forcePasswordChange` |
|---|---|
| Admin creates user (`POST /core/user`) | Set to `true` by default (overridable via the form checkbox) |
| Admin resets password (`PATCH /core/user/:id/reset-password`) | Set to `true` |
| User changes own password (`PATCH /core/user/:id/change-password`) | Cleared to `false` |

Password policy validation is **skipped** on user creation — the admin sets a temporary password without constraints. Policy is enforced when the user changes their own password.

### Admin Password Reset

`PATCH /core/user/:id/reset-password` — sets a new password without requiring the current one. Intended for admin use only. Records history identically to `changePassword` and sets `forcePasswordChange: true`.

The self-service flow (`PATCH /core/user/:id/change-password`) requires `currentPassword`, enforces `PasswordPolicy`, and clears `forcePasswordChange`. Exposed via `/core/user/password`.

### AllExceptionsFilter — Response Shape

`exception.filter.ts` wraps all responses inside a consistent envelope. There are two shapes:

**NestJS `HttpException` (e.g. validation, 403, custom throws):**
```json
{
  "statusCode": 400,
  "timestamp": "...",
  "path": "/api/core/user/.../change-password",
  "message": { "statusCode": 400, "message": "Senha atual incorreta", "error": "Bad Request" }
}
```

**Prisma known errors (e.g. unique constraint, foreign key, not found):**
```json
{
  "statusCode": 409,
  "timestamp": "...",
  "path": "/api/core/vehicle-brand",
  "message": { "statusCode": 409, "code": "UNIQUE_VIOLATION", "fields": ["name"], "message": "Unique constraint violation" }
}
```

The filter maps Prisma error codes to HTTP status and a structured `code`:

| Prisma code | HTTP | `code` |
|---|---|---|
| `P2002` | 409 | `UNIQUE_VIOLATION` |
| `P2003` | 409 | `FOREIGN_KEY_VIOLATION` |
| `P2014` | 409 | `RELATION_VIOLATION` |
| `P2025` | 404 | `NOT_FOUND` |

`fields` is extracted from `meta.driverAdapterError.cause.constraint.fields` (LibSQL/SQLite) or `meta.target` (PostgreSQL).

**Frontend — `extractError` + `apiErrorMessages`:**

Never read `json.message` directly. `extractError(json)` in `lib/utils.ts` handles the nesting, detects the `code` field, and resolves it against `apiErrorMessages` in `lib/messages.ts`:

```typescript
// lib/messages.ts — add or override any code here
export const apiErrorMessages: Record<string, string | ((fields: string[]) => string)> = {
  UNIQUE_VIOLATION: (fields) => fields.length
    ? `Unique value required: ${fields.join(', ')}.`
    : 'Unique value required.',
  FOREIGN_KEY_VIOLATION: 'This record is linked to other data and cannot be removed.',
  // ...
}
```

`extractError` falls back to `message.message` (string or joined array) when no `code` match is found.

**Convention:** all pages must call `extractError(await res.json())` on non-ok responses instead of hardcoding error strings — this ensures structured API errors surface correctly everywhere.

### Password Policy

`PasswordPolicy` is a global singleton (single DB row). It governs minimum length, character requirements, history count and expiry. Enforced at password change time.

---

## 6. Data Models

Models are defined in `apps/api/prisma/schema/` using Prisma 7's multi-file schema. One file per domain:

| File | Models |
|------|--------|
| `schema/core.prisma` | `User`, `Company`, `Branch`, `UserBranch`, `UserPermission`, `UserPasswordHistory` |
| `schema/settings.prisma` | `PasswordPolicy` |
| `schema/hr.prisma` | `Employee`, `Contract`, `Department`, `JobTitle` |

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
| `Input` | `components/ui/input.tsx` | size variants: default (`px-3 py-2`), sm (`px-2 py-1.5`); also exports `inputBaseCls` string for elements that can't use the component (IMaskInput, textarea) |
| `Select` | `components/ui/select.tsx` | wraps native `<select>` with built-in `ChevronDown` overlay; same size variants; `wrapperClassName` for outer div sizing; `keybind` prop renders a `KeyHint` badge inside the wrapper to the left of the chevron |
| `Breadcrumb` | `components/ui/breadcrumb.tsx` | segments array, optional dropdown per item |
| `Tabs` | `components/ui/tabs.tsx` | all panels mounted (`hidden` attr); focuses first enabled field on tab change; `TabItem.errorCount?: number` renders a badge on the tab label when the tab has invalid fields — `AutoForm` computes this automatically per group; custom pages pass it manually by counting `errors[field]` for fields in that tab |
| `Dropdown` | `components/ui/dropdown.tsx` | `createPortal` to `document.body` + `getBoundingClientRect()` fixed positioning — escapes `overflow:hidden` containers; configurable `side`, `align`, `sideOffset`; `DropdownItem` accepts `href` (renders `Link`) or `onClick` |
| `AssociationList` | `components/ui/association-list.tsx` | many-to-many with a per-row role select; "+ Add" opens a searchable combobox filtered to unassociated items; items grouped by parent entity when `companies` prop is provided; local state — persists only on topbar Save |
| `CheckboxGroup` | `components/ui/checkbox-group.tsx` | permissions matrix: resources as rows, actions (read/create/update/delete) as columns; section-level select-all / deselect-all toggle; global filter input; local state — persists only on topbar Save |
| `ThemeCard` | `components/ui/theme-card.tsx` | theme selector card with color swatch preview; `selected` state shows checkmark; used in the preferences page |
| `PasswordInput` | `components/ui/password-input.tsx` | `Input` wrapper with Eye/EyeOff toggle; `keybind` prop renders a `KeyHint` badge to the left of the toggle; uses `forwardRef` so `{...register(...)}` from React Hook Form works correctly — any input wrapper that receives RHF spread must use `forwardRef` |
| `Forbidden` | `components/ui/forbidden.tsx` | Rendered by generic pages on 403, `permissions.read` false, or `id === 'new'` with `permissions.create` false |
| `NotFound` | `components/ui/not-found.tsx` | Rendered by generic pages on any non-403 metadata error (e.g. 404 — resource does not exist) |
| `Collapsible` | — | implemented inline with `useState` + CSS transition — no separate component |
| `Toaster` | `components/ui/toast.tsx` | `createPortal` to `document.body`; groups toasts by resolved position; responsive (desktop vs mobile default); enter/exit CSS transition per position direction |

### Dropdown — Portal Architecture

The `Dropdown` component renders its menu into `document.body` via `createPortal`, computing position from the trigger's `getBoundingClientRect()`. This allows it to escape `overflow:hidden` containers (e.g., the sidebar).

Key behaviors:
- `visibility: hidden` until position is computed (prevents flash on first render)
- Viewport boundary correction — clamps to 8px from all edges
- Closes on `pointerdown` outside, `Escape` key, and scroll
- Repositions on window resize
- Props: `side: 'top'|'bottom'|'left'|'right'`, `align: 'start'|'center'|'end'`, `sideOffset` (px gap from trigger, default 0)

Sub-components: `DropdownItem` (supports `destructive`, `disabled`), `DropdownSeparator`, `DropdownLabel`.

### Toast — Notification System

Centralised feedback for system events. Three files:

| File | Role |
|------|------|
| `lib/toast-context.tsx` | `ToastProvider`, `useToast()` hook, types |
| `lib/messages.ts` | Standard message catalog |
| `components/ui/toast.tsx` | `Toaster` renderer |

**`ToastProvider`** is mounted once at the root (`providers.tsx`) with two position defaults:

```tsx
<ToastProvider defaultPosition="bottom-right" defaultPositionMobile="bottom-center">
```

**`useToast()`** exposes four methods — `toast.success()`, `toast.error()`, `toast.info()`, `toast.warning()`. All accept an optional `ToastOptions` object:

```ts
interface ToastOptions {
  autoDismiss?:      boolean   // success/info/warning: true; error: false
  autoDismissDelay?: number    // success/info: 4000ms; warning: 6000ms
  position?:         Position  // overrides provider default for this toast
}

type Position =
  | 'bottom-right' | 'bottom-left'
  | 'top-right'    | 'top-left'
  | 'top-center'   | 'bottom-center'
```

**`lib/messages.ts`** — single source of truth for standard CRUD messages. All pages default to `'Registro'` as the label:

```ts
msgs.created()  // → "Registro criado com sucesso"
msgs.updated()  // → "Registro atualizado com sucesso"
msgs.deleted()  // → "Registro excluído com sucesso"
msgs.saved()    // → "Registro salvo com sucesso"
msgs.error.save()    // → "Erro ao salvar. Tente novamente."
msgs.error.delete()  // → "Erro ao excluir. Tente novamente."
msgs.error.load()    // → "Erro ao carregar dados."
```

Custom pages pass string literals directly to `toast.success()` / `toast.error()`.

**`Toaster`** renders stacks per resolved position via `createPortal`. Uses `useIsMobile()` (`window.matchMedia('(max-width: 768px)')`) to pick between `defaultPosition` and `defaultPositionMobile`. Slide direction of the enter/exit animation matches the position edge (top positions slide down, bottom positions slide up).

**Integration points:**

| Location | Trigger | Message |
|---|---|---|
| `[domain]/[resource]/[id]/page.tsx` | save success | `msgs.created()` or `msgs.updated()` |
| `[domain]/[resource]/[id]/page.tsx` | save error | `msgs.error.save()` |
| `SettingsPanel.tsx` | save success | `msgs.saved()` |
| `SettingsPanel.tsx` | save error | `msgs.error.save()` |
| `core/user/[id]/page.tsx` | save success/error | same pattern |
| `preferences/page.tsx` | save success/error | custom string |
| `password/page.tsx` | success only | custom string (errors stay inline — multi-line policy violations) |
| `AutoList.tsx` — row action `method: DELETE` | success/error | `msgs.deleted()` / `msgs.error.delete()` |
| `AutoList.tsx` — row action other methods | success/error | `msgs.updated()` / `msgs.error.save()` |

---

## 8. Design System

Tokens are defined as HSL custom properties in `globals.css` and registered in the `@theme` block in the same file. Tailwind CSS 4 uses a CSS-first approach — there is no `tailwind.config.ts`. This allows full theme switching by changing a single CSS layer.

Token categories: `background`, `foreground`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar-*`.

All components reference tokens via Tailwind classes (`bg-primary`, `text-foreground`, etc.) — no hardcoded color values.

**CSS variable syntax in Tailwind v4:** use parentheses, not brackets, to reference CSS variables in arbitrary values:
- `rounded-(--radius)` → `border-radius: var(--radius)` ✓
- `rounded-[--radius]` → `border-radius: --radius` (invalid CSS, ignored by browser) ✗

This applies to any property: `bg-(--color)`, `text-(--color)`, etc.

### Accent Themes

The base dark mode defines neutral `--accent`, `--accent-foreground` and `--ring` tokens. Per-user accent themes override only these three tokens via a CSS class on `<html>`:

```css
/* applied by AuthProvider based on user.preferences.theme */
.dark.theme-eucalyptus { --accent: …; --accent-foreground: …; --ring: …; }
.dark.theme-ocean      { … }
.dark.theme-sunset     { … }
.dark.theme-lavender   { … }
.dark.theme-rose       { … }
.dark.theme-slate      { … }
```

`AuthProvider` applies the class via `applyTheme()` whenever `user.preferences.theme` changes. The preferences page provides live preview by applying the class directly while the user selects, reverting on `alt+l` if not saved.

---

## 8.1 User Preferences

Persisted in `User.preferences` (Json column). Read and written via `GET /auth/me` and `PATCH /auth/me/preferences`. Managed in the frontend through `useAuth()`.

| Preference | Type | Default | Effect |
|---|---|---|---|
| `theme` | `ThemeName` | `'eucalyptus'` | Accent color theme — CSS class on `<html>` |
| `sidebarCollapsed` | `boolean` | `false` | Sidebar initial state on page load |
| `dateFormat` | `'DD/MM/YYYY' \| 'MM/DD/YYYY' \| 'YYYY-MM-DD'` | `'DD/MM/YYYY'` | Date display format across the app |

**Schema convention:** every field must have a `.default()` — `AuthProvider` merges `defaultPreferences` with whatever is stored, so adding a new preference field requires no migration.

The preferences page lives at `/core/user/preferences` — a static route that takes priority over the generic `[id]` route. It uses `<form onSubmit>` + `type: 'submit'` in the topbar (same as all other pages) to avoid stale-closure issues with `onClick` handlers.

---

## 9. Keywatch — Keyboard Shortcuts

Shortcuts are declared with `useShortcut()` in any component. The `KeywatchCore` instance (held in `useKeywatch().coreRef`) maintains a registry of all active bindings, their descriptions, icons, groups and display order — used to render the shortcut help overlay.

Key concepts:
- `origin` — identifies the source file (for deduplication across re-renders)
- `context: 'all'` — shortcut is always active; default is active only when no input is focused
- `group` — groups shortcuts in the help overlay
- `display: false` — shortcut is registered but not shown in the overlay

Dynamic bindings (e.g., child navigation buttons from schema metadata) are managed via `core.bind()` / `core.unbindGroup()` in `useEffect`.

**Field keybinds (`Ctrl+Shift+[key]`)** — declared via `.meta({ keybind: 'x' })` in the Zod schema. `AutoForm` registers them automatically on mount. Custom pages must call `useFieldKeybinds()` manually:

```tsx
import { useRef } from 'react'
import { useFieldKeybinds } from '@/lib/keywatch'
import { Tabs, type TabsHandle } from '@/components/ui/tabs'

// With tabs: declare tabsRef, pass it to <Tabs ref={tabsRef}> and to the hook.
// tabIndex is the zero-based index of the tab that contains the field.
const tabsRef = useRef<TabsHandle>(null)

useFieldKeybinds([
  { key: 'g', fieldId: 'name',     tabIndex: 0 },
  { key: 'u', fieldId: 'username', tabIndex: 0 },
], 'core/user/[id]', tabsRef)

// Without tabs (single-form pages): omit tabsRef and tabIndex.
useFieldKeybinds([
  { key: 'g', fieldId: 'name' },
], 'some/page')
```

`fieldId` must match the `id` attribute of the target `<input>`. When `tabIndex` is set and `tabsRef` is provided, the hook switches to the correct tab before focusing — identical to the behaviour `AutoForm` uses internally. The hint badge (`KeyHint`) must be added manually to each control — wrap the input in `div.relative`, set the width constraint on the wrapper (not the input), and render `<KeyHint k="x" />` inside. `Select` and `PasswordInput` accept a `keybind` prop that handles the hint internally. See `docs/architecture/keyboard-shortcuts.md` for the list of reserved browser letters.

### Global shortcut conventions

Every page that holds editable state **must** implement these three shortcuts:

| Shortcut | Action | `context` | `display` |
|---|---|---|---|
| `alt+g` | Save / submit the main form | `'all'` | `true` |
| `alt+v` | Navigate back (list or domain) | `'all'` | `true` |
| `alt+l` | Reset — restore original page state | omit (default) | `false` |

**`alt+l` — reset to original state**

The behavior of `alt+l` differs by page type:

| Context | Behavior |
|---|---|
| Edit page (`[id]/page.tsx`, custom pages, `SettingsPanel`) | Discards pending edits and restores the last server-fetched values via `resetSignal` |
| List page (`AutoList`) | Clears all active filters; no-op when no filters are applied |

Both handlers fire simultaneously — the global one (`GlobalShortcuts`) invalidates queries, the local one acts on the component's own state.

Standard implementation with `resetSignal` (edit pages):

```tsx
const [resetSignal, setResetSignal] = useState(0)

// resets when the signal changes OR when server data arrives
useEffect(() => {
  if (serverValues) reset(serverValues)
}, [serverValues, resetSignal])

useShortcut('alt+l', () => setResetSignal((s) => s + 1), {
  display: false,
  origin:  'component-name',
})
```

**Rule:** every page with editable state must implement `alt+l` — generic pages (`AutoForm` via `[id]/page.tsx`), custom pages (e.g. `core/user/[id]/page.tsx`) and `SettingsPanel`. No exceptions. `AutoList` registers the handler internally.

### Date field shortcuts

Implemented via a single `keydown` listener on `document` in `GlobalShortcuts` (event delegation — zero per-field setup). Fires on any `input[type="date"]` when no modifier key (`Ctrl`/`Meta`/`Alt`) is held:

| Key | Action |
|---|---|
| `t` | Set to today |
| `-` | Subtract one day (if empty, uses today as base) |
| `+` | Add one day (if empty, uses today as base) |

Uses the native `HTMLInputElement.prototype` value setter (resolved inside `useEffect`) to trigger React/RHF's `onChange` properly.

### Global search (`F3`)

`GlobalSearch` (`components/layout/global-search.tsx`) is mounted permanently in `AppLayout`. Renders `null` when closed — no overhead when idle.

- `F3` (registered with `context: 'all'`) toggles open/closed
- Data source: `useDiscovery()` — only resources the user can `read` are shown, no extra fetch
- No query → input only, no results rendered (scales to any number of resources)
- Keyboard nav: `↑↓` moves cursor, `Enter` navigates, `Escape`/`F3` closes
- `pointerDown` on backdrop closes; `stopPropagation` on container prevents accidental close

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
    name: z.string().min(2).meta({ label: 'Name', listVisibility: 'visible' }),
    // ...
    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Product',
    labelPlural: 'Products',
    nameField:   'name',
    icon:        'Package',   // string — resolved by the frontend via icons.ts
    // optional — redirect to a related resource after creation instead of the list
    // afterCreate: '/sales/order-item?orderId={id}',
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