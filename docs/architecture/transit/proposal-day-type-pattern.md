# Proposal — DayType com Padrão Estruturado

> Status: **Em discussão** — não implementado. Registra a direção proposta, pontos abertos e checklist de validação antes de qualquer mudança no schema.

---

## Problema

O campo `code` atual é uma string livre. O sistema não consegue determinar automaticamente "esta viagem roda em quais dias da semana" sem depender de convenção implícita. Isso impede:

- Auto-atribuição de DayType ao criar viagens
- Detecção de conflito entre `ServicePeriod`s ativos
- Geração correta do plano de veículos (saber quais trips rodam num dado dia real)
- Relatórios por dia de semana

---

## Proposta

### 1. Campo `pattern: Json?` no `DayType`

Define estruturalmente quais dias do calendário esse tipo cobre. Dois shapes possíveis:

```typescript
type DayTypePattern =
  | { type: 'weekdays';     days: number[] }
  // days usa ISO weekday: 1=seg, 2=ter, 3=qua, 4=qui, 5=sex, 6=sab, 7=dom

  | { type: 'month_window'; anchor: 'start' | 'end'; days: number; baseWeekdays?: number[] }
  // baseWeekdays: restringe a janela a certos dias da semana (opcional)
  // ex: primeiros 15 dias úteis → { type: 'month_window', anchor: 'start', days: 15, baseWeekdays: [1,2,3,4,5] }
```

`pattern: null` — tipo sem auto-resolução. Só entra em cena via calendário de exceções (FERIAS, ESPECIAL).

### 2. Exemplos de catálogo

| code | name | pattern |
|------|------|---------|
| `UTIL` | Dia Útil | `{ type: 'weekdays', days: [1,2,3,4,5] }` |
| `SABADO` | Sábado | `{ type: 'weekdays', days: [6] }` |
| `DOMINGO` | Domingo | `{ type: 'weekdays', days: [7] }` |
| `SEG_QUI` | Segunda a Quinta | `{ type: 'weekdays', days: [1,2,3,4] }` |
| `SEX` | Sexta-feira | `{ type: 'weekdays', days: [5] }` |
| `PRIM_15` | Primeiros 15 dias | `{ type: 'month_window', anchor: 'start', days: 15 }` |
| `ULT_15` | Últimos 15 dias | `{ type: 'month_window', anchor: 'end', days: 15 }` |
| `FERIAS` | Férias | `null` |
| `ESPECIAL` | Especial | `null` |

### 3. Calendário de exceções — model separado (fase futura)

O DayType não sabe que "dia 25/12 usa FERIAS em vez de UTIL". Isso é responsabilidade de um model separado:

```
ServiceCalendarException {
  id         String
  branchId   String         // scoping
  date       DateTime       // data real
  dayTypeId  FK DayType     // "neste dia, trate como este tipo"
  notes      String?
}
```

Resolução para uma data real:
1. Existe `ServiceCalendarException` para essa data + filial? → usa o dayType da exceção
2. Existe CUSTOM com `pattern` que cobre essa data? → avalia em `sortOrder`, primeiro match ganha
3. Fallback: `WEEKDAY_BASE` por dia da semana (UTIL / SABADO / DOMINGO)

### 4. Ativação de `ServicePeriod` — detecção de conflito

Um `ServicePeriod` só pode ser marcado como `ACTIVE` se não houver outro `ServicePeriod ACTIVE` com viagens cujos `dayTypeId` tenham padrões sobrepostos no mesmo intervalo de datas.

**Definição de sobreposição entre dois DayTypes:**
- Ambos `weekdays`: interseção dos arrays `days` não é vazia
- Um `weekdays` + um `month_window`: o `month_window` pode cobrir dias que caem nos `weekdays` — considerar sobreposição potencial (conservador)
- Ambos `null` (FERIAS + ESPECIAL): sem sobreposição automática — só conflitam se o calendário de exceções os colocar na mesma data

**Lógica de validação no `ServicePeriodService.activate(id)`:**

```
1. Buscar todos os ServicePeriods ACTIVE da mesma filial
2. Para cada um, verificar se o intervalo [validFrom, validTo] se sobrepõe
3. Para os que se sobrepõem em data, buscar os DayTypes usados nas trips de cada período
4. Se algum par de DayTypes tem padrão sobreposto → rejeitar com erro descritivo
```

