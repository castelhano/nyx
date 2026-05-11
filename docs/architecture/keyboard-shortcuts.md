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
| `Ctrl+PageUp` | Previous page |
| `Ctrl+PageDown` | Next page |

#### Form Field Navigation

`Ctrl+Shift+[key]` moves focus to the field that declares `keybind: '[key]'` in its schema field meta. The binding is registered automatically by `AutoForm` via Keywatch when the form mounts and fires **even when focus is inside another input** — `Ctrl+Shift+*` with two standard modifiers bypasses Keywatch's composed-input guard by design.

```typescript
// company.schema.ts — example
taxId: z.string().meta({ label: 'CNPJ Raiz', keybind: 'j' }),
// registers Ctrl+Shift+J → focus #taxId while the form is active
```

**Rules:**
- Keys must be a single lowercase letter (`a–z`). Do not use digits or special characters.
- Avoid `z` (redo in some browsers) and letters used by browser DevTools shortcuts.
- Bindings are scoped to the form's Keywatch group and unregistered on unmount — no global pollution.
- Only one field per form may declare the same key.
- These shortcuts have `display: false` — they do not appear in the `Alt+K` shortcuts modal.

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
