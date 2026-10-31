# Plano — Detalhe do dia no portal do condutor

**Status: etapas 1 e 2 implementadas.** O que existe está descrito em
[`docs/architecture/transit/rostering.md`](../../architecture/transit/rostering.md) (Crew portal).

> **Etapa 2 — diferenças em relação ao texto abaixo:**
> - `PortalTripMap` traz também `start`/`end` da viagem; `joins`/`leaves` com `lat`/`lng` nulos
>   quando o local não tem coordenada (o ponto some do mapa, o texto fica no cabeçalho).
> - Distância "em linha reta" até onde ele assume; sem isso, até onde entrega; senão até o destino.
> - Viagem suprimida não tem botão de mapa.

> **Etapa 1 — diferenças em relação ao texto abaixo:**
> - Locais pelo `TransitLocality.name` (não `abbr`) — o condutor lê o nome.
> - `PortalDutyDetail.notes`: as markings da tabela, cada texto uma vez (viagens suprimidas fora).
> - Pegada e largada sempre vêm do `DutySummary` (horário efetivo, explícito ou implícito pelas
>   configurações); o local é o da atividade, senão o início da primeira peça / fim da última.
> - Tela: `apps/web/src/app/portal/day-detail.tsx`; endpoint `PortalService.rosterDay`.

Convenções: comentários em snippets Prisma/TS em inglês; texto em pt-BR; minutos do dia
operacional (`> 1440` = madrugada seguinte).

---

## Contexto — como funciona hoje

```
VehiclePlan ── VehicleBlock ── BlockTrip → TransitTrip (markings, stopPattern, notes)
   │                       ├─ BlockDeadrun / BlockInterval
   └─ CrewPlan ── Duty ── DutyPiece (span of ONE block: start/end minutes + locality)
                       └─ DutyActivity (SIGN_ON/OFF, BREAK, TRAVEL, STANDBY)
        │ materializeDay(scope, date) — a copy, never a reference
        ▼
DailyOperation ── DailyBlock (vehicleId) ── DailyBlockEvent (TRIP/DEADRUN/INTERVAL)
               └─ DailyDuty ── DailyDutyPiece / DailyDutyActivity
                     ▲
RosterEntry (crewMember × date) ── DUTY / STANDBY / DAY_OFF / COMP_OFF
```

- O portal (aba **Escala**, `apps/web/src/app/portal/sections.tsx` → `Roster` / `DayCard`) consome
  `GET /portal/roster?from&to` (`PortalService.roster`): só dias `PUBLISHED`/`CLOSED`; por dia mostra
  tipo, tabela, início–fim, linhas e carros. O card não é clicável e não há endpoint de detalhe.
- As **markings** da `TransitTrip` (`[{ legendText, fontStyle?, bgColor? }]`, sincronizadas com
  `LineDeparture.markings` / OSO) **não são copiadas para o dia** — `DailyBlockEvent` não tem o campo.

---

## Etapa 1 — detalhe do dia

Na aba Escala, cada dia é uma escala; tocar num dia com tabela abre o detalhe dela.

### Decisões

| Tema | Decisão |
|---|---|
| Onde | Portal, aba Escala — o `DayCard` com tabela fica clicável e abre um painel tela cheia (mobile first) |
| Endpoint | `GET /portal/roster/:date` — novo; mesma regra do `roster()`: `viewRoster` + dia `PUBLISHED`/`CLOSED`, senão 404 |
| Markings | **Copiadas para o dia** na materialização (o dia é cópia, não referência) — não lidas do plano pelo `sourceId` |
| stopPattern | Copiado junto, na mesma migração |
| Dados existentes | App não está em produção — sem carga/backfill; dias antigos ficam sem markings até serem recriados |
| Informação principal | **Horário e local** — onde e quando o condutor se apresenta / troca / entrega. A viagem que começa é secundária |
| Rendição no meio da viagem | Destaque para "HH:MM — Local"; a viagem aparece abaixo, com menos destaque |
| Várias tabelas no dia | Listar **todas**, em ordem cronológica (hoje `roster()` mostra só a primeira) |
| Markings na tela | Só a mensagem (`legendText`); cor e estilo da OSO ignorados |

