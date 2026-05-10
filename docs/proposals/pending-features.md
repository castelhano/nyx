# Pending Features — Specification & Implementation Plan

> Document de referência para as próximas etapas de desenvolvimento. Cada seção descreve o que construir, as decisões de design relevantes e os artefatos que precisam ser criados. Leia antes de implementar qualquer item.

---

## 1. Telas de Criação e Edição de Usuário

### 1.1 Lista de usuários (`/core/user`)

Substituir o `AutoList` genérico por uma página customizada `app/core/user/page.tsx` com:

**Filtros na toolbar:**
- Por empresa (dropdown com busca) — filtra pelos usuários que têm `UserBranch` em filiais daquela empresa
- Por filial (dropdown dependente da empresa selecionada)
- Por role (`admin | operator | viewer | driver`)
- Por status (`ativo | inativo`)

**Colunas extras:**
- Coluna "Filiais" mostrando badge com quantidade de filiais associadas

**Ação de linha:**
- "Copiar permissões" — abre modal de seleção de usuário destino (ver 1.4)

---

### 1.2 Form de usuário — layout em abas

Página customizada `app/core/user/[id]/page.tsx` com três abas:

#### Aba "Dados"
Campos do `userSchema` exceto `passwordHash`, `preferences`, `lastLoginAt`.

**Bloco de senha — condicional:**
- **Criação:** campo "Senha" (obrigatório) + "Confirmar senha"
- **Edição:** bloco colapsado por padrão com botão "Alterar senha", ao expandir mostra "Senha atual" + "Nova senha" + "Confirmar"
- Mostrar os critérios da `PasswordPolicy` atual em tempo real abaixo do campo de nova senha (busca em `GET /core/password-policy`), com indicadores visuais (✓/✗) que atualizam enquanto o usuário digita

#### Aba "Filiais" — componente `AssociationList`
Ver especificação do componente na seção 1.3.

Dados: `GET /core/user-branch/by-user/:id`
Salvar: `PUT /core/user-branch/by-user/:id` (substituição atômica)

#### Aba "Permissões" — componente `CheckboxGroup` + grupos
Ver especificação na seção 1.4.

Dados: `GET /core/user-permission/by-user/:id`
Salvar: `PUT /core/user-permission/by-user/:id` (substituição atômica)

---

### 1.3 Componente `AssociationList`

**Localização:** `apps/web/src/components/ui/association-list.tsx`

**Comportamento:**
- Lista de itens já associados, cada linha com: `[label da filial]  [select de role ▼]  [× remover]`
- Botão "+ Adicionar" abre um **combobox com busca** (`Popover` + input de filtro) listando as filiais disponíveis (não ainda associadas)
- Estado local — só persiste ao salvar a aba (botão "Gravar" na topbar)
- Em mobile: cards verticais em vez de linha horizontal, role select em largura total

**Props:**
```typescript
interface AssociationListProps {
  items:      { id: string; label: string; sublabel?: string; role: string }[]
  roleOptions: { value: string; label: string }[]
  available:  { id: string; label: string; sublabel?: string }[]  // para o combobox
  onChange:   (items: { id: string; role: string }[]) => void
  placeholder?: string  // texto do botão adicionar
}
```

**`sublabel`** para filiais mostrará a cidade/UF.

---

### 1.4 Componente `CheckboxGroup`

**Localização:** `apps/web/src/components/ui/checkbox-group.tsx`

**Comportamento:**
- Grupos colapsáveis (acordeão), cada grupo com: título + "marcar todos" + "desmarcar todos"
- Input de filtro no topo que filtra por nome de grupo e opção
- Botão global "Marcar todos" / "Desmarcar todos" no header do componente
- Estado local — persiste ao salvar

**Props:**
```typescript
interface CheckboxGroupProps {
  groups: {
    key:     string
    label:   string
    options: { key: string; label: string }[]
  }[]
  value:    { group: string; option: string }[]  // pares selecionados
  onChange: (value: { group: string; option: string }[]) => void
}
```

**Para permissões:**
- `groups` = recursos (`User`, `Company`, `Branch`, …)
- `options` = ações (`read`, `create`, `update`, `delete`)
- Colunas fixas de ações com checkboxes em cada linha — mais legível que acordeão puro

Considerar layout de **tabela** em desktop (recursos como linhas, ações como colunas) e acordeão em mobile.

---

### 1.5 Grupos de permissões (Permission Templates)

**Problema:** definir permissões campo a campo por usuário não escala. Usuários com o mesmo perfil operacional deveriam herdar um conjunto pré-definido.

**Solução: `PermissionGroup` (modelo no banco)**

