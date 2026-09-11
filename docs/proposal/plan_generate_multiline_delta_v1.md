# Proposta — Atendimento multilinha (intercalação no delta)

> **STATUS (2026-09-11):** 4.1/4.2/4.3/4.5 implementados em
> `multiline-delta-logic.ts`, e 4.4 implementado em `LineScheduleGeneratorModal.tsx` +
> `page.tsx` (accordion por linha, switch Principal, painel Multilinha,
> `Priority=Delta` funcional na v1 — não ficou como placeholder). Validado ao vivo
> contra o par real 206/206B (delta detectado automaticamente: locality "APAE") e
> contra outro par (107/203) com geração completa ponta a ponta. Pendente: as duas
> últimas linhas de 4.4 — `FrequencyPanel.tsx` (agrupar por cruzamento no delta) e
> `LineFreqPanel.tsx`/`line-freq.view.ts` (modo "Multilinha") — ficaram para uma
> próxima etapa, não bloqueiam a geração. Achado colateral, fora de escopo deste
> plano: uma linha com só um sentido cadastrado (ex. 206B, só OUTBOUND) não consegue
> gerar sozinha porque o select de sentido nunca oferece "Circular" quando há apenas
> uma direção registrada — bug pré-existente, não introduzido aqui, deixado para
> tratar separadamente.

Casos a serem coberto:
1) Gerar um planejamento com mais de uma linha, permitindo intercalação a partir de um ponto final ou delta
2) Geração pode dar prioridade a linha base e fazer pequenos ajustes para adequar ao delta (default), ou priorizar o delta em relação a linha base, neste caso a frequencia do delta eh tratada como prioridade
3) Linha no modal deixa de ser um label e vira o header de um accordion / collapse na aba de janelas (e talvez nas demans tbm), esse header deve ser construido pensando em abrigar controles, um deles já deve ser um swith "Principal" ao marcar uma linha como principal ela sera a primeira a ser gerada garantindo inicio e fim de operação mais fieis ao informado e as demais vao entrar intercaladas a esta (aqui é o desenho inicial, quero ouvir se tiver ideia melhor)

> RESPOSTA 3 (consolidado): o switch "Principal" só se aplica/aparece quando o direcionamento
> (item 2) está em `Priority=Delta` — no padrão (`Priority=Base`), não existe linha principal,
> vale o ajuste bidirecional sutil descrito em 4.3. `Priority=Delta` **exige** uma linha marcada
> como Principal (não pode ser selecionado sem isso — validar no modal). Ver detalhamento em
> 4.3.



Caso real usado como referência (conferido no banco em 2026-08-20):

```
Linha 206  (Cpa1 x Centro, sem parentLineId — é a linha "pai")
  INBOUND:  Est Bispo A → ... → Jd Florianopolis → ... → Term Cpa 1 - A
  OUTBOUND: Term Cpa 1 - A → ... → Jd Florianopolis → ... → Est Bispo A

Linha 206B (Florianopolis x Centro, parentLineId = 206)
  OUTBOUND: Jd Florianopolis → ... → Est Bispo A          (não tem INBOUND cadastrado)
```

> Relação de pai e filha não é necessária neste contexto, unico critério é que linhas tenham origem e/ou destinos iguais, ou que haja convergência em algum ponto


`Jd Florianopolis` (`ddd0c568-8cc7-4b5f-a7ac-94fdca1a3cad`) é parada intermediária da 206
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
   parâmetro `minTrunkHeadwayMinutes`, ajusta os dois em direções opostas (mesma técnica de
   retiming já usada no "closing pass" de `generateRounds`, `line-generator-logic.ts:712-777`,
   aplicando o deslocamento a toda a corrente de pernas daquele round em cada linha) —
   `Priority=Delta` é o caso degenerado em que um dos dois lados (a linha Principal) tem
   deslocamento sempre zero, então o outro absorve 100% (ver CONSIDERAÇÃO 4).
4. Reparto do deslocamento entre os dois: cada linha cede proporcionalmente à sua própria folga
   (distância até ficar equidistante dentro do próprio headway natural) — só uma cede tudo
   quando a outra não tem folga nenhuma. Isso evita que uma linha sempre absorva o ajuste.
5. Se o deslocamento necessário excede um teto configurável (default: metade do headway próprio
   daquela linha — exposto no modal, ver 4.4), não força além do teto — sem warning, o usuário
   ajusta manualmente o que achar relevante.
6. Só depois disso roda `assignRoundsToBlocks()` por linha, normalmente — blocos continuam
   sendo por linha (frota de 206 não vira frota de 206B), a interferência acontece só nos
   horários antes da distribuição em blocos.

Vantagem: reaproveita quase todo o pipeline da Fase 3 sem tocar em `generateRounds` nem
`assignRoundsToBlocks` internamente — é literalmente "uma variação single-line com um critério
extra", como o doc de impl já antecipava. Risco conhecido: quando as frequências das linhas do
grupo são muito desiguais (ex. 206 a cada 20', 206B a cada 5'), "equilíbrio" na prática vira
só "não colidir" — a intercalação fina fica limitada pela linha mais rara.

