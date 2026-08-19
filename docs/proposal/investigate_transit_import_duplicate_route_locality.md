# Investigar: erro de import do fixture transit.json (routeLocality duplicado)

> Documento temporário para investigação cruzada — apagar depois de resolvido.
> Recriado após sincronizar o repositório local (rollback de ajustes divergentes
> + merge de `origin/master`) e reproduzir o `pnpm db:reset` novamente: **o erro
> persiste, idêntico**. Isso descarta a hipótese de que fosse causado por
> código local desatualizado — a causa está nos dados do fixture, gerado no
> banco completo.

## Contexto

Rodei `pnpm db:reset` em `apps/api` numa máquina com banco de dev "vazio"
(sem dados de produção). O reset (`prisma migrate reset` + `db:seed` +
`db:seed-core`) roda limpo. O passo final, `db:import-transit`
(`apps/api/prisma/transit-import.ts`), quebra ao importar `RouteLocality`.

O fixture importado é `apps/api/prisma/fixtures/transit.json`, gerado por
`apps/api/prisma/transit-export.ts` a partir do **banco completo** (a máquina
que vai investigar este documento). A causa está nos dados de origem, não na
máquina onde o reset falha.

**Reprodução confirmada duas vezes**, em commits diferentes:
- 1ª vez: antes de sincronizar o repo.
- 2ª vez: depois de `git` rollback dos ajustes locais divergentes + merge de
  `origin/master` (branch atual em `2ab584a`, com `f7cc229`, `cd39c81`, etc).
  Uma migration nova (`20260819145315_add_route_layover_policy`) foi aplicada
  nessa segunda rodada, sem relação com o problema.

Em ambas as vezes, o fixture consumido é o **mesmo arquivo, byte a byte**
(`exportedAt: "2026-08-18T20:24:18.213Z"`, sem mudanças no `git log` desses
arquivos). Nenhum dos arquivos relevantes (`transit-import.ts`,
`transit-export.ts`, `fixtures/transit.json`, `schema/transit.prisma`) foi
tocado pelos commits que entraram no merge. Ou seja, **não é um problema de
código desatualizado local** — a causa é intrínseca aos dados exportados.

## Erro observado

```
PrismaClientKnownRequestError:
Invalid `prisma.routeLocality.create()` invocation in
apps/api/prisma/transit-import.ts:139:32
Unique constraint failed on the fields: (`"routeId"`, `sequence`)
code: 'P2002'
modelName: 'RouteLocality'
```

Import para depois de: localities (83), day types (5), interval types (0),
scopes (1), lines (53), routes (90) — todos OK. Quebra em `routeLocalities`.

## Causa raiz identificada (no fixture, do lado do export)

Inspecionei `apps/api/prisma/fixtures/transit.json` (840 entradas em
`routeLocalities`). Há 3 chaves `lineCode:direction:sequence` duplicadas, todas
da linha **`800`, direção `OUTBOUND`**:

```
duplicate keys: 800:OUTBOUND:1, 800:OUTBOUND:2, 800:OUTBOUND:3
```

A linha 800/OUTBOUND tem 11 entradas no fixture com sequências:

```
[1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3]
```

Ou seja, as 3 primeiras paradas aparecem duas vezes — uma vez no início e
outra vez "coladas" depois da sequência 8.

## Hipótese de causa

`apps/api/prisma/schema/transit.prisma` — o model `TransitRoute` **não tem**
`@@unique([lineId, direction])`. O comentário no schema (linha ~118-120) até
diz que "at most one per (lineId, direction)" é uma regra de negócio, mas
**enforçada só em `RouteService`, não no banco**:

```prisma
// at most one per (lineId, direction), enforced in RouteService
isPrimary Boolean @default(false)
```

Ou seja, nada no schema impede duas linhas `TransitRoute` para o mesmo
`(lineId, direction)`.

