# Keyboard Shortcut Convention

> Normative reference for keyboard shortcuts. Defines the global key map, modifier semantics, and implementation rules. Read this before registering any shortcut via `useShortcut`.

---

## Design Principles

| Principle | Rule |
|-----------|------|
| **Modifier semantics** | Each modifier has a single responsibility. Do not repurpose a modifier group for a different intent. |
| **No conflicts** | Keys listed here are globally reserved. Page-level shortcuts must use `F9–F11` or `Alt+[unassigned]`. |
| **Destructive actions require confirmation** | Any shortcut that triggers an irreversible action (logout, delete, etc.) must gate behind a confirmation dialog before executing. *(Pending: generic confirmation component — do not implement the shortcut without it.)* |
| **Alt bypasses composed input** | Per Keywatch's composed pattern, `Alt+*` shortcuts fire immediately inside form fields. Reserve `Alt` for actions the user should be able to trigger at any time, regardless of focus state. |
| **Default context by default** | Omitting `context` registers the shortcut under `'default'`. This is the correct behavior for most shortcuts — when a modal or overlay pushes a new context, `'default'` shortcuts automatically stop firing, preserving the expected isolation. Use `context: 'all'` only in exceptional cases and with full awareness that it bypasses context isolation (see below). |

---

## Shortcut Groups & Modal Order

Shortcuts are assigned an `order` value that controls grouping and display sequence in the `Alt+K` modal. Groups are a guide — no rule here is enforced at runtime — but consistent placement builds muscle memory across all screens.

| Group | Order range | Intent | Preferred zone | Preferred keys |
|-------|--------------|--------|---------------|----------------|
| **1 — System & Utilities** | `0–3` | Infrastructure that floats above any screen: global search, module menu, notifications, help, logout | Anywhere (global) | `F1–F4`, `Alt+*` |
| **2 — Operations** | `4–6` | Actions on the current record or its hierarchy: save, delete, download, navigate to child resource, navigate back | Topbar + Breadcrumb | `F9–F11`, `Alt+*` |
| **3 — Navigation & Components** | `7–9` | Movement within layout primitives: form field focus, table row navigation, tab switching, sidebar | Main content | `Ctrl+*`, `Alt+*` |
| **4 — General** | `10+` | Page-specific fragments with no natural home in the groups above | Main content | — |

**Ordering within a group:** use the midpoint (`2`, `5`, `8`) when display order is irrelevant. Declare a lower value to appear earlier, a higher value to appear later. Multiple shortcuts may share the same `order` — first-registered wins within a tie.

**`Alt+V` (navigate back)** belongs to Group 2. Although it is rendered inside the breadcrumb component, it moves the user out of the current record — the same semantic intent as saving or navigating to a child resource.

**Reference values for standard actions:**

| Action | Suggested `order` |
|--------|------------------|
| Global search, help, logout | `0–2` |
| Save record | `4` |
| Navigate to child resource | `5` |
| Navigate back (`Alt+V`) | `6` |
| Form field focus (`Ctrl+Shift+*`) | `display: false` — omit `order` |
| Table row / page navigation | `7–8` |
| Tab switching | `9` |

---

## Key Map

### Fn — Context Operations

Global operations tied to system-level features. Always available regardless of page or context.

| Key | Action | Status |
|-----|--------|--------|
| `F1` | Open help module | — |
| `F2` | Show page filters | — |
| `F3` | Focus module search | — |
| `F4` | Open global lookup modal | — |
| `F5` | **Reserved by browser** — do not override | — |
| `F6` | Vacant | — |
| `F7` | Vacant | — |
| `F8` | Vacant | — |
| `F9` | Reserved for page context | — |
| `F10` | Reserved for page context | — |
| `F11` | Reserved for page context | — |
| `F12` | System menu (logout, change password, etc.) | — |

`F9–F11` may be registered by individual pages for page-specific operations. They must be scoped to the page's Keywatch context and unregistered on unmount.

---

