# Proposta — Ativação com data de início (planejamento, escala e grade)

Objetivo: ativar um `VehiclePlan`, uma `CrewPlan` ou aprovar uma `LineSchedule` **pedindo a
data de início**, em vez de assumir "agora". Caso típico: na sexta, ativar o planejamento que
entra em vigor na segunda. A vigência (datas) passa a ser a fonte de verdade de "o que roda em
cada dia", sem agendador de tarefas e sem troca manual na data.

---

## Como é hoje

- Ativar usa o instante atual: o novo recebe `validFrom = agora`, e o anterior do mesmo escopo +
  tipo de dia volta para `DRAFT` com `validTo = agora` (`VehiclePlanService.activate`,
  `CrewPlanService.activate`/`closeActive`). A grade de horários já usa `SUPERSEDED`
  (`LineScheduleService.approve`, `vehicle-plan-import.service.ts`).
- `validFrom`/`validTo` são timestamps. Com o servidor em UTC−4, "ativei sexta às 21h" vira
  sábado em UTC — o mesmo problema de fuso já corrigido no DOP.
- O DOP lê só `ACTIVE`: um plano substituído (hoje `DRAFT`) some do histórico.

---

## Regras

1. **Status.**

   | Status | Significado |
   |---|---|
   | `DRAFT` | nunca entrou em vigor; editável; sem datas |
   | `ACTIVE` | o **último ativado** (cronologicamente) do escopo + tipo de dia — pode já estar em vigor ou começar no futuro |
   | `SUPERSEDED` | foi substituído; somente leitura; guarda a vigência (pode ainda estar em vigor até o `validTo`) |

   Continua existindo **um único `ACTIVE`** por escopo + tipo de dia (por planejamento, no caso
   da escala; por linha + tipo de dia, na grade — onde `APPROVED` faz o papel de `ACTIVE`).

2. **"O que roda no dia" vem das datas, não do status.** Todo consumidor (DOP, troca de
   veículo, telas, futuros processos) usa uma função única `inForceOn(date)`: planos não-`DRAFT`
   com `validFrom ≤ dia` e (`validTo` vazio ou `≥ dia`). Nenhum código novo deve usar
   `status: 'ACTIVE'` para responder "o que roda hoje".

3. **Ativar P com início D** (mesmo escopo + tipo de dia): todo plano não-`DRAFT` cuja janela
   alcança D ou depois recebe `validTo = D − 1`:
   - janela continua válida → `SUPERSEDED`;
   - janela fica vazia (começaria em D ou depois — nunca entrou em vigor) → volta a `DRAFT`,
     sem datas.

   P fica `ACTIVE` com `validFrom = D`, `validTo` vazio. Exemplos:
   - A em vigor; ativar B para segunda → A `SUPERSEDED` até domingo, B `ACTIVE` desde segunda.
   - B agendado para segunda; ativar C para quarta → B `SUPERSEDED` segunda–terça, C `ACTIVE`.
   - B agendado para segunda; ativar C para domingo → B volta a `DRAFT` (nunca valeu).

4. **Data retroativa (D < hoje)** só é aceita se **nenhum** plano não-`DRAFT` do mesmo escopo
   + tipo de dia tiver vigência em D ou depois (nem em vigor, nem agendado). Ou seja, a
   retroativa só serve para o primeiro plano de um tipo de dia ou para um período em que nada
   valia, e nunca altera outro plano; a regra 3 nem chega a agir. Em conflito, a ativação é
   recusada indicando o plano e a vigência que conflitam. ✅ Fechado.

5. **Escala** (mesmas regras, dentro do planejamento):
   - início da escala ≥ início do planejamento; pode ativar a escala de um planejamento que
     ainda não começou (sexta: ativa o planejamento para segunda e depois a escala para segunda);
   - quando o planejamento recebe `validTo = D − 1`, a escala dele é cortada na mesma data (e
     volta a `DRAFT` se a janela ficar vazia);
   - ao ativar um planejamento sem escala ativa a partir do início dele, a tela avisa (o DOP já
     mostra os dias sem escala).

6. **Grade de horários:** mesma regra, com `APPROVED` no papel de `ACTIVE`. A importação de
   planejamento, que aprova grades automaticamente, aprova a partir de hoje (sem campo de data
   na importação por enquanto).

7. **Datas sem hora.** `validFrom`/`validTo` passam a `@db.Date` (fim inclusivo). A migração
   converte os timestamps existentes para a data local.

---

## Tela

- Ativar/aprovar abre um modal com **data de início** (padrão: hoje) e a **prévia do efeito**
  antes de confirmar: "U2026_init deixa de valer em 04/10", "V1 volta a rascunho", "este
  planejamento ainda não tem escala a partir de 05/10".
- Badge derivado das datas: `ATIVO • 05/10` (ativo que ainda não começou), `ATIVO` (em vigor),
  `ATÉ 04/10` (substituído ainda em vigor), `SUBSTITUÍDO` (já encerrado).

---

## Consumidores a ajustar

| Onde | Hoje | Passa a |
|---|---|---|
| `VehiclePlanService.activate` | `validFrom = now`, anterior → `DRAFT` | data informada; regra 3; corta a escala (regra 5) |
| `CrewPlanService.activate` / `closeActive` | idem | data informada; regras 3 e 5 |
| `LineScheduleService.approve`, `vehicle-plan-import.service.ts` | `validFrom = now`, anterior → `SUPERSEDED` | data informada; regra 3 |
| `dop.service.ts`, `dop-crew.service.ts` | `status: 'ACTIVE'` + janela | `inForceOn` (não-`DRAFT` + janela) |
| `vehicle-swap.service.ts` ("apenas na escala ativa") | `status === 'ACTIVE'` | mantém: a troca edita o plano, e `SUPERSEDED` é somente leitura (a versão agendada pode ser ajustada antes de começar) |
| `VehiclePlanService` comparativo de linha | compara com o `ACTIVE` | mantém o `ACTIVE` ("o que vai valer") |
| `CrewPlanService.resolveForVehiclePlan` | abre a `ACTIVE`, senão a mais recente | mantém |
| Bloqueios de edição/exclusão (`status === 'ACTIVE'`) | só `ACTIVE` | `ACTIVE` e `SUPERSEDED` |
| Enums | `VehiclePlanStatus`/`CrewPlanStatus` = DRAFT, ACTIVE | + `SUPERSEDED` |

---

## Implementação

Implementado (migrações `plan_activation_date` + `plan_superseded_status`; regras em
`apps/api/src/modules/transit/timetabling/plan-validity.ts`; modal compartilhado em
`apps/web/src/app/transit/activation-modal.tsx`; badge em `apps/web/src/lib/plan-vigence.ts`).
Endpoints: `POST …/activate` (planejamento, escala) e `POST …/approve` (grade) recebem
`{ startDate, confirm }` — sem `confirm` devolvem só a prévia.

Ordem seguida:

1. Migração: enums + `@db.Date` nas vigências; conversão dos timestamps existentes.
2. Backend: `inForceOn`, regra 3 compartilhada pelos três serviços, validação da retroativa,
   cascata da escala, endpoints de ativação recebendo `startDate`.
3. Consumidores da tabela acima.
4. Frontend: modal de ativação com data + prévia; badges.
