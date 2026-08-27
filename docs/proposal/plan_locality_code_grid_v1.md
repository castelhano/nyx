# Proposta — Código geográfico por quadrante para TransitLocality

## Contexto

Hoje `TransitLocality.code` é uma sequência numérica sem significado geográfico (herança
da importação original — `1052`, `1064`, `10`...). Ao cadastrar um ponto novo manualmente,
não há convenção: o usuário escolhe qualquer código livre.

Ideia: mapear a área de atuação em quadrantes (grid regular). Ao criar um `TransitLocality`
com `lat`/`lng` definidos, o sistema sugere um `code` derivado da posição geográfica
(quadrante + sequência dentro do quadrante), editável antes de salvar.

---

## Bounding box atual (dado real, consultado no banco)

```
lat: -15.633475 a -15.278968   (delta ≈ 0.3545°  ≈ 39.3 km)
lng: -56.232999 a -55.942227   (delta ≈ 0.2908°  ≈ 31.2 km em -15.5° lat)
```

Os extremos batem com pontos reais e plausíveis — não são outliers de erro de digitação:

| Extremo | Ponto | Observação |
|---|---|---|
| Sul | `PF Pedra 90` (-15.6335) | periferia leste, extremo da malha |
| Norte | `Aguacu` (-15.2790) | zona norte/rural |
| Oeste | `Guia` (-56.2330) | Várzea Grande, extremo oeste |
| Leste | `PF Pedra 90` (-55.9422) | mesmo ponto do extremo sul, é o canto SE da malha |

> Correção: Esse Guia não eh proximo de varzea grande, mais eh uma linha bem ao extremo que atendemos, peguei o lat lng de VG (parte mais a oeste) -15.67532, -56.19753 acho que podemos usar ela como referencia, hoje nao existe nenhuma linha atendendo em VG mais grid deve pensar em atender aqui

Ou seja, a região coberta hoje já é essencialmente **Cuiabá + Várzea Grande + entorno
imediato** (bairros periféricos como Coxipó do Ouro, Guia, Aguaçu) — bate com a leitura do
usuário.

> RESPOSTA: confirma que o bounding box deve ser esse (Cuiabá + Várzea Grande + entorno
> operacional atual), ou deve ser fixado num valor maior/administrativo (ex.: limites
> municipais oficiais das duas cidades), já prevendo expansão futura da malha?

> Considerar já limite maior pensando em expansão futura

**Minhas considerações**: certo, o ponto de VG (-15.67532, -56.19753) já não entra na caixa
atual (fica ~4,6 km ao sul do extremo sul hoje, `PF Pedra 90`) — confirma que a correção do
Guia procede, e reforça que "extremo atendido hoje" não é a mesma coisa que "limite do
grid". Já que a origem do grid é um valor fixo de configuração (não recalculado a partir dos
pontos cadastrados), dá pra simplesmente arbitrar uma caixa generosa agora sem custo — ela
só define até onde a sugestão de código "sabe" mapear; não afeta os pontos já cadastrados
nem exige migração se crescer de novo no futuro.

Proposta de caixa (números redondos, com folga em todas as direções):

```
Norte: -15.20   (Aguacu -15.2790 fica ~9 km dentro da margem)
Sul:   -15.75   (referência de VG -15.67532 fica ~8,3 km dentro da margem)
Oeste: -56.30   (Guia -56.2330 fica ~7,5 km dentro da margem)
Leste: -55.90   (PF Pedra 90 -55.9422 fica ~4,6 km dentro da margem)
```

Isso dá ≈ 61 km (N–S) × 43 km (L–O) → grid de ~61×43 células a 1 km, ainda folgado dentro
de 2 dígitos (row/col) e com espaço pra crescer mais ~35% antes de precisar de 3 dígitos aí
também.

> RESPOSTA: **superada** — ver "Revisão — caixa núcleo + letras de fora da área" logo
> abaixo. Essa caixa expandida distorcia o quadrante (centroide geométrico ≠ centro real de
> Cuiabá) e obrigava esticar o grid pra caber outliers raros (Guia, Aguaçu, Coxipo do Ouro).

---

## Revisão — caixa núcleo + letras de "fora da área"

Ao plotar os 49 pontos (KML importado no My Maps), ficou visível que a caixa expandida
inflava o grid por causa de 3 pontos bem distantes do resto da malha — e o centro geométrico
da caixa grande não é o centro real de Cuiabá, o que jogou `Garagem Rapido` pro quadrante
errado no exemplo anterior.

