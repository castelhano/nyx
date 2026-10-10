# Proposta — Exigências de atendimento por linha (LineServiceRequirement)

**Status: Fases 1–4 implementadas (4 parcial, ver abaixo). Pendentes: Fase 4 completa (depende de um
sistema de notificações), Fase 5 (decisão de produto).**

Objetivo: registrar, por linha / tipo de dia / sentido, horários que a programação **precisa**
atender — saída de escola, entrada de empresa, troca de turno — para que (a) o plano mostre quais
viagens atendem cada exigência e quais exigências ficaram descobertas, e (b) o gerador de
programação force uma viagem dentro da janela.

---

## Nome

Não usar "Timepoint": no GTFS (`stop_times.timepoint`) e no jargão do setor, timepoint é a parada
com horário exato, e há um export GTFS planejado (`brainchild/plan_gtfs_export_v1.md`). O conceito
aqui é uma exigência sobre a existência de uma viagem → `LineServiceRequirement`, na UI
"Atendimento" / "Atendimentos".

## Modelo

```
LineServiceRequirement
  lineId, dayTypeId, direction (OUTBOUND | INBOUND | CIRCULAR)
  kind             BOARDING | ALIGHTING
  localityId?      ponto de referência; nulo = origem (embarque) / destino (desembarque)
  earliestMinutes  janela, minutos desde 00:00 (pode passar de 1440)
  latestMinutes
  label            ex. "Saída E.E. Fulano"
  notes?
```

- **Horário e range são o mesmo modelo.** Sempre uma janela `[earliest, latest]`; "17:00 + alguns
  minutos" é só a janela `17:00–17:15`. Embarque mede a **passagem** pelo ponto; desembarque mede
  a **chegada** nele.
  - Saída de escola 17:00, Volta, embarque na escola → passagem pela escola em 17:00–17:15.
  - Entrada de empresa 08:00, Ida, desembarque na empresa → chegada na empresa em 07:40–07:55.
- **Sentido.** Toda exigência informa o sentido; qualquer viagem da linha nesse sentido conta,
  inclusive de rotas variantes (`ordinal`). Com ponto de referência, só contam viagens cuja rota
  passa por ele. O cadastro rejeita sentido que a linha não tem e ponto que nenhuma rota do
  sentido percorre.
- **Uma viagem basta** — sem quantidade mínima de carros.
- **Não bloqueia nada.** Exigência descoberta é aviso, nunca impede salvar/ativar plano ou aprovar
  OSO.
- **Tabela própria**, não JSON em `TransitLine.metrics`: vira resource filho da linha (breadcrumb)
  com CRUD genérico, e é consultável para validar.
- Período letivo fica de fora: um DayType próprio ("DU escolar") resolve.

## Validação

Função pura em `packages/schemas/transit/` (ao lado de `block-validation.ts`), para rodar no front
agora e na API depois (notificações). Para cada exigência: existe viagem no sentido, com rota que
passa pelo ponto, cuja passagem (embarque) ou chegada (desembarque) cai na janela? O horário no
ponto é a partida da viagem + soma dos `RouteLocality.deltaMinutes` até ele (para o destino em
desembarque, `arrivalMinutes` da viagem, que é o valor autoritativo).

Serve para o plano gerado, planos editados à mão e as partidas da OSO (DRAFT e APPROVED).

## Sinalização no vehicle plan

- **Viagem que atende:** borda superior mais grossa (4px) dentro da barra, recortada pelos cantos
  arredondados; cinza sem matiz por tema (ver Fases). O tooltip lista os atendimentos
  ("Atende: Saída E.E. Fulano (17:00–17:15)").
- **Não atendimento:** indicador de status na topbar, não no Gantt nem no LinesPanel.
  - Agregador genérico: `PlanIssue { severity, source, message, lineId?, target }`; cada
    validador contribui com uma lista. Primeiras fontes: exigências + uma já existente (intervalo
    irregular / `block-validation`) para validar a agregação.
  - Cor pela pior severidade (verde sem nada, amarelo só avisos, vermelho com erro). Exigência
    descoberta = aviso.
  - Escopo: o plano inteiro, não só as linhas selecionadas — senão o verde mente. Lista agrupada
    por linha.
  - Clicar no item navega: viagem/bloco → foco/seleção do segmento; exigência descoberta → o
    Gantt rola até a janela e mostra uma faixa translúcida temporária sobre ela.
  - Neutro enquanto os dados carregam (nunca "success" antes de validar).
  - `TopbarAction` ganha um tipo de status (contagem + tom + popover de itens), genérico para o
    crew plan reaproveitar.

## Gerador

O closing pass de `generateRounds` (`line-generator-logic.ts`) já é uma âncora — puxa a última
viagem para `opEnd` e redistribui o delta entre as rodadas da mesma faixa. Generalizar:

1. Cada exigência vira uma janela-alvo para a **partida âncora** (`firstTripDirection`): no sentido
   derivado, âncora = alvo − (tempo do sentido âncora + intervalo); ponto intermediário subtrai o
   offset até ele (resolvido no modal, como HOLD/DEPOT, porque o arquivo é puro).
2. A linha do tempo vira segmentos `[opStart, âncora₁, …, opEnd]`; o acumulador de taxa decide
   quantas partidas cabem em cada um, espaçadas uniformemente.
3. Âncora que não cabe sem distorcer o headway → rodada de reforço, com aviso (pode custar carro).
4. Rodadas ancoradas são fixas: `assignRoundsToBlocks` e Redistribuir só podem deslocá-las dentro
   da folga restante da janela.

Snap pós-geração (mover a viagem mais próxima para dentro da janela) foi descartado: headways
tortos e conflito com o closing pass.

## Fases

1. ✅ Modelo + CRUD filho da linha (inclui widget `time` H:MM no form/lista genéricos).
2. ✅ Validador compartilhado (`service-requirement-validation.ts`) + indicador "Pendências" na topbar
   (`TopbarAction.status`). Viagem que atende: borda superior de 4px dentro da barra, recortada pelos
   cantos arredondados — neutral-900 no light, neutral-400 no dark (cinzas sem matiz, para não se
   confundir com as cores de linha). Faixa lateral interna e pílula externa foram testadas e descartadas.
3. ✅ Âncoras no gerador (`GenAnchor`, `applyAnchors` em `line-generator-logic.ts`): espalhamento linear
   até os pontos fixos vizinhos, reforço quando o esticamento passa de 30% do headway; mira meio
   minuto dentro da janela (arredondamento). Rodadas ancoradas levam `slack`, respeitado por
   `assignRoundsToBlocks` e `interleaveDeltaGroup`; Redistribuir não encurta viagem que atende
   (`coversRequirement`). O modal confere o resultado final e informa "atendimentos X/Y".
4. ◐ Avisos na prévia de **ativar plano** e de **aprovar OSO** (`PlanActivationPreview.warnings`, via
   `line-service-requirement.util.ts`). Na OSO a chegada é estimada pela soma dos `deltaMinutes` da
   rota (partida não tem chegada própria). **Falta:** notificar ao alterar exigência de linha com plano
   ativo — não existe sistema de notificações (o sino da topbar é placeholder).
5. ☐ (Opcional) Marking automática na viagem que atende, para sair marcada na OSO — pendente de
   decisão: texto/estilo da legenda e se deve sincronizar com a OSO como as markings manuais.
