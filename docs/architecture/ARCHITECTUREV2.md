# ERP Architecture Reference — V2

> Authoritative reference for the system architecture. Supersedes `ARCHITECTURE.md`. For the migration checklist from V1 to V2, see `docs/proposals/arquitecture_v2_migrate.md`. For naming conventions and new-resource checklists, see `conventions.md`.

---

## 1. Goals

| Goal | Description |
|------|-------------|
| **Zero manual registry** | Adding a resource requires zero edits outside its own files — sidebar, breadcrumb and discovery update automatically |
| **Convention over configuration** | Defaults applied automatically; explicit config only when deviating |
| **Maximum automation** | Prisma model + Zod schema + `BaseService` → full CRUD with validated API, metadata endpoint and auto-rendered UI |
| **Single source of truth** | Zod schema is the sole authority for DB types, API validation, UI forms, metadata and navigation |
| **Scalable by default** | PostgreSQL as production target; branch scoping built into the base layer |

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
│   │           │   ├── core.module.ts      # @Domain({ label: 'Controle', icon: 'Shield' })
│   │           │   ├── user/
│   │           │   ├── company/
│   │           │   ├── branch/
│   │           │   ├── user-permission/
│   │           │   └── user-branch/
│   │           └── settings/
│   │               ├── settings.module.ts  # @Domain({ label: 'Configurações', icon: 'Settings' })
│   │               └── password-policy/
│   └── web/                        # Next.js frontend
│       └── src/
│           ├── lib/
│           │   ├── icons.ts        # Mapa string → LucideIcon (único lugar com imports do Lucide)
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
│           │       └── tabs.tsx
│           ├── core/               # Shared frontend infrastructure
│           │   ├── AutoForm.tsx
│           │   ├── AutoList.tsx
│           │   ├── AutoBreadcrumb.tsx
│           │   ├── FieldRenderer.tsx
│           │   ├── useMetadata.ts
│           │   └── useDiscovery.ts  # Hook para GET /discovery — substitui domains.ts
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
│       └── index.ts                # Inclui apiRoute() e navRoute() helpers
└── docs/
```

**Arquivos eliminados em V2:**
- `apps/web/src/core/domains.ts` — substituído por `useDiscovery()` + `@Domain` + `iconName` no schema
- `apps/api/src/modules/**/*.routes.ts` — substituídos por `apiRoute()` / `navRoute()` em `packages/types`

**Regra de navegação:** recursos com `breadcrumb` no schema são filhos — não aparecem na sidebar nem no discovery. Recursos sem `breadcrumb` são top-level — aparecem automaticamente.

---

## 3. Technology Stack

### Backend

| Technology | Role |
|------------|------|
| **NestJS** | Main framework — DI container, modules, route orchestration |
| **Prisma ORM 7** | Database access, migrations, type-safe queries — LibSQL (dev) / PostgreSQL (prod) |
| **Zod** | Schema definition and validation (shared with frontend) |
| **Passport.js / @nestjs/jwt** | Authentication — JWT strategy and route guards |
| **CASL** | Ability-based authorization — `can('update', 'Company')` |

### Frontend

| Technology | Role |
|------------|------|
| **Next.js (App Router)** | UI framework — Server Components, file-based routing |
| **TanStack Query** | Server state management — cache, background sync, invalidation |
| **React Hook Form** | Form management, integrado com Zod via `zodResolver` |
| **Tailwind CSS** | Utility-first styling — design tokens via CSS custom properties |
| **Lucide React** | Icon library — resolvida via `lib/icons.ts` (sem imports diretos em componentes) |

> **Upgrades planejados (PRs separados):** Next.js 15, React 19, Tailwind CSS 4, NestJS 11, bcrypt → argon2.

### Database

| Ambiente | Driver |
|----------|--------|
| **Dev** | SQLite via LibSQL adapter (`@prisma/adapter-libsql`) |
| **Prod** | PostgreSQL — `provider = "postgresql"` no schema.prisma |

Toda busca de texto usa `mode: 'insensitive'` para garantir comportamento consistente no PostgreSQL.

---

## 4. Architectural Patterns

### 4.1 Modular Monolith

Mesma estrutura da V1. Módulos podem importar services uns dos outros diretamente. Módulos marcados como **extractable** seguem regras mais rígidas: comunicação via interfaces, cross-references por ID apenas.

### 4.2 Prisma Setup

| File | Role |
|------|------|
| `apps/api/prisma/schema.prisma` | Data model + generator config |
| `apps/api/prisma.config.ts` | Prisma CLI config: datasource URL, adapter, seed |
| `apps/api/src/generated/prisma/` | Prisma Client gerado — gitignored |
| `apps/api/src/prisma/prisma.service.ts` | NestJS service extendendo `PrismaClient`, injetado globalmente |

```bash
# Após qualquer mudança no schema:
pnpm db:migrate   # apps/api/ — aplica migration + regenera client
```

### 4.3 Clean Architecture (por módulo)

```
Request → Controller → Service → Prisma → Database
                          ↑
                    Business logic aqui apenas
