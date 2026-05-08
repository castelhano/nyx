# Nyx

Monorepo full-stack com NestJS (API) e Next.js (Web), gerenciado via pnpm workspaces e Turborepo.

## Estrutura

```
nyx/
├── apps/
│   ├── api/        # NestJS + Prisma (backend)
│   └── web/        # Next.js 14 + Tailwind (frontend)
├── packages/
│   ├── schemas/    # Schemas Zod compartilhados
│   └── types/      # Tipos TypeScript compartilhados
└── docs/           # Documentação de arquitetura e uso
```

## Pré-requisitos

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 10 — instale com `npm install -g pnpm`

## Configuração do ambiente (primeiro uso)

### 1. Instalar dependências

```bash
pnpm install
```

### 2. Configurar variáveis de ambiente da API

```bash
cp apps/api/.env.example apps/api/.env
```

Edite `apps/api/.env` e ajuste os valores:

```env
DATABASE_URL="file:./dev.db"   # caminho do banco SQLite (desenvolvimento)
JWT_SECRET="troque-em-producao" # segredo para assinar tokens JWT
```

Para gerar um `JWT_SECRET` forte é possivel usar o próprio Node.js (funciona no Linux e no Windows):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

> **Importante:** nunca comite o arquivo `.env`. Ele já está no `.gitignore`.

### 3. Criar o banco de dados e aplicar migrations

```bash
cd apps/api
pnpm exec prisma migrate dev
```

### 4. Popular o banco com dados iniciais (seed)

```bash
cd apps/api
pnpm db:seed
```

Isso cria o usuário administrador padrão:

| Campo    | Valor     |
|----------|-----------|
| username | `admin`   |
| senha    | `admin123` |

> Troque a senha após o primeiro login.

### 5. Iniciar o ambiente de desenvolvimento

A partir da raiz do monorepo:

```bash
pnpm dev
```

Isso inicia em paralelo via Turbo:

| App | URL padrão            |
|-----|-----------------------|
| API | http://localhost:3000 |
| Web | http://localhost:3001 |

## Scripts disponíveis

| Comando       | Descrição                                  |
|---------------|--------------------------------------------|
| `pnpm dev`    | Inicia todos os apps em modo desenvolvimento |
| `pnpm build`  | Compila todos os apps para produção         |
| `pnpm lint`   | Executa o linter em todos os workspaces     |

### Scripts específicos da API (`apps/api/`)

| Comando                       | Descrição                           |
|-------------------------------|-------------------------------------|
| `pnpm exec prisma migrate dev` | Aplica migrations e sincroniza o schema |
| `pnpm exec prisma studio`      | Abre o Prisma Studio (GUI do banco) |
| `pnpm db:seed`                 | Popula o banco com dados iniciais   |
| `pnpm build`                   | Compila o NestJS para produção      |

## Tecnologias

- **Backend:** NestJS · Prisma ORM · SQLite (dev) · JWT · CASL (autorização)
- **Frontend:** Next.js 14 · React 18 · Tailwind CSS · TanStack Query/Table · React Hook Form · Zod
- **Tooling:** pnpm workspaces · Turborepo · TypeScript 5
