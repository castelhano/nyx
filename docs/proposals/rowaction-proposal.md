# Row Actions — Design Proposal

> Extends `AutoList` with per-row contextual actions declared in the Zod schema,
> serialised through the existing metadata API, permission-gated via `metadata.permissions`,
> and rendered using the existing `Dropdown` component.
> Zero new infrastructure required.

---

## Table of contents

1. [Goals](#1-goals)
2. [Design principles](#2-design-principles)
3. [Type definitions](#3-type-definitions)
4. [Schema declaration](#4-schema-declaration)
5. [Metadata builder changes](#5-metadata-builder-changes)
6. [Frontend — `RowActionsCell` component](#6-frontend--rowactionscell-component)
7. [Frontend — `AutoList` integration](#7-frontend--autolist-integration)
8. [Execution model](#8-execution-model)
9. [Permission evaluation](#9-permission-evaluation)
10. [Custom pages](#10-custom-pages)
11. [Adding a row action — checklist](#11-adding-a-row-action--checklist)
12. [Non-goals](#12-non-goals)

---

## 1. Goals

| Goal | Description |
|------|-------------|
| **Schema-driven** | Row actions declared once in `withMeta`, alongside every other resource-level option |
| **Zero extra files** | No action registry, no config file — declaration lives in the schema |
| **Declarative mutations** | Simple API calls (PATCH, POST, DELETE) declared in the schema and executed by `AutoList` automatically — no custom page required |
| **Permission-aware** | Each action maps to `'create' \| 'read' \| 'update' \| 'delete'`, evaluated against the `metadata.permissions` object already present in the metadata response |
| **Consistent rendering** | Uses the existing `Dropdown` component and `rowAction` button variant |
| **Escape hatch** | `onAction` prop for logic that cannot be expressed declaratively (multi-endpoint, dynamic body, conditional redirects) |

---

## 2. Design principles

- **Convention over configuration** — the schema is the single source of truth.
- **Three execution paths, strictly separated:**
  - `hrefTemplate` — navigation, handled by `AutoList` via `router.push`
  - `method + endpointTemplate` — declarative mutation, handled by `AutoList` via `apiFetch` + cache invalidation
  - `onAction` — escape hatch, handled by the parent page component
- **Permission via `metadata.permissions`** — reuses the boolean map already in the metadata response. No need for the full CASL `AppAbility` instance on the frontend.
- **Groups, not separator flags** — separators emerge from group boundaries, not from a `separator` property on individual actions.
- **`RowActionsCell` is pure rendering** — it receives filtered actions and a callback; it has no knowledge of routing, API, or permissions.

---

## 3. Type definitions

### `packages/types/index.ts`

```ts
export interface RowActionDef {
  /** Unique identifier used in onAction callbacks. */
  action: string

  /** Display label shown in the dropdown or inline button. */
  label: string

  /**
   * Lucide icon name resolved via resolveIcon() in the frontend.
   * Must be present in apps/web/src/lib/icons.ts.
   */
  icon: string

  /** @default 'default' */
  variant?: 'default' | 'destructive'

  /**
   * Groups actions for separator rendering.
   * A DropdownSeparator is inserted between adjacent actions whose group values differ.
   * Actions without a group are treated as a single unnamed group.
   */
  group?: string

  /**
   * Maps to the matching key in ResourceMetadata.permissions.
   * Evaluated on the frontend; backend re-validates on the actual API call.
   */
  permission: 'create' | 'read' | 'update' | 'delete'

  // ── Execution — exactly one path ──────────────────────────────────────────

  /**
   * Navigation target. Placeholders use the row's field names wrapped in braces.
   * Example: '/core/user/{id}/reset-password'
   * AutoList resolves placeholders and calls router.push().
   */
  hrefTemplate?: string

  /**
   * HTTP method for a declarative mutation.
   * Used together with endpointTemplate.
   * AutoList calls apiFetch and invalidates the query cache automatically.
   */
  method?: 'POST' | 'PATCH' | 'DELETE'

  /**
   * API endpoint template. Placeholders use the row's field names wrapped in braces.
   * Example: '/core/company/{id}'
   */
  endpointTemplate?: string

  /**
   * Static request body sent with the mutation.
   * For dynamic bodies, use the onAction escape hatch.
   */
  body?: Record<string, unknown>
}

// Added to ResourceMetadata:
// rowActions?: RowActionDef[]
```

### `packages/schemas/with-meta.ts` (schema-level input type)

```ts
export type RowActionInput = Omit<RowActionDef, 'hrefTemplate' | 'endpointTemplate'> & {
  /**
   * Typed navigation function — converted to hrefTemplate by the metadata builder.
   * Must be a simple template (no conditional logic); the builder resolves it with a Proxy.
   * Example: (row) => `/core/company/${row.id}`
   */
  href?: (row: Record<string, unknown>) => string

  /**
   * Typed endpoint function — converted to endpointTemplate by the metadata builder.
   * Same constraint as href: simple template only.
   * Example: (row) => `/core/company/${row.id}`
   */
  endpoint?: (row: Record<string, unknown>) => string
}
```

> **Proxy constraint:** `href` and `endpoint` are called with a Proxy that intercepts every
> field access and returns `'{fieldName}'`. Functions with conditional logic (e.g.,
> `row.active ? '/a' : '/b'`) produce incorrect templates silently. Keep these functions
> as simple string templates. For conditional logic, use the `onAction` escape hatch.

---

## 4. Schema declaration

```ts
// packages/schemas/core/company.schema.ts
export const companySchema = withMeta(
  z.object({ ... }),
  {
    label:       'Empresa',
    labelPlural: 'Empresas',
    nameField:   'legalName',
    icon:        'Building',

    rowActions: [
      {
        action:     'viewBranches',
        label:      'Ver filiais',
        icon:       'GitBranch',
        group:      'nav',
        permission: 'read',
        href:       (row) => `/core/branch?companyId=${row.id}`,
      },
      {
        action:     'deactivate',
        label:      'Desativar',
        icon:       'Ban',
        group:      'danger',
        variant:    'destructive',
        permission: 'update',
        method:     'PATCH',
        endpoint:   (row) => `/core/company/${row.id}`,
        body:       { isActive: false },
      },
    ],
  }
)
```

### Rules

- `action` must be unique within a resource's `rowActions` array.
- `icon` must be registered in `apps/web/src/lib/icons.ts`.
- Exactly one execution path per action: `href`, or `method + endpoint`, or neither (dispatches via `onAction`).
- `group` controls separator placement — a `DropdownSeparator` is inserted between adjacent actions with different group values.
- Actions without a group are treated as one implicit group; separators only appear at group boundaries.

---

## 5. Metadata builder changes

### `apps/api/src/core/metadata.builder.ts`

```ts
function extractTemplate(fn: (row: any) => string): string {
  const proxy = new Proxy({}, { get: (_, key) => `{${String(key)}}` })
  return fn(proxy)
  // (row) => `/core/company/${row.id}` → '/core/company/{id}'
}

function serializeRowActions(actions: RowActionInput[] | undefined): RowActionDef[] | undefined {
  if (!actions?.length) return undefined
  return actions.map(({ href, endpoint, ...rest }) => ({
    ...rest,
    ...(href     ? { hrefTemplate:     extractTemplate(href) }     : {}),
    ...(endpoint ? { endpointTemplate: extractTemplate(endpoint) } : {}),
  }))
}
```

Called in `buildMetadata`:

```ts
const rowActions = serializeRowActions(schemaMeta.rowActions)

return {
  ...existingFields,
  ...(rowActions ? { rowActions } : {}),
}
```

The `href`/`endpoint` functions never leave the backend — they are serialised to plain strings safe for JSON transport.

---

## 6. Frontend — `RowActionsCell` component

`apps/web/src/core/RowActionsCell.tsx`

**Responsibilities:** render the correct control based on the number of visible actions; call `onExecute` on interaction.

**No hooks** — pure rendering component.

```
Visible actions | Rendering
0               | null (AutoList omits the column header too)
1               | Inline <Button variant="rowAction"> with icon + label
2+              | <Button> with <MoreHorizontal> opening the existing portal Dropdown
```

**Group separator logic:** actions with the same adjacent `group` are rendered contiguously; a `DropdownSeparator` is inserted at every group boundary.

---

## 7. Frontend — `AutoList` integration

### New prop

```ts
interface Props {
  domain:    string
  resource:  string
  onEdit?:   (id: string) => void
  onAction?: (action: string, row: Record<string, unknown>) => void | Promise<void>
  filters?:  Record<string, string>
}
```

### Permission filtering

```ts
// Inside AutoList — no AppAbility needed
const visibleRowActions = (meta.rowActions ?? [])
  .filter(a => meta.permissions[a.permission])
```

### Column placement

The `_rowActions` column is inserted after all data columns and before the existing `_actions` (edit) column.

```
[data columns] [row actions] [edit button]
```

When `visibleRowActions` is empty, the column is not added and the header is not rendered.

---

## 8. Execution model

`AutoList` resolves every action internally. The `onAction` prop is only called when no declarative path is declared.

```
AutoList.handleRowAction(action, row)
│
├── action.hrefTemplate
│     └── router.push(resolveTemplate(hrefTemplate, row))
│
├── action.method + action.endpointTemplate
│     └── apiFetch(resolveTemplate(endpointTemplate, row), { method, body })
│           └── queryClient.invalidateQueries({ queryKey: [domain, resource] })
│
└── neither
      └── onAction?.(action.action, row)   ← escape hatch
```

`resolveTemplate` replaces `{fieldName}` placeholders with the corresponding values from the row object.

---

## 9. Permission evaluation

Permission is evaluated on two layers:

| Layer | Mechanism |
|---|---|
| **Frontend (UI gate)** | `metadata.permissions[action.permission]` — filters out invisible actions before rendering |
| **Backend (enforcement)** | `PoliciesGuard` + CASL ability on the actual API call |

The frontend check is UI-only. The backend enforces access control on every request regardless of what the frontend renders.

`metadata.permissions` is already computed per-user by the backend and cached per-session by TanStack Query — no additional request needed.

---

## 10. Custom pages

A custom list page is only needed when `onAction` is required (logic not expressible declaratively). It wraps `AutoList` identically to the generic page and adds only the `onAction` handler:

```tsx
// app/core/company/page.tsx
export default function CompanyListPage() {
  const router = useRouter()

  return (
    <AutoList
      domain="core"
      resource="company"
      onEdit={(id) => router.push(`/core/company/${id}`)}
      onAction={async (action, row) => {
        if (action === 'sendInvite') {
          await apiFetch(`/core/company/${row.id}/invite`, { method: 'POST' })
          // toast, conditional redirect, etc.
        }
      }}
    />
  )
}
```

`AutoList` continues to handle all table logic. The custom page adds only what cannot be declared in the schema.

---

## 11. Adding a row action — checklist

Standard case (`hrefTemplate` or `method + endpoint`): **one file**.

- [ ] Add entry to `rowActions` in `withMeta` (`packages/schemas/<domain>/<resource>.schema.ts`)
- [ ] Ensure the icon is registered in `apps/web/src/lib/icons.ts`
- [ ] If `method + endpoint`: ensure the backend endpoint and `PoliciesGuard` rule exist
- [ ] If `href`: ensure the target route exists

**No changes required to:** metadata builder, `AutoList`, `RowActionsCell`, sidebar, breadcrumb, or discovery.

Escape hatch case (`onAction`):

- [ ] Above steps, plus: create a custom list page that passes `onAction` to `AutoList`

---

## 12. Non-goals

| Out of scope | Rationale |
|---|---|
| Bulk actions | Different UX pattern; separate proposal |
| Server-side permission filtering in metadata | `metadata.permissions` is per-user and cached — frontend filtering is sufficient for UI gating |
| Built-in confirmation dialogs | Pages that need confirmation add it in `onAction`; keeps `RowActionsCell` generic |
| Dynamic request bodies | Use `onAction` — static `body` covers the common case |
| Action ordering beyond declaration order | Declaration order is render order |