### Migração

```prisma
model DailyBlockEvent {
  // ...
  // TripMarking[] copied from TransitTrip.markings at materialization — TRIP only
  markings    Json?
  // copied from TransitTrip.stopPattern — TRIP only
  stopPattern TripStopPattern?
}
```

`daily-materialize.ts`: `tripSelect` passa a ler `markings` e `stopPattern`; `tripEvent()` grava os dois.

### Contrato (`packages/schemas/transit/portal.schema.ts`)

```ts
export interface PortalRosterDayDetail {
  date: string
  duties: PortalDutyDetail[]          // every duty of the day, chronological
  window: string | null               // approved time window, as in PortalRosterDay
}

export interface PortalDutyDetail {
  label: string                       // "D10" | "Plantão"
  kind: 'DUTY' | 'STANDBY'
  start: number | null; end: number | null
  totals: { spreadMinutes?: number; workMinutes?: number; breakMinutes?: number } | null
  items: PortalDutyItem[]
}

export type PortalDutyItem =
  | { type: 'SIGN_ON' | 'SIGN_OFF'; minutes: number; locality: string | null }
  // a piece: the relief points are the headline — where and when he takes / hands over the car
  | { type: 'PIECE'; start: number; end: number; from: string; to: string; vehicle: string | null; events: PortalDutyEvent[] }
  | { type: 'BREAK'; start: number; end: number; label: string; locality: string | null }
  | { type: 'TRAVEL'; start: number; end: number; from: string | null; to: string | null }

export type PortalDutyEvent =
  | { type: 'TRIP'; id: string; start: number; end: number; line: string; from: string; to: string
      stopPattern: 'LOCAL' | 'LIMITED' | 'EXPRESS' | null; cancelled: boolean
      // he takes / hands over mid-trip — the piece's edge time, else null
      joinsAt: number | null; leavesAt: number | null
      notes: string[] }                 // markings' legendText
  | { type: 'DEADRUN'; start: number; end: number; from: string; to: string }
  | { type: 'INTERVAL'; start: number; end: number; label: string }
```

- Locais por nome (`TransitLocality.abbr ?? name`), resolvidos num `findMany` — as tabelas do dia
  guardam só ids.
- Eventos da peça: os do `DailyBlock` que cruzam `[piece.start, piece.end]`. Viagem que começa antes
  do início da peça → `joinsAt`; que termina depois do fim → `leavesAt`.
- Viagem suprimida (`isCancelled`) é listada, marcada como suprimida.

### Tela

Por tabela, de cima para baixo:

1. **Cabeçalho** — "Tabela D10", `07:12 – 15:40`, totais (jornada · trabalhado · intervalo).
2. **Observações** — as mensagens únicas de markings da tabela, num bloco de aviso no topo (o
   condutor vê antes de tudo o que é especial no dia).
3. **Linha do tempo** — cada ponto com **hora grande + local em destaque**:
   - `07:12  Garagem Centro` · Pegada
   - `07:30  Terminal Norte` · Assume o carro 1234
     - viagens abaixo, em texto menor: `07:30–08:15 · 308 Terminal Norte → Centro` · selo
       "Expresso" quando não for LOCAL · a marking em itálico logo abaixo
   - `11:05  Centro` · Refeição (até 12:05)
   - `15:40  Garagem Centro` · Entrega o carro / Largada
4. Rendição no meio da viagem: o ponto mostra `09:47  Ponto X` · "Assume em andamento"; a viagem
   inteira fica abaixo, com menos destaque.
5. Várias tabelas no dia: um bloco por tabela, separados, na ordem do início.

Voltar fecha o painel (sem atalhos de teclado — o portal não usa alt+g/v/l).

---

## Etapa 2 — mapa da viagem e posição do condutor

No detalhe do dia, tocar numa viagem abre o mapa dela; liberando a geolocalização, o mapa mostra
onde o condutor está. **Sem navegação passo a passo e sem "como chegar"** — fora do escopo.

