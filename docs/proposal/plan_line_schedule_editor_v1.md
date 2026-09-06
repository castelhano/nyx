# Proposta — Editor único de Quadro de Horários (LineSchedule + LineDeparture)

Registro da ideia inicial e das decisões já tomadas em conversa, antes de qualquer
implementação real. Existe um protótipo visual/interativo em `/playground`
(`apps/web/src/app/playground/page.tsx`) — dados 100% mockados, nada é persistido.

---

## Contexto

Hoje `transit/line-schedule/[id]` usa a página dinâmica genérica
(`app/[domain]/[resource]/[id]/page.tsx`) — um form comum para os campos de
`LineSchedule`, e as `LineDeparture` (partidas) filhas aparecem como lista genérica
via breadcrumb, sem visão de conjunto por sentido. Para uma OSO real (dezenas de
partidas por sentido), o form genérico não dá o tipo de visão/edição que esse
domínio pede — precisa ser possível ver e ajustar muitas partidas de uma vez,
comparando ida e volta lado a lado.

## Modelo de dados (já existente, sem mudança)

- `LineSchedule` (label "OSO") — cabeçalho: `dayTypeId`, `status`
  (`DRAFT`/`APPROVED`/`SUPERSEDED`/`ARCHIVED`, não editável via form — só via ações
  Duplicar/Aprovar), `approvalRef`, vigência, `notes`.
- `LineDeparture` — filho de `LineSchedule` via `lineScheduleId`: `routeId`
  (o "sentido" — cada `route` da linha tem `direction`: `OUTBOUND`/`INBOUND`/`CIRCULAR`),
  `departureMinutes`, `requiredVehicleType`, `notes`, `markings` (molde copiado pro
  `Trip` materializado, hoje sem UI própria de edição).
- **Sem relação com `VehiclePlan`/`Trip`** — N planos podem ser gerados a partir de
  uma `LineSchedule`; editar aqui não deve refletir em planos já existentes.

## Ideia central

Uma página custom só, substituindo form + lista genérica:

- **Cabeçalho** compacto edita `LineSchedule` (dayType, OSO, notas; status via ações
  Duplicar/Aprovar como já existe hoje).
- **Uma aba por sentido** (não lado a lado — testado no protótipo e descartado por
  crescer demais horizontalmente) — as partidas em grade tipo calendário
  (`04:50 05:00 05:10 ...`), navegável por teclado e clicável.
- **Painel lateral fixo** edita a `LineDeparture` focada (`departureMinutes`,
  `requiredVehicleType`, `notes`, `markings`) — ou vira edição em lote quando há
  seleção múltipla (deslocar horário, trocar veículo, excluir).
- Editar markings de uma viagem hoje só existe via modal dedicado no Gantt do
  `vehicle-plan` (`TripMarkingsModal.tsx`) — aqui serve só de referência de paleta/
  campos, não do fluxo em modal (o painel lateral já fica visível o tempo todo,
  então editar inline é mais direto que abrir mais uma camada por cima).

## Decisões já tomadas (conversa com o usuário)

> Buffer local me agrada mais e é coerente com o que já existe na edição no plan

Sem chamada por campo nem form único: cada edição (criar/mudar/excluir partida,
mudar cabeçalho) fica num buffer local (`draft`) com dirty-tracking. `alt+g` salva
tudo — cabeçalho **e** partidas — num commit único; `alt+l` reverte o buffer ao
último estado salvo. Implica, no backend real, um endpoint que recebe o estado
final das partidas por sentido e resolve create/update/delete numa transação, em
vez de N chamadas ao `BaseService` genérico.

> não vamos adicionar Guardrail num primeiro momento, editar viagens individuais
> ou adicionar markings em uma viagem pode ocorrer mesmo em uma [OSO] active,
> apenas no modal de confirmação adicionar um badge ou alerta reforçando que se
> trata de OSO ativa

Sem bloqueio de edição por status. O reforço é só no momento de salvar: se
`status !== 'DRAFT'`, o `alt+g` abre uma confirmação com `badge` de alerta antes de
efetivar. `ConfirmModal` já tem esse campo pronto (`badge?: string`, comentado no
código como "flagging that the action affects a plan already in operação (ACTIVE)")
— é reaproveitar o mesmo mecanismo, não criar um novo.

