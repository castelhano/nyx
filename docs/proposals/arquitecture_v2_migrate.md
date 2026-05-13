# Migration: Architecture V1 → V2

> Checklist completo de migração. Executar na ordem — cada fase não depende das seguintes mas pode depender das anteriores. Verificar ao fim de cada fase antes de avançar.

---

## Fase 1 — Camada de Schema `packages/`

> Sem impacto em runtime. Apenas adições e remoções de tipos.

- [x] **`packages/types/index.ts`**
  - Adicionar `icon?: string` em `SchemaMeta` (ou interface equivalente para `withMeta`)
  - Adicionar `keybind?: string` em `BreadcrumbDef`
  - Remover `ChildResourceDef` do schema-level (manter apenas em `ResourceMetadata` — é gerado pelo backend)
  - Adicionar helpers: `apiRoute(domain, resource, suffix?)` e `navRoute(domain, resource, suffix?)`

- [x] **`packages/schemas/with-meta.ts`**
  - Adicionar `icon?: string` em `SchemaMeta<T>`
  - Adicionar `keybind?: string` em `BreadcrumbDef`
  - Remover `children?: ChildResourceDef[]` de `SchemaMeta<T>` — não existe mais no schema

- [x] **`packages/schemas/core/company.schema.ts`**
  - Adicionar `icon: 'Building'` no `withMeta`
  - Remover o array `children` inteiro (a relação com `branch` passa a ser declarada apenas no schema do filho)

- [x] **`packages/schemas/core/branch.schema.ts`**
  - Adicionar `keybind: 'f9'` na entrada `breadcrumb` que aponta para `company`
  - `icon` omitido — recurso filho não aparece na sidebar

- [x] **`packages/schemas/core/user.schema.ts`**
  - Adicionar `icon: 'Users'`

- [x] **`packages/schemas/core/user-branch.schema.ts`**
  - `icon` omitido — recurso filho

- [x] **`packages/schemas/core/user-permission.schema.ts`**
  - `icon` omitido — recurso filho

- [x] **`packages/schemas/settings/password-policy.schema.ts`**
  - Adicionar `icon: 'Lock'`

### ✅ Verificação Fase 1
```bash
pnpm --filter @nyx/schemas build
pnpm --filter @nyx/types build
# Sem erros de TypeScript
```

---

## Fase 2 — Backend: Registry, Discovery e `@Domain`

> Infraestrutura nova. Nenhum comportamento existente é alterado.

- [x] **Criar `apps/api/src/core/resource-registry.ts`**
  ```typescript
  export interface RegistryEntry { domain: string; resource: string; schema: ZodObject<any> }
  export const resourceRegistry: RegistryEntry[] = []
  ```

- [x] **Criar `apps/api/src/core/domain-registry.ts`**
  - Array global `domainRegistry: DomainEntry[]`
  - Decorator `@Domain({ label, icon })` que insere no registry usando o nome da classe como chave
  - Função `getDomainRegistry(): DomainEntry[]`

- [x] **Atualizar `apps/api/src/core/base.service.ts`**
  - Adicionar parâmetro `domain: string` após `schema` no construtor
  - Adicionar parâmetro opcional `scopeField?: string` após `domain`
  - No construtor, fazer `resourceRegistry.push({ domain, resource: modelName, schema })`
  - Em `findAll()`, quando `scopeField` está definido e o user não é admin, adicionar `{ [scopeField]: { in: user.branchIds } }` ao `where`

- [x] **Atualizar `apps/api/src/core/metadata.builder.ts`**
  - Remover leitura de `schemaMeta.children`
  - Após construir os fields, escanear `resourceRegistry` para derivar `children`:
    ```typescript
    const children = resourceRegistry
      .filter(e => e.resource !== resource)
      .flatMap(e => {
        const m = (e.schema as any)._schemaMeta
        const entry = m?.breadcrumb?.find((b: any) => b.resource === resource)
        if (!entry) return []
        return [{ resource: e.resource, domain: e.domain, label: m.labelPlural ?? toTitleCase(e.resource), contextField: entry.contextField, ...(entry.keybind ? { keybind: entry.keybind } : {}) }]
      })
    ```

- [x] **Criar `apps/api/src/modules/discovery/discovery.controller.ts`**
  - `@Controller('discovery')`, `@UseGuards(JwtAuthGuard)`
  - `@Get()` — lê `resourceRegistry` e `getDomainRegistry()`, filtra recursos filho (com breadcrumb), retorna `DiscoveryDomain[]`