**Centro confirmado**: `-15.5989, -56.0979` — conferido visualmente no mapa, é o centro real
de Cuiabá.

**Caixa núcleo — v3**, ancorada em pontos reais em vez de números redondos inventados. A
primeira versão usava `PF Pedra 90` como canto Sudeste, mas isso cortava área real de Cuiabá
ao sul; você deu 2 referências novas pro lado sul (Sudeste e Sudoeste) e pediu pra alinhar
os dois no mesmo limite Sul (o mais extremo dos dois):

```
Norte: -15.509906  (Bandeira, code 1028 — Noroeste, sem mudança)
Sul:   -15.699610  (referência Sudoeste, -15.69961 — mais ao sul que a Sudeste, -15.69523)
Oeste: -56.232420  (referência Sudoeste, -56.23242 — mais a oeste que Bandeira)
Leste: -55.921120  (referência Sudeste, -55.92112 — mais a leste que PF Pedra 90)
```

`PF Pedra 90` deixa de ser um canto da caixa — agora fica bem dentro dela (natural, já que a
caixa cresceu pra sul e leste pra não cortar área real).

≈ 21,0 km (N–S) × 33,4 km (L–O) → grid de **21 linhas × 34 colunas**.

O centro (`-15.5989, -56.0979`) ficou bem mais central dessa vez: até a borda norte ~9,9 km,
até a sul ~11,1 km, até a oeste ~14,4 km, até a leste ~19,0 km — bem mais equilibrado que a
v2 (que tinha só 3,8 km até o sul).

Reconferindo `Garagem Rapido`: lat acima do centro (norte), lng acima do centro (leste) →
**Nordeste** — segue batendo com o que você apontou.

**Pontos fora da caixa núcleo hoje** (só os 3 reais — a referência de VG das rodadas
anteriores foi substituída pelos 2 pontos novos do Sul acima, que já entraram como cantos
da própria caixa):

| Ponto | Excesso |
|---|---|
| `1022 Guia` | ~18,3 km ao norte do limite |
| `1034 Aguacu` | ~25,5 km ao norte do limite |
| `1033 Coxipo Ouro` | ~5,7 km ao norte **e** ~3,9 km a leste (excede os dois lados) |

**Sua ideia de letras extras pra "fora"**: concordo, resolve bem — em vez de inflar a caixa
pra caber casos raros, eles ganham uma letra de "direção de saída" própria. Com 4 dentro
(`A`–`D`) + 4 fora, fecha nas suas "8 (ou algo do tipo)":

| Letra | Significa | Regra |
|---|---|---|
| `A`–`D` | dentro da caixa núcleo | quadrante por posição vs. centro (como já definido) |
| `E` | fora, ao Norte | lat acima do limite norte da caixa |
| `F` | fora, ao Sul | lat abaixo do limite sul da caixa |
| `G` | fora, a Leste | lng além do limite leste da caixa |
| `H` | fora, a Oeste | lng aquém do limite oeste da caixa |

**Desempate quando o ponto excede dois lados** (caso do Coxipo do Ouro, que passa de duas
bordas ao mesmo tempo): uso o eixo com **maior excesso em km** — Coxipo do Ouro cai em `E`
(Norte, 5,7 km > 3,9 km a leste). Simples e determinístico, sem precisar de lógica de
ângulo/8 direções pra decidir. Se um dia isso incomodar (ex.: crescer muito a leste e ao
norte ao mesmo tempo), dá pra evoluir pra 8 direções sem quebrar os códigos já emitidos —
mas pra hoje, com só 3 casos conhecidos, acho desnecessário.

**Formato pros pontos "fora"**: linha/coluna do grid núcleo não fazem sentido pra quem está
fora dele, então proponho simplificar pra `[Letra]-[SSS]` (sem `RR`/`CC`) — ex.: `E-001`,
`E-002`, `E-003` pros três pontos hoje fora ao norte. Perde a resolução fina de posição, mas
é aceitável — são poucos pontos, raros, e o que importa é só sinalizar "atípico, fora da
área núcleo".

> RESPOSTA: As letras sugeridas perfeito, mais quero que todos os pontos tenham o mesmo size, então mesmo que não representando um quadrante real vamos usar L0000-000 na pior das hipoteses usar 0 em todas as posições do quadrante mesmo