> ⚠️ **Ponto aberto:** o que exatamente "conflito" significa em termos de negócio precisa ser confirmado. Dois períodos ativos com UTIL sobrepostos em datas é claramente um problema. Dois períodos com UTIL e SEG_QUI sobrepostos em datas também é (SEG_QUI ⊂ UTIL). Dois períodos com SEG_QUI e SEX sobrepostos não é (conjuntos disjuntos).

---

## Pontos Abertos para Validação

### P1 — Conflito de padrão: sortOrder é suficiente?
Quando segunda-feira bate em `UTIL [1-5]` e `SEG_QUI [1-4]` ao mesmo tempo, o sistema resolve por `sortOrder` (menor número ganha) ou isso indica erro de modelagem pelo usuário? Se `sortOrder` resolve, ele deve ser único por filial para tipos com `pattern` não-nulo?

### P2 — `month_window` sem `baseWeekdays`: o que cobre?
"Primeiros 15 dias" sem restrição de dia da semana cobre todos os dias (seg-dom) do dia 1 ao 15, ou apenas dias úteis implícitos? Precisa de `baseWeekdays` obrigatório, ou o default é "todos os dias"?

### P3 — FERIAS e ESPECIAL no form de viagem
Quando o usuário cria uma viagem e escolhe `dayTypeId = FERIAS` (pattern null), o sistema não consegue auto-atribuir esse tipo. Isso é intencional — o usuário escolhe explicitamente. Mas no gerador do plano, como o solver sabe quais trips de FERIAS incluir numa execução? O `VehiclePlan` precisa de um campo extra "forçar este dayType para esta data" ou isso vem do `ServiceCalendarException`?

### P4 — Seed dos tipos base
Os três tipos base (UTIL, SABADO, DOMINGO) devem ser seedados automaticamente e protegidos contra exclusão? Ou o usuário pode recriá-los livremente? Protegê-los simplifica a lógica de fallback.

### P5 — Retrocompatibilidade
O `code` atual é string livre. A migração para `pattern` não quebra dados existentes (adiciona coluna nullable), mas trips já criadas com um `dayTypeId` que não tem `pattern` ficam sem semântica estruturada. Precisa de script de preenchimento após a migração.

---

## Checklist antes de implementar

- [ ] Confirmar definição de "conflito" entre ServicePeriods (P1)
- [ ] Decidir comportamento de `month_window` sem `baseWeekdays` (P2)
- [ ] Definir como o solver recebe o contexto de qual DayType está ativo numa data real (P3)
- [ ] Decidir sobre seed + proteção dos tipos base (P4)
- [ ] Planejar script de migração de dados existentes (P5)
- [ ] Revisar impacto no form: quando `pattern === null`, ocultar/desabilitar campos de padrão
- [ ] Revisar impacto no solver: `SolverConfig` precisa receber o DayType resolvido para a data, não apenas o ID
- [ ] Atualizar `transit.md` seção 2.2 após decisões tomadas

---

## Alterações de Schema Previstas

```prisma
model DayType {
  id          String   @id @default(uuid())
  code        String   @unique
  name        String
  description String?
  pattern     Json?    // DayTypePattern | null
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  trips        TransitTrip[]
  vehiclePlans VehiclePlan[]

  @@map("transit_day_types")
}

// Fase futura — calendário de exceções
model ServiceCalendarException {
  id        String   @id @default(uuid())
  branchId  String
  date      DateTime
  dayTypeId String
  notes     String?
  createdAt DateTime @default(now())

  branch  Branch  @relation(fields: [branchId], references: [id])
  dayType DayType @relation(fields: [dayTypeId], references: [id])

  @@unique([branchId, date])
  @@map("transit_service_calendar_exceptions")
}
```

```typescript
// packages/schemas/transit/day-type.schema.ts — adição prevista
pattern: z.union([
  z.object({
    type: z.literal('weekdays'),
    days: z.array(z.int().min(1).max(7)),
  }),
  z.object({
    type:         z.literal('month_window'),
    anchor:       z.enum(['start', 'end']),
    days:         z.int().min(1).max(31),
    baseWeekdays: z.array(z.int().min(1).max(7)).optional(),
  }),
]).nullable().optional().meta({
  label:       'Padrão de dias',
  showInForm:  true,
  widget:      'day-pattern',  // componente custom — a definir
}),
```
