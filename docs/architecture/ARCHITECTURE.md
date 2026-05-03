# ERP Architecture Reference

> Referência autoritativa da arquitetura do sistema. Descreve estrutura, stack, padrões e infraestrutura transversal. Leia este documento antes de escrever código. Para convenções de nomenclatura, schemas e checklists de novo recurso, consulte `conventions.md`.

---

## 1. Goals

| Goal | Description |
|------|-------------|
| **Modular & scalable** | Módulos de domínio independentes, separáveis em microserviços sem reescrita |
| **Convention over configuration** | O framework aplica defaults automaticamente; configuração explícita só quando há desvio |
| **Maximum automation** | Prisma model + Zod schema + `BaseService` → recurso CRUD completo com API validada, metadata endpoint e UI auto-renderizada |
| **Type safety end-to-end** | Um único Zod schema é a fonte de verdade para tipos no DB, validação na API e formulários no frontend |

---

## 2. Monorepo Structure

```
erp-monorepo/
├── apps/
│   ├── api/                        # NestJS backend
│   │   └── src/
│   │       ├── core/               # Infraestrutura compartilhada (sem lógica de negócio)
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
│   │       └── modules/            # Módulos de domínio de negócio
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
│           │   └── keywatch/       # Gerenciador de atalhos de teclado
│           ├── core/               # Infraestrutura frontend compartilhada
│           │   ├── AutoForm.tsx
│           │   ├── AutoList.tsx
│           │   ├── FieldRenderer.tsx
│           │   └── useMetadata.ts
│           └── modules/            # Páginas espelhando os módulos da API
│               ├── identity/
│               │   └── user/
│               │       ├── page.tsx
│               │       └── [id]/page.tsx
│               └── crm/
│                   └── company/
│                       ├── page.tsx
│                       └── [id]/page.tsx
├── packages/
│   ├── schemas/                    # Zod schemas — compartilhados por api e web
│   │   ├── identity/
│   │   │   └── user.schema.ts
│   │   └── crm/
│   │       └── company.schema.ts
│   └── types/
│       └── index.ts                # z.infer<> exports de todos os schemas
└── docs/
    ├── architecture/
    │   ├── ARCHITECTURE.md         # Este arquivo
    │   ├── conventions.md          # Nomenclatura, schemas, checklists
    │   └── decisions/              # Architecture Decision Records (ADRs)
    └── user-manual/
        ├── identity/
        └── crm/
```

**Regra:** o nome do diretório de um modelo (ex: `company`) determina o prefixo de rota da API (`/crm/company`), o arquivo de schema Zod (`packages/schemas/crm/company.schema.ts`) e o caminho da página frontend (`modules/crm/company/page.tsx`). Nenhuma configuração adicional necessária.

---

## 3. Technology Stack

### Backend

| Technology | Role |
|------------|------|
| **NestJS** | Framework principal — DI container, módulos, orquestração de rotas |
| **Prisma ORM** | Acesso ao banco, migrations, queries type-safe |
| **Zod** | Definição de schemas e validação (compartilhado com o frontend) |
| **Passport.js / @nestjs/jwt** | Autenticação — estratégia JWT e guards de rota |
| **CASL** | Autorização baseada em abilities — `can('update', 'Company')` |

### Frontend

| Technology | Role |
|------------|------|
| **Next.js (App Router)** | Framework UI — Server Components, Server Actions, roteamento por arquivo |
| **TanStack Query** | Gerenciamento de estado servidor — cache, sync em background, invalidação |
| **TanStack Table** | Engine de tabela headless para `AutoList` — sorting, filtering, paginação |
| **React Hook Form** | Gerenciamento de formulários, integrado ao Zod via `zodResolver` |
| **Radix UI** | Primitivas de componente acessíveis (Dropdown, Collapsible, Dialog…) |
| **Shadcn/ui + Tailwind CSS** | Sistema de design — componentes padronizados para todo o ERP |

