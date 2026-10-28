# Plano — Dimensionamento do quadro no console

**Status: proposta, nada implementado.**

O console (painel de escala) deve dizer de forma direta se o quadro de uma empresa e função
está ok, sobrando ou faltando, já considerando férias e o abatimento do banco de horas. O
escalante abre o painel e lê um número só.

Convenções: comentários em snippets Prisma/TS em inglês; texto em pt-BR; minutos do dia
operacional (`> 1440` = madrugada seguinte).

---

## 1. Problema

A seção Demanda × quadro mostra hoje três medidas de falta, calculadas de formas diferentes e
que não batem entre si (exemplo: VP Rod Parque · Motorista):

| Onde | Como calcula hoje | Exemplo |
|---|---|---|
| Card **Falta no quadro** (`KpiStrip`, `apps/web/src/app/transit/console/sections.tsx`) | soma o pior saldo negativo de cada turno, cada um no seu pior dia | −3 |
| Alerta **COVERAGE_SHORT** / linha **Cobríveis** | simulação da escala diária no pior dia de cada tipo (`coverageByDay`) | −4 (82/86 no domingo) |
| Coluna **Quadro** (`staffing().required`) | `ceil(maior demanda do turno × cycleFactor)`, sem olhar o regime de folga | −19 (230 contra 211) |

Nenhuma delas é "o quadro necessário":

- o card soma dias diferentes e ignora que um turno pode cobrir outro;
- a linha Cobríveis está certa, mas só para um dia e sem dizer quantas pessoas faltam;
- a coluna Quadro trata o regime como se a folga pudesse cair em qualquer dia.

Nenhuma considera férias nem banco de horas.

---

## 2. Definições

| Termo | Definição |
|---|---|
| **Quadro atual** | operadores na oferta do console (`inSupply`: escaláveis, com turno, não afastados). Férias lançadas não descontam |
| **Quadro operacional** | menor quadro que cobre todas as tabelas (plantões incluídos) em todos os dias da janela de referência (5 semanas), com os regimes de folga, as janelas de turno e as regras da escala diária da empresa |
| **Reserva de férias** | pessoas a mais para cobrir férias projetadas pelo quadro: sempre 30 dias por ano, distribuídas uniformemente (todo mês sai a mesma quantidade). Venda de férias e férias efetivamente lançadas não entram |
| **Reserva do banco** | pessoas a mais para abater com folga compensada a parte banqueada da HE **planejada**, descontada a sobra que o quadro já tem. O saldo real do banco não entra: a conta é planejada |
| **Quadro necessário** | operacional + reserva de férias + reserva do banco |
| **Saldo** | atual − necessário. Negativo = falta; positivo = sobra |

### 2.1 Por que o operacional não é a conta "chapada"

A conta pelo total da empresa (`tabelas de domingo × 2` no Sab-Dom Revezado) supõe que qualquer
operador pega qualquer tabela. Com janelas de turno, cada turno precisa do tamanho exigido pelo
**seu** dia mais apertado. Na VP Rod Parque, por exemplo:

| Turno | Útil | Sábado ×2 | Domingo ×2 | Precisa | Dia que decide |
|---|---|---|---|---|---|
| Manhã | 81 | (98, coberto pela sobra da D Pegada) | 96 | 96 | domingo |
| Tarde | 86 | 78 | 76 | 86 | útil |
| D Pegada | 29 | — (Domingo Fixo) | — | 29 | útil |
| **Total** | | | | **211** | |

A soma dos piores dias de cada turno (211) passa do pior dia da empresa inteira (`86 × 2 = 172`,
mais os 29 da D Pegada = 201). A diferença é o custo da combinação entre janelas e regimes. Se a
empresa permite cruzar turnos (seção 3), essa diferença cai.

---

## 3. Regras da escala: separar a janela do turno das restrições do operador

Hoje `ruleModes.shiftWindow` (`packages/schemas/transit/settings-roster.schema.ts`) junta três
coisas: *"Fora do turno, dos limites do operador ou de uma restrição de horário"*. Além disso,
`effectiveWindow` (`apps/api/src/modules/transit/daily/daily-checks.ts`) funde tudo numa janela
só, e os limites pessoais **substituem** os limites rígidos do turno.

A empresa precisa poder permitir que um operador da Tarde pegue uma tabela da Manhã no domingo
(com aviso, sem precisar contratar), mas **nunca** passar por cima do "não depois de" do operador
ou de uma restrição de horário aprovada no portal.

### Decisão

| Regra | Cobre | Padrão |
|---|---|---|
| `shiftWindow` — **Janela do turno** | a tabela fora dos limites rígidos do turno do operador | `BLOCK` (a empresa pode passar para `WARN`) |
| `crewWindow` (nova) — **Restrições do operador** | `notBeforeMinutes` / `notAfterMinutes` do operador e restrições de horário (`TIME_WINDOW`) aprovadas | `BLOCK` |

