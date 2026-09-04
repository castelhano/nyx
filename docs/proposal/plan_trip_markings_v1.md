# Proposta — Marcações de viagem (Trip Markings) + DISPLACEMENT no OSO

Objetivo: dar à `TransitTrip` um campo único (`markings`, Json) para marcar visualmente uma
viagem no OSO exportado, sem catálogo nem modelo novo — para dois usos:

1. Marcações livres que o usuário associa a qualquer viagem (ex: "faz laço na rua Y", "inicia em
   Z") e que aparecem destacadas no OSO exportado, com legenda correspondente.
2. Fechar a regra 7 de `plan_oso_export_v1.md` — hoje `DeadrunType.DISPLACEMENT` (retorno
   reservado no contrafluxo) é descartado do OSO — usando o mesmo mecanismo visual, mas **sem
   nunca persistir nada na viagem**: resolvido em tempo de export por uma constante fixa do
   pipeline. Esta é também a "Fase 4 — Observações estruturadas" já prevista (e nunca
   implementada) no doc original.

---

## O que já existe

| Peça | Onde | Estado |
|---|---|---|
| `TransitTrip.notes` | `trip.schema.ts:71-75` | Precedente de campo livre editado via form genérico — mostra que a superfície de edição da viagem já lida com esse tipo de campo |
| `TransitTrip` é `hidden: true` | `trip.schema.ts:84` | Sem página própria de listagem/form — marcação manual entra pelo Gantt (ver Fase 3) |
| `Selection` (tipo `interval`) | `gantt.types.ts:68-70` | Range contíguo de segmentos dentro de **um único carro/bloco** (`rowId`), já usado hoje pra mover viagens em lote (`useGanttEditor.ts:1414-1416`) — mesmo mecanismo reaproveitado pra aplicar marcação em lote (Fase 3) |
| Clone de plano copia `notes`/`constraints` linha a linha | `vehicle-plan.service.ts:620-630` | `TransitTrip` nunca é reaproveitada entre planos — duplicar sempre cria linhas novas, copiando os campos existentes. `markings` segue o mesmo tratamento, uma linha a mais no `create` |
| Varredura de órfãs ao remover plano/linha | `vehicle-plan.service.ts:668-690`, `:1066-1068` | `TransitTrip` sem nenhum `BlockTrip` restante é apagada em nível de aplicação — confirma que um campo embutido na própria linha da viagem nunca fica órfão: some junto com a viagem, sem mecanismo novo |
| `BlockDeadrun.type` (`ACCESS`\|`RETURN`\|`DISPLACEMENT`) | `transit.prisma:31-37, 591-607` | Sem FK pra viagem — vínculo é posicional |
| `findDeadrunIdsAnchoredToTrips` | `block-deadrun.utils.ts:8-58` | **Já resolve** a viagem-âncora de um DISPLACEMENT (a viagem anterior mais próxima cronologicamente, mesma regra dos intervalos) |
| `oso-assembler.ts:174-177` | assembler | Descarta explicitamente tudo que não é `RETURN` (`if (dr.type !== 'RETURN' \|\| ...) continue`) — o dado ancorado existe, só é jogado fora aqui |
| `buildCarroRows` (RECO/INTERV) | `oso-workbook.renderer.ts:221-...`, `:464-468` | Mecanismo de "linha reservada" pra um evento que não é viagem já existe e já funciona — é a peça que dá a "lacuna esperando inserir" que já existe no grid. DISPLACEMENT reaproveita esse slot, mas mostrando o horário real, não um rótulo fixo tipo `'RECO'` |
| `cell.font` (ExcelJS) | `oso-workbook.renderer.ts` (`baseFont`, usado em toda parte) | `bold`/`italic`/`underline`/`strike`/fill já são suportados nativamente |
| `TAN_FILL`/`RECO_FILL`/`INTERV_FILL` | `oso-workbook.renderer.ts:43-48` | `FFDDD9C3`/`FFFFFF00`/`FFFFCC66` — paleta já em uso na grade; a paleta nova de `bgColor` precisa evitar essas cores (regra 5) |
| Célula `OBSERVAÇÃO:` | `oso-workbook.renderer.ts:556` | Já reservada no chassi, mas nunca populada — `oso-observations.ts` (camada 5 do pipeline original) nunca chegou a ser criado |

---

## Modelo de dados proposto

Um campo novo, sem modelo/FK novos:

```prisma
model TransitTrip {
  // ...campos existentes...

  // TripMarking[] (packages/schemas/transit/trip.schema.ts) — marcações visuais manuais desta
  // viagem no OSO. Nunca inclui a marcação de DISPLACEMENT (regra 6) — essa é sempre inferida em
  // tempo de export, nunca persistida aqui.
  markings Json?
}
```

Shape validado em `trip.schema.ts` (mesmo tratamento que `constraints`/`TripConstraints` já
recebe hoje — "gerenciado por controles de UI dedicados, não input JSON cru"):

```ts
type TripMarking = {
  legendText: string
  fontStyle?: 'BOLD' | 'ITALIC' | 'BOLD_ITALIC' | 'UNDERLINE' | 'STRIKETHROUGH'
  bgColor?:   'AZUL' | 'VERDE' | 'ROSA' | 'ROXO' | 'CINZA' | 'VERMELHO'  // paleta fechada, ver regra 5
}

// TransitTrip.markings: TripMarking[] | null
```

---

## Arquitetura proposta (mudanças no pipeline OSO)

```
1. oso-assembler.ts        — para de descartar DISPLACEMENT; resolve a marcação efetiva de
                              cada viagem do recorte (ver regra 6)
2. oso-layout.resolver.ts  — sem mudança (marcação não cria coluna nova)
3. oso-banding.ts          — sem mudança
4. oso-summary.ts          — sem mudança
5. oso-observations.ts     — NOVO (camada já prevista, nunca criada): junta os `legendText`
                              efetivamente presentes no recorte exportado (dedupe por string) e
                              gera as linhas da célula OBSERVAÇÃO
6. oso-workbook.renderer.ts — buildCarroRows: o slot de um evento marcado carrega
                              { minutes, fontStyle?, bgColor? } em vez do rótulo bare 'RECO';
                              renderer aplica font/fill a partir disso
```

Camada 1 resolve, por viagem do recorte, a lista efetiva de marcações:

1. `TransitTrip.markings` dela, se houver.
2. Mais uma marcação vinda da constante fixa de DISPLACEMENT (nunca persistida — ver regra 6),
   se `findDeadrunIdsAnchoredToTrips` ancorar um DISPLACEMENT nessa viagem.

Com essa lista resolvida, o renderer aplica a regra 4 (primeira entrada por canal vence) — nesta
ordem, manual antes do inferido.

---

## Regras de negócio definidas

1. **Marcação é característica da `TransitTrip`, não do plano/bloco.** Vive em
   `TransitTrip.markings`, não em `BlockTrip` — vale em qualquer `VehiclePlan` que materialize
   aquela viagem.

2. **Sem catálogo, sem modelo novo, sem FK.** Um único campo `Json?` com array de marcações.
   Consistência visual entre viagens que "significam a mesma coisa" (ex: duas viagens com
   "reforço") é responsabilidade de quem cadastra, não é imposta pelo schema.

3. **Cada entrada tem até dois canais independentes** (`fontStyle` e `bgColor`) que nunca
   conflitam entre si — podem coexistir na mesma entrada (ex: itálico + fundo rosa numa marcação
   só) ou em entradas diferentes da mesma viagem.

4. **Conflito só existe entre duas entradas que reivindicam o mesmo canal** (duas com `fontStyle`
   diferente, ou duas com `bgColor` diferente). Resolvido por prioridade determinística: a
   primeira entrada da lista resolvida (regra da camada 1) que define aquele canal vence o efeito
   visual da célula — as demais entradas ainda contribuem sua legenda no rodapé, mesmo perdendo o
   canal.

5. **Paleta de `bgColor` é fechada, 6 cores** — Azul, Verde, Rosa, Roxo, Cinza, Vermelho. Evita
   colisão com `TAN_FILL`/`RECO_FILL`/`INTERV_FILL` já usados na grade (todos na família
   amarelo/laranja/bege) e garante legibilidade em impressão/xerox P&B. Hex exatos a validar
   visualmente contra a grade real na Fase 2.

6. **DISPLACEMENT nunca é persistido em `markings`.** Estilo+legenda ficam numa constante fixa no
   próprio pipeline OSO (mesmo espírito de `RECO_FILL`/`INTERV_FILL` já serem constantes TS, não
   dado de banco), aplicada em tempo de export sempre que `findDeadrunIdsAnchoredToTrips` ancora
   um DISPLACEMENT na viagem — nenhuma escrita na viagem, nenhuma ação manual repetida.

7. **Supersede a regra 7 de `plan_oso_export_v1.md`.** Antes: "`DeadrunType.ACCESS` e
   `DISPLACEMENT` não aparecem na OSO". Agora: `ACCESS` continua fora (grade sempre começa na
   primeira viagem produtiva — isso não muda), `DISPLACEMENT` passa a aparecer como evento próprio
   na grade do carro, na mesma "lacuna" hoje usada por `RECO`, mostrando o horário real de partida
   do deadrun (não um rótulo bare), estilizado pela marcação resolvida.