### Monorepo

| Technology | Role |
|------------|------|
| **pnpm workspaces** | Gerenciador de pacotes e orquestração de workspace |
| **Turborepo** | Pipeline de build, cache de tarefas entre apps e packages |
| **TypeScript** | Strict mode em todos os apps e packages |

---

## 4. Architectural Patterns

### 4.1 Modular Monolith

O código é organizado como **monolito modular**: todos os módulos vivem no mesmo repositório e processo. No caso comum, módulos podem importar serviços uns dos outros diretamente. Para módulos marcados como **extractable** (candidatos a microserviço), regras mais rígidas se aplicam: comunicação via interfaces de serviço, referências cruzadas por ID, sem imports de implementação interna.

### 4.2 Clean Architecture (por módulo)

```
Request → Controller → Service → Prisma → Database
                          ↑
                    Lógica de negócio aqui apenas
```

- **Controller** — parsing de input, definição de rota, chama service, retorna resposta. Sem lógica de negócio.
- **Service** — toda a lógica de negócio. Chama Prisma diretamente. Sem conceitos HTTP.
- **Prisma** — camada de acesso a dados.

### 4.3 BaseService & BaseController

Todo recurso herda de classes base genéricas que implementam CRUD padrão automaticamente:

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

Em cada camada, o sistema verifica: *há configuração explícita?* Se sim, usa. Se não, aplica a convenção:

| Layer | Convention (default) | Override |
|-------|---------------------|----------|
| Route prefix | derivado do caminho do diretório | `@Controller('custom-path')` |
| Label do campo | `camelCase → Title Case` | `.meta({ label: 'Razão Social' })` |
| Campo exibido na lista | `true` para não-relação e não-senha | `.meta({ showInList: false })` |
| Campo exibido no form | `true` | `.meta({ showInForm: false })` |
| Campo ordenável | `true` para string/number/date | `.meta({ sortable: false })` |
| Componente do form | derivado do tipo Zod | `.meta({ widget: 'textarea' })` |

### 4.5 Metadata API

Todo recurso expõe `GET /<domain>/<resource>/metadata`, gerado automaticamente pelo `BaseController` a partir do Zod schema. O frontend consome esse endpoint para renderizar `AutoForm` e `AutoList` sem HTML específico do recurso.

```typescript
interface ResourceMetadata {
  resource:    string
  label:       string
  permissions: { create: boolean; read: boolean; update: boolean; delete: boolean }
  fields:      MetadataField[]
  actions:     ResourceAction[]
}
```

### 4.6 AutoForm & AutoList

Componentes de ordem superior que consomem a Metadata API:

- **AutoForm** — itera `fields` com `showInForm: true`, delega cada campo ao `FieldRenderer` que mapeia o tipo Zod para um componente Shadcn. Aplica validação Zod via `zodResolver`.
- **AutoList** — itera `fields` com `showInList: true` para construir `ColumnDef[]` para TanStack Table. Flags `sortable` e `searchable` ativam sorting e filtros automaticamente. `actions` viram botões verificados pelo CASL.

Os ~20% de recursos que precisam de UI customizada substituem `AutoForm` ou `AutoList` por componentes hand-crafted — o contrato de metadata não impõe seu uso.

---

## 5. Initial Modules

### 5.1 `identity`

**Propósito:** gestão de usuários e autenticação.

`User` — `id`, `name`, `email` (unique), `passwordHash` (hidden), `role` (admin | operator | viewer), `isActive`, `createdAt`, `updatedAt`

Extras: `changePassword(id, dto)`, `deactivate(id)`.

**Auth flow:** `POST /auth/login` → valida credenciais → retorna JWT. Todas as outras rotas exigem o JWT guard. Abilities CASL derivadas de `user.role`.

### 5.2 `crm`

**Propósito:** registros de empresa (cliente/fornecedor/parceiro).

