# Nyx — Contexto para IA

Referência completa: `docs/architecture/ARCHITECTURE.md`

---

## Stack

| Camada | Tech |
|--------|------|
| Backend | NestJS + Prisma 7 (multi-file schema) + Zod |
| Frontend | Next.js App Router + TanStack Query + React Hook Form + Tailwind CSS |
| DB dev | SQLite via LibSQL adapter |
| DB prod | PostgreSQL |
| Monorepo | pnpm workspaces — `apps/api`, `apps/web`, `packages/schemas`, `packages/types` |

---

## Princípio central

**Zod schema = fonte única de verdade.** Um schema em `packages/schemas/<domain>/<resource>.schema.ts` define tipos do banco, validação da API, campos do form, metadados de UI e navegação. Nada mais precisa ser editado para um CRUD básico.

---

## Adicionar um resource — 4 arquivos

1. `packages/schemas/<domain>/<resource>.schema.ts` — schema Zod com `withMeta()`
2. `apps/api/prisma/schema/<domain>.prisma` — modelo Prisma + `pnpm db:migrate`
3. `apps/api/src/modules/<domain>/<resource>/<resource>.service.ts` — estende `BaseService`
4. Controller + Module — estende `BaseController`, registra no módulo pai

Resultado: resource aparece no sidebar, breadcrumb e discovery automaticamente. Zero edições em arquivos de config.

---

## Padrões obrigatórios

**Schema**
- `withMeta(schema, { label, labelPlural, nameField, icon })` — metadados do resource
- `.meta({ label, widget, filter, listVisibility, showInForm, ... })` — metadados do campo
- Recursos filhos declaram `breadcrumb: [{ resource, contextField, nameField, keybind }]` no próprio schema — o pai descobre automaticamente
- Campo com `breadcrumb` = filho → não aparece no sidebar nem no discovery

**Backend**
- `BaseService` constructor: `super(prisma, 'modelName', schema, 'domain', 'scopeField?')`
- `scopeField` ativa branch scoping automático em `findAll()` para não-admins
- Settings resources: estender `BaseSettingsService` / `BaseSettingsController` (singleton — sem lista, create ou delete)
- `AllExceptionsFilter` envolve erros em `{ message: { statusCode, message, error } }` — no frontend usar `extractError()` para lidar com string | string[]

**Frontend**
- Sem Radix UI ou libs de primitivos externos — todos os componentes são hand-rolled em TypeScript + Tailwind
- Sem imports diretos do Lucide em componentes — usar `resolveIcon()` de `lib/icons.ts`
- Novos ícones: importar em `icons.ts` e adicionar ao map `Icons`
- `apiFetch()` de `lib/auth.ts` para todas as chamadas autenticadas
- API calls vão para `/api/...` (relativo) — o Next.js proxeia para o NestJS via rewrite em `next.config.js`

**Shortcuts — toda página editável deve ter os três**
| Shortcut | Ação |
|---|---|
| `alt+g` | Salvar / submit do form principal |
| `alt+v` | Voltar |
| `alt+l` | Resetar ao estado do servidor (`display: false`) |

Omitir `context` — a lib aplica o default. `context: 'all'` é reservado para atalhos que precisam disparar mesmo com input focado; o único exemplo atual é abrir/fechar o sidebar.

**Topbar** — ações declaradas via `useTopbarActions()`. Botão primário de salvar usa `type: 'submit'` + `form: FORM_ID`.

---

## Auth

- JWT lean: `{ sub, username, role, branchIds }` — sem dados de usuário
- `GET /auth/me` retorna `{ id, name, username, role, branchIds, preferences, forcePasswordChange }`
- `AuthProvider` busca `/auth/me` uma vez no mount (`staleTime: 300_000`)
- **Não usar `initialData`** na query `['auth', 'me']` — com `staleTime > 0` impede o fetch inicial
- Login → `queryClient.invalidateQueries(['auth', 'me'])` imediatamente após
- Logout → `queryClient.clear()` antes de redirecionar para `/login`

**forcePasswordChange**
- Setado `true` ao criar usuário (padrão) e ao admin resetar senha
- `AuthProvider` redireciona para `/core/user/password` enquanto for `true`
- `changePassword` limpa o flag; após sucesso invalidar `['auth', 'me']`
- Criação de usuário **não** valida política de senha — senha temporária livre

---

## Páginas customizadas vs genéricas

- Rota estática (`app/core/user/[id]/page.tsx`) tem prioridade sobre a dinâmica (`app/[domain]/[resource]/[id]/page.tsx`)
- Páginas custom mantêm: `useTopbarActions`, `FORM_ID`, `AutoBreadcrumb`, shortcuts `alt+g/v/l`
- Páginas standalone (preferences, password): usam `<Breadcrumb>` direto com segmentos customizados; `alt+v` vai para `/`

---

## Não fazer

- Não adicionar features, abstrações ou error handling além do necessário para a tarefa
- Não commitar sem o usuário pedir explicitamente
- Não usar `app.listen(port)` com IP fixo — o proxy do Next.js elimina essa necessidade em dev
- Em produção: rotear `/api` via nginx/load balancer e remover o rewrite do `next.config.js`
- Não proteger rotas `/api/*` no middleware Next.js — o NestJS tem seus próprios guards
