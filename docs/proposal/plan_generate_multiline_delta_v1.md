# Proposta — Atendimento multilinha (intercalação no delta)

Aprofunda a Fase 4 de `docs/proposal/plan_generate_proposal_v1_impl.md` (marcada lá como
"escopo maior, tratar como sub-iniciativa própria"). Fases 0–3 daquele plano estão
implementadas; este documento é o plano detalhado da Fase 4.

Caso real usado como referência (conferido no banco em 2026-08-20):

```
Linha 206  (Cpa1 x Centro, sem parentLineId — é a linha "pai")
  INBOUND:  Est Bispo A → ... → Jd Florianopolis → ... → Term Cpa 1 - A
  OUTBOUND: Term Cpa 1 - A → ... → Jd Florianopolis → ... → Est Bispo A

Linha 206B (Florianopolis x Centro, parentLineId = 206)
  OUTBOUND: Jd Florianopolis → ... → Est Bispo A          (não tem INBOUND cadastrado)
```

> Relação de pai e filha não é necessária neste contexto, unico critério é que linhas tenham origem e/ou destinos iguais, ou que haja convergência em algum ponto


`Jd Florianopolis` (`d5ba0921-16e4-4875-bf9c-ef51408181f0`) é parada intermediária da 206
(sequência no meio da rota) e é a origem exata da 206B. As duas linhas correm juntas no
trecho `Jd Florianopolis → Est Bispo A` ("tronco"); 206 tem um ramal adicional
`Term Cpa 1 → Jd Florianopolis` que 206B não roda ("delta"). Quem espera no tronco pega
ônibus de qualquer uma das duas linhas — por isso a geração precisa enxergar as duas juntas
para não empilhar partidas no mesmo minuto ali.

---

## Conceito

- **Tronco**: trecho de rota compartilhado por duas (ou mais) linhas, terminando num destino
  comum.
- **Delta**: locality onde uma linha "entra" no tronco vindo de um ramal próprio que a outra
  linha não tem. É o ponto de intercalação — a partir dali, o passageiro não distingue as
  linhas, só a frequência combinada importa.
- Uma linha pode ter delta com mais de uma outra (ex.: três linhas convergindo no mesmo
  corredor) — o agrupamento não é necessariamente um par.

---

## O que já existe

| Peça | Onde | Estado |
|---|---|---|
| `TransitLine.parentLineId` | `transit.prisma:78-82` | Já modela família de linhas (206B é child de 206) — hoje só usado para agregação de OSO/km, não para geração |
| `LineGroup` / `LineGroupLine` | `transit.prisma:479-502`, `line-group.schema.ts` | Resource CRUD genérico (nome, filial, `lineIds[]`) — usado hoje só em `LinesPanel.tsx` para filtrar a lista de linhas do plano, sem ligação com o gerador |
| Seleção multi-linha | `page.tsx:191-192` | `selectedLineIds` (Set) já existe e já é usado por `AddTripModal`/Gantt — mas o botão "Gerar" força `disabled: selectedLineIds.size !== 1` e passa só `lineId: [...selectedLineIds][0]` |
| `RouteLocality` | `transit.prisma:155-183` | Sequência de paradas por rota, com `deltaMinutes`/`deltaKm` por perna (`localityId` null = waypoint OSRM, não é parada real) — é o dado que dá a topologia da rota, hoje só usado para desenhar trajetória e (Fase 3.4) medir gap entre paradas |
| `TravelTimeMatrix` (OSRM) | `transit.prisma:185-202`, `travel-time.ts` | Matriz origem×destino já consultada via `getTravelTime()` para acesso/recolhida (Fase 3.4) |
| `generateRounds()` / `assignRoundsToBlocks()` / `generateSchedule()` | `line-generator-logic.ts:629-855` | Motor real (Fase 3): gera partidas por acumulador de taxa contínua (`fleetCount / totalCycleMinutes`) e distribui em blocos por round-robin — **100% single-line**, sem qualquer noção de "essa partida colide com a de outra linha" |
| `FrequencyPanel.tsx` | idem | Barra inferior do Gantt — agrupa por `direction` de um único plano carregado, sem cruzar linhas |
| `LineFreqPanel.tsx` / `line-freq.view.ts` | idem | Painel lateral — mostra a grade da linha da viagem focada, troca de linha com setas, mas sempre uma linha por vez, sem modo "ver as duas juntas no tronco" |