> não vamos misturar as coisas, LineSchedule+LineDeparture não é diretamente
> ligado a um plano, N planos podem ser construídos baseado em uma LineSchedule,
> mudar aqui, pelo menos num primeiro momento, não reflete para nada além disso

Isolado do `vehicle-plan` — essa página só escreve em `LineSchedule`/`LineDeparture`.

> eu imagino duas seções distintas na página, uma que edita dados de LineSchedule
> e outra (o painel lateral que sugeri) que edita dados do LineDeparture (aqui sim
> deve permitir edição do departureMinutes, dentre outros)

Confirmado — e resolve a dúvida sobre `arrivalMinutes`: esse campo é só de `Trip`,
`LineDeparture` nem tem, então o painel lateral edita exatamente os campos que
`LineDeparture` tem.

> Geração: não, nesta tela não penso em gerar nada, o grid já tem abordagem para
> geração, publicação de novo LineSchedule, aqui é mais para visualização e ou
> pequenos ajustes

Sem geração em lote — só visualização e ajustes pontuais (mover horário, trocar
veículo, adicionar/remover partida individual, editar marking). Geração por
frequência já existe em `vehicle-plan` (`LineScheduleGeneratorModal.tsx` +
`line-generator-logic.ts`) e não deve ser duplicada aqui.

## Padrões reaproveitados do editor de `vehicle-plan` (referência, não cópia)

- Navegação por setas via `useShortcut('←'|'→'|'↑'|'↓', ...)` registrada
  globalmente na página (não local ao elemento) — mesmo padrão de
  `useVehiclePlanShortcuts.ts` para navegar entre viagens do Gantt.
  `shift+seta` estende seleção a partir de um anchor (`shiftAnchorRef`).
- `alt+g`/`alt+l`/`alt+v` com `enabled` amarrado a "existe alteração pendente" —
  mesma semântica do CLAUDE.md para toda página editável.
- `useConfirm()` (`@/lib/confirm-context`) para as confirmações de salvar/reverter/
  sair, com o `badge` de "OSO ativa" reaproveitando o campo já existente no
  `ConfirmModal`.
- Paleta/estilos de `markings` (`BG_COLOR_OPTIONS`, `FONT_STYLE_OPTIONS`,
  `ColorPicker`) espelham `TripMarkingsModal.tsx` — mesmas 6 cores e 5 estilos,
  sem a lógica de "sweep" entre viagens (não se aplica aqui: cada `LineDeparture`
  é editada isoladamente, sem replicar marking pra outras partidas).

## Ajustes visuais feitos no protótipo (2ª rodada)

- Layout trocado de "duas seções lado a lado" para **abas** (Ida/Volta) — uma
  grade por vez, cheia largura. Trocar de aba limpa foco/seleção se pertenciam
  ao sentido anterior.
- Chip da partida com **altura fixa** — sem segunda linha de texto. Indicação de
  veículo requerido (`requiredVehicleType`) virou um traço (dash) pequeno no
  canto inferior-esquerdo em vez de ícone ou texto — mesma linguagem visual do
  experimento de cor que existia antes em `/playground`. O ponto colorido de
  `markings` continua no canto superior-direito (cor = `bgColor` da primeira
  marcação).
- Cabeçalho reorganizado em duas linhas: (1) Linha/status/badge "OSO ativa" +
  botões; (2) `approvalRef`, `dayTypeId` e `notes` na mesma linha, sem labels
  (campos autoexplicativos) — `approvalRef` primeiro, depois `dayTypeId`, depois
  `notes` ocupando o espaço restante, placeholder só "Observações".
- Indicador de "dirty" (borda esquerda mais espessa) marca partida com alteração
  pendente no buffer local (`draft` diferente do `baseline` salvo) — distinto de
  foco (ring) e seleção (fundo). Cor atual (âmbar) julgada agressiva demais —
  ver "Definições finais" abaixo.

## Definições finais para a implementação (não é mais só protótipo)

