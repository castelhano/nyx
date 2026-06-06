# Transit Settings — Arquitetura de Scoring

> Documentação da abordagem de configuração e cálculo de pontuação para os domínios `planning` e `schedule` do módulo transit.

---

## 1. Visão Geral

O settings de transit é dividido em três escopos independentes:

| Escopo | Consumido por | Fase |
|---|---|---|
| `general` | Toda a operação transit | 1 |
| `planning` | Solver VSP (geração de blocos de veículo) | 1 |
| `schedule` | Solver de escala de motoristas | 2 |

Cada escopo tem um registro global e pode ter overrides por filial. O solver de cada fase lê **apenas** o escopo relevante.

---

## 2. Estrutura do Settings

```js
const transitSettings = {
  general: {
    global: {
      operationalDayStartHour: { value: 3, hint: 'Viagens entre 00:00 e este horário pertencem ao dia operacional anterior' },
    },
  },

  planning: {
    global: {
      // Flat: calculados sobre o plano inteiro, penalizam ou bonificam o score final
      flat: {
        fleetUsage:          { type: 'flat', active: true,  direction: 'minimize', weight: 300, hint: 'Custo por veículo utilizado no plano' },
        deadrunKm:           { type: 'flat', active: true,  direction: 'minimize', weight: 50,  hint: 'Custo por km em vazio no plano' },
        totalKm:             { type: 'flat', active: true,  direction: 'minimize', weight: 2,   hint: 'Custo por km total percorrido no plano' },
        distributionVariance:{ type: 'flat', active: true,  direction: 'minimize', weight: 200, hint: 'Penaliza planos com distribuição desbalanceada de km entre blocos (coeficiente de variação)' },
        specialFleetUsage:   { type: 'flat', active: true,  direction: 'minimize', weight: 150, hint: 'Custo por bloco que requer tipo de veículo especial (requiredVehicleType)' },
        driverUsage:         { type: 'flat', active: false, direction: 'minimize', weight: 150, hint: '[Fase 2] Custo por condutor utilizado no plano' },
        overtime:            { type: 'flat', active: false, direction: 'minimize', weight: 6,   hint: '[Fase 2] Custo por minuto de hora extra no plano' },
      },

      // Range: calculados por bloco, contribuem para o scoreBloco
      range: {
        lineTransfer:  { type: 'count', active: true, modifier: 1.0, floor: 0, idealMin: 0, idealMax: 0, ceiling: 4,  hint: 'Número de trocas de linha no bloco (linhas distintas - 1); zero = bloco com linha única' },
        tripInterval:  { type: 'min',   active: true, modifier: 0.3, floor: 3, idealMin: 5, idealMax: 10, ceiling: 15, hint: 'Menor intervalo entre viagens consecutivas no bloco (minutos)' },
        deadrunRatio:  { type: 'perc',  active: true, modifier: 1.0, floor: 0, idealMin: 0, idealMax: 10, ceiling: 25, hint: 'Proporção de km em vazio sobre o total do bloco (%)' },
      },
    },

    // Override por branch: armazena config completa; UI pré-carrega global como ponto de partida
    // branchX: { flat: { ... }, range: { ... } }
  },

  schedule: {
    global: {
      // Range: calculados por turno/bloco de condutor
      range: {
        layover:            { type: 'min',  active: true, modifier: 1.0, floor: 360, idealMin: 440, idealMax: 550, ceiling: 560, hint: 'Duração total do turno (minutos)' },
        shiftBreak:         { type: 'min',  active: true, modifier: 1.0, floor: 60,  idealMin: 70,  idealMax: 110, ceiling: 120, hint: 'Duração da pausa dentro do turno (minutos)' },
        interShiftRest:     { type: 'min',  active: true, modifier: 1.0, floor: 600, idealMin: 660, idealMax: 960, ceiling: 960, hint: 'Descanso entre turnos consecutivos do mesmo condutor (minutos)' },
        splitShiftInterval: { type: 'min',  active: true, modifier: 1.0, floor: 60,  idealMin: 60,  idealMax: 240, ceiling: 250, hint: 'Intervalo entre as partes de um turno partido (minutos)' },
        driverPrefLine:     { type: 'perc', active: true, modifier: 1.0, floor: 90,  idealMin: 90,  idealMax: 100, ceiling: 100, hint: '% de viagens do turno nas linhas preferenciais do condutor' },
        driverPrefTech:     { type: 'perc', active: true, modifier: 1.0, floor: 90,  idealMin: 90,  idealMax: 100, ceiling: 100, hint: '% de viagens do turno com tecnologia de veículo preferencial do condutor' },
      },
    },
  },
}
```