- [x] **Criar `apps/api/src/modules/discovery/discovery.module.ts`**
  - `@Module({ controllers: [DiscoveryController] })`

- [x] **Atualizar `apps/api/src/app.module.ts`**
  - Adicionar `DiscoveryModule` aos imports

- [x] **Adicionar `@Domain` nos módulos de domínio**
  - `CoreModule`: `@Domain({ label: 'Controle', icon: 'Shield' })`
  - `SettingsModule`: `@Domain({ label: 'Configurações', icon: 'Settings' })`

- [x] **Atualizar todos os services — adicionar `domain` ao `super()`**
  - `CompanyService`: `super(prisma, 'company', companySchema, 'core')`
  - `BranchService`: `super(prisma, 'branch', branchSchema, 'core')`
  - `UserService`: `super(prisma, 'user', userSchema, 'core')`
  - `UserPermissionService`: `super(prisma, 'user-permission', userPermissionSchema, 'core')`
  - `UserBranchService`: `super(prisma, 'user-branch', userBranchSchema, 'core')`
  - `PasswordPolicyService`: `super(prisma, 'password-policy', passwordPolicySchema, 'core')`

### ✅ Verificação Fase 2
```bash
pnpm --filter api dev
# GET /discovery deve retornar domínios com recursos top-level (sem branch, user-branch, user-permission)
# GET /core/company/metadata deve retornar children: [{ resource: 'branch', ... }] — sem declarar no schema do pai
# GET /core/branch/metadata deve retornar breadcrumb mas sem aparecer no discovery
```

---

## Fase 3 — Backend: Search Insensitive + Remoção de `.routes.ts`

- [x] **Atualizar `buildSearchWhere` em todos os services**
  - `CompanyService`: adicionar `mode: 'insensitive'` em cada `contains`
  - `BranchService`: idem
  - `UserService`: idem
  - Quaisquer outros services com busca textual

- [x] **Deletar todos os arquivos `.routes.ts`**
  - `apps/api/src/modules/core/company/company.routes.ts`
  - `apps/api/src/modules/core/branch/branch.routes.ts`
  - `apps/api/src/modules/core/user/user.routes.ts`
  - `apps/api/src/modules/core/user-branch/user-branch.routes.ts`
  - `apps/api/src/modules/core/user-permission/user-permission.routes.ts`
  - `apps/api/src/modules/settings/password-policy/password-policy.routes.ts`

- [x] **Verificar imports dos `.routes.ts` no frontend**
  - Buscar por `from '.*\.routes'` no diretório `apps/web/src`
  - Substituir qualquer uso pelos helpers `apiRoute()` / `navRoute()` de `@nyx/types`

### ✅ Verificação Fase 3
```bash
pnpm --filter api build
# Sem erros de TypeScript, sem imports quebrados
```

---

## Fase 4 — Frontend: Discovery, `useDiscovery`, Sidebar, Remoção de `domains.ts`

- [x] **Criar `apps/web/src/lib/icons.ts`**
  - Único arquivo com imports do Lucide no projeto
  - Exporta `Icons: Record<string, LucideIcon>` e `resolveIcon(name?: string): LucideIcon`
  - Incluir todos os ícones usados atualmente + `Default: LayoutGrid`

- [x] **Criar `apps/web/src/core/useDiscovery.ts`**
  - `useQuery` para `GET /api/discovery`
  - `staleTime: Infinity` em produção, `0` em dev
  - Retorna `DiscoveryDomain[]`

- [x] **Atualizar `apps/web/src/components/layout/sidebar.tsx`**
  - Substituir `import { domains } from '@/core/domains'` por `useDiscovery()`
  - Resolver ícones via `resolveIcon(domain.icon)` e `resolveIcon(resource.icon)` de `lib/icons.ts`
  - Remover todos os imports do Lucide que não sejam ícones de UI da própria sidebar (LogOut, ChevronsUpDown, ChevronRight, User, KeyRound — esses ficam, pois são UI interna)

- [x] **Atualizar `apps/web/src/app/page.tsx`**
  - Substituir `domains` por `useDiscovery()`
  - Resolver ícones via `resolveIcon()`

- [x] **Atualizar `apps/web/src/app/[domain]/page.tsx`**
  - Substituir `domains` por `useDiscovery()`

- [x] **Deletar `apps/web/src/core/domains.ts`**