```prisma
model PermissionGroup {
  id          String   @id @default(uuid())
  name        String   @unique  // ex: "Operador CRM", "Visualizador Geral"
  description String?
  permissions Json     // [{ resource: 'Company', action: 'read' }, ...]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("permission_groups")
}
```

**Na aba Permissões do form de usuário:**
- Dropdown "Aplicar grupo" → seleciona um `PermissionGroup` → mescla (ou substitui) as permissões atuais
- Botão "Salvar como grupo" → abre modal para nomear e salvar as permissões atuais como novo template
- O grupo é só uma referência de conveniência: ao aplicar, copia os registros para `UserPermission`. Não há FK — alterações futuras no grupo não afetam usuários já configurados (comportamento explícito e auditável)

**Tela de gerenciamento de grupos:** `/core/permission-group` — CRUD padrão com `AutoList`/`AutoForm` ou página simples com `CheckboxGroup` embutido.

**Artefatos a criar:**
- `PermissionGroup` no `schema.prisma`
- `packages/schemas/core/permission-group.schema.ts`
- `apps/api/src/modules/core/permission-group/` (service, controller, module, routes)
- Entrada em `domains.ts` ou só acessível via tela de usuário

---

### 1.6 Copiar permissões entre usuários

**Fluxo:**
1. Na lista de usuários, ação de linha "Copiar permissões" — ou no form do usuário, botão "Copiar de outro usuário"
2. Modal com combobox de busca de usuário (nome/username)
3. Preview das permissões do usuário origem (read-only `CheckboxGroup`)
4. Opção: "Substituir" ou "Mesclar" (merge — mantém as existentes, adiciona as novas)
5. Confirmar → `PUT /core/user-permission/by-user/:targetId`

**Backend:** nenhum endpoint novo necessário — o frontend busca as permissões do usuário origem e envia para o destino via `setForUser`.

---

## 2. Tela de Política de Senha (`/core/password-policy`)

Página customizada `app/core/password-policy/page.tsx` — **singleton**, sem lista.

**Layout:** formulário único com os campos da `PasswordPolicy`, botão "Salvar" na topbar.

**Campos a exibir com UX aprimorada:**
- `minLength` — input numérico com range visual (slider ou stepper)
- `requireUppercase`, `requireNumbers`, `requireSpecial` — switches (não checkboxes)
- `historyCount` — input numérico + texto explicativo: "0 = não verifica repetição"
- `expiresInDays` — input numérico + texto: "0 = senha não expira"

**Preview em tempo real:** painel lateral (ou abaixo em mobile) mostrando como a política atual afeta a criação de senhas — lista dos critérios ativos com ícone.

**API:** `GET /core/password-policy` para carregar, `PUT /core/password-policy` para salvar.

**Nota:** remoção do `password-policy` do `domains.ts` de navegação lateral — acessível via menu de configurações, não como recurso CRUD genérico.

---

## 3. Refatoração da Tela de Login

### 3.1 Layout

**Desktop:** split layout — painel esquerdo com branding/ilustração (cor `--primary`, logo, tagline), painel direito com o formulário centralizado.

**Mobile:** formulário centralizado com logo acima, sem painel lateral.

**Design:** card com `--card` background, `--border` border, `--radius` border-radius. Input de username e senha seguindo os tokens de `--input` e `--input-bg`.

### 3.2 "Permanecer conectado"

**Estado atual:** token sempre salvo em `localStorage` (persistente) + cookie.

**Novo comportamento:**
- Checkbox "Permanecer conectado" — **default: marcado**
- **Marcado:** comportamento atual — `localStorage` + cookie com `max-age: 7d`
- **Desmarcado:** `sessionStorage` — token apagado ao fechar o navegador/aba

**Alterações em `apps/web/src/lib/auth.ts`:**
```typescript
setToken(token, persistent: boolean)
getToken()  // lê localStorage primeiro, depois sessionStorage
```

**Backend:** nenhuma alteração — o JWT continua com `expiresIn: '7d'`. A diferença é apenas onde o cliente armazena.

**"Permanecer conectado" com `expiresInDays` da policy:** quando `expiresInDays > 0`, o JWT deve ser emitido com `expiresIn` correspondente. `AuthController.login()` precisa buscar a policy e ajustar `signOptions` dinamicamente.

### 3.3 Recuperação de senha

**Fluxo:**
1. Link "Esqueci minha senha" na tela de login
2. Tela `/login/forgot-password` — input de e-mail ou username, botão "Enviar"
3. Backend gera token de reset, envia e-mail (ver 3.4)
4. Usuário clica no link do e-mail → `/login/reset-password?token=xxx`
5. Tela de redefinição (ver seção 4)