**Decidido: `[Letra][RR][CC]-[SSS]` sempre, tamanho fixo pra todo código.** Pontos fora da
caixa núcleo (`E`–`H`) usam `RR=00`/`CC=00` fixos (não representam célula real, é só
padding) — ex.: `E0000-001`. Mais simples de parsear/validar (regex único, sem variação de
tamanho) e mais fácil de ordenar/alinhar em listagem.

Recalculado com a caixa núcleo **v3** (bounds Sul/Leste/Oeste corrigidos pelas suas novas
referências, precisão total, sem arredondamento):

| Letra | Qtd hoje | Exemplos |
|---|---|---|
| `A` (Nordeste) | 28 | `Garagem Rapido` → `A0318-001`, `TRT` → `A0717-001` |
| `B` (Noroeste) | 8 | `Bandeira` → `B0006-001` (perto da borda norte, como esperado) |
| `C` (Sudeste) | 8 | `PF Pedra 90` → `C1331-001` (agora bem dentro da caixa, não mais na borda) |
| `D` (Sudoeste) | 4 | `Praca Porto` → `D1113-001` |
| `E` (fora, Norte) | 3 | `Guia`, `Coxipo Ouro`, `Aguacu` → `E0000-001/002/003` |
| `F`/`G`/`H` | 0 | nenhum ponto cai fora ao sul/leste/oeste hoje |

KMZ atualizado com a caixa núcleo v3, os 8 grupos de cor por letra e o código calculado de
cada ponto no nome do placemark (inclui os 2 pontos de referência que você deu, marcados
como `SE ref (novo)` e `SW ref (novo)`, pra você conferir visualmente que caem exatamente
nos cantos da caixa):

```
/tmp/claude-1000/-home-rafael-studio-nyx/e97ae154-f82d-45d9-8106-6e6562275e4b/scratchpad/locality_grid_v3.kmz
```

(A ordem de sequência dentro da célula, no exemplo acima, foi por `code` só pra ilustrar —
ainda não tem regra definitiva; ver "O que precisa ser construído".)

---

## Tamanho de célula sugerido: **1 km × 1 km**

Com o bounding box acima isso dá um grid de aproximadamente **40 linhas × 32 colunas ≈
1.280 células**, das quais hoje só ~49 têm algum ponto (baixíssima densidade — a maioria
das células fica vazia, o que é esperado nesse estágio).

Por quê 1 km:
- Suficiente pra separar bairros/pontos de referência distintos sem exagerar — dois pontos
  a 1.4 km de distância (diagonal da célula) ainda caem em quadrantes vizinhos, então o
  prefixo já carrega informação útil de localização.
- Célula pequena o bastante pra não misturar pontos de rotas diferentes na mesma sequência
  (o sufixo sequencial por quadrante tende a ficar de 1–2 dígitos, mesmo com a malha
  crescendo bastante).
- Redondo o suficiente pra virar constante de config única (`CELL_SIZE_KM = 1`), fácil de
  ajustar depois sem tocar em código de negócio.

Alternativa considerada: 2 km (grid ~20×16 ≈ 320 células) — reduz ainda mais a granularidade,
mas em troca cada quadrante passa a cobrir uma área bem maior (ex.: um bairro inteiro),
o que pode agrupar pontos que o usuário esperaria ver em quadrantes diferentes.

> RESPOSTA: 1 km está bom, ou prefere outro valor (2 km, 500 m)?
> 1km esta otimo

**Decidido: 1 km × 1 km.** Vale só reconferir depois de fechar a caixa expandida acima —
com ~61×43 células continua a mesma lógica, nenhum ajuste necessário.

---

## Formato do código proposto

Formato: `[Quadrante][Sequência]`, exemplo `Q1407-03` → quadrante linha 14 / coluna 07,
3º ponto cadastrado nesse quadrante.

- **Quadrante**: `linha` (índice norte→sul a partir do canto NW do bounding box) e `coluna`
  (índice oeste→leste), cada um com 2 dígitos zero-padded — dá pra até 99 células por eixo,
  suficiente pro grid de ~40×32.
- **Sequência**: contador por quadrante, 2 dígitos zero-padded (renumera dentro da célula,
  não é globalmente único sozinho — só o `code` completo é).
- Separador `-` só por legibilidade; pode sair se preferir código compacto tipo `140703`.