### Non-Standard Modifiers — Letter-Key Combinations

Keywatch supports shortcuts that use a regular letter as a pseudo-modifier (e.g. `c+i`, `g+o`). These are declared exactly like standard shortcuts via `useShortcut`:

```tsx
useShortcut('c+i', openInspector, { desc: 'Open inspector', origin: 'InspectorPanel' })
```

**Constraints:**
- These shortcuts follow the composed pattern — they **do not fire when focus is inside a form input**. The keystroke is captured by the input instead.
- Only use on pages or panels that have no focusable form elements (e.g. dashboards, read-only views, map/canvas screens).
- Do not register letter-key combos on pages that contain `<input>`, `<select>`, or `<textarea>` elements.

**Keys `a–z` are not globally reserved** in this convention — they are available for page-level assignment. Avoid single letters as modifiers if they form common words or abbreviations that users might type.

---

### Alt — Page Quick Actions

Fast-access shortcuts for primary page actions. Fire immediately even inside form inputs (see Alt bypass rule above).

| Key | Action | Notes |
|-----|--------|-------|
| `Alt+L` | Refresh current page | Composed: `GlobalShortcuts` calls `invalidateQueries()` (refetch); form pages additionally register a local handler (`display: false`) that increments `resetSignal` on `AutoForm`, resetting fields to the last server-fetched values. Both handlers fire on the same keypress. |
| `Alt+N` | New record | — |
| `Alt+V` | Navigate back (one breadcrumb level) | — |
| `Alt+G` | Save / commit changes | — |
| `Alt+Q` | Log out | ⚠ Requires confirmation dialog before executing |
| `Alt+[` | Previous tab | Registered by `Tabs` when mounted — fires inside inputs |
| `Alt+]` | Next tab | Registered by `Tabs` when mounted — fires inside inputs |

---

### Ctrl — Navigation

Structural navigation shortcuts. Operate on layout primitives (sidebar, table, form fields).

#### General

| Key | Action |
|-----|--------|
| `Ctrl+'` | Toggle sidebar |
| `Ctrl+F1` | Open page-local help |
| `Ctrl+Enter` | Access / open focused item |

#### Table Navigation

| Key | Action |
|-----|--------|
| `Ctrl+ArrowUp` | Previous row |
| `Ctrl+ArrowDown` | Next row |
| `Alt+PageUp` | Previous page |
| `Alt+PageDown` | Next page |

> For page navigation, the modifier has been changed to Alt to avoid conflicts when switching browser tabs.

#### Form Field Navigation

`Ctrl+Shift+[key]` moves focus to the field that declares `keybind: '[key]'` in its schema field meta. The binding is registered automatically by `AutoForm` via Keywatch when the form mounts and fires **even when focus is inside another input** — `Ctrl+Shift+*` with two standard modifiers bypasses Keywatch's composed-input guard by design.

```typescript
// company.schema.ts — example
taxId: z.string().meta({ label: 'CNPJ Raiz', keybind: 'x' }),
// registers Ctrl+Shift+X → focus #taxId while the form is active
```