- O membro do modelo (`RgMember`) passa a carregar duas janelas por dia: a do turno e a pessoal
  (`[notBefore ?? −∞, notAfter ?? +∞]` ∩ restrições do dia). Cada uma é verificada pela sua
  regra, em `pairRule()` e em `blockedBy()` (`roster-generator.calc.ts`).
- Hoje o limite pessoal substitui o do turno. Com a separação, ele restringe por cima. Quando o
  limite pessoal é mais largo que o turno (alguém que pode começar antes do piso do turno), o
  efeito é uma tabela fora do turno: a regra `shiftWindow` decide. **A confirmar na
  implementação:** se há operadores cadastrados com limite pessoal mais largo que o turno de
  propósito. Se houver, a regra pessoal precisa continuar podendo alargar.
- O ajuste fino por proximidade do ideal (`range.shiftFit`) continua sendo pelo turno.
- `interShiftRest` (interjornada) não muda e continua sendo o freio natural do cruzamento: quem
  trabalhou até 23:00 no sábado não pega a Manhã do domingo; quem folgou no sábado pega.
- As configurações são JSON com default, então dispensa migração do banco. Empresas já
  configuradas recebem `crewWindow: 'BLOCK'`.

### Consequência para o console

A simulação do console (`windowModel`) já recebe o `ruleModes` da empresa. Com a separação:

| Janela do turno | Quadro operacional | Escala diária |
|---|---|---|
| `BLOCK` | pior dia de cada turno | não cruza turnos |
| `WARN` | cruza turnos onde a interjornada deixa | cruza, com aviso |

O painel e o gerador usam a mesma regra, e por isso sempre concordam.

---

## 4. O cálculo

Tudo em `apps/api/src/modules/transit/console/console.calc.ts`, por empresa e função, sobre a
janela de referência que já existe (5 semanas).

### 4.1 Quadro operacional — operadores virtuais

1. Partir da oferta atual (`inSupply`) e da simulação por dia (`windowModel` + `coverageByDay`).
2. Candidatos: um operador virtual por **turno × grupo de folga** do regime padrão do turno
   (`restGroupOffsets` do `RestPattern` do turno). O virtual tem a janela do turno e nenhuma
   restrição pessoal (linha, veículo, limites).
3. A cada rodada, adicionar o candidato que mais reduz o total descoberto na janela inteira
   (Σ dos dias de `demanda − cobertas`). Em caso de empate, o turno de menor prioridade, depois o
   grupo com menos gente.
4. Parar quando todas as tabelas de todos os dias estiverem cobertas, ou quando nenhum candidato
   reduzir o descoberto. Isso acontece com tabelas que nenhum turno aceita ou que ninguém pode
   operar por linha ou veículo: elas são reportadas à parte, como **tabelas sem encaixe**, e não
   viram pessoas.
5. **Excesso:** se o quadro atual cobre tudo, medir também a sobra. Remover operadores atuais
   enquanto a cobertura se mantiver dá a sobra de cada turno e grupo. Remover é só para a conta;
   ninguém sai do cadastro.

Resultado: `operacional = atual + adicionados − removíveis`, com a lista de adicionados e
removíveis por turno e grupo (o "onde falta", exibido de forma discreta).

Custo: poucos turnos × poucos grupos por rodada, e cada rodada refaz o emparelhamento dos dias
(a mesma operação que `coverageByDay` já faz). Uma rodada só precisa refazer os dias em que o
candidato trabalha.

### 4.2 Reserva de férias

```
fator          = 30 / 365                            (≈ 8,2%)
reserva_total  = ceil(operacional × fator)
```

- Distribuída entre turnos e grupos proporcionalmente ao operacional de cada um, pelo maior
  resto. Arredondar para cima em cada grupo inflaria o total.
- A reserva vale para os dois grupos de um regime revezado: a cada domingo, o grupo que trabalha
  perde os próprios feristas, e no domingo seguinte o outro grupo perde os seus. Por isso não é
  "metade da reserva".
- 30 dias fixos. A venda de férias vira sobra no dia e não entra na conta.

### 4.3 Reserva do banco

Por turno, sobre a HE planejada do plano efetivo:

```
HE_mês        = Σ tipo de dia: HE do tipo × dias no mês do tipo
                  dias no mês: útil 21 · sábado 4 · domingo 5     (convenção do setor)
HE do tipo    = Σ DutySummary.overtimeMinutes das tabelas do turno no tipo
banco_mês     = HE_mês × parte banqueada × % abatida
                  parte banqueada: a do banco de horas (hoje 50%, splitExtra em hour-bank.calc.ts)
                  % abatida: configuração nova (4.4)
folgas_mês    = banco_mês / jornada diária do turno
sobra_mês     = Σ tipo de dia: (trabalhando no tipo − tabelas do tipo) × dias no mês do tipo
                  trabalhando = quadro operacional + férias, descontado o fator de férias
reserva_banco = ceil(max(0, folgas_mês − sobra_mês) / dias trabalhados no mês)
                  dias trabalhados no mês = 30 × (dias T ÷ tamanho do ciclo do regime)
```

- **Jornada diária:** `weeklyHours / workDaysPerWeek` do contrato vigente, ou o `weeklyHours` do
  operador. Usa a média do turno.
- **Tipo de dia → convenção:** pelo dia da semana predominante dos dias do tipo na janela (seg–sex
  → 21, sábado → 4, domingo → 5). Feriados que caem num tipo não alteram a predominância.
- **Por turno:** a folga compensada de alguém da Manhã só é absorvida pela sobra da Manhã. Com
  `shiftWindow = WARN`, a sobra dos turnos que cruzam pode ser somada, desde que a interjornada
  permita. Na primeira versão, conta só a sobra do próprio turno.
- **Parte banqueada:** extrair o 50% de `splitExtra` para uma constante exportada, usada pelo
  banco de horas e por esta conta. Outros métodos de cálculo do banco ficam para depois e entram
  pelo mesmo ponto.

### 4.4 Configuração nova

Em `settings-roster.schema.ts`, junto das regras da escala:

| Campo | Rótulo | Padrão |
|---|---|---|
| `hourBankCompPct` | % das horas do banco abatidas com folga | 100 |

O resto dos parâmetros é derivado (30 dias de férias, convenção 21/4/5, jornada pelo contrato) e
não vira configuração.

---

## 5. Tela

### 5.1 Card

O card **Falta no quadro** passa a mostrar o saldo:

| Saldo | Card |
|---|---|
| < 0 | **Falta no quadro −X** (vermelho) |
| > 0 | **Sobra no quadro +X** |
| 0 | **Quadro ok** |

Linha de detalhe discreta, por exemplo: `operacional 211 · férias +18 · banco +3 · necessário 232`
(números ilustrativos).

### 5.2 Demanda × quadro

- A coluna **Quadro** passa a mostrar `atual / necessário` por turno, com a mesma conta
  (operacional + reservas distribuídas), em vez de `× 7/6`.
- Abaixo da tabela, de forma discreta: onde entram ou sobram pessoas (`Manhã G7 +3 · Manhã G0
  +1`) e as tabelas sem encaixe, se houver.
- As células por tipo de dia (saldo no pior dia) continuam como estão: são a leitura diária, não o
  dimensionamento.

### 5.3 Alertas

- `SHIFT_SHORT` e `COVERAGE_SHORT` passam a ser um alerta só de dimensionamento ("Faltam X no
  quadro: …"), coerente com o card.
- Novo alerta para tabelas sem encaixe (nenhum turno aceita, ou ninguém pode operar por linha ou
  veículo): o motivo não é o tamanho do quadro.

---

## 6. Ordem de implementação

1. **Regras:** `crewWindow` no schema, duas janelas no `RgMember`, `pairRule()` / `blockedBy()`,
   rótulos e ajuda nas configurações. Testes do gerador cobrindo `shiftWindow = WARN` com
   `crewWindow = BLOCK`.
2. **Operacional:** operadores virtuais em `console.calc.ts`, adicionados e removíveis, tabelas
   sem encaixe. Testes em `console.calc.spec.ts`.
3. **Férias:** fator e distribuição pelo maior resto.
4. **Banco:** constante da parte banqueada, `hourBankCompPct`, HE por turno e tipo, sobra.
5. **Snapshot e tela:** `ConsoleSnapshot` ganha o dimensionamento; card, coluna Quadro, alertas.
6. **Documentação:** `docs/architecture/transit/` (console e regras da escala).

---

## 7. Fora deste plano

- Cruzar turnos só em alguns tipos de dia (por exemplo, só no fim de semana). Com `WARN` a regra
  vale todos os dias. Na prática, o regime já limita, porque no dia útil quase não sobra ninguém
  fora do turno.
- Saldo real do banco de horas e prazo para zerá-lo.
- Outros métodos de cálculo do banco além do 50% atual.
- Venda de férias, férias efetivamente lançadas, absenteísmo e afastamentos imprevistos (a reserva
  planejada já é dimensionada pensando no imprevisto).
- Sugestão automática de mudança de regime (por exemplo, parte da D Pegada no Sab-Dom Revezado). O
  painel mostra o custo do regime; a decisão é do escalante.
