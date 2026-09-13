# Proposta — Ctrl+C não encerra o `pnpm dev` de forma confiável

Registro da investigação (2026-09-13) de por que `pnpm dev` (turbo + nodemon + Next) passou a
travar no Ctrl+C — sintoma: turbo mostra `WARNING Some tasks in your Turborepo are taking
awhile to shut down: @nyx/api#dev`, o segundo Ctrl+C às vezes devolve o prompt, mas a API e o
`nodemon` continuam vivos em segundo plano, órfãos, segurando a porta 3001 e ainda escrevendo
log no terminal. Antes disso, um fix anterior (`"ui": "stream"` em `turbo.json`, commit
`4d1ea21`) já tinha corrigido um problema relacionado (o TUI do turbo destacava as tasks da
sessão do terminal) — o travamento atual é outro problema, que sobreviveu a essa correção.

Documento pedido pra deixar rastreável o que foi tentado, o que se mostrou equivocado, e a
causa/hipótese atual com solução proposta — antes de implementar o próximo passo.

---

## Hipótese 1 (descartada) — vazamento de conexão do `@libsql/client`

**Raciocínio na hora**: `@libsql/client@0.17.3` tem um bug documentado — em toda transação
Prisma (`$transaction`), o `COMMIT` não fecha a conexão nativa aberta pelo `BEGIN`, deixando-a
(e os `Statement`s preparados nela) para o finalizador do V8. Native handles vazados podem
impedir o event loop do Node de esvaziar, o que bateria com o padrão "turbo espera o `@nyx/api`
terminar e ele nunca termina sozinho".

**Teste**: nenhum teste direto disponível pra provar a causalidade — a decisão foi investigar
se a lib fazia sentido no projeto de qualquer forma.

**Por que caiu**: ao checar `apps/api/.env`, o `DATABASE_URL` já era Postgres (a linha SQLite
estava comentada) — ou seja, dev não usa mais SQLite/LibSQL há tempo. A lib e todo o branch
`isPostgres ? PrismaPg : PrismaLibSql` (repetido em `prisma.service.ts` + 6 scripts de
seed/export/import/oso) eram código morto, sem nenhuma conexão libsql sendo de fato aberta em
uso normal. Removido por ser lixo confirmado, não porque resolveu o travamento — depois da
remoção completa (dependência + branches), o Ctrl+C continuou travando exatamente igual.

**Ficou**: a remoção (dead code), independente da causa raiz — ver seção "O que foi mantido".

---

## Hipótese 2 (descartada) — `http.Server#close()` esperando conexões keep-alive

**Raciocínio na hora**: `http.Server#close()` do Node só para de aceitar conexões novas — ele
espera as conexões **existentes** encerrarem sozinhas, e não força nada. Se o front (TanStack
Query) mantém uma conexão keep-alive fazendo polling contínuo, ela nunca fica ociosa por tempo
suficiente pro timeout do servidor (5s por padrão) fechar sozinha, e o `close()` do Nest
(`app.close()`) ficaria esperando pra sempre.

**Teste**: abri uma conexão TCP crua (`/dev/tcp`) mandando um `GET` a cada 1s (simulando
polling do front) contra a API rodando, depois mandei SIGINT pro **grupo de processos inteiro**
do terminal (`kill -INT -<pgid>`, pra imitar o Ctrl+C real, que sinaliza o grupo todo, não um
processo isolado) — o shutdown completou em ~1s, sem processo remanescente.

**Por que não era (sozinha) a causa**: mesmo depois de aplicar o fix (`server.closeAllConnections()`
no `main.ts`, chamado nos handlers de `SIGINT`/`SIGTERM`) e confirmar via esse teste que ele
funciona exatamente como esperado, o usuário reportou que o travamento real, no terminal dele,
continuou idêntico. Ou seja: o fix é correto para o problema que ele resolve (conexão
keep-alive impedindo `close()`), mas não é a causa do travamento reportado.

**Ficou**: o fix (`server.closeAllConnections()`) — é uma boa prática padrão do Node
independente da causa raiz. Ver seção "O que foi mantido".

---

## Hipótese 3 (parcialmente certa, mas incompleta) — nodemon não sai no primeiro SIGINT

