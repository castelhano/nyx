# Pending Features

> Implementation backlog. Each section describes what to build and the relevant design decisions. Read before implementing.

---

## 1. User Screens

### 1.1 User list (`/core/user`)
- [ ] Custom page `app/core/user/page.tsx` replacing generic `AutoList`
- [ ] Toolbar filters: by company, by branch (dependent on company), by role, by status
- [ ] Extra column: "Branches" badge showing count of associated branches
- [ ] Row action: "Copy permissions" — opens user-selection modal (see 1.6)

### 1.2 User form — tabbed layout
- [x] Custom page `app/core/user/[id]/page.tsx` with three tabs: **Dados**, **Filiais**, **Permissões**
- [x] **Data tab:** user fields (excluding `passwordHash`, `preferences`, `lastLoginAt`)
- [x] **Password block (conditional):** on create — required password + confirm with real-time policy indicator; on edit — collapsed "Redefinir senha" block (admin flow: new + confirm only, via `PATCH /core/user/:id/reset-password` — no current password required)
- [x] Real-time `PasswordPolicy` criteria indicator below the new password field (fetch `GET /core/password-policy`)

### 1.3 `AssociationList` component
- [x] Location: `apps/web/src/components/ui/association-list.tsx`
- [x] Lists associated items with role select (`member` / `manager` / `owner`) and remove button per row; items grouped by parent company with a text divider
- [x] "+ Add" button opens a searchable combobox of available (not yet associated) items, also grouped by company
- [x] Local state — persists only on topbar Save

### 1.4 `CheckboxGroup` component
- [x] Location: `apps/web/src/components/ui/checkbox-group.tsx`
- [x] Groups with "Marcar todos" / "Desmarcar todos" per section (static headers — not collapsible)
- [x] Global filter input at the top
- [x] Desktop: table layout (resources as rows, actions as columns)
- [ ] Mobile: accordion layout — pending
- [x] Local state — persists only on Save

### 1.5 Permission Templates
- [ ] `PermissionGroup` Prisma model: `id`, `name` (unique), `description`, `permissions` (Json)
- [ ] "Apply group" dropdown in user Permissions tab — copies permissions into `UserPermission` (no FK — changes to the group do not affect already-configured users)
- [ ] "Save as group" button — names and saves current permissions as a new template
- [ ] Management screen `/core/permission-group` (CRUD or embedded `CheckboxGroup`)

### 1.6 Copy permissions between users
- [x] Done

---

## 2. Password Policy Screen (`/core/password-policy`)
- [ ] Singleton form (no list) — `app/core/password-policy/page.tsx`
- [ ] Numeric inputs with stepper for `minLength`, `historyCount`, `expiresInDays`
- [ ] Switches for `requireUppercase`, `requireNumbers`, `requireSpecial`
- [ ] Real-time policy preview panel showing active criteria with icons
- [ ] Remove from sidebar — accessible only via settings menu

---

## 3. Login Screen

- [x] Login page refactored — card layout, pt-BR labels, `--card`/`--border`/`--input` tokens
- [x] "Stay logged in" checkbox (default: checked) — `localStorage` + 7-day cookie when checked, `sessionStorage` + session cookie when unchecked (`apps/web/src/lib/auth.ts`)
- [ ] Split layout — left branding panel, right form (desktop only)
- [ ] JWT `expiresIn` driven by `PasswordPolicy.expiresInDays` when > 0

### 3.1 Password recovery
- [ ] "Forgot password" link → `/login/forgot-password` (email/username input)
- [ ] `PasswordResetToken` Prisma model: `userId`, `token` (unique), `expiresAt`, `usedAt`
- [ ] `POST /auth/forgot-password` — generates token, sends email; always returns 200
- [ ] `POST /auth/reset-password` — validates token, applies `PasswordPolicy.validate()`, marks token used
- [ ] Password reset screen `/login/reset-password?token=xxx` with real-time criteria indicator

### 3.2 Email service
- [ ] `EmailModule` + `EmailService` wrapping configurable SMTP provider
- [ ] Dev: `nodemailer` with `ethereal.email`; prod: `SMTP_*` env vars
- [ ] Password reset HTML email template

---

## 4. User Preferences (`/core/user/preferences`)
- [ ] Persisted in `User.preferences` (Json) via `PATCH /core/user/:id`
- [ ] Visual theme selector — cards with color preview, not a `<select>`
- [ ] Themes: `eucalyptus` (existing), `ocean`, `sunset`, `lavender`, `rose`, `slate` — each defines only `--accent`, `--accent-foreground`, `--ring`
- [ ] Additional preferences: `sidebarCollapsed`, `tablePageSize`, `dateFormat`, `defaultBranchId`, `timezone`, `notificationsEnabled`

---

## 5. PIN Login — Scheduling Module (Future)
- [ ] Extend `UserRole` with `driver`; add `pin` (bcrypt hash) and `loginMode` to `User`
- [ ] `PinPolicy` singleton model: `minLength`, `maxLength`, `expiresInDays`
- [ ] `POST /auth/login/pin` endpoint; CASL branch for `driver` role (read own schedule only)
- [ ] Separate frontend portal `/driver` — numeric PIN keyboard, schedule view, auto-logout on inactivity
- [ ] "PIN" tab in user form when `role = driver`

---

## 6. Additional Items

- [ ] **Audit log** — `AuditLog` model (`userId`, `action`, `resource`, `resourceId`, `before`, `after`); hook into `BaseService` or NestJS interceptor; initially only for critical resources (User, PasswordPolicy)
- [ ] **Rate limiting on login** — `@nestjs/throttler`, 10 attempts / 60 s per IP on `POST /auth/login`
- [ ] **Refresh token** — short-lived access JWT (15 min) + opaque refresh token in `httpOnly` cookie (30 d); `RefreshToken` model for revocation; `POST /auth/refresh`
- [ ] **Unique email check in frontend** — debounced `GET /core/user?email=xxx` before submit
- [ ] **User avatar** — `avatarUrl` field, `POST /core/user/:id/avatar` upload endpoint, shown in topbar and user list
- [ ] **Active branch context** — branch selector in topbar (persisted in `preferences.defaultBranchId`); passed as `X-Branch-Id` header; `BaseService.findAll()` applies branch scope filter


## TODO:
- [ ] **CSV export** — Ajustar separador para ; UTF-8 + boom (caracteres especiais e separador para excel)
- [ ] **Controles de filtro** — alt+l deve limpar os filtros (caso filtrado tabela)