# Plano de Atualização de Dependências

> Elaborado em 2026-05-21. Versão Node.js: 22 LTS. pnpm: 10.x.

---

## Visão Geral

O upgrade está dividido em **5 ondas** ordenadas por independência e risco. Cada onda deve ser uma PR separada. Ondas 4 e 5 são as mais críticas e devem ser feitas com os testes do app em mão.

| Onda | Escopo | Risco | Duração estimada |
|------|--------|-------|-----------------|
| 1 | Patches seguros | Nenhum | 5 min |
| 2 | Backend: NestJS 11, CASL 7, argon2 | Baixo | 1–2 h |
| 3 | React 19 + Next.js 16 | Médio | 2–3 h |
| 4 | Zod 4 | **Alto** | 3–5 h |
| 5 | Tailwind 4 | Médio-alto | 2–4 h |

**TypeScript 6** e **@types/\*** são tratados ao final como sweep independente.

---

## Onda 1 — Patches seguros

**Pacotes:** `@tanstack/react-query` → 5.100.11, `react-hook-form` → 7.76.0, `postcss` → 8.5.15, `turbo` → 2.9.14, `next-themes` → 0.4.6.

Nenhum breaking change. Executar do diretório raiz:

```bash
pnpm update @tanstack/react-query react-hook-form postcss turbo next-themes --recursive
```

Verificar que o app sobe normalmente. Fim.

---

## Onda 2 — Backend: NestJS 11, CASL 7, bcrypt → argon2

### 2.1 NestJS 10 → 11

**Impacto:** Mínimo. NestJS 11 exige Node ≥ 18 (já ok) e atualiza dependências peer (RxJS 7 já no lock).  
Os decoradores `@Injectable`, `@Controller`, `@Module`, `@Get`/`@Patch`/`@Put`/`@Delete`, `@Body`, `@Req`, `@UseGuards` não mudaram de API.

**Passo a passo:**

```bash
# em apps/api/
pnpm update @nestjs/common @nestjs/core @nestjs/jwt @nestjs/passport \
            @nestjs/platform-express @nestjs/cli @nestjs/schematics
```

Verificar: `pnpm dev` sobe sem erro. Se houver peer-dep warning de `rxjs`, checar se ainda é `^7.x` — deve ser compatível.

### 2.2 CASL 6 → 7

**Impacto:** A API `createMongoAbility` / `MongoAbility` / `AbilityBuilder` mudou de nome em CASL 7. O pacote passou a usar `PureAbility` como base e renomeou alguns exports.

**Arquivo afetado:** `apps/api/src/auth/casl.factory.ts`

```bash
pnpm update @casl/ability
```

Após instalar, verificar o que mudou de nome:

```typescript
// ANTES (CASL 6)
import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability'
export type AppAbility = MongoAbility

// DEPOIS (CASL 7) — nomes prováveis, confirmar nos release notes do pacote instalado
import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability'
// Se MongoAbility foi removido:
import { AbilityBuilder, PureAbility, createPureAbility } from '@casl/ability'
export type AppAbility = PureAbility
// e substituir createMongoAbility → createPureAbility na linha do AbilityBuilder
```

A lógica interna do `CaslAbilityFactory` (`can(action, subject)`, `build()`) não muda.

### 2.3 bcrypt → argon2

O CLAUDE.md já documenta esta migração como planejada. Argon2 é mais seguro e não precisa de `@types/bcrypt`.

```bash
pnpm remove bcrypt @types/bcrypt
pnpm add argon2
```

**Arquivo afetado:** `apps/api/src/modules/core/user/user.service.ts` (ou onde estiver o hash de senha).

```typescript
// ANTES
import * as bcrypt from 'bcrypt'
const hash = await bcrypt.hash(password, 10)
const match = await bcrypt.compare(password, hash)

// DEPOIS
import * as argon2 from 'argon2'
const hash  = await argon2.hash(password)
const match = await argon2.verify(hash, password)
```

**Atenção:** senhas existentes no banco foram hasheadas com bcrypt. Na migração, manter suporte a bcrypt no `verify` até todos os usuários terem trocado a senha, ou forçar reset geral. Estratégia recomendada:

```typescript
// Detecção do algoritmo pelo prefixo do hash
async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$2b$') || stored.startsWith('$2a$')) {
    return bcrypt.compare(plain, stored)  // hash legado
  }
  return argon2.verify(stored, plain)    // hash novo
}
```

Manter `bcrypt` apenas como devDependency temporária durante transição, removendo quando todos os hashes forem migrados.