---

## 3. Campos — Referência

### 3.1 Campos comuns

| Campo | Tipo | Descrição |
|---|---|---|
| `active` | Boolean | `false` → critério ignorado completamente no cálculo |
| `hint` | String | Texto de ajuda exibido na UI |

### 3.2 Campos exclusivos de `flat`

| Campo | Tipo | Descrição |
|---|---|---|
| `type` | `'flat'` | Identificador do tipo; usado na UI |
| `direction` | `'minimize' \| 'maximize'` | Determina o sinal na fórmula: minimize subtrai, maximize soma |
| `weight` | Float | Custo por unidade da quantidade medida |

### 3.3 Campos exclusivos de `range`

| Campo | Tipo | Descrição |
|---|---|---|
| `type` | `'min' \| 'perc' \| 'count'` | Unidade do valor medido; usado apenas na UI |
| `modifier` | Float | Peso do critério no score do bloco |
| `floor` | Number | Limite inferior absoluto; abaixo: penalidade proporcional |
| `idealMin` | Number | Início da zona ideal |
| `idealMax` | Number | Fim da zona ideal |
| `ceiling` | Number | Limite superior absoluto; acima: penalidade proporcional |

---

## 4. Definição dos Critérios

### 4.1 `general`

| Critério | V medido |
|---|---|
| `operationalDayStartHour` | Hora de início do dia operacional (0–6); viagens entre 00:00 e este horário pertencem ao dia anterior |

### 4.2 `planning.flat`

Calculados sobre o candidato completo (plano inteiro). Requerem acesso a todos os blocos simultaneamente.

| Critério | Quantity (`V`) | Fase |
|---|---|---|
| `fleetUsage` | `count(blocos no plano)` | 1 |
| `deadrunKm` | `Σ BlockTrip.deadheadKm` do plano | 1 |
| `totalKm` | km produtivo + km em vazio do plano | 1 |
| `distributionVariance` | `desvio_padrão(blockKm) / média(blockKm)` — coeficiente de variação; 0 = distribuição perfeita | 1 |
| `specialFleetUsage` | `count(blocos com requiredVehicleType definido)` — incentiva consolidar viagens especiais em menos veículos | 1 |
| `driverUsage` | `count(condutores distintos no plano)` | 2 |
| `overtime` | `Σ minutos de hora extra no plano` | 2 |

### 4.3 `planning.range`

Calculados por bloco em isolamento, sem necessidade de contexto do plano.

| Critério | V medido |
|---|---|
| `lineTransfer` | `count(lineIds distintos no bloco) - 1` — número de trocas de linha; 0 = bloco com linha única (ideal) |
| `tripInterval` | Menor intervalo entre viagens consecutivas no bloco (minutos) |
| `deadrunRatio` | `deadrunKm / totalKm` do bloco (%) |

### 4.4 `schedule.range`

Calculados por turno de condutor. Todos são Fase 2.

| Critério | V medido |
|---|---|
| `layover` | Duração total do turno (minutos) |
| `shiftBreak` | Duração da pausa dentro do turno (minutos) |
| `interShiftRest` | Descanso entre turnos consecutivos do mesmo condutor (minutos) |
| `splitShiftInterval` | Intervalo entre partes de um turno partido (minutos) |
| `driverPrefLine` | % de viagens do turno nas linhas preferenciais do condutor |
| `driverPrefTech` | % de viagens do turno com tecnologia de veículo preferencial do condutor |

---

## 5. Fórmula de Cálculo

### 5.1 Score base por critério (range)

Para um valor `V` medido no bloco:

**Zona ideal** (`idealMin ≤ V ≤ idealMax`):
```
scoreBase = 100
```

**Tolerância inferior** (`floor ≤ V < idealMin`):
```
scoreBase = ((V - floor) / (idealMin - floor)) × 100
```

**Tolerância superior** (`idealMax < V ≤ ceiling`):
```
scoreBase = ((ceiling - V) / (ceiling - idealMax)) × 100
```