```

### 4.4 BaseService & BaseController

```typescript
abstract class BaseService<T, CreateDTO, UpdateDTO> {
  constructor(
    prisma: PrismaService,
    modelName: string,
    schema: ZodObject<any>,
    domain: string,           // V2: obrigatório — registra no ResourceRegistry
    scopeField?: string,      // V2: opcional — campo usado para branch scoping automático
  )

  findAll(query: PaginationQuery): Promise<PaginatedResult<T>>
  findOne(id: string): Promise<T>
  create(dto: CreateDTO): Promise<T>
  update(id: string, dto: UpdateDTO): Promise<T>
  remove(id: string): Promise<void>
  getMetadata(): ResourceMetadata
  protected buildSearchWhere(search: string): Record<string, unknown>  // override para busca customizada
}
```

**Branch scoping automático:** quando `scopeField` é declarado (e.g., `'branchId'`), `BaseService.findAll()` aplica automaticamente `{ [scopeField]: { in: user.branchIds } }` para roles não-admin. O `AuthUser` é injetado via `AsyncLocalStorage` ou passado explicitamente pelo controller.

**Auto-registro:** no construtor de `BaseService`, o par `(domain, resource, schema)` é inserido em `resourceRegistry`. Isso alimenta o `DiscoveryController` e o `metadata.builder` para derivar `children`.

### 4.5 Convention → Configuration

| Layer | Convention (default) | Override |
|-------|---------------------|----------|
| Route prefix | `@Controller('core/<resource>')` | qualquer string |
| Resource label | `camelCase → Title Case` | `withMeta(schema, { label: 'Empresa' })` |
| Resource label plural | `label + 's'` | `withMeta(schema, { labelPlural: 'Empresas' })` |
| Resource icon | nenhum (sem ícone no sidebar) | `withMeta(schema, { icon: 'Building' })` |
| Field label | `camelCase → Title Case` | `.meta({ label: 'Razão Social' })` |
| Top-level resource | `true` se schema não tem `breadcrumb` | — determinado automaticamente |
| Field shown in list | `true` para não-relação, não-senha | `.meta({ showInList: false })` |
| Field shown in form | `true` | `.meta({ showInForm: false })` |
| Sortable field | `true` para string/number/date/enum | `.meta({ sortable: false })` |
| Form component | derivado do tipo Zod | `.meta({ widget: 'textarea' })` |
| Search mode | `insensitive` (PostgreSQL-safe) | — fixo, sem override |

### 4.6 Resource Registry e Domain Registry

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
  icon:  string   // nome do ícone — mesmo sistema de iconName no schema
}
const domainRegistry: DomainEntry[] = []

export function Domain(meta: Omit<DomainEntry, 'key'>) {
  return (target: Function) => {
    const key = Reflect.getMetadata('domain:key', target) // ou extraído do nome do módulo
    domainRegistry.push({ key, ...meta })
  }
}

export function getDomainRegistry(): DomainEntry[] {
  return domainRegistry
}
```

Uso:
```typescript
@Domain({ label: 'Controle', icon: 'Shield' })  // V2: substituiu a entrada em domains.ts
@Module({ imports: [CompanyModule, BranchModule, ...] })
export class CoreModule {}
```

### 4.7 Discovery API

```
GET /discovery
```

Retorna todos os domínios com seus recursos top-level (sem `breadcrumb`):

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

