# Job Queue — Background Processing

## Problema

Algumas operações do sistema são longas demais para rodar dentro de um request HTTP:
sync com ERP (upload de TXT), geração de relatórios PDF, etc. O usuário precisa poder
disparar o processo, sair da tela e voltar para verificar o resultado.

---

## Modelo de dados

```prisma
// apps/api/prisma/schema/core.prisma

model Job {
  id          String    @id @default(uuid())
  type        String    // 'employee-sync', 'vehicle-sync', 'pdf-report'
  domain      String    // 'hr', 'fleet', 'core'
  resource    String    // 'employee', 'vehicle'
  status      JobStatus @default(PENDING)
  createdById String
  createdBy   User      @relation(fields: [createdById], references: [id])
  startedAt   DateTime?
  completedAt DateTime?
  durationMs  Int?
  input       Json?     // parâmetros passados ao job (ex: nome do arquivo, filtros)
  output      Json?     // resumo estruturado: { created, updated, deactivated, ... }
  outputFile  String?   // path para arquivo gerado (PDF, CSV, etc.)
  errors      Json?     // erros por registro: [{ line, record, message }] — não travam o job
  error       String?   // erro catastrófico que abortou o processo
  createdAt   DateTime  @default(now())

  @@map("jobs")
}

enum JobStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
}
```

**Distinção `errors` vs `error`:**
- `errors: Json?` — erros por linha/registro que não travam o processo (ex: CPF inválido na linha 14)
- `error: String?` — falha catastrófica que abortou o job; processo não chegou ao fim

Um job pode terminar com `status: COMPLETED` e ainda ter entradas em `errors` — significa que
o processo concluiu, mas algumas linhas foram puladas.

---

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/:domain/:resource/sync` | Cria o job, dispara async, retorna `{ jobId }` com 202 |
| `GET` | `/core/job` | Lista jobs visíveis ao usuário (filtrado por permissão) |
| `GET` | `/core/job/:id` | Status + output + errors do job |
| `GET` | `/core/job/:id/file` | Download do `outputFile` quando existir |

O endpoint de sync retorna **202 Accepted** imediatamente com o `jobId`. O frontend
usa o `jobId` para acompanhar o progresso.

---

## Arquitetura backend

### JobService — infraestrutura genérica

`apps/api/src/modules/core/job/job.service.ts`

Responsável por criar jobs, atualizar status e salvar output. Não conhece nenhuma
lógica de negócio.

```typescript
@Injectable()
export class JobService {
  async create(data: {
    type: string
    domain: string
    resource: string
    createdById: string
    input?: unknown
  }): Promise<Job>

  async run(jobId: string, handler: () => Promise<unknown>): Promise<void> {
    await this.markRunning(jobId)
    const start = Date.now()
    try {
      const output = await handler()
      await this.markCompleted(jobId, output, Date.now() - start)
    } catch (err) {
      await this.markFailed(jobId, err.message, Date.now() - start)
    }
  }

  // markRunning, markCompleted, markFailed — privados
}
```

### Handler por tipo — lógica própria

Cada domain implementa seu próprio handler. O handler é responsável por:
1. Parsear o input (arquivo TXT, parâmetros, etc.)
2. Executar a lógica de negócio
3. Retornar o output estruturado

```typescript
// apps/api/src/modules/hr/employee/employee-sync.service.ts
@Injectable()
export class EmployeeSyncService {
  constructor(
    private readonly jobService: JobService,
    private readonly prisma: PrismaService,
  ) {}

  async sync(file: Buffer, userId: string): Promise<{ jobId: string }> {
    const job = await this.jobService.create({
      type: 'employee-sync',
      domain: 'hr',
      resource: 'employee',
      createdById: userId,
      input: { filename: file.originalname },
    })

    // fire-and-forget — não awaita
    this.jobService.run(job.id, () => this.execute(file))

    return { jobId: job.id }
  }

