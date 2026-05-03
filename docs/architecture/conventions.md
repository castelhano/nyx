# ERP Conventions Reference

> Nomenclatura, schemas Zod e checklist de novo recurso. Leia junto com `ARCHITECTURE.md`. Este documento é a fonte de verdade para decisões de código repetitivo.

---

## 1. Naming & Language

**Regra geral:** código em inglês, rótulos de UI em pt-BR.

| Artefato | Convenção | Exemplo |
|----------|-----------|---------|
| Arquivos e diretórios | `kebab-case` | `company.service.ts`, `crm/` |
| Classes e interfaces | `PascalCase` | `CompanyService`, `BaseController` |
| Variáveis e funções | `camelCase` | `findAll`, `taxId` |
| Constantes globais | `UPPER_SNAKE_CASE` | `ROUTES`, `DEFAULT_PAGE_SIZE` |
| Campos Prisma / Zod | `camelCase` | `legalName`, `isActive` |
| Rotas de API | `kebab-case` | `/crm/company`, `/identity/user` |
| Variáveis CSS | `--kebab-case` | `--sidebar-accent`, `--input-bg` |

### Routes constants

Prefira constantes tipadas a strings literais espalhadas pelo código:

```typescript
// packages/types/routes.ts
export const ROUTES = {
  identity: {
    user: {
      list:   '/identity/user',
      detail: (id: string) => `/identity/user/${id}`,
    },
  },
  crm: {
    company: {
      list:   '/crm/company',
      detail: (id: string) => `/crm/company/${id}`,
    },
  },
} as const
```

---

## 2. Zod Schema Pattern

O Zod schema é a **fonte única de verdade** para tipos no DB, validação na API e formulários no frontend. Vive em `packages/schemas/<domain>/<resource>.schema.ts`.

```typescript
// packages/schemas/crm/company.schema.ts
import { z } from 'zod'

// ── Enums ──────────────────────────────────────────────────────────────────

export const CompanyTypeEnum = z.enum(['client', 'supplier', 'partner', 'other'])

// ── Base (campos sempre presentes) ────────────────────────────────────────

const companyBase = z.object({
  legalName:  z.string().min(2).meta({ label: 'Razão Social' }),
  tradeName:  z.string().nullable().optional().meta({ label: 'Nome Fantasia' }),
  taxId:      z.string().length(14).meta({ label: 'CNPJ' }),
  type:       CompanyTypeEnum.meta({ label: 'Tipo', widget: 'select' }),
  isActive:   z.boolean().default(true).meta({ label: 'Ativo', showInForm: false }),
})

// ── DTOs ──────────────────────────────────────────────────────────────────

export const createCompanySchema = companyBase

export const updateCompanySchema = companyBase.partial()

// ── Entidade completa (resposta da API) ───────────────────────────────────

export const companySchema = companyBase.extend({
  id:        z.string().uuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

// ── Tipos inferidos ───────────────────────────────────────────────────────

export type Company       = z.infer<typeof companySchema>
export type CreateCompany = z.infer<typeof createCompanySchema>
export type UpdateCompany = z.infer<typeof updateCompanySchema>
```

### `.meta()` disponíveis

| Propriedade | Tipo | Default | Efeito |
|-------------|------|---------|--------|
| `label` | `string` | `camelCase → Title Case` | Rótulo em formulários e colunas |
| `showInList` | `boolean` | `true` (não-relação, não-senha) | Inclui na `AutoList` |
| `showInForm` | `boolean` | `true` | Inclui no `AutoForm` |
| `sortable` | `boolean` | `true` para string/number/date | Ativa sorting na coluna |
| `widget` | `string` | derivado do tipo Zod | Componente de form: `'textarea'`, `'select'`, `'date'`, etc. |

---

## 3. Adding a New Resource

Checklist mínimo para adicionar um recurso ao ERP. Cada passo cria um artefato; nenhum é opcional.

### Passo 1 — Schema Zod

Crie `packages/schemas/<domain>/<resource>.schema.ts` seguindo o padrão da seção 2. Exporte os tipos em `packages/types/index.ts`.

### Passo 2 — Prisma model

Adicione o model em `apps/api/prisma/schema.prisma`, rode `pnpm prisma migrate dev` e `pnpm prisma generate`.

### Passo 3 — Service

Crie `apps/api/src/modules/<domain>/<resource>/<resource>.service.ts` extendendo `BaseService`:

```typescript
@Injectable()
export class CompanyService extends BaseService<Company, CreateCompany, UpdateCompany> {
  constructor(private prisma: PrismaService) {
    super(companySchema, prisma.company)
  }
}
```

### Passo 4 — Controller & Module

Crie `<resource>.controller.ts` extendendo `BaseController` e `<resource>.module.ts` registrando ambos. Registre o módulo no módulo de domínio (`crm.module.ts`).

### Passo 5 — Frontend

Crie as páginas `apps/web/src/modules/<domain>/<resource>/page.tsx` e `[id]/page.tsx`. Use `AutoList` e `AutoForm` consumindo o endpoint de metadata:

```tsx
// page.tsx
const { data: metadata } = useMetadata('/crm/company/metadata')
return <AutoList metadata={metadata} />

// [id]/page.tsx
const { data: metadata } = useMetadata('/crm/company/metadata')
return <AutoForm metadata={metadata} defaultValues={company} onSubmit={save} />
```

Adicione a rota em `ROUTES` (`packages/types/routes.ts`) e o item de navegação no array `NAV` do sidebar.