### ✅ Verificação Fase 4
```bash
pnpm --filter web dev
# Sidebar renderiza domínios e recursos corretamente via API
# Home page lista domínios via discovery
# Domain page lista recursos via discovery
# Recursos filho (branch, user-branch, user-permission) NÃO aparecem na sidebar
# pnpm --filter web build  — sem erros de TypeScript
```

---

## Fase 5 — Frontend: Remoção do Radix UI

- [x] **Substituir `Collapsible` do Radix no sidebar**
  - Remover imports `* as Collapsible from '@radix-ui/react-collapsible'`
  - Substituir `<Collapsible.Root>`, `<Collapsible.Trigger>`, `<Collapsible.Content>` por:
    - `<div>` com `onClick={() => toggleModule(key)}`
    - Conteúdo com `className={cn('overflow-hidden transition-all', isExpanded ? 'max-h-96' : 'max-h-0')}`

- [x] **Criar `apps/web/src/components/ui/dropdown.tsx`**
  - Componente hand-rolled: `useState(open)` + `useRef` + `useEffect` para click-outside
  - API: `<Dropdown trigger={<button>}>`, `<DropdownItem onClick>`, `<DropdownSeparator />`
  - Posicionamento via `position: absolute` + `bottom-full` / `top-full` conforme prop

- [x] **Substituir `DropdownMenu` do Radix no sidebar**
  - Remover imports `* as DropdownMenu from '@radix-ui/react-dropdown-menu'`
  - Substituir o user menu pelo novo `<Dropdown>` component

- [x] **Desinstalar pacotes Radix**
  ```bash
  pnpm --filter web remove @radix-ui/react-dropdown-menu @radix-ui/react-collapsible
  ```

### ✅ Verificação Fase 5
```bash
pnpm --filter web dev
# Sidebar: colapso de módulos funciona (animação CSS)
# Sidebar: user menu abre/fecha corretamente
# Sidebar: logout funciona
# Sidebar: click fora do menu fecha o dropdown
# Nenhum import de @radix-ui no projeto (grep para verificar)
pnpm --filter web build
```

---

## Fase 6 — Validação Final

- [x] **Build completo do monorepo**
  ```bash
  pnpm build
  # Sem erros em packages/types, packages/schemas, apps/api, apps/web
  ```

- [x] **Smoke test funcional**
  - Login funciona
  - Sidebar carrega domínios e recursos via discovery
  - Listar, criar, editar e deletar uma empresa
  - Navegar para filiais da empresa (botão no form)
  - Filial aparece com breadcrumb correto (Empresas → nome da empresa → Filiais)
  - Metadata de empresa retorna `children: [{ resource: 'branch' }]` sem declaração no schema
  - `GET /discovery` não retorna branch, user-branch, user-permission

- [x] **Verificar ausência dos arquivos eliminados**
  ```bash
  # Nenhum destes deve existir:
  # apps/web/src/core/domains.ts
  # apps/api/src/modules/**/*.routes.ts
  # Nenhum import de @radix-ui/* no projeto
  ```

---

## Fase 7 — Upgrades de Tecnologia (PRs separados)

> Não bloqueia as fases anteriores. Executar em PRs isolados com testes completos.

- [ ] **Next.js 14 → 15**
  - Verificar breaking changes de caching (fetch cache behavior mudou)
  - Verificar Server Actions API
  - Testar todas as páginas após upgrade

- [ ] **React 18 → 19**
  - Verificar uso de `useFormState` / `useFormStatus` (API mudou)
  - Verificar `useEffect` com cleanup (comportamento de Strict Mode mudou)
  - Testar AutoForm, AutoList e formulários customizados

- [ ] **Tailwind CSS 3 → 4**
  - Migrar `tailwind.config.ts` para configuração CSS-first em `globals.css`
  - Remover `tailwind.config.ts` após migração
  - Verificar classes customizadas e design tokens
  - Testar todos os componentes visuais

- [ ] **bcrypt → argon2** ⚠️ _breaking change de dados_
  - Instalar `argon2`, remover `bcrypt` e `@types/bcrypt`
  - Atualizar `UserService.create()`, `UserService.changePassword()`, `AuthService.login()`
  - **Atenção:** hashes bcrypt existentes são incompatíveis com argon2 — planejar reset de senhas ou período de transição com suporte aos dois formatos

- [ ] **NestJS 10 → 11**
  - Verificar changelog de breaking changes
  - Testar guards, interceptors e filtros globais