> CONSIDERAÇÕES:
1) No modal (multilinha) adicionar controle Prioridade: Base | Delta, sendo base default, que assume o comportamento descrito, cria tabelas e apenas desvia levemente as viagens para buscar intercalação (mesmo que parcial) no delta. ATUALIZAÇÃO: `Delta` entra funcional na v1 (não fica desabilitado — ver item 4 abaixo e a atualização na seção B), reaproveitando a mesma estrutura desta abordagem A;
2) Com relação ao item 4 acima (Desempate de viagens) não é necessário escolher uma viagem para desempate, ideal eh ajustaar ambas (cada um em direções opostas) priorizando uma apenas se tiver margem de folga para isso, mais em geral ajustar ambas gera menos impacto da frequencia das linhas base
3) Esse direcionamento não precisa gerar warnings para nao poluir a tela, otimiza o máximo possivel e usuario edita manualmente o que achar relevante
4) `Priority=Base` (default) é o comportamento acima (ajuste bidirecional, cada linha cede
   proporcionalmente à sua própria folga). `Priority=Delta` é um modo diferente, não uma
   variação de peso do mesmo algoritmo: a linha marcada "Principal" (caso 3) gera e mantém seus
   rounds fixos como referência; as demais linhas do grupo é que absorvem o retiming integral
   para se encaixar na frequência dela no delta — sem split bidirecional. `Priority=Delta` sem
   uma linha Principal definida não é um estado válido (bloquear no modal). O teto do passo 5
   continua valendo em `Priority=Delta`, mas só do lado de quem absorve (a Principal nunca se
   move) — mesmo comportamento silencioso (sem warning) quando excedido.


**B. Grade de tronco compartilhada (mais pesada, não recomendada para v1)**

Calcular uma demanda combinada no tronco, gerar uma frequência única equidistante ali, e só
depois "repartir" cada partida do tronco entre as linhas do grupo (round-robin ponderado por
demanda de cada ramal), estendendo cada uma de volta ao seu próprio ramal. Mais correto
teoricamente (zero colisão por construção, não por correção), mas exige reformular
`computeOfertaSeries`/`deriveFleetBands` — hoje inteiramente por linha — para uma noção de
demanda de grupo. Guardar como evolução futura se a abordagem A se mostrar insuficiente em
produção.

> CONSIDERAÇÃO: Prioridade descrita no item acima já preve este caso (opção Delta no select), fica para implementação futura, mais ja vamos deixar comentario no fragmento gerado com ideia geral
>
> ATUALIZAÇÃO (consolidado): a abordagem B (grade de tronco compartilhada, com repartição
> round-robin ponderada por demanda) continua adiada — isso não mudou. O que muda é que
> `Priority=Delta` **não depende dela** para ser funcional na v1: a variante "Principal fixo +
> demais absorvem o retiming" (4.3, CONSIDERAÇÃO 4) é uma extensão leve da própria abordagem A
> (mesma geração independente por linha, só troca a regra de quem cede no retiming) e entra
> como algoritmo real na v1. B permanece reservada para o caso em que a abordagem A/Delta se
> mostrar insuficiente em produção (grupos com frequências muito desiguais, ver risco já
> descrito em A).

### 4.4 Mudanças de UI

| Componente | Mudança |
|---|---|
| `page.tsx:191-192` | Relaxar `disabled: selectedLineIds.size !== 1` para `size === 0` (mesma condição já usada pelas outras ações da toolbar) — abre sempre com 1+ linhas; a checagem de grupo válido (4.1/4.5) acontece dentro do modal, não aqui |
| `LineScheduleGeneratorModal.tsx` | Hoje recebe `lineId: string` único (`Props`, linha 138-144) — precisa aceitar `lineIds: string[]`, carregar rotas/janelas por linha, e ganhar uma seção "Multilinha": ponto de delta sugerido por sentido (editável, resultado de 4.1), `minTrunkHeadwayMinutes`, teto de deslocamento configurável (passo 4.3.5, default = metade do headway próprio) e o select Prioridade Base\|Delta |
| Aba de janelas (por linha) do modal | Header de cada linha deixa de ser label e vira accordion/collapse (caso 3) — abriga o switch "Principal" (habilitado só quando `Priority=Delta`, obrigatório escolher uma) e demais controles por linha |
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

> RESPOSTA (consolidado): a geração por sentido sempre fecha em **um único** delta — não há
> encadeamento de múltiplos pontos de delta ao longo do tronco na v1 (ex.: três linhas
> convergindo em três localities diferentes não formam um grupo triplo só porque estão no mesmo
> corredor). Uma linha só entra no grupo daquele sentido se o seu `commonSuffixLocality` (4.1)
> bater exatamente com o delta comum às demais. IDA e VOLTA são avaliados independentemente e
> podem ter conjuntos de linhas / delta diferentes — inclusive uma linha pode participar do
> grupo só na IDA (delta ali) e ficar de fora na VOLTA se não compartilhar o mesmo ponto (ver
> também Dúvida 1 nas respostas abaixo).

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