**Fora dos limites** (`V < floor` ou `V > ceiling`):
```
scoreBase = 0

// Abaixo do floor (idealMin > floor):
penalidade = -((floor - V) / (idealMin - floor)) × 100

// Acima do ceiling (ceiling > idealMax):
penalidade = -((V - ceiling) / (ceiling - idealMax)) × 100

// Se a janela de tolerância for zero (idealMin === floor ou ceiling === idealMax):
penalidade = -100   // penalidade imediata máxima
```

> **Zona ideal de largura zero** (`idealMin === idealMax`): qualquer desvio entra imediatamente na tolerância. Ex: `lineTransfer` com `idealMin = idealMax = 0` — qualquer troca de linha já penaliza.

### 5.2 Pontuação individual do critério (range)

```
pontuacaoCriterio = (scoreBase + penalidade) × modifier
```

Dentro dos limites `penalidade = 0`, simplifica para `scoreBase × modifier`.

### 5.3 Score do bloco

Soma das pontuações de todos os critérios `range` ativos:

```
scoreBloco = Σ pontuacaoCriterio(i)   para cada range ativo
```

### 5.4 Score final do plano

```
scoreFinal = Σ scoreBloco(i)
           ± Σ (quantity(j) × weight(j))   para cada flat ativo
```

O sinal de cada `flat` é determinado por `direction`:
- `minimize` → subtrai (penaliza quantidade maior)
- `maximize` → soma (bonifica quantidade maior)

O solver **maximiza** `scoreFinal`.

**Exemplo concreto:**
```
scoreFinal = 48.000   (soma dos blocos — range criteria)
           - (55  × 300)   // fleetUsage:           55 veículos
           - (0.18 × 200)  // distributionVariance:  18% coef. variação
           - (4   × 150)   // specialFleetUsage:     4 blocos articulado
           - (820 × 2  )   // totalKm:              820 km
           - (95  × 50 )   // deadrunKm:             95 km ociosos

= 48.000 - 16.500 - 36 - 600 - 1.640 - 4.750
= 24.474
```

---

## 6. Resolução de Settings por Branch

### 6.1 Modelo de storage

Cada escopo (`transit.general`, `transit.planning`, `transit.schedule`) tem uma row na tabela `settings` por scope:

```
{ key: 'transit.planning', scope: 'global',  value: { flat: {...}, range: {...} } }
{ key: 'transit.planning', scope: 'branchX', value: { flat: {...}, range: {...} } }  // config completa
```

A row de branch armazena sempre a **configuração completa** — não um delta. A UI pré-carrega os valores globais como ponto de partida quando a branch ainda não tem config própria; o admin ajusta o que quer e salva o config inteiro.

### 6.2 Fallback no `get()`

```
get(section, branchId?) {
  if (branchId) {
    row = settings.findUnique({ key: `transit.${section}`, scope: branchId })
    if (row) return schema.parse(row.value)
  }
  row = settings.findUnique({ key: `transit.${section}`, scope: 'global' })
  return schema.parse(row?.value ?? {})   // Zod preenche defaults de campos ausentes
}
```

Singletons sem suporte a branch (ex: `general`) passam `branchId = undefined` — sempre retornam o global.

### 6.3 Alteração necessária no `BaseSettingsService`

A única mudança na infraestrutura compartilhada: implementar o fallback `branch → global → schema defaults` no método `get()`. Settings que não usam branch (scope fixo em `'global'`) não são afetados.

---

## 7. Considerações de Implementação

### 7.1 Separação de cálculo: bloco vs. plano

| Tipo | Quando calcular | Requer contexto do plano |
|---|---|---|
| `range` | A cada avaliação de bloco no loop do solver | Não |
| `flat` | Uma vez por candidato completo, antes de somar ao score final | Sim |

Pré-calcular os critérios ativos (`activeRange`, `activeFlat`) **uma vez** antes do loop — não filtrar a cada iteração.

### 7.2 Scoring incremental

Critérios `range` por bloco permitem scoring incremental: ao mover uma trip, só recalcular os dois blocos afetados.

Critérios `flat` **não** suportam scoring incremental — `distributionVariance` e `specialFleetUsage` dependem do estado de todos os blocos. Recalcular o score flat completo a cada candidato é aceitável dado o custo O(blocos), não O(trips²).

### 7.3 Critérios inativos (`active: false`)

Early-return explícito no solver — critério inativo não contribui com score nem penalidade:

```typescript
for (const [key, criterion] of Object.entries(activeRange)) {
  if (!criterion.active) continue
  // ...
}
```

### 7.4 Zona ideal de largura zero (`idealMin === idealMax`)

Matematicamente válido. `lineTransfer` com `idealMin = idealMax = 0` significa que apenas blocos de linha única atingem score máximo — qualquer transferência já entra na tolerância superior. Documentar no `hint`.

### 7.5 UI — Custom Page

A tela de configuração de transit settings é uma custom page, não AutoForm. Cada seção (`general`, `planning`, `schedule`) renderiza seus critérios em tabela editável com colunas por campo. Critérios de Fase 2 (`active: false`) são exibidos com indicação visual de fase futura.

---

## 8. TODO — Etapas de Execução

### Etapa 1 — Infraestrutura: fallback no BaseSettingsService
- [ ] Adicionar fallback `branch → global → defaults` no `get(branchId?)` do `BaseSettingsService`
- [ ] Garantir que singletons sem branch (`scope: 'global'` fixo) não são afetados

### Etapa 2 — Schemas Zod dos novos settings
- [ ] `packages/schemas/transit/settings-general.schema.ts` — `operationalDayStartHour`
- [ ] `packages/schemas/transit/settings-planning.schema.ts` — shape completo de `flat` + `range`
- [ ] `packages/schemas/transit/settings-schedule.schema.ts` — shape completo de `range`
- [ ] Tipos TypeScript exportados: `PlanningSettings`, `ScheduleSettings`, `GeneralSettings`

### Etapa 3 — Services e Controllers
- [ ] Criar `TransitGeneralConfigService` extends `BaseSettingsService` (scope: `'global'`)
- [ ] Criar `TransitPlanningConfigService` extends `BaseSettingsService` (scope: `'branch'`)
- [ ] Criar `TransitScheduleConfigService` extends `BaseSettingsService` (scope: `'branch'`)
- [ ] Controllers correspondentes com endpoints `GET` e `PUT`
- [ ] Registrar nos módulos (`NetworkModule` ou novo `TransitSettingsModule`)
- [ ] Remover `PlanningConfigService` / `PlanningConfigController` antigos após migração do solver

### Etapa 4 — Migrar o solver para a nova fórmula
- [ ] Substituir a função de score atual pela fórmula `range por bloco + flat por candidato`
- [ ] Implementar cálculo de `V` para cada critério `range` (`lineTransfer`, `tripInterval`, `deadrunRatio`)
- [ ] Implementar cálculo de `quantity` para cada critério `flat` (`fleetUsage`, `deadrunKm`, `totalKm`, `distributionVariance`, `specialFleetUsage`)
- [ ] Pré-filtrar critérios ativos no setup do worker (arrays `activeRange`, `activeFlat`)
- [ ] Remover campos obsoletos do `PlanningConfig` antigo (`minLayoverMinutes`, `maxLayoverMinutes`, `maxDeadrunSoftMinutes`, `maxDeadrunHardMinutes`, `weightMinimizeFleet`, `weightMinimizeDeadrun`, `weightBlockDuration`)
- [ ] Manter `operationalDayStartHour` e critérios de parada (`stopNoImprovementMinutes`, `stopMaxTotalMinutes`) — migrar para `general` e `planning` respectivamente

### Etapa 5 — UI Custom Page de Settings
- [ ] Página `app/transit/settings/page.tsx` com tabs `Geral`, `Planejamento`, `Escala`
- [ ] Componente de tabela editável de critérios `flat` (colunas: ativo, direção, peso, hint)
- [ ] Componente de tabela editável de critérios `range` (colunas: ativo, modifier, floor, idealMin, idealMax, ceiling, hint)
- [ ] Indicação visual de critérios de Fase 2 (`active: false` + badge "Fase 2")
- [ ] Suporte a override por branch: selector de branch + load/save independente
- [ ] Shortcuts `alt+g` (salvar), `alt+v` (voltar), `alt+l` (resetar ao servidor)

### Etapa 6 — Fase 2: Escala de Motoristas
- [ ] Ativar critérios `schedule.range` quando o solver de crew scheduling for implementado
- [ ] Ativar `planning.flat.driverUsage` e `planning.flat.overtime`
- [ ] Adicionar preferências de condutor (linhas preferenciais, tecnologia preferencial) ao modelo de dados
