# Variáveis — Comparativo & Simulação de Linha

Checklist de variáveis necessárias para implementação futura, mapeadas a partir do protótipo em `apps/web/src/app/playground/page.tsx`. Nomes em inglês, ajustados para refletir os ajustes visuais feitos no protótipo (ex.: split de intervalo de pico em manhã/tarde) **e conferidos contra o estado atual do código** (schema, prisma, `line-generator-logic.ts`, `LineScheduleGeneratorModal.tsx`).

> Apenas mapeamento — não reflete necessariamente o que já existe hoje no backend/schema. Itens marcados "✅ já existe" apontam para o campo real; os demais são propostas novas.

## Linha (entidade base)

- [ ] `id` — ✅ já existe (`TransitLine.id`)
- [ ] `code` — ✅ já existe (`TransitLine.code`), protótipo só usava `name`
- [ ] `name` — ✅ já existe (`TransitLine.name`)
- [ ] `LineType` — ✅ já existe, enum `URBAN | METROPOLITAN | RURAL | SPECIAL`
- [ ] `status` — ⚠️ **não existe** no nível de linha hoje. `TransitLine` só tem `isActive: boolean`. Ver dúvida (1) abaixo.


## Métricas que já existem hoje (`TransitLine.metrics`, Json)

Tudo abaixo já está implementado e em uso — não são campos novos, são o que o comparativo precisaria **ler/reaproveitar**. Importante: quase tudo é escopado por **sentido** (`OUTBOUND | INBOUND | CIRCULAR`) e parte também por **dayType** (`U`, `S`, `D`, ...) — não são valores únicos "da linha".

- [ ] `extensionKm: Record<Direction, number>` — ✅ já existe, por sentido (`metrics.extensionKm.OUTBOUND` etc.)
- [ ] `windows: Record<dayTypeCode, Record<Direction, CycleWindow[]>>` — ✅ já existe. Cada `CycleWindow = { from, to, minutes, intervalMinutes, isDerived? }`. **Isso é o que hoje modela intervalo de pico/entrepico** — como uma lista arbitrária de janelas horárias, não como campos fixos `peakIntervalMorning/Afternoon`. Ver dúvida (2).
- [ ] `renewalIndex: Record<Direction | 'overall', RenewalStat>` — ✅ já existe, **computado** (não editável manualmente) a partir da conciliação bilhetagem × GPS. `RenewalStat = { value, peakPax, peakTripId, tripCount, avgPax, assumedCapacity, method, computedAt, sourceFile }`. Isso é literalmente o card "Renovação" do protótipo — ver dúvida (6).
- [ ] `demand: Record<dayTypeCode, Record<Direction, Record<hour, number>>>` — ✅ já existe (importado via `DemandImportModal` → `POST /transit/transit-line/demand/apply`). São **contagens reais por hora**, não uma distribuição percentual como o `demandProfile[]` do protótipo. Ver dúvida (4).

## Métricas do comparativo sem lastro hoje (precisam de fonte/cálculo)

Nenhum destes existe persistido em lugar nenhum hoje. Precisam ser calculados (provavelmente agregando `LineSchedule` → `LineDeparture`/`TransitTrip`, ou `VehicleBlock`, de forma análoga a `VehiclePlan.summary`) ou definidos como novo campo. Ver dúvida (7).

- [ ] `fleetSize`
- [ ] `dailyTrips`
- [ ] `operatingHours`
- [ ] `dailyKm`
- [ ] `avgSpeed`
- [ ] `occupancyIndex` (IOC)
- [ ] `serviceFrequencyIndex` (IFS)
- [ ] `peakPassengersPerHour`
- [ ] `score` — RESOLVIDO: nome correto é `score`. `VehiclePlan.summary` já atribui um score em nível de plano; aqui seria em nível de linha. Critérios/fórmula ficam para depois (definição futura pelo usuário).


### Removidos do escopo (não implementar)

- [x] ~~`corridor`~~ — confirmado lixo, não existe no schema atual
- [x] ~~`onTimePerformance` (pontualidade)~~
- [x] ~~`costPerKm`~~
- [x] ~~`fleetAvgAge`~~

## Simulação Oferta × Demanda — já existe implementação equivalente

`line-generator-logic.ts` (`computeOfertaSeries` + `fleetNeededForHour`) e `LineScheduleGeneratorModal.tsx` já fazem exatamente esse cálculo hoje, no contexto do gerador de horários — vale reaproveitar em vez de reinventar o modelo do protótipo:

- [ ] `vehicleCapacity` (pax) — ⚠️ hoje é **input manual** no gerador de horários (`useState(80)`, sem persistência) — não vem de `Vehicle.seatedCapacity/totalCapacity` (frota real). Protótipo também fixou em 80 — bate com o default atual. Ver dúvida (5).
- [ ] `renewalIndex` por sentido — ✅ já existe (ver seção anterior), usado para inflar a capacidade por viagem: `capacityPerTrip = vehicleCapacity * (1 + renewalIndex[dir]/100)`
- [ ] `ofertaSeries: Record<Direction, Record<hour, number>>` — ✅ equivalente a `supply` do protótipo, já calculado por `computeOfertaSeries` a partir de `windows` + `vehicleCapacity` + `renewalIndex`
- [ ] `demand` por hora — ✅ já existe (ver seção anterior), é o `demand` real importado, não uma distribuição percentual sobre `dailyRidership`

> Consideração: Gráfico de oferta e demanda do modal do gerador ocorre em momento e com propositos diferentes, no modal ainda nao existe dados reais, eh tudo simulado, aqui vai pegar os dados reais de viagens, km, etc, reaproveitar a logica perfeito, mais lembrando que são momentos distintos

Nomenclatura observada no código real: funções/variáveis em inglês (`computeOfertaSeries`, `renewalIndex`, `vehicleCapacity`), mas as **chaves de dados do gráfico** ficam em português (`dataKey="oferta"` / `"demanda"`) porque vão direto pro rótulo da UI. Se for reaproveitar esse padrão no comparativo, decidir se mantém `oferta`/`demanda` como chave ou padroniza em inglês (`supply`/`demand`) — protótipo atual já usa `supply`/`demand`.

> Respondendo: prefiro padronizar nome de chaves todas em ingles, e mapear para exibição no UI

## Simulação — perfil de demanda (do jeito que está no protótipo)

- [ ] `demandProfile[]` — ⚠️ **não deveria ser necessário** — é uma distribuição percentual inventada para o protótipo; o sistema real já tem `demand` por hora (contagem real, ver acima). Provavelmente descartar em favor do `demand` real.
- [ ] `peakHours[]` — mesmo caso: hoje "pico" é implícito nas `windows[]` (janela com `intervalMinutes` menor), não um `Set` fixo de horas.

> Perfeito, dados no prototipo somente para visualização mesmo, limpar e adequar o que necessário para o cenário real agora

## Simulação — dados calculados por hora (linha do gráfico)

- [ ] `hour`
- [ ] `demand` — ✅ mapeia pro `demand` real da linha
- [ ] `supply` — ✅ mapeia pro `ofertaSeries` (`computeOfertaSeries`)
- [ ] `loadFactor` — `demand / supply`
- [ ] `deficit` — `max(0, demand - supply)`
- [ ] `isPeak` — a definir (ver dúvida 2)

## Simulação — KPIs agregados

- [ ] `totalDailyDemand`
- [ ] `totalDailySupply`
- [ ] `avgLoadFactor`
- [ ] `saturatedHoursCount` — horas com `loadFactor > 1.0`
- [ ] `totalUnmetDemand`
- [ ] `peakLoadFactor`

## Considerações e dúvidas em aberto

1. **Status da linha (rascunho/ativo)** — `TransitLine` não tem esse conceito hoje, só `isActive: boolean`. O comparativo (atual × proposto) é uma feature nova em nível de linha — vira uma entidade própria versionada (tipo um "LineProposal", espelhando `VehiclePlan`/`VehiclePlanStatus`), ou reaproveita `isActive` de algum jeito? Indício forte pra primeira opção: `vehicle-plan/[id]/page.tsx:430-431` já usa exatamente esse padrão — `status === 'ACTIVE' ? 'Ativo' : 'Rascunho'` — e o protótipo copiou esse texto/cor. Sugere reaproveitar `VehiclePlanStatus` (`DRAFT | ACTIVE`) como convenção, não inventar um enum novo.

> RESPOSTA: Existe sim, o status neste caso não é de `TransitLine` e sim de `LineSchedule`, que seria a "ordem de serviço" associada ao planejamento... esse comparativo vai "morar" em `apps/web/src/app/transit/vehicle-plan/[id]/page.tsx` (na verdade em um fragmento separado, mais listado nesta página), aqui o status listado eh o LineScheduleStatus, consideração em caso de o plano ainda não ter um `LineSchedule` associado, o badge neste caso deve mostrar "Em análise"

2. **Intervalo de pico manhã/tarde/entrepico como campos fixos** — hoje o modelo real (`windows[]`) é uma lista arbitrária de janelas por dayType/sentido, cada uma com seu próprio `intervalMinutes`, sem conceito fixo de "manhã/tarde". O comparativo deve: (a) simplificar para 3 slots fixos como no protótipo, ou (b) expor a lista completa de janelas (mais fiel ao dado real, mais complexo de exibir num card resumo)?

> Resposta: A: inferir uma média nos 3 principais blocos, em geral pico manha gira em torno de 05h30 as 08h00 (+-) e pico tarde entre 15h30 as 18h00 (+-) mais pode ter pequenas variações dependendo da linha, intervalo deve ser do ciclo (ida+volta), são raros os caso onde um dos sentidos tem frequencia muito diferente do outro (exemplo alguma linha com parte da frota operando somente em uma das pernas), estas excessões vamos deixar para tratar quando aparecerem