**Raciocínio na hora**: nodemon tem um bug documentado e não resolvido pelo mantenedor quando
roda como subprocesso-dentro-de-subprocesso
([remy/nodemon#2154](https://github.com/remy/nodemon/issues/2154)) — exatamente a cadeia deste
projeto (`turbo → pnpm → sh → nodemon → sh → node`). Também é comportamento conhecido do
nodemon precisar de **dois** Ctrl+C pra sair de verdade (o primeiro é historicamente
interpretado como "reiniciar", não "sair"), e isso piora quando o `stdin` do nodemon não é um
TTY real (sempre o caso aqui, já que turbo/pnpm o iniciam via pipe).

**Teste**: adicionei `"stdin": false` no `nodemon.json` (config oficial recomendada pra nodemon
rodando não-interativo/aninhado, desliga o listener de teclado do `readline` que implementa o
"digite `rs` pra reiniciar" e a lógica de duplo-Ctrl+C). Testei de novo com conexão em polling
contínuo + SIGINT no grupo inteiro do terminal — shutdown limpo em ~1s, sem sobra, monitorado
por 15s.

**Por que ficou incompleta**: o teste sintético passou, mas o usuário reportou que o
travamento real persistiu sem mudança nenhuma. Assim como nos casos anteriores, o teste
sintético (mandar sinal via `kill` de outro processo) não reproduzia fielmente a condição real
de um terminal interativo pressionando Ctrl+C.

**Ficou**: o `"stdin": false"` — não resolveu sozinho, mas é config correta e documentada pra
esse cenário, sem efeito colateral conhecido. Ver seção "O que foi mantido".

---

## Causa confirmada (evidência ao vivo, 2026-09-13 ~18:00)

Depois de três tentativas erradas via reprodução sintética, pedi pro usuário capturar o estado
real **durante** o travamento, sem matar nada, com:

```bash
ps --forest -eo pid,ppid,pgid,stat,cmd | grep -E "turbo|nodemon|main.ts|next" | grep -v grep
```

Isso pegou uma árvore `turbo run dev` genuinamente travada havia mais de 12 minutos (processo
`turbo` e `nodemon` ambos vivos, `nodemon` sem nenhum filho `node src/main.ts` ativo — ou seja,
a API já tinha morrido, mas nem o `nodemon` nem o `turbo` perceberam que deviam encerrar).

**Inspeção direta via `/proc` (sem matar nada):**

- `nodemon` sempre nasce com `PPID = 3571` (`systemd --user`) — **desde o início**, não só no
  shutdown. É estrutural desse encadeamento pnpm/turbo (algo no meio do caminho —
  provavelmente `pnpm run dev` ou o `sh -c` intermediário — libera o `nodemon` do controle de
  processo do `turbo` assim que ele é criado). Isso não é o bug em si, mas explica por que o
  `turbo` não pode contar com sinalização por grupo de processo do SO (`killpg`) pra alcançar o
  `nodemon` — só pode rastreá-lo por PID.
- No momento do travamento: `turbo` — `SigPnd: 0`, majoritariamente threads ociosas em
  `futex_do_wait` (normal de runtime Go/Rust), sem sinal pendente.
- `nodemon` — `SigPnd: 0`, ocioso em `ep_poll` (estado normal de idle do event loop do Node),
  **sem filho vivo**.
- **Teste decisivo**: mandei um `SIGINT` novo, direto pro PID do `nodemon` (sem mexer no
  `turbo`) — `nodemon` **e** `turbo` caíram em menos de 1 segundo.

**Conclusão**: o primeiro SIGINT do Ctrl+C chega no `turbo`, que repassa pro `nodemon`. O
`nodemon` usa esse sinal pra matar o processo monitorado (a API) — mas **o próprio processo do
`nodemon` não sai**: ele volta a ficar ocioso vigiando arquivos, como se fosse só reiniciar. O
`turbo` fica esperando o `nodemon` (a task que ele de fato rastreia) terminar — e ele nunca vai
terminar sozinho, porque vigiar arquivos indefinidamente é o comportamento normal do nodemon. O
segundo Ctrl+C deveria forçar isso, mas como o `nodemon` está estruturalmente órfão do
`systemd` desde o nascimento (grupo de processo diferente do que o `turbo` originalmente
rastreou), o kill de força do `turbo` no segundo Ctrl+C aparentemente mira um alvo que não
corresponde mais — falha silenciosamente, e o `turbo` desiste e devolve o terminal mesmo assim.

Isso é um bug real de integração `turbo` + `nodemon` em subprocess aninhado — não algo
resolvível só com configuração dos dois lados (já tentamos a configuração oficial do nodemon
pra esse cenário e não foi suficiente).

---

## Solução implementada — `scripts/dev.sh`

Não dá pra confiar que `turbo`/`nodemon` vão cooperar pra encerrar tudo sozinhos. A saída
prática é parar de depender disso: `scripts/dev.sh` envolve `turbo run dev` e **garante** a
limpeza no Ctrl+C, independente do que `turbo`/`nodemon` conseguiram fazer por conta própria.

```bash
#!/usr/bin/env bash
turbo run dev &
TURBO_PID=$!

cleanup() {
  kill -TERM "$TURBO_PID" 2>/dev/null
  sleep 1
  pkill -9 -f 'nodemon|turbo run dev|next dev|next-server|src/main\.ts' 2>/dev/null
  true
}
trap cleanup INT TERM

wait "$TURBO_PID"
cleanup
```

`package.json` raiz roda esse script em vez de `turbo run dev` diretamente (`"dev": "bash
scripts/dev.sh"` — `pnpm dev` continua sendo o comando que o usuário digita). No Ctrl+C: dá 1s
pro `turbo` encerrar do jeito normal, depois varre e mata à força qualquer processo
remanescente por padrão de nome, garantindo que a porta 3001/3000 sempre fique livre depois do
Ctrl+C, independente do bug upstream.

**Validado em 2026-09-13**: subi `pnpm dev` (via o wrapper), simulei uso real (conexão HTTP
com polling contínuo a cada 1s, como o TanStack Query faz) e mandei `SIGINT` pro grupo de
processos inteiro do terminal (`kill -INT -<pgid>`, o mais fiel possível a um Ctrl+C real sem
ser literalmente digitado num terminal interativo) — encerramento completo em ~1s, sem
processo remanescente, portas 3000/3001 livres.

**Alternativa considerada e descartada por ora**: eliminar o `nodemon` de vez, trocando por
`node --watch --watch-path=... -r @swc-node/register -r tsconfig-paths/register src/main.ts`
(nativo do Node 22, sem a lógica de restart-interativo do nodemon que causa o problema). Tentado
e revertido — quebrou a resolução de módulos (`tsconfig-paths/register` passou a resolver pro
próprio código-fonte `.ts` em vez do `dist/register.js` compilado, gerando
`Cannot find module 'express'`), por razão não investigada a fundo (possível interação entre
`--watch` e o hook de `require` do `@swc-node/register`). Pode valer revisitar no futuro se
alguém quiser investigar essa resolução de módulo com mais tempo — seria a solução mais limpa
(remove a dependência problemática em vez de contorná-la).

---

## O que foi mantido (correções e melhorias válidas, independente da causa raiz)

Nenhuma delas resolveu o travamento sozinha, mas todas são corretas por si só e foram mantidas:

- Remoção de `@libsql/client`/`@prisma/adapter-libsql` e todo o branch condicional de adapter
  SQLite/Postgres (`prisma.service.ts` + `seed.ts`, `seed-core.ts`, `transit-export.ts`,
  `transit-import.ts`, `oso-debug.ts`, `oso-render-debug.ts`) — código morto confirmado, dev já
  usa só Postgres.
- `turbo` fixado em `2.9.14` no `package.json` raiz (era `"latest"`, upgrade silencioso a cada
  install).
- `server.closeAllConnections()` no `apps/api/src/main.ts`, chamado em `SIGINT`/`SIGTERM` —
  evita que conexões keep-alive do front travem `app.close()`.
- `"stdin": false` em `apps/api/nodemon.json` — config oficial do nodemon pra rodar
  não-interativo/aninhado.
- `CLAUDE.md` e `docs/architecture/ARCHITECTURE.md` atualizados (citavam SQLite em dev, hoje é
  Postgres nos dois ambientes) — desatualizado antes desta investigação, sem relação com o bug.