**Conclusão da varredura**: nenhuma peça do algoritmo de geração (Fase 3) enxerga mais de uma
linha ao mesmo tempo. `parentLineId` e `LineGroup` dão pistas de agrupamento, mas nenhum dos
dois carrega hoje a informação de *onde* é o delta — isso teria que ser calculado.

> RESPOSTA 1: parentLineId apesar de não ser requisito obrigatorio tem grande probabilidade de ser candidato de planejamento multilinha 
> RESPOSTA 2: LineGroup não se aplica neste caso, funciona como agrupamento de setor, ou de concessionaria, não terá grande ajuda aqui


---

## O que falta

### 4.1 Detectar o ponto de delta automaticamente

Dado um par de rotas de mesmo sentido terminando no mesmo destino, o ponto de delta é o
**primeiro elemento em comum ao comparar as duas sequências de paradas reais (ignorando
waypoints, `localityId == null`) de trás para frente**:

```
206  OUTBOUND (só localities reais): [Term Cpa 1, Jd Florianopolis, Est Bispo A]
206B OUTBOUND (só localities reais): [Jd Florianopolis, Est Bispo A]

comparando do fim: Est Bispo A == Est Bispo A ✓, Jd Florianopolis == Jd Florianopolis ✓,
Term Cpa 1 vs (206B acabou) → para aqui

sufixo comum: [Jd Florianopolis, Est Bispo A] → delta = Jd Florianopolis
              (primeiro elemento do sufixo comum)
```

Função pura nova em `line-generator-logic.ts` (ou arquivo irmão), independente de rede —
só precisa das `RouteLocality[]` já carregadas por rota:

```ts
function commonSuffixLocality(routeA: RouteLocalityRef[], routeB: RouteLocalityRef[]): string | null
```

Roda para cada par de rotas de mesmo sentido dentro do grupo de linhas selecionado. Não exige
`parentLineId` — funciona para qualquer par que compartilhe sufixo, mas `parentLineId` é uma
boa forma de **sugerir** candidatos automaticamente na UI (linhas da mesma família quase
sempre compartilham tronco).

Não precisa de campo novo no schema — é derivado sob demanda, mesmo espírito de manter a
Fase 3 sem endpoint dedicado (`vehicle-plan-fleet-window-redesign.md` / considerações finais
do doc de impl.).

### 4.2 Ancorar o instante de cruzamento no delta

Cada linha tem sua própria origem e seu próprio ciclo — para comparar partidas de linhas
diferentes precisamos do **instante em que cada viagem gerada cruza o locality de delta**, não
do horário de partida bruto.

```
instanteNoDelta = departureMinutes(round, linha) + Σ deltaMinutes das pernas da rota
                  entre a origem da linha e o locality de delta
```

- `deltaMinutes` já vem por perna em `RouteLocality` (fallback: `TravelTimeMatrix` origem↔delta
  quando `deltaMinutes` é null, mesmo padrão já usado em `resolveNearestDepot`,
  `LineScheduleGeneratorModal.tsx:110-136`).
- Para 206B, cuja origem OUTBOUND já É o delta, o offset é 0.
- Para 206, o offset é a soma das pernas de `Term Cpa 1` até `Jd Florianopolis`.

### 4.3 Algoritmo de equilíbrio — entrelaçar sem recolidir

Duas abordagens possíveis; recomendo a primeira para a v1:

**A. Geração independente + entrelaçamento por deslocamento (recomendada)**

1. Roda `generateRounds()` normalmente para cada linha do grupo, sem mudar nada da Fase 3
   (cada linha continua com suas próprias janelas/frota/renovação).
2. Para cada round gerado, calcula o instante de cruzamento no delta (4.2) e marca
   `(lineId, crossingMinutes)`.
3. Junta e ordena todos os cruzamentos do grupo, por sentido. Percorre a lista: sempre que dois
   cruzamentos consecutivos — de linhas diferentes — ficarem mais próximos que um novo
   parâmetro `minTrunkHeadwayMinutes`, empurra o mais atrasado dos dois para frente (mesma
   técnica de retiming já usada no "closing pass" de `generateRounds`,
   `line-generator-logic.ts:712-777`, aplicando o deslocamento a toda a corrente de pernas
   daquele round).
4. Desempate de qual round empurrar: prioriza empurrar o que se afasta menos do seu próprio
   headway "natural" (equidistante dentro da própria linha) — isso é o que produz o
   "equilíbrio", já que impede que uma linha sempre absorva o ajuste.
5. Se o deslocamento necessário excede um teto (ex.: metade do headway próprio daquela linha),
   não força — registra warning (mesmo padrão de `generalWarnings`/toast já usado na Fase 3.4)
   em vez de degradar a grade silenciosamente.
6. Só depois disso roda `assignRoundsToBlocks()` por linha, normalmente — blocos continuam
   sendo por linha (frota de 206 não vira frota de 206B), a interferência acontece só nos
   horários antes da distribuição em blocos.

Vantagem: reaproveita quase todo o pipeline da Fase 3 sem tocar em `generateRounds` nem
`assignRoundsToBlocks` internamente — é literalmente "uma variação single-line com um critério
extra", como o doc de impl já antecipava. Risco conhecido: quando as frequências das linhas do
grupo são muito desiguais (ex. 206 a cada 20', 206B a cada 5'), "equilíbrio" na prática vira
só "não colidir" — a intercalação fina fica limitada pela linha mais rara.

> CONSIDERAÇÕES:
1) No modal (multilinha) adicionar controle Prioridade: Base | Delta (disabled inicialmente), sendo base default, que assume o comportamento descrito, cria tabelas e apenas desvia levemente as viagens para buscar intercalação (mesmo que parcial) no delta;
2) Com relação ao item 4 acima (Desempate de viagens) não é necessário escolher uma viagem para desempate, ideal eh ajustaar ambas (cada um em direções opostas) priorizando uma apenas se tiver margem de folga para isso, mais em geral ajustar ambas gera menos impacto da frequencia das linhas base
3) Esse direcionamento não precisa gerar warnings para nao poluir a tela, otimiza o máximo possivel e usuario edita manualmente o que achar relevante


**B. Grade de tronco compartilhada (mais pesada, não recomendada para v1)**

Calcular uma demanda combinada no tronco, gerar uma frequência única equidistante ali, e só
depois "repartir" cada partida do tronco entre as linhas do grupo (round-robin ponderado por
demanda de cada ramal), estendendo cada uma de volta ao seu próprio ramal. Mais correto
teoricamente (zero colisão por construção, não por correção), mas exige reformular
`computeOfertaSeries`/`deriveFleetBands` — hoje inteiramente por linha — para uma noção de
demanda de grupo. Guardar como evolução futura se a abordagem A se mostrar insuficiente em
produção.

> CONSIDERAÇÃO: Prioridade descrita no item acima já preve este caso (opção Delta no select), fica para implementação futura, mais ja vamos deixar comentario no fragmento gerado com ideia geral

### 4.4 Mudanças de UI