`apps/api/prisma/transit-export.ts` (linhas 43-49, 82-87) busca todos os
`RouteLocality` ordenados por `[routeId asc, sequence asc]`, mas **mapeia
cada um para a chave `lineCode:direction`** (via `rl.route.line.code` +
`rl.route.direction`), não por `routeId`:

```ts
routeLocalities: routeLocalities.map(rl => ({
  lineCode: rl.route.line.code, direction: rl.route.direction, sequence: rl.sequence,
  ...
}))
```

Se existirem **duas rotas** (`TransitRoute`) distintas para
`lineCode=800, direction=OUTBOUND` — cada uma com seu próprio trajeto
(`RouteLocality` com `sequence` 1..N por rota) — o export junta as duas em uma
única lista sob a mesma chave `800:OUTBOUND`, gerando sequências repetidas.
No import (`transit-import.ts:130-146`), como o `routeMap` só guarda **um**
`routeId` por chave `lineCode:direction` (o último `TransitRoute` visto no
loop de `routes`), a segunda rota nunca é criada/atualizada separadamente e
suas `routeLocalities` colidem com as da primeira no mesmo `routeId`.

## O que pedir para o Claude validar no banco completo

1. **Confirmar duplicidade de rota**: rodar
   ```sql
   SELECT tr.id, tr.direction, tr.name, tr."isPrimary", tr."isActive", tr."createdAt"
   FROM transit_routes tr
   JOIN transit_lines tl ON tl.id = tr."lineId"
   WHERE tl.code = '800' AND tr.direction = 'OUTBOUND';
   ```
   Esperado: mais de 1 linha. Se sim, confirma a hipótese acima.

2. **Ver o trajeto de cada rota duplicada**:
   ```sql
   SELECT rl."routeId", rl.sequence, rl."localityId", rl."deltaKm", rl."deltaMinutes"
   FROM route_localities rl
   WHERE rl."routeId" IN (<ids encontrados acima>)
   ORDER BY rl."routeId", rl.sequence;
   ```
   Confirmar se são dois trajetos genuinamente diferentes (ex.: um antigo/
   obsoleto e um atual) ou um duplicado acidental (mesmos dados, dois inserts).

3. **Decidir a resolução**, dependendo do que for encontrado:
   - Se for **duplicata acidental** (dois `TransitRoute` idênticos): apagar o
     registro extra (e seus `RouteLocality`) no banco completo, re-exportar
     (`pnpm db:export-transit` ou script equivalente) e recommitar o fixture.
   - Se forem **duas rotas legítimas** (ex.: variação de trajeto para a mesma
     linha/direção — like um itinerário alternativo): o modelo de dados
     precisa de uma chave adicional para diferenciá-las no fixture/export
     (hoje `lineCode:direction` não é suficiente como chave natural). Nesse
     caso considerar adicionar algo como `name` da rota à chave de export/
     import, ou revisitar se `TransitRoute` deveria ter
     `@@unique([lineId, direction])` e a segunda rota é de fato um erro de
     cadastro que deveria ter sido bloqueado.

4. Verificar se há outras linhas/direções no banco completo com o mesmo
   problema (mais de uma `TransitRoute` por `(lineId, direction)`), não só a
   `800`, para dimensionar o escopo do problema:
   ```sql
   SELECT tl.code, tr.direction, COUNT(*) 
   FROM transit_routes tr
   JOIN transit_lines tl ON tl.id = tr."lineId"
   GROUP BY tl.code, tr.direction
   HAVING COUNT(*) > 1;
   ```

## Arquivos relevantes

- `apps/api/prisma/transit-export.ts` — gera o fixture (roda no banco completo)
- `apps/api/prisma/transit-import.ts` — consome o fixture (quebra aqui)
- `apps/api/prisma/fixtures/transit.json` — fixture com o problema (linha 800/OUTBOUND)
- `apps/api/prisma/schema/transit.prisma` — models `TransitRoute` / `RouteLocality`