`Company` — `id`, `legalName`, `tradeName` (nullable), `taxId` (CNPJ, unique), `type` (client | supplier | partner | other), `isActive`, `createdAt`, `updatedAt`

Extras: `deactivate(id)`.

---

## 6. Design System

O frontend usa CSS custom properties (HSL) organizadas por camada semântica, definidas em `apps/web/src/app/globals.css` e mapeadas para utilitários Tailwind em `tailwind.config.ts`.

### Camadas de tokens

| Grupo | Tokens | Aplicação |
|-------|--------|-----------|
| **App** | `--background`, `--foreground` | body, área principal de conteúdo |
| **Superfícies** | `--card`, `--popover` (+ foregrounds) | cards/painéis, dropdowns/modais |
| **Ações** | `--primary`, `--accent`, `--muted`, `--destructive` (+ foregrounds) | botões e estados interativos |
| **Controles** | `--input-bg`, `--input`, `--ring` | inputs, selects, textareas, foco |
| **Estrutura** | `--border`, `--radius` | bordas de card, divisores, border-radius global |
| **Sidebar** | `--sidebar-bg`, `--sidebar-fg`, `--sidebar-border`, `--sidebar-accent`, `--sidebar-accent-fg` | exclusivos da sidebar |

### Regras críticas

- **`--accent`** é a cor de tema substituível pelo usuário — usada em hover de botões ghost/icon (topbar, etc.). Atualmente "Cold Eucalyptus" no dark mode.
- **`--sidebar-accent`** é um token de elevação estrutural — sempre neutro, independente do tema. Não deve ser igualado ao `--accent`.
- **`--input`** (borda de controles interativos) deve ter maior contraste que **`--border`** (bordas estruturais passivas). São semanticamente distintos.
- `--input-bg` é aplicado automaticamente via `@layer base` em `input`, `select` e `textarea`.

---

## 7. Keywatch — Atalhos de Teclado

Infraestrutura transversal do frontend para gerenciamento de keyboard shortcuts.

**Localização:** `apps/web/src/lib/keywatch/`

| Arquivo | Responsabilidade |
|---------|-----------------|
| `core.ts` | Registry + matching de eventos, zero DOM — instanciável em qualquer contexto |
| `context.tsx` | React Provider: registra event listeners, gerencia estado do modal |
| `use-shortcut.ts` | `useShortcut` e `useShortcutContext` — bind/unbind pelo ciclo de vida do componente |
| `modal.tsx` | `ShortcutsModal` — lista todos os atalhos ativos com painel de rastreio |
| `index.ts` | Exports públicos |

**Integração:** `KeywatchProvider` envolve o `AppLayout`. Qualquer componente registra atalhos via hook:

```tsx
useShortcut('ctrl+s', save, { desc: 'Salvar', origin: 'ClienteForm' })
useShortcutContext('modal') // empilha contexto no mount, restaura no unmount
```

**`Alt+K`** abre o modal com todos os atalhos do contexto atual.

**Comportamento em inputs (composed pattern):** quando o cursor está em um campo de formulário, o atalho não dispara imediatamente — fica pendente até que uma tecla de confirmação (`;` por padrão) seja pressionada, evitando acionamentos acidentais ao digitar.

**Contextos:** atalhos podem ser escopados por contexto (ex: `'default'`, `'modal'`). O contexto `'all'` responde sempre, independente do contexto ativo.

---

## 8. Documentation Structure

```
docs/
├── architecture/
│   ├── ARCHITECTURE.md     # Este arquivo — visão geral da arquitetura
│   ├── conventions.md      # Nomenclatura, schemas Zod, checklist de novo recurso
│   └── decisions/          # Architecture Decision Records (ADRs)
│       └── ADR-001-monorepo.md
└── user-manual/
    ├── identity/
    │   └── users.md
    └── crm/
        └── companies.md
```

**ADRs** seguem o formato: contexto → decisão → consequências. Crie um para cada escolha arquitetural significativa.