8. **Legenda na OBSERVAÇÃO é condicional por recorte e deduplicada por string.** `oso-
   observations.ts` só lista uma legenda quando pelo menos uma viagem do recorte exportado
   (família de linhas deste OSO, não o plano inteiro) efetivamente carrega aquele `legendText` —
   dedupe é por igualdade exata de string (sem id compartilhado pra deduplicar de outra forma;
   duas legendas digitadas com diferença de espaço/capitalização geram duas linhas).

---

## Ordem de implementação sugerida

**Fase 0 — Dados**
- `TransitTrip.markings` (schema + migration)
- Shape `TripMarking` validado em `trip.schema.ts`, paleta de `bgColor` fechada (regra 5)

**Fase 1 — Assembler + observations**
- `oso-assembler.ts`: para de descartar DISPLACEMENT; resolve lista efetiva de marcações por
  viagem (manual + inferido)
- `oso-observations.ts` novo: legenda condicional por recorte, dedupe por string

**Fase 2 — Renderer**
- `buildCarroRows`/render da célula: horário real + `fontStyle`/`bgColor` resolvidos, no lugar do
  rótulo bare atual pra este caso
- Validar visualmente contra a linha 390 (caso real citado no `FLOW.md`)

**Fase 3 — UI de aplicação manual**
- Atalho `q+j` (viagem focada) + botão ícone "tags" (novo em `icons.ts`) em
  `GanttActionBar.tsx` — abre modal de entrada/edição de marcações.
- Seleção múltipla reaproveita `Selection` tipo `interval` (mesmo mecanismo do mover em lote) —
  limitada a um range dentro do mesmo carro/bloco, sem seleção cross-carro no v1.
- Registro de labels em memória: `useMemo` sobre os `blockTrips` das linhas em `selectedLineIds`
  já carregadas no Gantt, deduplicado por `legendText` — alimenta um quick-pick no modal
  (clicar reaplica os canais já usados), sem chamada nova ao backend.
- Modal com múltiplas viagens selecionadas: mostra a união das labels presentes em pelo menos
  uma. Remover uma label afeta só as viagens da seleção atual. Editar o texto de uma label
  (rename por `legendText`) dispara um batch-update — endpoint novo — que reescreve em todas as
  viagens das linhas marcadas no painel (mesmo escopo do registro acima), nunca no plano
  inteiro; modal mostra quantas viagens serão afetadas antes de confirmar.