### Decisões

| Tema | Decisão |
|---|---|
| O que tem mapa | Só viagens (`TRIP`) — o traçado vem da rota. Ociosas e intervalos não têm traçado guardado: sem mapa |
| Traçado | `RouteLocality.geometry` (GeoJSON por trecho, já gerado pelo OSRM) + paradas com `lat`/`lng` — nada novo no banco |
| Migração | **Nenhuma** — a etapa 2 não acrescenta campo à migração da etapa 1 |
| Destaques | Origem, destino e o **ponto de rendição** da peça (onde ele assume / entrega) quando cai no meio da viagem |
| Posição | `navigator.geolocation.watchPosition` depois que ele libera; ponto "você está aqui", botão para centralizar/seguir, distância em linha reta até o ponto de rendição ou o destino |
| Permissão negada | O mapa funciona igual, só sem a posição; aviso discreto de como liberar |
| Tela acesa | Wake Lock API enquanto o mapa com posição está aberto (onde o navegador suportar) |
| Mapa | Leaflet / react-leaflet (já no web) — componente próprio do portal, leve, sem as ferramentas de edição do `MapCanvas` da rota |

### Contrato

`PortalDutyEvent` do tipo `TRIP` ganha `id` (o `DailyBlockEvent.id`) para pedir o mapa.

```ts
// GET /portal/roster/:date/trip/:eventId/map
export interface PortalTripMap {
  line: string
  route: string                         // TransitRoute.name
  // the route's legs joined in order — GeoJSON coordinates ([lng, lat])
  path: [number, number][]
  stops: { name: string; lat: number; lng: number; kind: 'ORIGIN' | 'DESTINATION' | 'STOP' }[]
  // where he takes / hands over the car when it falls inside this trip — else null
  joins: { name: string; lat: number; lng: number; minutes: number } | null
  leaves: { name: string; lat: number; lng: number; minutes: number } | null
}
```

- Guard: mesma regra do detalhe (`viewRoster`, dia `PUBLISHED`/`CLOSED`) **e** o evento tem de cair
  numa peça de uma tabela dele naquele dia — o condutor não abre mapa de viagem alheia.
- Rota sem traçado gerado (legs sem `geometry`): `path` liga as paradas em linha reta, com aviso
  "traçado aproximado".

### Limitações (app web)

- Geolocalização só em **HTTPS** (ou `localhost`) — testar no celular pela rede local exige túnel ou
  certificado.
- Com a tela apagada ou o navegador em segundo plano a posição para de atualizar — não há rastreio
  em segundo plano.
- **Tiles**: o servidor público do OpenStreetMap (usado hoje no `MapCanvas`) não admite uso em
  produção por um app de campo — antes de produção, provedor (MapTiler, Stadia...) ou servidor próprio.
- Uso ao volante: tela de consulta, com o carro parado ou o celular no suporte — sem interação
  necessária enquanto dirige.

---

## Em aberto (não decidido)

Ideias levantadas, fora das etapas 1 e 2:

- **Navegação passo a passo** — os `steps` do OSRM (já pedidos em `OsrmService.getRoute`, hoje
  descartados), instruções em pt-BR e voz; alerta "fora do itinerário" em vez de recalcular.
- **"Como chegar"** ao ponto de apresentação — link para Google Maps / Waze ou rota OSRM da posição.
- **Observação do escalante para o dia** — `DailyDuty.notes` (texto livre da tabela no dia) e/ou por
  condutor (`RosterEntry.notes`); entraria no bloco "Observações".
- **Observação da tabela do plano** (`Duty.notes`) e da viagem (`TransitTrip.notes`) — hoje não são
  copiadas; copiar exigiria `DailyDuty.notes` / `DailyBlockEvent.notes`.
- **Ciência do condutor** — confirmação de que viu o detalhe do dia (`RosterEntry.acknowledgedAt`?),
  análoga à confirmação das mudanças já existente.
- **Mudanças no detalhe** — destacar o que mudou desde a publicação (via `DailyChangeLog`).