3. **Escopo por sentido** — `extensionKm`, `windows`, `renewalIndex` e `demand` são todos por sentido (`OUTBOUND/INBOUND/CIRCULAR`). O protótipo trata a linha como um valor único agregado. O comparativo deve comparar por sentido, ou consolidar num "geral" (`overall`, que já existe pra `renewalIndex`)?

> Rdsposta: Consolidar, média do ciclo (ida+volta)


4. **DayType** — `windows` e `demand` também são escopados por tipo de dia (`U`/`S`/`D`...). O comparativo assume um dayType fixo (ex. dia útil) ou precisa de seletor?

> Não, como explicado pagina mora na pagina de VehiclePlan que já é associado a um dayType, comparativo (condição atual) assume VehiclePlan com mesmo dayType e status=ACTIVE, se o proprio for o proprio plano em analise apenas repete os dados (ou deixa apenas um dos quadro, vamos ver o que fica melhor)

5. **`vehicleCapacity`** — usar valor manual (como o gerador de horários hoje, default 80 — bate com o protótipo) ou puxar de `Vehicle.totalCapacity`/`seatedCapacity` da frota real vinculada ao `VehiclePlan`?

> Não, no modal de geração isso eh inferido manualmente pois é estimado, no planejamento real os carros (blocos) recebem um vehicleType, vamos definir associação padrão, onde cada vehicleType tem uma capacidade de referencia, e inferir a capacidade daqui... num primeiro momento vamos deixar isso mapeado hardcoded msm, mais com uma observação no bloco para migrar para o settings (ou de fleet ou de transit, pensar melhor) no futuro 

6. **`renewalIndex` / "Renovação"** — hoje é **computado** (bilhetagem × GPS), não um input manual. O protótipo tratava como estático/editável (10%). O comparativo deve só exibir o valor computado real (por sentido ou `overall`), ou também precisa permitir simular um cenário manual (ex. "e se a renovação fosse X%")?

> Apenas estatico, em ambos o s casos (modal de geração e este que estamos tratando) quero passar a mostrar somente o indice de renovação da olinha (geral) não por sentido, tanto na exibição quando na geração, o indice por sentido é apenas para consulta persistido no json sem aplicação prática no sistema, linha sempre usa o indice geral

7. **Métricas sem fonte hoje** (`fleetSize`, `dailyTrips`, `operatingHours`, `dailyKm`, `avgSpeed`, `occupancyIndex`, `serviceFrequencyIndex`, `peakPassengersPerHour`) — de onde cada uma seria calculada? Hipótese: agregação de `LineSchedule`/`LineDeparture`/`TransitTrip` para o "atual" (o que está oficialmente aprovado), e de algum rascunho editável para o "proposto" — análogo a como `VehiclePlan.summary` é populado pelo solver. Confirmar fonte por métrica, e se "atual" = schedule `APPROVED` vigente.

> Resposta: Aqui tudo já existe ou será calculado em nivel de plano, fleetSize (blocos usados no plano), dailyTrips (viagens produtivas do plano), etc... hipoteze correta, mais estou pensando em adicionar um summary (provavelmente em VehiclePlanLine) para persistir dados e facilitar a consulta / comparação, quero sua opnião neste caso

8. **`score`** — RESOLVIDO (ver acima), critérios definidos depois.

## Notas de UI adicionais

- Gráfico Oferta × Demanda: oferta = barra, demanda = linha (era o inverso no protótipo inicial).

## Arquivos relevantes já lidos durante a análise

- `apps/api/prisma/schema/transit.prisma` — modelos `TransitLine`, `VehiclePlan`, `LineSchedule`, etc.
- `packages/schemas/transit/line.schema.ts` — schema Zod de `TransitLine.metrics` (fonte de verdade dos nomes de campo)
- `apps/web/src/app/transit/vehicle-plan/[id]/line-generator-logic.ts` — `computeOfertaSeries`, `fleetNeededForHour`, `deriveFleetBands`
- `apps/web/src/app/transit/vehicle-plan/[id]/components/LineScheduleGeneratorModal.tsx` — uso real do gráfico oferta/demanda e do `renewalIndex`/`vehicleCapacity`
- `apps/web/src/app/transit/vehicle-plan/[id]/views/vehicles.view.ts` — tipos `LineMetrics`/`CycleWindow` no frontend
- `apps/web/src/app/transit/transit-line/DemandImportModal.tsx` — formato real de `demand` e fluxo de importação
- `apps/web/src/app/transit/vehicle-plan/[id]/page.tsx` — confirma o padrão `status === 'ACTIVE' ? 'Ativo' : 'Rascunho'` que o protótipo reproduziu (ver dúvida 1)
