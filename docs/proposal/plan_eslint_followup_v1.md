# Proposta — Pendências pós-configuração do ESLint

Registro do que ficou pra trás depois de configurar ESLint no monorepo e zerar os erros em
`apps/api` e `apps/web` (2026-09-07). O objetivo daquela tarefa era ter lint funcionando e
sem erros — não fechar toda dívida técnica que ele revelou. Este documento é o mapa do que
sobrou, pra não se perder na quantidade de comentários `eslint-disable` espalhados pelo código.

---

## 1. Tipar `db`/`tx` como `any` no `apps/api` (o item maior)

É de longe o item mais trabalhoso.

**O que é**: praticamente todo service/util do `apps/api` que recebe tanto `PrismaService`
quanto um `Prisma.TransactionClient` (pra poder rodar dentro ou fora de uma transação) tipa o
parâmetro como `any` em vez de `PrismaService | Prisma.TransactionClient` — os dois tipos não
têm uma interface em comum conveniente no Prisma 7, então tipar direito exigiria um alias ou
generic próprio.

**Por que foi adiado**: com o parâmetro `any`, qualquer `db.model.metodo(...)` propaga `any`
por toda a cadeia — isso sozinho gerava ~1685 dos ~1817 erros originais de `apps/api` via
`no-unsafe-call`/`no-unsafe-member-access`/`no-unsafe-assignment`/`no-unsafe-argument`/
`no-unsafe-return`. Resolver de verdade significa retipar a assinatura em cada função afetada
— um refactor de escopo bem maior que "configurar eslint e revisar o que aparece", e com risco
real de esbarrar em incompatibilidades genuínas entre os dois tipos do Prisma (overloads que
`Prisma.TransactionClient` não tem, por exemplo).

**Estado atual**: `no-unsafe-*` está desligado pra `apps/api/**/*.ts` em `eslint.config.mjs`
(bloco comentado "Prisma is the one place..."); `no-explicit-any` ficou como `warn` em vez de
`error`, pelo mesmo motivo — ainda visível, não bloqueia.

**Arquivos onde o padrão aparece** (não exaustivo, mas dá o tamanho): praticamente todo
service em `apps/api/src/modules/**`, mais `trip-mutation.utils.ts` e
`vehicle-plan.service.ts` como os mais densos.

---

## 2. Habilitar lint com type information também em `apps/web`

Hoje só `apps/api` usa `tseslint.configs.recommendedTypeChecked` (regras que exigem o
compilador TS rodando por trás — `no-floating-promises`, `no-misused-promises`,
`await-thenable`, etc.). `apps/web` ficou só com o preset não-type-aware porque, na hora de
configurar, misturar o parser/plugin do Next (`eslint-config-next`) com `projectService` do
`typescript-eslint` parecia arriscado o suficiente pra deixar pra depois — ver o comentário em
`eslint.config.mjs`:

```
// Type-aware rules where a single, simple tsconfig makes them cheap to run
// correctly (apps/api). Not enabled repo-wide yet — Next's own parser/plugin
// stack on apps/web makes project-service resolution there more fragile; can
// be extended there later once the basics are clean.
```

Agora que a base de `apps/web` está zerada, vale revisitar: ligar
`recommendedTypeChecked` + `parserOptions.projectService` pra `apps/web/**/*.{ts,tsx}` e ver
quantos erros aparecem (a expectativa é que sejam poucos, já que o padrão `any` do Prisma que
inflou tudo em `apps/api` não existe do lado do client).

---

## 3. Se algum dia adotar o React Compiler

A maior parte dos `eslint-disable` que sobraram em `apps/web` não é dívida técnica — é
diagnóstico do `eslint-plugin-react-hooks` v6 (vem por padrão no `eslint-config-next` do
Next 16) avisando sobre coisas que só importam **se** o projeto ligar o React Compiler
(`babel-plugin-react-compiler` / `reactCompiler: true` no `next.config`). Hoje não liga, então
são avisos adiantados, não bugs. Se um dia isso mudar, são exatamente estes pontos que
precisariam de atenção — cada um já está com o disable e o motivo comentado no código, esta
tabela só consolida onde procurar:

| Categoria | Onde | O que precisaria mudar |
|---|---|---|
| `react-hooks/incompatible-library` | `core/user/[id]/page.tsx`, `core/user/password/page.tsx`, `core/SettingsPanel.tsx` (react-hook-form `watch()`); `core/AutoList.tsx` (`useReactTable()`) | Incompatibilidade documentada das próprias libs com o compiler — precisaria trocar `watch()` por `useWatch()` (que é compiler-friendly) e verificar se há uma versão do TanStack Table com suporte melhor |
| `react-hooks/static-components` | `components/ui/domain-card.tsx`, `core/RowActionsCell.tsx`, `vehicle-plan/[id]/components/GanttActionBar.tsx` (x2) | Falso positivo do heurístico do compiler em cima de `const Icon = resolveIcon(...)` (seleção de um componente já existente, não definição de um novo) — se o compiler continuar não reconhecendo esse padrão, o jeito seria mover a seleção pra fora do componente ou usar um `Record<string, LucideIcon>` direto no JSX em vez de uma variável PascalCase |
| `react-hooks/refs`, `react-hooks/immutability` | `lib/keywatch/context.tsx` (singleton `KeywatchCore` via lazy-init em ref), `lib/keywatch/modal.tsx` (snapshot do ref em `useState`), `core/FieldRenderer.tsx` (`ctrl.ref`/`ctrl.value`/`ctrl.onBlur` do Controller do react-hook-form), `transit/day-type/[id]/page.tsx` (guard de seed único via ref) | Os padrões de ref aqui são os documentados pelo próprio React (`react.dev/reference/react/useRef#avoiding-recreating-the-ref-contents`) — o compiler ainda não reconhece todas as variações. Revisitar quando/se a versão do plugin melhorar esse reconhecimento |
| `react-hooks/preserve-manual-memoization` | `app/[domain]/[resource]/[id]/page.tsx`, `transit/transit-line/[id]/page.tsx`, `transit/transit-locality/[id]/page.tsx` (`effectiveListPath`), `vehicle-plan/[id]/components/FrequencyPanel.tsx`, `vehicle-plan/[id]/hooks/useGanttEditor.ts` (`addTripReference`) | O compiler infere um dep array mais estreito do que o manual (ex.: só `meta.breadcrumb` onde a lista manual tem 6 entradas) — a lista manual é mais conservadora, não errada. Se ligar o compiler, precisaria decidir se confia na inferência dele ou mantém os `useMemo` manuais como estão (o disable já resolve isso por ora) |

Nenhum destes bloqueia nada hoje. Só vale revisitar coletivamente no dia em que a decisão de
ligar o React Compiler entrar em pauta de verdade — até lá, tratar isoladamente cada um
seria trabalho perdido caso a versão do plugin (ou do compiler) mude o que reconhece.

---

## 4. Achados soltos, não relacionados ao lint em si

- `apps/web/src/app/login/page.tsx` linka para `/login/forgot-password`, que **não existe**
  como rota (`apps/web/src/app/login/forgot-password/` não tem `page.tsx`). Só troquei o
  `<a>` por `<Link>` pra resolver o `no-html-link-for-pages` — a feature de recuperação de
  senha em si nunca foi implementada. Se o link for clicado hoje, dá 404.
- O aviso `Pages directory cannot be found at .../pages or .../src/pages` que aparece no
  stderr ao rodar `eslint apps/web` é cosmético (o app usa App Router, não Pages Router) —
  tentei resolver com `settings.next.rootDir` em `eslint.config.mjs` mas não fez efeito;
  não afeta o resultado do lint (`@next/next/no-html-link-for-pages` continua funcionando
  normalmente, só o aviso de inicialização insiste). Não investiguei mais fundo.
