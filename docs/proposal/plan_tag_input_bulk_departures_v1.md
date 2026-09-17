# Proposta — Componente Tag Input / Multi-value Input + inclusão em lote de partidas

**Status: desenho fechado, implementação não iniciada.**

Objetivo: criar um componente reutilizável que aceita colagem de múltiplos valores (ex.: lista
copiada de uma planilha) e os traduz em N itens, para uso em qualquer formulário que hoje só
aceite um valor por vez. Primeiro uso concreto: inclusão de múltiplas `LineDeparture` (partidas)
de uma vez em `transit/line-schedule/[id]`, colando uma lista de horários.

Casos futuros citados (fora do escopo desta proposta, só para orientar o desenho do componente):
lançamento de falta por matrícula de funcionário, colando uma lista de matrículas.

---

## Onde isso se encaixa hoje

`apps/web/src/app/transit/line-schedule/[id]/page.tsx` é um editor único de `LineSchedule` +
`LineDeparture` com buffer local (dirty-tracking) e commit único via
`PATCH /transit/line-schedule/:id/departures-batch`. Não usa react-hook-form — é estado próprio
(`draft: DraftDeparture[]`, linha 227) com chips por rota e um painel lateral que edita o
`DraftDeparture` focado.

Peças relevantes já existentes:

| Peça | Onde | O que faz |
|---|---|---|
| `addDeparture(routeId)` | `page.tsx:388-396` | Cria **um** `DraftDeparture` com valores default (`departureMinutes` = último + 10, `stopPattern: 'LOCAL'`) e foca ele |
| Botão "Partida" / atalho `alt+n` | `page.tsx:766-772`, `page.tsx:612-614` | Chamam `addDeparture(viewRouteId)` |
| Painel lateral (modo edição) | `page.tsx:828-892` | Um `<form>` com `Partida` (`Input` HH:MM, `id="ld-departureMinutes"`, linhas 849-862), `Veículo requerido` (`Select`, 866-876), `Observações` (`textarea`, 879-891), editando o `focused: DraftDeparture` campo a campo via `patchDeparture` |
| Painel lateral (modo `isBulk`) | `page.tsx:794-827` | **Já existe** um bulk-edit para chips **já criados e selecionados**: desloca horário (`shiftSelectedMinutes`, 402-405) e aplica veículo a todos os selecionados (`applyVehicleTypeToSelected`, 398-400). É edição em massa de itens existentes — **não** é o caso desta proposta, que é inclusão de itens novos |
| `SaveDeparturesBatchDto` | `apps/api/.../line-schedule.service.ts:10-15,117-159` | Já aceita `create: [...]` como array e usa `createMany` numa `$transaction` — **bulk create já é suportado ponta a ponta, sem mudança de backend necessária** |
| Componente multi-valor/paste | — | **Não existe** nenhum hoje em `apps/web/src/components` (grep confirmado) |

---

## Decisão 1 — Componente genérico

Componente "burro", sem acoplamento a domínio:

- Valor: `string[]` (entrada e saída)
- Digitação normal: `Enter`/`,` confirma um item
- Colagem: splita por `\n`, `\t` e `,`, cria um chip por item
- Cada chip tem estado (válido/inválido) — consumidor injeta `parse(token) => T | { error }`; chip
  inválido fica editável/removível, os demais não são bloqueados por ele
- Local: `apps/web/src/components/ui/tag-input.tsx`, mesmo padrão hand-rolled Tailwind dos outros
  componentes de `ui/` (sem Radix)

Não generalizar o endpoint de bulk create agora — `BaseService`/`BaseController` não têm suporte
genérico a isso hoje (confirmado por grep: nenhum `bulk`/`createMany`/`batch` em `core/`), cada
bulk existente é hand-rolled por módulo. Com um único caso de uso confirmado, extrair um padrão de
endpoint genérico é abstração prematura — revisitar quando o segundo caso (ex.: falta por
matrícula) aparecer.

---

## Decisão 2 — Inclusão em lote reaproveita o painel existente, sem duplicar

Descartada a ideia inicial de um painel separado para inclusão em lote (quase toda a UI seria
duplicada). Desenho fechado: **o mesmo painel lateral**, com um modo de criação que escreve num
estado "pendente" em vez de num `DraftDeparture` já materializado — e a única troca de widget é no
campo de horário.

- Novo estado: `pendingNew: { routeId, requiredVehicleType, stopPattern, notes, times: string[] } | null`
- Botão "Partida" (`page.tsx:766-772`) e atalho `alt+n` (`page.tsx:612-614`) deixam de chamar
  `addDeparture()` direto — abrem o painel em modo `pendingNew` (mesmos campos: veículo, stop
  pattern, observações, vinculados ao `pendingNew` em vez de a um `focused` existente)
- O campo que hoje é o `Input` de `Partida` (`page.tsx:849-862`) vira o `TagInput` **apenas neste
  modo** — usuário cola/digita a lista de horários (HH:MM), cada token parseado com o mesmo
  `hhmmToMinutes` já usado no blur atual
- Ao confirmar, materializa N `DraftDeparture` (mesma forma do `addDeparture` atual), todos com
  `routeId`/`requiredVehicleType`/`stopPattern`/`notes` do `pendingNew` e `departureMinutes`
  individual por item — via `setDraft` (mesmo mecanismo de `addDeparture`, linha 392)
- `pendingNew` fecha; os chips recém-criados caem no fluxo normal — clicar em um deles abre o
  painel em **modo edição** de novo, campo a campo, como hoje (`focused`, `patchDeparture`)
- `markings` (linhas 894-929) não entra no `pendingNew` — fica exclusivo do modo edição individual,
  como já é hoje

Resultado: zero duplicação de markup do painel (rota/veículo/stop pattern/observações continuam
sendo os mesmos `Select`/`textarea`), a distinção `pendingNew` vs. `focused` decide só o destino do
`onChange`/`onBlur` de cada campo e qual widget aparece no lugar de `Partida`. Nenhuma mudança de
backend — `departures-batch` já aceita o array resultante.

---

## Ordem de implementação sugerida

1. `apps/web/src/components/ui/tag-input.tsx` — componente genérico, testável isolado
2. `page.tsx` — introduzir `pendingNew`, adaptar botão "Partida"/`alt+n` para abrir esse modo em
   vez de chamar `addDeparture` direto
3. `page.tsx` — painel lateral: condicionar o campo `Partida` (`TagInput` vs. `Input`) e o destino
   dos demais campos (`pendingNew` vs. `focused`) conforme o modo ativo
4. Confirmar `pendingNew` → materializa N `DraftDeparture` via `setDraft`, fecha o modo
5. Validar manualmente: colar lista de horários com formatos válidos/inválidos misturados, conferir
   chips inválidos editáveis, conferir save único em `departures-batch` com os N criados