**Novo modelo no banco:**
```prisma
model PasswordResetToken {
  id        String    @id @default(uuid())
  userId    String
  token     String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("password_reset_tokens")
}
```

**Novos endpoints:**
- `POST /auth/forgot-password` — body: `{ email | username }` → gera token, envia e-mail. Sempre retorna 200 (não revelar se e-mail existe)
- `POST /auth/reset-password` — body: `{ token, newPassword }` → valida token (não expirado, não usado), aplica `PasswordPolicy.validate()`, atualiza senha, marca token como usado

### 3.4 Serviço de e-mail

**Necessário para:** recuperação de senha, futuramente notificações.

**Abordagem:** módulo `EmailModule` com `EmailService` wrappando um provider configurável via `.env`:
- Dev: `nodemailer` com `ethereal.email` (SMTP fake, sem envio real)
- Prod: variáveis `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

**Artefatos:**
- `apps/api/src/modules/email/email.service.ts`
- `apps/api/src/modules/email/email.module.ts`
- Template de e-mail de reset (HTML simples inline ou usando `handlebars`)

---

## 4. Tela de Redefinição de Senha (`/login/reset-password`)

**URL:** `/login/reset-password?token=<uuid>`

**Comportamento:**
1. Ao montar, valida o token com `GET /auth/reset-password/validate?token=xxx` — se inválido/expirado, mostra mensagem de erro e link para "Solicitar novo link"
2. Se válido, exibe o formulário
3. Busca `GET /core/password-policy` e exibe os critérios ativos
4. Campos: "Nova senha" + "Confirmar nova senha"
5. **Validação em tempo real** enquanto o usuário digita — cada critério da policy com indicador ✓/✗ colorido
6. Submit: `POST /auth/reset-password`

**Componente `PasswordStrengthIndicator`:**
- Localização: `apps/web/src/components/ui/password-strength-indicator.tsx`
- Props: `password: string`, `policy: PasswordPolicy`
- Renderiza lista de critérios com ícone colorido por status

---

## 5. Tela de Preferências do Usuário

**URL:** `/core/user/preferences` (ou acessível via menu de perfil no topbar)

**Persistência:** campo `preferences: Json` no model `User`. `PATCH /core/user/:id` com `{ preferences: {...} }`.

### 5.1 Tema

Seletor visual de tema — cards com preview de cores, não um `<select>`.

**Temas a criar** (além do `eucalyptus` existente):

| Chave | Nome | Ring / Accent |
|-------|------|---------------|
| `eucalyptus` | Eucalipto | Verde suave (existente) |
| `ocean` | Oceano | Azul médio |
| `sunset` | Pôr do Sol | Âmbar/laranja |
| `lavender` | Lavanda | Violeta suave |
| `rose` | Rosa | Rosa/vermelho suave |
| `slate` | Ardósia | Azul-cinza neutro |

Cada tema define apenas `--accent`, `--accent-foreground` e `--ring` em `.dark.theme-<key>` e `.theme-<key>`.

### 5.2 Outras preferências

| Chave | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `theme` | `string` | `''` (padrão do sistema) | Tema selecionado |
| `sidebarCollapsed` | `boolean` | `false` | Estado da sidebar memorizado |
| `tablePageSize` | `number` | `20` | Linhas por página no AutoList |
| `dateFormat` | `string` | `'DD/MM/YYYY'` | Formato de datas nas tabelas |
| `defaultBranchId` | `string \| null` | `null` | Filial pré-selecionada no contexto |
| `timezone` | `string` | `'America/Sao_Paulo'` | Timezone (útil quando o módulo de escala entrar) |
| `notificationsEnabled` | `boolean` | `true` | Receber notificações in-app (futuro) |

**`defaultBranchId`:** quando o usuário tem acesso a múltiplas filiais, pré-seleciona uma no contexto da sessão — evita ter que filtrar a cada acesso.

---

## 6. Login por PIN — Módulo de Escala (Futuro)

### 6.1 Contexto

Condutores precisarão consultar a escala de trabalho. O acesso deles deve ser:
- Autenticado por **PIN numérico** (4–6 dígitos) — sem username/password
- Extremamente restrito: apenas leitura da própria escala
- Adequado para uso em tablet/totem compartilhado

### 6.2 Integração com a estrutura atual

**Abordagem recomendada:** estender o modelo `User` existente, adicionando role `driver` e suporte a PIN. Não criar entidade separada — o condutor é um usuário do sistema com capacidades restritas.

**Alterações no schema:**

```prisma
enum UserRole {
  admin
  operator
  viewer
  driver    // novo — acesso por PIN, permissões extremamente restritas
}