Isso quebra compatibilidade com o padrão legado (`1052`, `10`, etc. — puramente numérico
sequencial, sem separador). Ver pergunta de renumeração abaixo.

> RESPOSTA: formato ok? Prefere manter só dígitos (sem `-`) pra ficar mais parecido com o
> padrão antigo, ou algum outro formato (ex.: usar letra pra coluna em vez de número, tipo
> `N14-03`)?

> Resposta: gostei da sugestão, so quero sugerir para ao invez de usarmos o Qxx aproveitarmos essa letra com um proposito, a letra poderia indicar um quadrante maior, exemplo região nordesste, sudeste etc... uma letra apenas que poderiamos mapear A=NORDESTE exemplo, desta forma so olhando para a letra ja temos a ideia da região deste ponto, o que acha? Outra questão vamos usar 3 posições para o ponto, nçao sei se corre risco de ter mais de 99 pontos em um raio de 1km mais melhor precaver, ficaria algo como A1401-001 me de suas considerações 

**Minhas considerações:**

- **Sequência em 3 dígitos**: concordo, é barato (código fica só 1 caractere mais longo) e
  remove de vez a preocupação de estourar 99 pontos numa mesma célula de 1 km² (bem
  plausível num centro adensado). Fechado: `SSS` (000–999).

- **Letra de macro-região**: gosto da ideia, mas com uma ressalva — "quadrante" já é
  literalmente o nome do sistema, então acho que faz mais sentido usar **4 letras** (os 4
  quadrantes clássicos: Nordeste / Noroeste / Sudeste / Sudoeste, cortando a caixa pelo
  centro) em vez de 8 (rosa dos ventos completa). Fica mais simples de explicar e a letra
  não perde significado. Se no futuro a malha crescer muito pra um lado só, dá pra migrar
  pra 8 sem quebrar nada (letra é só metadado de leitura, não é usada em nenhum cálculo).

  Com a caixa expandida da seção anterior, o centro do corte ficaria em
  `lat -15.475, lng -56.10`:

  | Letra | Região | Condição |
  |---|---|---|
  | `A` | Nordeste | lat ≥ -15.475 (norte) **e** lng ≥ -56.10 (leste) |
  | `B` | Noroeste | lat ≥ -15.475 (norte) **e** lng < -56.10 (oeste) |
  | `C` | Sudeste | lat < -15.475 (sul) **e** lng ≥ -56.10 (leste) |
  | `D` | Sudoeste | lat < -15.475 (sul) **e** lng < -56.10 (oeste) |

- **Ponto em aberto que não estava no seu exemplo**: a letra já *escolhe* metade da caixa —
  então `linha`/`coluna` (`14`/`01` no seu exemplo) deveriam contar **a partir do canto da
  própria macro-região** (zerando dentro de cada quadrante) em vez de contar a partir do
  canto NW da caixa inteira? Isso evita redundância entre a letra e os dígitos (hoje, sem
  isso, a letra e o valor da `linha` carregam a mesma informação duas vezes) e mantém os
  números menores (cada quadrante cobre só ~30×21 células da caixa expandida, bem longe de
  precisar de 3 dígitos aí também). Recomendo essa opção — mas como o seu exemplo
  `A1401-001` não deixa claro qual dos dois você tinha em mente, prefiro confirmar antes de
  fixar no plano.

  > RESPOSTA: codigo do quadrante total, nao reinicia por região, na divisão do quadrantes
  > pode ate ser que se enxergue como reduntante, quadrante do 01 ao 30 = letra A (exemplo),
  > mais para o humano que lé eh mais facil decorar 4 codigos para saber a região, então não
  > vejo problema

  **Decidido**: `linha`/`coluna` globais, contados a partir do canto NW da caixa inteira —
  a letra não corta a numeração, é puramente redundante pra leitura humana, como você
  descreveu.

- **Formato final fechado: `[Letra][RR][CC]-[SSS]`**, ex.: `A1401-001` — `A` = macro-região
  (Nordeste), `14`/`01` = linha/coluna globais na caixa inteira (não resetam por letra),
  `001` = sequência dentro da célula.

---

## O que precisa ser construído