  private async execute(file: Buffer) {
    const rows = parseEmployeeTxt(file)   // parser específico deste relatório
    const errors: Array<{ line: number; record: string; message: string }> = []
    let created = 0, updated = 0, deactivated = 0

    const erpCodes = rows.map(r => r.erpCode)

    for (const row of rows) {
      try {
        await this.prisma.employee.upsert({
          where:  { erpCode: row.erpCode },
          create: { ...row, status: 'ACTIVE' },
          update: { ...row },
        })
        // incrementa created ou updated conforme o caso
      } catch (err) {
        errors.push({ line: row._line, record: row.erpCode, message: err.message })
      }
    }

    // funcionários ausentes da lista → inativar (ERP sempre ganha)
    const deactivated = await this.prisma.employee.updateMany({
      where:  { erpCode: { notIn: erpCodes }, status: 'ACTIVE' },
      data:   { status: 'INACTIVE' },
    })

    return { created, updated, deactivated: deactivated.count, errors }
  }
}
```

### Regra: ERP sempre ganha

Para todos os models sincronizados, o ERP é a fonte de verdade:
- Registros presentes no arquivo → upsert completo (todos os campos sobrescritos)
- Registros ausentes do arquivo → tratamento específico por model (soft delete, inativação, etc.)
- Campos que existem apenas no Nyx (anotações internas, configurações locais) → preservados no upsert

A lógica de "o que fazer com ausentes" é hardcoded por model — não há como abstrair pois
a semântica varia (funcionário ausente = inativar; veículo ausente = pode ser outro tratamento).

---

## Identificador ERP

Cada model sincronizável tem um campo natural que serve como chave de identificação no ERP.
Não é criado um campo genérico `erpCode` — usa-se o campo que já existe e faz esse papel:

| Model | Campo identificador | Valor no arquivo TXT |
|-------|--------------------|-----------------------|
| `Employee` | `code` (matrícula) | coluna `matricula` |
| `Vehicle` | `plate` (placa) | coluna `placa` |

O campo deve ser `@unique` no Prisma. O upsert usa esse campo como chave — nunca o UUID
interno. Isso garante que o UUID interno (referenciado por outras tabelas) nunca muda entre syncs.

```typescript
// Employee — usa code (matrícula) como chave
await this.prisma.employee.upsert({
  where:  { code: row.matricula },
  create: { ...row },
  update: { ...row },
})
```

---

## Parser por relatório

O formato TXT do Globus Praxio varia por relatório. Cada sync implementa seu próprio parser:

```
apps/api/src/modules/hr/employee/employee-sync.parser.ts
apps/api/src/modules/fleet/vehicle/vehicle-sync.parser.ts
```

Não há parser genérico — cada um conhece o layout do seu relatório específico.

---

## Frontend

### Botão de sync na topbar

Páginas de list de models sincronizáveis incluem um botão "Sincronizar" na topbar.
O clique abre um `<input type="file">` (ou modal com drag-drop). Ao selecionar o arquivo,
o frontend faz `POST /:domain/:resource/sync` com `multipart/form-data` e recebe `{ jobId }`.

### Acompanhamento com polling

```typescript
const { data: job } = useQuery({
  queryKey: ['job', jobId],
  queryFn:  () => apiFetch(`/core/job/${jobId}`).then(r => r.json()),
  refetchInterval: (data) =>
    data?.status === 'PENDING' || data?.status === 'RUNNING' ? 2000 : false,
})
```

O polling para automaticamente quando o job termina (`COMPLETED` ou `FAILED`).

### Página de jobs

`/core/job` — lista todos os jobs visíveis ao usuário, com status, duração, quem criou
e link para o output. Renderizada via `AutoList` com filtros por `status`, `type` e `domain`.

---

## Permissões

Um usuário vê jobs de `domain/resource` para os quais tem permissão `read`.
Admins veem todos os jobs. Implementado no `GET /core/job` com filtro por `domain` + `resource`
cruzado com as permissões CASL do usuário.

O `Job` é um resource do domínio `core` — aparece no sidebar como qualquer outro resource,
com listagem genérica via `AutoList`.

---

## Output estruturado

Todo handler retorna um objeto consistente salvo em `output`:

```typescript
// sync
{ created: 5, updated: 12, deactivated: 2, errors: [...] }

// geração de relatório
{ pages: 4, records: 87 }  // outputFile aponta para o PDF gerado
```

O frontend exibe o `output` formatado na página do job após a conclusão.

---

## Quando considerar BullMQ / Redis

A Job Table resolve sem dependências extras. Migrar para BullMQ faz sentido apenas se no
futuro o sistema precisar de:

- Retry automático com backoff exponencial
- Jobs agendados (cron)
- Concorrência controlada (máx N jobs simultâneos por tipo)
- Filas com prioridade

O design atual não bloqueia essa migração — a `Job` table e os handlers por tipo
permanecem; só a camada de execução muda.