`PasswordPolicyService.recordHistory` e `validate` também usam bcrypt — aplicar o mesmo padrão.

---

## Onda 3 — React 19 + Next.js 16

### 3.1 React 18 → 19

**Impacto principal:** `forwardRef` ainda funciona mas passou a ser opcional — refs são props comuns. Nenhuma remoção de API que o projeto use.

```bash
# em apps/web/
pnpm update react react-dom @types/react @types/react-dom
```

Verificar se algum component usa `React.FC` com props implícitas (React 19 removeu `children` implícito em `React.FC`). Busca rápida:

```bash
grep -r "React.FC" apps/web/src --include="*.tsx"
```

Se encontrar, adicionar `children: React.ReactNode` explicitamente nas interfaces afetadas.

O `PasswordInput` usa `forwardRef` corretamente e continuará funcionando. Não é necessário migrar agora.

### 3.2 Next.js 14 → 16

**Impacto crítico: `params` agora é Promise em Next.js 15+.**

Em Next.js 15+, o objeto `params` recebido como prop em page components é `Promise<{...}>` mesmo em Client Components. A abordagem recomendada para componentes client é substituir por `useParams()`.

**Arquivos afetados (4 páginas):**

**`apps/web/src/app/[domain]/page.tsx`**
```typescript
// ANTES
export default function DomainPage({ params }: { params: { domain: string } }) {
  const { domain: domainKey } = params

// DEPOIS
import { useParams } from 'next/navigation'
export default function DomainPage() {
  const { domain: domainKey } = useParams<{ domain: string }>()
```

**`apps/web/src/app/[domain]/[resource]/page.tsx`**
```typescript
// ANTES
export default function ResourceListPage({ params }: { params: { domain: string; resource: string } }) {
  const { domain, resource } = params

// DEPOIS
import { useParams } from 'next/navigation'
export default function ResourceListPage() {
  const { domain, resource } = useParams<{ domain: string; resource: string }>()
```

**`apps/web/src/app/[domain]/[resource]/[id]/page.tsx`**
```typescript
// ANTES
export default function ResourceDetailPage({ params }: { params: { domain: string; resource: string; id: string } }) {
  const { domain, resource, id } = params

// DEPOIS
import { useParams } from 'next/navigation'
export default function ResourceDetailPage() {
  const { domain, resource, id } = useParams<{ domain: string; resource: string; id: string }>()
```

**`apps/web/src/app/core/user/[id]/page.tsx`**
```typescript
// ANTES
export default function UserDetailPage({
  params,
  ...
}: {
  params: { id: string }
  ...
}) {
  const { id } = params

// DEPOIS
import { useParams } from 'next/navigation'
export default function UserDetailPage({ ... }: { ... }) {
  const { id } = useParams<{ id: string }>()
```

**`next.config.js`:** verificar se `allowedDevOrigins` ainda é suportado ou foi renomeado. Se o app subir com warning, consultar o release notes do Next 16 para o nome atual da opção.

```bash
# em apps/web/
pnpm update next
```

Após upgrade, rodar `pnpm build` e verificar se há warnings de deprecação ou erros de tipo nas páginas dinâmicas.

### 3.3 react-imask

`react-imask` 7.x suporta apenas React 18. Para React 19 é necessário a versão 8.x (mudança de API mínima — o hook `useIMask` e o componente `IMaskInput` mantêm a mesma assinatura, mas os tipos internos foram atualizados).

```bash
pnpm update react-imask --filter @nyx/web
```

Após atualizar, verificar os campos que usam `IMaskInput` (busca rápida em `apps/web/src`) e confirmar que `{...register(...)}` ainda propaga corretamente — o comportamento de `forwardRef` em `IMaskInput` muda ligeiramente no 8.x.

### 3.4 @hookform/resolvers

Está em `package.json` mas não é usado no código — `AutoForm` não aplica `zodResolver`, a validação acontece no servidor. Remover a dependência:

```bash
pnpm remove @hookform/resolvers --filter @nyx/web
```

Se no futuro quiser validação client-side no `AutoForm`, adicionar novamente compatível com Zod 4 (versão 5.x).

---

## Onda 4 — Zod 4 ⚠️ Crítico

Esta é a mudança de maior impacto. Zod 4 introduz `.meta()` como API nativa, que conflita diretamente com a extensão de protótipo do sistema. Toda a camada de metadados precisa ser adaptada.

### 4.1 Entender o conflito