| Peça | Onde | Descrição |
|---|---|---|
| Constante de configuração do grid | novo, provavelmente `packages/schemas/transit/` ou `apps/api/src/modules/transit/network/locality/` | Origem do grid (canto NW fixo, não recalculado a partir dos pontos existentes — senão o grid desliza toda vez que um ponto mais extremo é cadastrado), tamanho de célula, dígitos de padding |
| Função pura `latLngToQuadrant(lat, lng)` | idem | Aritmética simples sobre a origem fixa — sem dependência de banco, testável isolada |
| Contador de sequência por quadrante | endpoint novo (ex.: `GET /transit/locality/suggest-code?lat=&lng=`) | Precisa de round-trip ao banco (`count` de localities cujo code já começa com o prefixo do quadrante) — não dá pra calcular só no frontend |
| Sugestão no form de criação | `packages/schemas/transit/locality.schema.ts` + página de criação | Ao digitar/arrastar `lat`/`lng` no form, disparar a sugestão e preencher `code` (editável — usuário pode sobrescrever) |
| Decisão de renumeração do legado | — | Ver pergunta abaixo — se sim, precisa rodar migração pontual + `pnpm db:export-transit` pra manter o fixture em dia (mesmo cuidado que vimos na limpeza anterior) |
| Legenda de macro-região (letra → nome) | mesmo lugar da constante do grid | Dicionário de 8 entradas (`A–D` quadrantes internos, `E–H` fora ao Norte/Sul/Leste/Oeste), puramente pra exibição/leitura — a letra interna não entra em cálculo, mas a letra `E–H` sim decide o formato do código (sem `RR`/`CC`) |
| Função `classifyOutside(lat, lng)` | mesma pasta da constante do grid | Se o ponto cai fora da caixa núcleo: calcula excesso em km pros 4 lados, retorna a letra do maior excesso (regra de desempate quando excede 2 lados) |

> Consideação: Todos os pontos legados seram ajustados para corresponder a nova metodologia

**Nota**: como ficou decidido renumerar os 49 pontos existentes (pergunta 4 abaixo), a
migração precisa rodar **depois** de fechar caixa + formato (senão renumera duas vezes).
Ordem sugerida: 1) confirmar caixa/formato → 2) implementar `latLngToQuadrant` + endpoint de
sugestão → 3) rodar migração dos 49 pontos legados (script pontual, não via form) →
4) `pnpm db:export-transit` pra sincronizar o fixture.

---

## Perguntas / dependências abertas

1. ~~**Bounding box**~~ — caixa expandida descartada. Nova proposta: caixa núcleo ancorada em
   `Bandeira`/`PF Pedra 90`, ver seção "Revisão — caixa núcleo + letras de fora da área" —
   falta confirmar.
2. ~~**Tamanho de célula**~~ — decidido: 1 km × 1 km (dentro da caixa núcleo).
3. **Formato do código**: pontos dentro da caixa núcleo fechado em `[Letra A-D][RR][CC]-[SSS]`
   (letra redundante por design, `linha`/`coluna` globais, sequência 3 dígitos). Pontos fora
   propostos como `[Letra E-H]-[SSS]` (sem grid) — falta confirmar essa parte + a regra de
   desempate quando o ponto excede 2 bordas.
4. **Renumerar os 49 pontos existentes agora, ou só aplicar o padrão daqui pra frente?**
   Manter os 49 como estão é mais simples e zero-risco; renomear todos de uma vez dá
   consistência total mas exige re-sincronizar o fixture (`db:export-transit`) e revisar
   se algum outro lugar guarda `code` "hardcoded" fora do banco.
   > RESPOSTA: Revisar todos para manter consistencia
5. **Ponto na borda entre duas células** — não há ambiguidade real (é aritmética de piso/
   truncamento, sempre determinística), mas vale confirmar: ok um ponto a poucos metros da
   fronteira cair "arbitrariamente" numa célula ou outra, sem tolerância especial?
   > RESPOSTA: Sem problemas, nao precisa de logica muito complicada.
6. **Sugestão só como texto no campo `code`, ou também mostrar o quadrante no mapa (overlay
   visual) pro usuário conferir antes de salvar?** Overlay é mais trabalho de frontend
   (desenhar grid sobre o mapa Leaflet/MapLibre já usado na tela de rota).
   > RESPOSTA: So como texto no campo code por enquanto, exibição no mapa fica para futuro (caso necessario)
7. **`isDepot`** — depots (ex.: `Garagem Vpar`, `code: 10`) entram no mesmo esquema de
   quadrante ou mantêm uma faixa de código separada (já que são poucos e conceitualmente
   diferentes de parada de linha)?
   > RESPOSTA: Mesmo esquema, não muda