model User {
  // ... campos existentes ...
  pin         String?   // hash do PIN (bcrypt), nullable
  loginMode   LoginMode @default(standard)
}

enum LoginMode {
  standard  // username + password
  pin       // PIN numérico
}

model PinPolicy {
  id         String  @id @default(uuid())
  minLength  Int     @default(4)
  maxLength  Int     @default(6)
  expiresInDays Int  @default(0)
  updatedAt  DateTime @updatedAt

  @@map("pin_policy")
}
```

**Novo endpoint:**
```
POST /auth/login/pin  →  body: { userId, pin }  →  JWT com role=driver
```

**CASL para `driver`:**
```typescript
if (user.role === 'driver') {
  can('read', 'Schedule', { userId: user.id })  // somente própria escala
  can('read', 'OwnProfile')
}
```

**Frontend — portal do condutor:**
- Rota separada: `/driver` com layout próprio (sem sidebar, sem topbar de ações)
- Tela de PIN: teclado numérico virtual (touch-friendly), input de 4–6 dígitos com máscara `• • • •`
- Após login: apenas tela de escala (`/driver/schedule`)
- "Auto-logout" por inatividade (ex: 5 minutos) — diferente do comportamento padrão

**Configuração do condutor:**
- Na tela de usuário, quando `role = driver`: aba "PIN" em vez de "Permissões" — campo para definir/redefinir o PIN
- Admin define o PIN inicial; condutor pode redefinir no portal (se permitido pela policy)

### 6.3 O que precisa ser construído quando chegar nessa fase

- Migrations: adicionar `pin`, `loginMode` ao `User`; criar `PinPolicy`
- `AuthController`: endpoint `POST /auth/login/pin`
- `UserService`: método `setPin(id, pin)` com hash + `PinPolicy.validate()`
- `CaslFactory`: branch para role `driver`
- Portal frontend: layout, tela de PIN, tela de escala
- `PinPolicy` settings: tela em `/core/pin-policy` similar à política de senha

---

## 7. Itens Adicionais Não Mencionados

### 7.1 Módulo de auditoria (Audit Log)

Rastrear quem alterou o quê e quando. Útil para compliance e debugging.

**Abordagem mínima:**
```prisma
model AuditLog {
  id         String   @id @default(uuid())
  userId     String?  // null = sistema
  action     String   // 'create' | 'update' | 'delete'
  resource   String   // 'User', 'Company', etc.
  resourceId String
  before     Json?
  after      Json?
  createdAt  DateTime @default(now())

  @@map("audit_logs")
}
```

Implementado via método `logAction()` no `BaseService` ou via interceptor NestJS. Fase futura — registrar só em recursos críticos inicialmente (User, PasswordPolicy).

### 7.2 Rate limiting no login

`POST /auth/login` sem rate limit é vulnerável a brute force.

**Solução:** `@nestjs/throttler` — configurar limite por IP (ex: 10 tentativas / minuto). Já disponível como package NestJS, sem dependências pesadas.

```typescript
@Throttle({ default: { limit: 10, ttl: 60000 } })
@Post('login')
async login() { ... }
```

### 7.3 Refresh token

O JWT atual expira em 7 dias e não tem revogação. Para produção:

- JWT de acesso: `expiresIn: '15m'`
- Refresh token: opaco, armazenado em `httpOnly cookie`, `expiresIn: '30d'`
- Novo model `RefreshToken` no banco (permite revogação)
- Endpoint `POST /auth/refresh`

Implementar junto com a refatoração de login (seção 3).

### 7.4 Validação de e-mail único no frontend

Atualmente a unicidade de `email` é só validada no banco (constraint). O form deveria fazer `GET /core/user?email=xxx` para checar disponibilidade antes do submit, com debounce.

### 7.5 Foto/avatar do usuário

Campo `avatarUrl String?` no `User`. Upload via endpoint dedicado `POST /core/user/:id/avatar` que salva o arquivo localmente ou em S3/bucket. Exibido no topbar e na lista de usuários.

### 7.6 Contexto de filial ativo

Quando o usuário tem acesso a múltiplas filiais, o sistema precisa saber **qual filial está ativa** na sessão para filtrar dados. Opções:

- Seletor de filial no topbar (persistido em `preferences.defaultBranchId`)
- O `branchId` ativo é incluído nas requests como header (`X-Branch-Id`) ou query param
- O `BaseService.findAll()` recebe o `branchId` ativo e aplica o filtro

Isso é necessário antes de construir qualquer módulo de dados (escala, financeiro, etc.) que seja scoped por filial.