Em Zod 4, `.meta(obj)` é um método nativo de `ZodType` que armazena metadados em `_def.meta`. O sistema atual:
1. Augmenta `ZodType.prototype.meta` via `declare module 'zod'`
2. Armazena em `_fieldMeta` na própria instância
3. Acessa via `(field as any)._fieldMeta` no `metadata.builder.ts`

**Opção A — Usar a API nativa do Zod 4 (recomendado):**  
Zod 4 armazena o objeto passado para `.meta()` em `schema._def.meta`. Como o sistema já usa um objeto `FieldMeta` livre, a transição é direta: remover o augment e trocar `._fieldMeta` por `._def.meta` em todos os acessos.

**Opção B — Renomear o método customizado:**  
Manter a extensão de protótipo mas renomear para `.fieldMeta()` para evitar colisão. Requer busca e substituição em todos os schemas.

**Opção A é preferida.** Alinha o sistema com Zod 4, elimina o monkey-patch e remove código de infraestrutura.

### 4.2 Instalar e verificar internals

```bash
pnpm update zod --recursive
```

Após instalar, confirmar nos tipos do pacote instalado:
1. `ZodType._def.meta` existe? (esperado: sim)
2. `ZodDefault._def.defaultValue` — verificar se ainda é uma função `() => T` ou passou a ser o valor direto
3. `ZodEnum._def.values` — verificar se ainda é `string[]`
4. `instanceof ZodOptional`, `instanceof ZodDefault`, etc. — verificar se as classes ainda existem com mesmo nome

```typescript
// Verificação rápida — rodar em ts-node ou playground
import { z, ZodOptional, ZodDefault, ZodString, ZodEnum } from 'zod'
const s = z.string().optional().default('x')
console.log(s instanceof ZodDefault)          // deve ser true
console.log((s as any)._def.defaultValue)     // função ou valor?
const e = z.enum(['a', 'b'])
console.log((e as any)._def.values)           // ['a', 'b']?
```

### 4.3 Migrar `packages/schemas/zod-meta.ts`

```typescript
// ANTES — augment + prototype patch
import { ZodType } from 'zod'
import type { FieldMeta } from '@nyx/types'

declare module 'zod' {
  interface ZodType {
    meta(metadata: FieldMeta): this
    _fieldMeta?: FieldMeta
  }
}
ZodType.prototype.meta = function (metadata: FieldMeta) {
  this._fieldMeta = { ...(this._fieldMeta ?? {}), ...metadata }
  return this
}

// DEPOIS — aproveitar .meta() nativo do Zod 4
// Zod 4 aceita qualquer objeto em .meta() e armazena em ._def.meta
// Basta declarar o tipo para TypeScript:
import type { FieldMeta } from '@nyx/types'

declare module 'zod' {
  interface ZodTypeDef {
    meta?: FieldMeta  // garante tipagem no ._def.meta
  }
}

// Nenhum código runtime necessário — .meta() já existe no Zod 4
export type { FieldMeta }
```

> **Se a declaração `ZodTypeDef` não compilar:** verificar o nome exato da interface de def no Zod 4 (pode ser `ZodDef` ou outra). Em último caso, manter sem declaração e usar `as any` nos acessos.

### 4.4 Migrar `packages/schemas/with-meta.ts`

O `withMeta` não usa a API de `.meta()` — ele opera em `_schemaMeta` na instância. Isso **não conflita** com Zod 4 e pode ficar exatamente como está. Nenhuma mudança necessária aqui.

### 4.5 Migrar `apps/api/src/core/metadata.builder.ts`

Substituir todos os acessos a `._fieldMeta` por `._def.meta`:

```typescript
// ANTES — em todas as ocorrências
const meta = (field as any)._fieldMeta ?? {}

// DEPOIS
const meta = (field as any)._def.meta ?? {}
```

Ocorrências no arquivo: linha 87 (no loop de `fields`) e linha 71 (`schemaMeta`).

Verificar também o acesso a `_def.defaultValue`. Se em Zod 4 `defaultValue` for o valor direto (não função):

```typescript
// ANTES
const defaultValue = field instanceof ZodDefault
  ? (field as any)._def.defaultValue()
  : undefined

// DEPOIS (se Zod 4 armazena o valor diretamente)
const defaultValue = field instanceof ZodDefault
  ? (field as any)._def.defaultValue   // sem ()
  : undefined

// Ou verificar se existe _def.defaultValue como função ou propriedade e adaptar
```