**Rules:**
- Keys must be a single lowercase letter (`a–z`). Do not use digits or special characters.
- **Do not use the reserved letters below** — they are intercepted by the browser before reaching the app.
- Boolean, switch, checkbox, and radio fields do not receive keybinds (they don't accept focus).
- Bindings are scoped to the form's Keywatch group and unregistered on unmount — no global pollution.
- Only one field per form may declare the same key.
- These shortcuts have `display: false` — they do not appear in the `Alt+K` shortcuts modal.
- Custom pages (that don't use `AutoForm`) must call `useFieldKeybinds()` from `lib/keywatch` manually.

#### Reserved letters — Ctrl+Shift+[key] (Chrome / Edge on Windows)

| Letter | Browser action |
|--------|---------------|
| `B` | Toggle bookmarks bar |
| `I` | Open DevTools |
| `J` | Open Downloads panel |
| `N` | New incognito / private window |
| `R` | Hard reload (bypass cache) |
| `P` | New incognito / private window on Firefox |
| `T` | Reopen last closed tab |
| `W` | Close window |
| `Z` | Redo (some OS/browser combinations) |

**Potentially risky (avoid if alternatives exist):**

| Letter | Risk |
|--------|------|
| `H` | Opens History in Edge (Ctrl+Shift+H); safe in Chrome |
| `M` | Guest profile switcher in some Chrome versions |
| `U` | Unicode input on Linux; safe on Windows |

**Confirmed safe:** `A` `C` `D` `E` `F` `G` `K` `L` `O` `Q` `S` `U` `V` `X` `Y`

---
### Standard combinations

| Letter | Role |
|--------|---------------|
| `C` | Code, unique identifier |
| `G` | Name, main descriptive identifier |


---

### Schema-Driven Child Resource Shortcuts

Child resource links declared in a schema's `children[]` array can optionally bind a keyboard shortcut via `keybind`:

```typescript
// company.schema.ts
children: [
  { resource: 'branch', domain: 'core', label: 'Filiais', contextField: 'companyId', keybind: 'f9' },
]
```

`[id]/page.tsx` reads `meta.children` and automatically registers each entry that declares `keybind` via `core.bind()`. The shortcut navigates to `/{domain}/{resource}?{contextField}={id}`.

**Defaults applied automatically:**
- `desc` — `child.label`
- `icon` — `LayoutList`
- `context` — `'default'`
- `order` — `'4'`

**Key assignment rules:**
- Use `F9–F11` (reserved for page context per the Fn key map).
- Alternatively, use an unassigned `Alt+*` key if the resource deserves a globally memorable binding.
- Do not use `Ctrl+Shift+*` — that modifier group is reserved for form field focus.

---

## Context: `'default'` vs `'all'`

Keywatch maintains a context stack. When a modal or overlay mounts, it pushes its own context (e.g. `'modal'`) via `useShortcutContext`. Shortcuts registered under `'default'` stop responding until that context is popped — this is the intended isolation mechanism.

```
Page mounts   → active context: 'default'   → alt+n fires ✓
Modal opens   → active context: 'modal'     → alt+n silent ✓
Modal closes  → active context: 'default'   → alt+n fires ✓
```

`context: 'all'` bypasses this stack entirely — the shortcut fires regardless of what context is active. This breaks modal isolation: `alt+n` would trigger a new record navigation even while a confirmation dialog is open.

**Rule:** omit `context` (defaults to `'default'`) for all shortcuts. Only set `context: 'all'` for actions that are explicitly designed to work across every context — and document why at the call site.

---

## Origin Convention

The `origin` field is a developer-facing trace string shown in the Alt+K shortcuts modal. It must be the **full workspace-relative file path without extension**, matching the file that registers the shortcut:

```tsx
useShortcut('alt+n', handler, {
  desc:   'Novo registro',
  origin: 'apps/web/src/core/AutoList',   // ✓
  // origin: 'AutoList',                  // ✗ too short — not traceable
  // origin: 'List page',                 // ✗ prose — not a path
})
```

**Rules:**
- Use the path from the workspace root, no leading slash, no `.tsx`/`.ts` extension.
- For dynamic routes, use the literal directory name: `apps/web/src/app/[domain]/[resource]/page`.
- `origin` is a diagnostic string for developers. In production, consider hiding it from non-admin users in the shortcuts modal render.

---

## Implementation Checklist

When registering a shortcut via `useShortcut`:

- [ ] Verify the key is not reserved in this document
- [ ] Omit `context` (defaults to `'default'`) unless there is an explicit reason to use `'all'` — document why at the call site if so
- [ ] Set `desc`, `icon`, and `origin` (full file path, no extension)
- [ ] For destructive shortcuts: gate behind confirmation *(pending generic component)*
- [ ] For page-scoped shortcuts (`F9–F11`): use `useShortcutContext` to push/restore context on mount/unmount