- **Ações para o topbar, não inline na página** — por convenção do projeto
  (`useTopbarActions()`), os botões **Duplicar** e **Aprovar** saem do cabeçalho
  da página e vão para o topbar. O topbar também precisa de **Salvar** (`alt+g`)
  e **Limpar/Reverter** (`alt+l`) — os três junto com os já existentes, seguindo
  o mesmo padrão de botão primário `type: 'submit'` + `form: FORM_ID` descrito no
  CLAUDE.md, adaptado já que aqui não há um único `<form>` HTML — o "submit" é o
  commit do buffer local, não um POST de form nativo.
- **Cor do indicador de dirty precisa ser mais sutil** — âmbar (`border-l-amber-500`)
  ficou agressivo demais para um estado tão frequente (qualquer edição pendente).
  Trocar por um tom neutro/discreto (ex.: `border-l-muted-foreground/40` ou
  equivalente) na implementação — não é mais urgente resolver agora, só registrar
  que o tom atual do protótipo não é o final.
- **Conflito de navegação por teclado entre grade e painel lateral** — no
  protótipo, as setas (`←→↑↓`) navegam entre partidas mesmo com foco dentro de um
  `<input>`/`<textarea>` do painel lateral, e vice-versa (editar texto move o
  cursor mas também pode disparar navegação da grade). Diferente dos modais do
  `vehicle-plan` (que suspendem o contexto padrão via `useShortcutContext` enquanto
  abertos), aqui o painel fica sempre montado ao lado da grade, então não existe
  um momento "modal fechado" pra isolar os dois. Duas soluções candidatas,
  decisão pra hora da implementação:
  1. **Foco de verdade** — grade vira um widget com foco DOM real (roving
     tabindex), painel lateral só recebe foco quando clicado/tabulado; o handler
     de atalho só dispara quando o foco DOM realmente está na grade. Mais
     "elegante" (nas palavras da conversa), mas exige mais trabalho de
     acessibilidade/gestão de foco.
  2. **Modificador dedicado** (`ctrl+←/→/↑/↓` só pra navegação da grade, teclas
     puras livres para edição de texto em qualquer lugar) — mais simples e
     contido nesta página, sem mexer em nada global.
  - Existe um recurso pronto no `KeywatchCore` pra isso — `checkInputHint`/
    `checkInputModifier` (`core.ts:68-70`, hoje `checkInputHint: false` por
    padrão) — suspende atalhos sem modificador enquanto o foco está num
    input/textarea/select, a menos que o usuário segure o modificador
    configurado (`ctrl` por padrão) antes. **Porém** é uma opção do
    `KeywatchCore`, instanciado uma única vez no `KeywatchProvider` da raiz do
    app — ativar isso muda o comportamento pra todas as páginas, não só esta.
    Vale avaliar como iniciativa separada; pra esta página isoladamente, a opção
    2 (modificador dedicado só nos `useShortcut` daqui) é a mudança mais contida.
- **Painel lateral precisa listar as marcações já usadas** para atribuição
  rápida (quick-pick), não só criar uma nova digitando do zero — mesmo padrão de
  `quickPicks` do `TripMarkingsModal.tsx` (dedup por `legendText` entre as
  viagens/partidas carregadas). Escopo do dedup pra decidir na implementação:
  só as `LineDeparture` deste `LineSchedule`, ou de toda a linha.

## Escopo do protótipo em `/playground`

Testa a sensação de uso da grade + painel — **não** é a implementação final:

- Dados mockados em memória (`SEED_DEPARTURES`/`SEED_HEADER`), sem chamada à API.
- Navegação ↑/↓ usa uma contagem fixa de colunas (`COLS = 10`) como aproximação —
  a implementação real precisa medir as colunas efetivamente renderizadas
  (`ResizeObserver` ou similar), já que o grid é responsivo.
- `alt+v` já aponta para a lista real (`/transit/line-schedule`), mas a página em
  si não substitui `transit/line-schedule/[id]` ainda.
- Duplicar/Aprovar no cabeçalho são só `toast`, sem chamar endpoint.

## Em aberto

- Desenho exato do endpoint de save em lote (`PUT/PATCH .../line-schedule/:id`
  recebendo cabeçalho + array de partidas por sentido?) — não definido ainda,
  fica para quando sair do protótipo.
- Medição real de colunas do grid pra navegação ↑/↓ funcionar de verdade em
  qualquer largura de tela.