### 4.6 Migrar todos os schemas em `packages/schemas/`

Os schemas usam `.meta({ label, widget, ... })`. Com Zod 4, o método nativo aceita qualquer objeto — **nenhuma mudança necessária nos arquivos de schema**. O `.meta()` funcionará da mesma forma.

Rodar build de verificação:

```bash
cd packages/schemas && npx tsc --noEmit
```

### 4.7 Verificar `apps/api/src/core/filter.builder.ts`

O filter builder também acessa `._fieldMeta` indiretamente via `meta.filter`. Aplicar a mesma substituição:

```bash
grep -n "_fieldMeta" apps/api/src --include="*.ts" -r
```

Substituir todas as ocorrências por `._def.meta`.

### 4.8 Teste de smoke

Após as alterações:
1. `pnpm db:generate` (regenerar cliente Prisma se necessário)
2. `pnpm dev` — verificar que a API sobe
3. `GET /core/user/metadata` — verificar que os campos retornam com labels e tipos corretos
4. `GET /discovery` — verificar que os recursos aparecem
5. Abrir um form e verificar que os fields renderizam

---

## Onda 5 — Tailwind CSS 4

Tailwind 4 substitui o arquivo `tailwind.config.ts` por uma abordagem CSS-first. A configuração migra para dentro do `globals.css` via diretivas `@theme` e `@import`.

### 5.1 Atualizar dependências

```bash
# em apps/web/
pnpm update tailwindcss tailwind-merge
pnpm add -D @tailwindcss/postcss
```

`tailwind-merge` 3 é par obrigatório do Tailwind 4 — as regras de merge são reconstruídas para a nova versão.

### 5.2 Atualizar `postcss.config.js`

```javascript
// ANTES
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } }

// DEPOIS
module.exports = { plugins: { '@tailwindcss/postcss': {} } }
// autoprefixer não é mais necessário — Tailwind 4 já inclui prefixos
```

### 5.3 Migrar `globals.css` — importação e tema

**Cabeçalho do arquivo:**

```css
/* ANTES */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* DEPOIS */
@import "tailwindcss";
```

**Bloco `@theme` (substitui `tailwind.config.ts`):**

Adicionar após o `@import`, antes do `@layer base`:

```css
@theme {
  /* Cores — mapeiam as variáveis CSS existentes */
  --color-background:           hsl(var(--background));
  --color-foreground:           hsl(var(--foreground));
  --color-border:               hsl(var(--border));
  --color-input:                hsl(var(--input));
  --color-input-bg:             hsl(var(--input-bg));
  --color-ring:                 hsl(var(--ring));
  --color-primary:              hsl(var(--primary));
  --color-primary-foreground:   hsl(var(--primary-foreground));
  --color-muted:                hsl(var(--muted));
  --color-muted-foreground:     hsl(var(--muted-foreground));
  --color-accent:               hsl(var(--accent));
  --color-accent-foreground:    hsl(var(--accent-foreground));
  --color-destructive:          hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-card:                 hsl(var(--card));
  --color-card-foreground:      hsl(var(--card-foreground));
  --color-popover:              hsl(var(--popover));
  --color-popover-foreground:   hsl(var(--popover-foreground));
  --color-row-hover:            hsl(var(--row-hover));

  /* Sidebar */
  --color-sidebar:              hsl(var(--sidebar-bg));
  --color-sidebar-foreground:   hsl(var(--sidebar-fg));
  --color-sidebar-border:       hsl(var(--sidebar-border));
  --color-sidebar-accent:       hsl(var(--sidebar-accent));
  --color-sidebar-accent-foreground: hsl(var(--sidebar-accent-fg));

  /* Border radius */
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
}
```

> **Atenção:** Em Tailwind 4, os tokens de cor usam o prefixo `--color-*`. A classe `bg-primary` continua funcionando — o Tailwind 4 faz o mapeamento automaticamente via convenção de nome. Não é necessário mudar as classes nos componentes.

**Dark mode:**

```css
/* ANTES (no tailwind.config.ts) */
darkMode: ['class']

/* DEPOIS (no globals.css, após @import) */
@variant dark (&:where(.dark, .dark *));
```

### 5.4 Remover `tailwind.config.ts`

Após confirmar que o `@theme` no CSS cobre todos os tokens, o arquivo pode ser deletado.

```bash
rm apps/web/tailwind.config.ts
```

### 5.5 Verificar `tailwind-merge` (cn utility)

O `tailwind-merge` 3 pode ter mudado as exportações. Verificar `apps/web/src/lib/utils.ts`:

```typescript
// Se twMerge deixou de ser o export padrão ou foi renomeado,
// ajustar conforme a documentação do tailwind-merge 3.
// Na maioria dos casos a assinatura de twMerge não muda.
import { twMerge } from 'tailwind-merge'  // verificar se ainda exporta assim
```

### 5.6 Verificar monorepo content scanning

Tailwind 4 faz content detection automático, mas para monorepo com packages externos pode ser necessário declarar explicitamente. Se os ícones/classes dos packages não aparecerem:

```css
/* globals.css */
@source "../../packages/**/*.{ts,tsx}";
```

### 5.7 Teste visual completo

Tailwind 4 muda como algumas classes de utilidade são nomeadas internamente. Abrir o app e verificar visualmente:
- Dark mode (toggle de tema)
- Cores de accent por tema (eucalyptus, ocean, etc.)
- Sidebar collapsed/expanded
- Formulários e tabelas
- Botões (todas as variantes: default, destructive, outline, ghost)

---

## Sweep final — TypeScript 6 + @types/*

Fazer por último, pois TypeScript 6 pode expor erros de tipo latentes nas ondas anteriores.

### @types/node

Fixar na versão do runtime, não no latest:

```bash
# Node 22 LTS → @types/node@22
pnpm update @types/node@22 --recursive
# NÃO usar @types/node@25 — Node 22 é o runtime
```

### @types/express

```bash
pnpm update @types/express --filter @nyx/api
```

Express 5 mudou o tipo de `Request`/`Response` em alguns detalhes. Se `@types/express@5` causar erros de tipo no `apps/api/src`, checar se os handlers usam tipos explícitos ou inferência — na maioria dos casos funciona sem mudança.

### @types/bcrypt

Removido junto com bcrypt na onda 2 (migração para argon2).

### @types/react + @types/react-dom

Atualizados na onda 3 junto com React 19.

### TypeScript 5 → 6

```bash
pnpm update typescript --recursive
```

TS 6 adiciona checagens de strictness. Executar:

```bash
pnpm tsc --noEmit --project apps/api/tsconfig.json
pnpm tsc --noEmit --project apps/web/tsconfig.json
```

Corrigir erros de tipo que surgirem. Os mais prováveis:
- `emitDecoratorMetadata: true` no `apps/api/tsconfig.json` — verificar se ainda é a sintaxe correta ou se TS 6 requer `experimentalDecorators: true` junto
- Tipos mais estritos em `as any` podem gerar warnings adicionais

---

## lucide-react 0.400 → 1.16

Entre a versão 0.x e 1.x, Lucide fez um renaming de vários ícones.

```bash
pnpm update lucide-react --filter @nyx/web
```

Após instalar, compilar:

```bash
cd apps/web && npx tsc --noEmit
```

Os ícones que não existirem mais causarão erro de importação. Verificar e corrigir em `apps/web/src/lib/icons.ts`. Os mais sujeitos a mudança de nome em versões 1.x:
- `BarChart2` → possivelmente `ChartBar` ou `BarChartBig`
- `LayoutGrid` → verificar
- `SlidersHorizontal` → verificar

Para cada ícone com erro, buscar o novo nome no [lucide.dev](https://lucide.dev) e atualizar o import em `icons.ts`.

---

## Checklist de PR por onda

```
Onda 1 — [x] pnpm update patches  [ ] app sobe
Onda 2 — [x] NestJS 11  [x] CASL 7 (API compatível sem mudanças)  [x] argon2 (troca limpa, sem compat layer)  [ ] login/senha funciona
Onda 3 — [x] React 19  [x] Next 16.2.6  [x] react-imask 7.x ok (peer dep >=0.14)  [x] useParams nas 4 páginas  [x] @hookform/resolvers removido  [ ] pnpm build sem erros
Onda 4 — [x] zod 4.4.3  [x] zod-meta.ts → GlobalMeta augment (proto override removido)  [x] metadata.builder field.meta() + _def.entries  [x] filter.builder field.meta()  [ ] GET /metadata retorna correto
Onda 5 — [x] @tailwindcss/postcss  [x] @import tailwindcss  [x] @theme no globals.css  [x] @variant dark  [x] tailwind.config.ts removido  [ ] dark mode visual ok
Sweep  — [x] @types/node@22  [x] TypeScript 6.0.3  [x] module:Node16 na API  [x] lucide 1.16 sem renomes  [x] tsc --noEmit ok em api e web
```