| Componente | Mudança |
|---|---|
| `page.tsx:191-192` | Relaxar `disabled: selectedLineIds.size !== 1` — permitir abrir o gerador com N linhas selecionadas quando formam (ou o usuário força) um grupo de delta |
| `LineScheduleGeneratorModal.tsx` | Hoje recebe `lineId: string` único (`Props`, linha 138-144) — precisa aceitar `lineIds: string[]`, carregar rotas/janelas por linha, e ganhar uma seção "Multilinha": ponto de delta sugerido por sentido (editável, resultado de 4.1) + `minTrunkHeadwayMinutes` |
| `FrequencyPanel.tsx` | Nova opção de visualização: em vez de agrupar só por `direction`, agrupar por cruzamento no delta quando as linhas plotadas pertencem a um grupo — mostra os traços das duas linhas na mesma faixa, cores diferentes |
| `LineFreqPanel.tsx` / `line-freq.view.ts` | Entrada "Multilinha" no seletor (setas de troca de linha) — quando ativa, mostra a grade combinada no ponto de delta em vez da grade bruta de uma linha só |

`LineGroup` (já existente, CRUD genérico) pode ser reaproveitado como forma **opcional** de
persistir "essas linhas costumam ser geradas juntas", pré-selecionando no modal — não é
necessário para o algoritmo funcionar (delta é sempre recalculado on-the-fly), só é
conveniência de UI.
> LineGroup não acho que se aplica aqui


### 4.5 Critério de agrupamento

Conforme documento original: linhas compartilham origem OU destino OU delta mapeado. Na
prática, com 4.1 implementado, "origem/destino em comum" é só o caso degenerado de "delta = a
própria origem/destino" — não precisa de lógica separada, o algoritmo do sufixo comum já cobre
os três casos.

---

## Dados novos necessários

Nenhum modelo Prisma novo é estritamente necessário — tudo é derivável de `RouteLocality` +
`TravelTimeMatrix`, que já existem. Único dado novo é um parâmetro de sessão do modal
(`minTrunkHeadwayMinutes`, não persistido, mesmo tratamento client-side de `maneuverMargin`).

Se depois de validar em produção fizer sentido persistir "grupos de delta" com o ponto
confirmado manualmente (em vez de recalcular toda vez), o candidato natural é estender
`LineGroup` com um campo `deltaOverrides` (Json, opcional, por sentido) — adiar essa decisão
até haver uso real que justifique.

---

## Ordem de implementação sugerida

```
4.1 (detecção do delta) ──┐
4.2 (ancoragem de tempo) ─┼──> 4.3 (entrelaçamento) ──> 4.4 (UI) ──> validar com 206/206B real
4.5 (critério de grupo) ──┘
```

4.1/4.2/4.5 são funções puras, testáveis isoladamente com o par 206/206B real como fixture —
mesmo padrão de prototipagem em `/playground` já usado para `line-generator-logic.ts`. 4.3
depende delas. 4.4 só faz sentido depois que 4.3 produz algo para visualizar.

---

## Dúvidas em aberto

1. Quando uma linha do grupo não tem rota cadastrada num sentido que a outra tem (caso real:
   206B sem INBOUND) — a intercalação nesse sentido simplesmente não se aplica (linha sem rota
   ali fica de fora do entrelaçamento), ou deveria ser sinalizado como pendência de cadastro?
2. Teto de deslocamento por round (passo 4.3.5) — "metade do headway próprio da linha" é
   proposta inicial; confirmar se é aceitável ou se deve ser outro parâmetro exposto na UI.
3. Vale a pena já expor `LineGroup` como atalho de pré-seleção no modal na v1, ou isso fica
   para depois (usuário sempre seleciona as linhas manualmente em `LinesPanel` primeiro)?

> RESPOSTAS:
1) Intercalação somente no sentido onde existe o delta, outro sentido segue normal como eh hoje
2) Metade do headway em alguns casos pode gerar variação muito grande, vamos partir com isso como base mais acredito que modal deve contemplar campo de configuração disso para geração
3) Não