Implementado em `DiscoveryController`, que lê `resourceRegistry` e `domainRegistry`:
- Filtra recursos com `breadcrumb` (são filhos — não aparecem)
- Agrupa por `domain`
- Extrai `label`, `labelPlural`, `icon` do `_schemaMeta` do schema

O frontend cache esse endpoint com `staleTime: Infinity` (produção) via `useDiscovery()`.

### 4.8 Children — Derivação Automática

**V1:** `children` declarado manualmente no schema do pai.
**V2:** `children` é derivado automaticamente pelo `metadata.builder` a partir dos `breadcrumb` dos filhos.

**Regra:** ao construir o metadata de um recurso pai, o builder escaneia o `resourceRegistry` procurando schemas que declaram `breadcrumb: [{ resource: '<pai>' }]`. Para cada match, constrói a entrada `ChildResourceDef`:

```typescript
// Derivado automaticamente — sem declaração no schema do pai
{
  resource:     'branch',              // chave do recurso filho
  domain:       'core',               // domain do filho
  label:        'Filiais',            // = filho.labelPlural
  contextField: 'companyId',         // = breadcrumb[].contextField
  keybind:      'f9',                 // = breadcrumb[].keybind  ← movido para o filho
}
```

**`keybind` no `BreadcrumbDef` do filho:** declara o atalho do botão que o PAI renderiza para navegar até este filho. Semanticamente: "quando meu pai me referencia, use esta tecla."

```typescript
breadcrumb: [
  { resource: 'company', contextField: 'companyId', listLabel: 'Empresas', nameField: 'legalName', keybind: 'f9' }
]
```

### 4.9 Metadata API

Mesma interface da V1. `children` agora é sempre derivado — nunca vem do schema do pai.

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
  children?:   ChildResourceDef[]   // computado automaticamente via registry
  breadcrumb?: BreadcrumbDef[]      // declarado no schema do filho
}
```

### 4.10 AutoForm, AutoList & AutoBreadcrumb

Sem mudanças de comportamento em relação à V1. `children` no metadata continua funcionando da mesma forma — AutoForm ainda renderiza os botões de filhos no topbar.

### 4.11 Frontend — Resolução de Ícones

O sistema de ícones é centralizado em `apps/web/src/lib/icons.ts`. Nenhum componente importa Lucide diretamente — apenas `icons.ts` faz isso.

```typescript
// apps/web/src/lib/icons.ts
import { Shield, Users, Building, GitBranch, Lock, Settings, LayoutGrid, type LucideIcon } from 'lucide-react'

export const Icons: Record<string, LucideIcon> = {
  Shield, Users, Building, GitBranch, Lock, Settings,
  Default: LayoutGrid,
}

export function resolveIcon(name?: string): LucideIcon {
  return (name && Icons[name]) ? Icons[name] : Icons.Default
}
```

### 4.12 Frontend — useDiscovery

```typescript
// apps/web/src/core/useDiscovery.ts
export function useDiscovery(): DiscoveryDomain[] {
  const { data } = useQuery({
    queryKey: ['discovery'],
    queryFn:  () => apiFetch('/discovery'),
    staleTime: process.env.NODE_ENV === 'production' ? Infinity : 0,
  })
  return data ?? []
}
```

Usado por: `Sidebar`, `app/page.tsx`, `app/[domain]/page.tsx`.

### 4.13 Route Helpers

Em `packages/types/index.ts`:

```typescript
// Rota de API (backend): /core/company, /core/company/abc123
export const apiRoute = (domain: string, resource: string, suffix?: string) =>
  `/${domain}/${resource}${suffix ? `/${suffix}` : ''}`

// Rota de navegação (frontend): /core/company, /core/company/new
export const navRoute = (domain: string, resource: string, suffix?: string) =>
  `/${domain}/${resource}${suffix ? `/${suffix}` : ''}`
```

`apiRoute` e `navRoute` têm a mesma implementação — a distinção é semântica e documentada. O prefixo `/api` é adicionado pelo proxy do Next.js, não pelo helper.

---

## 5. Auth & Permissions

Sem mudanças em relação à V1. JWT payload, CASL, branch scoping e password policy permanecem iguais.

### Branch Scoping em V2

Em V2, o scoping pode ser delegado ao `BaseService` via `scopeField`:

```typescript
// V1 — manual em cada service
export class SomeService extends BaseService<...> {
  constructor(prisma: PrismaService) {
    super(prisma, 'someModel', someSchema, 'core')
  }
  // override findAll para aplicar branchId filter
}

// V2 — automático
export class SomeService extends BaseService<...> {
  constructor(prisma: PrismaService) {
    super(prisma, 'someModel', someSchema, 'core', 'branchId')  // scopeField
  }
  // findAll aplica { branchId: { in: user.branchIds } } automaticamente para não-admin
}
```

---

## 6. Data Models

Sem mudanças em relação à V1.

---

## 7. UI Components

**Regra:** este projeto não usa Radix UI nem qualquer biblioteca de primitivos externos além dos já listados abaixo. Componentes são escritos em TypeScript puro + Tailwind. Acessibilidade (ARIA, keyboard nav) é implementada manualmente onde necessário.

**Modelo de referência:** `apps/web/src/components/ui/button.tsx` — TypeScript + Tailwind + `cn()` + Lucide via `resolveIcon()`.

| Component | File | Notes |
|-----------|------|-------|
| `Button` | `components/ui/button.tsx` | variants: default, destructive, outline, ghost, rowAction |
| `Breadcrumb` | `components/ui/breadcrumb.tsx` | segments array, dropdown opcional por item |
| `Tabs` | `components/ui/tabs.tsx` | todos os painéis montados (`hidden` attr); foca primeiro campo habilitado na troca |
| `Dropdown` | `components/ui/dropdown.tsx` | `useState` + `useRef` click-outside + CSS position — sem Radix |
| `Collapsible` | — | implementado inline com `useState` + transição CSS — sem componente separado |

---

## 8. Design System

Sem mudanças em relação à V1. Tokens HSL em `globals.css`, mapeados no `tailwind.config.ts`.

---

## 9. Keywatch — Keyboard Shortcuts

Sem mudanças em relação à V1.

---

## 10. TopbarActionsContext — Topbar Slot

Sem mudanças em relação à V1.

---

## 11. Adding a New Resource — Checklist V2

Mínimo obrigatório. Recursos padrão precisam de **4 arquivos**. Recursos com lógica customizada podem precisar de mais.

### Step 1 — Zod Schema

`packages/schemas/<domain>/<resource>.schema.ts`:

```typescript
export const productSchema = withMeta(
  z.object({
    id:   z.string().uuid(),
    name: z.string().min(2).meta({ label: 'Nome', showInList: true }),
    // ...
    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Produto',
    labelPlural: 'Produtos',
    nameField:   'name',
    icon:        'Package',   // V2: string — resolvida pelo frontend via icons.ts
  },
)
```

Exportar em `packages/schemas/index.ts`. Adicionar `'Package'` em `apps/web/src/lib/icons.ts` se necessário.

### Step 2 — Prisma Model

`apps/api/prisma/schema.prisma`, depois:
```bash
pnpm db:migrate   # em apps/api/
```

### Step 3 — Service

```typescript
@Injectable()
export class ProductService extends BaseService<Product, CreateProductDto, UpdateProductDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'product', productSchema, 'core')  // V2: domain obrigatório
  }

  protected buildSearchWhere(search: string) {
    return { OR: [{ name: { contains: search, mode: 'insensitive' } }] }
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

Registrar `ProductModule` em `CoreModule`.

**Resultado:** recurso aparece automaticamente na sidebar, no breadcrumb e no discovery. Nenhuma edição de `domains.ts`, `.routes.ts` ou qualquer arquivo de configuração frontend.

### Recurso filho (parent-child)

Declare apenas no schema do filho:
```typescript
withMeta(z.object({ ... }), {
  label:       'Variante',
  labelPlural: 'Variantes',
  nameField:   'name',
  // icon omitido — filhos não aparecem no sidebar
  breadcrumb: [
    { resource: 'product', contextField: 'productId', listLabel: 'Produtos', nameField: 'name', keybind: 'v' }
  ],
})
```

O pai descobre os filhos automaticamente — não é necessário editar o schema do pai.
