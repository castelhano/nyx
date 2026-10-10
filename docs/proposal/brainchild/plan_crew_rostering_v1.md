# Proposta — Turnos, escala real (rostering) e portal do condutor

**Status: decisões de direção fechadas, modelagem detalhada em aberto.** Consolida a discussão que
antecede a construção da escala real (alocação de frota e condutores reais). Nada aqui está
implementado; a única fase que pertence à escala lógica (e deve ser fechada antes do resto) é a
**Fase 1 — Turnos**.

Objetivo: sair do planejamento lógico (`VehiclePlan` → `CrewPlan` → `Duty`, sem pessoas nem
veículos reais) para a escala diária real — quem dirige qual tabela, em qual carro, em cada data —
com um gerador que respeita restrições do condutor, busca previsibilidade sem engessar e garante a
carga mensal contratada.

---

## O que já existe

| Peça | Onde | Estado |
|---|---|---|
| `CrewPlan` / `Duty` / `DutyPiece` / `DutyActivity` | `transit.prisma` | Escala lógica de um `VehiclePlan` (scope + dayType). `Duty.kind` inclui `STANDBY` (reserva lógica) |
| `CrewSettings` | `packages/schemas/transit/settings-crew.schema.ts` | Regras CCT da tabela (ranges floor/ideal/ceiling + score) |
| `RosterSettings` | `packages/schemas/transit/settings-roster.schema.ts` | Reservado: `interShiftRest`, `driverPrefLine`, `driverPrefTech` — ainda não consumido |
| `rangeCriterionSchema` | `settings-planning.schema.ts` | Formato de critério reaproveitável para regras rígidas/leves |
| `DutySummary.interShiftRestMinutes` | `duty.schema.ts` | Só estimativa (mesma tabela no dia seguinte); a real vem do rostering |
| `Duty` issue `BRANCH_MISMATCH` | `duty.schema.ts` | Já sinaliza tabela de outro operador |
| `ScopeOperator.share` | `transit.prisma` | Reservado para composição de escala |
| `Employee` | `hr.prisma` | Cadastro de RH puro; `status` sem período (`ON_LEAVE` não tem datas) |
| `Contract.weeklyHours` | `hr.prisma` | Default 44 — base da carga mensal |
| `Vehicle` | `fleet.prisma` | Sem disponibilidade (manutenção) nem "tecnologia" (que `driverPrefTech` pressupõe) |
| `DayTypeService.resolveDayType(date, lineId)` | `day-type/day-type.service.ts` | Resolve o dayType efetivo por linha e data, considerando `LineCalendarException` |
| Auth atual | `apps/api/src/auth/*`, `apps/web/src/lib/auth.ts` | JWT único (`JWT_SECRET`), token em `localStorage` + cookie `token` |

---

## 1. Turno

Turno é um **cadastro de janela de restrições**, não um rótulo de pertencimento.

- Campos (iniciais): `inícioMínimo`, `términoMáximo`, `permiteDuplaPegada`, talvez
  `máxMinutosNoturnos`. Cada regra reaproveita `rangeCriterionSchema` — ceiling = rígido,
  idealMax = preferência — mesma linguagem do crew solver.
- **Cadeia de herança, mesmo formato em todos os níveis:**
  `Padrão do Scope → Turno → ajuste do condutor (só campos divergentes)`.
  O "este condutor não pode terminar após X" é o mesmo objeto, opcional, sobre o turno.
- **Elegibilidade por encaixe:** uma tabela é elegível para o condutor se cabe na janela efetiva
  dele. O rótulo do turno serve para agrupar e reportar, não para filtrar.
- Vínculo condutor ↔ turno com histórico (`validFrom`/`validTo`).

> CONSIDERACAO: máxMinutosNoturnos acho que não vale o esforço, deixa de fora

**Na escala lógica (Fase 1):**
- `Duty` recebe um **turno derivado** (o de maior prioridade em que ela se encaixa), fixável
  manualmente.
- `CrewPlanSummary` ganha contagem de tabelas por turno → primeira checagem de capacidade
  ("o plano pede 40 tabelas de manhã"). O desconto de folgas entra quando o regime existir.

## 2. Continuidade (tabela não é do condutor, mas a sugestão é previsível)

O condutor **não é dono da tabela**, mas o gerador favorece continuidade.

- **"Tabela parecida" = mesma linha dominante + mesmo turno.** Linha dominante = a com mais
  minutos de viagem na tabela (o `byLine` do summary já faz essa divisão). Isso resolve o fato de
  D10 de dia útil e D10 de sábado serem `Duty`s diferentes — não depende de identidade da tabela
  entre versões do plano ou tipos de dia.
- **Limite de alterações no período:** informado na tela de geração (ex.: 3). Conta apenas troca
  de tabela; folga e retorno da folga para tabela parecida não contam. Vale sempre — com ou sem o
  critério de carga mensal.

## 3. Carga mensal

Não é equilibrar horas entre condutores — é **cada condutor cumprir a sua carga**.

- Carga mensal vem do **contrato** (`Contract.weeklyHours`; conversão semanal → mensal a definir).
- Opção na geração: **"garantir carga mensal"**. Marcada: o gerador projeta as horas do mês por
  condutor e, se ficar **abaixo** da carga, usa o orçamento de alterações para movê-lo para
  tabelas que dão mais hora. Ex.: tabela de 6h00 — o condutor não fica o mês inteiro nela.
- **Só insuficiência é tratada.** Excesso não dispara troca.
- Opção marcada → a preferência de jornada do condutor (gosta/não gosta de hora extra) é
  ignorada. Desmarcada → a preferência é considerada.
- Projeção sem a opção marcada: insuficiência só aparece como pendência.


## 4. Horizonte de geração e fonte única

- Horizonte definido pelo usuário na geração (de X a Y): mês inteiro, semana a semana, etc.
- Reprocessar a partir de uma data: os dias anteriores ficam **congelados**, mas suas horas e
  alterações já consumidas entram no cálculo da carga e do orçamento. O primeiro dia gerado olha
  o dia anterior (interjornada, ciclo de folga) — inclusive na virada de mês.
- **Fonte única:** não existe modelo de "escala mensal". A escala do período **é o conjunto de
  escalas diárias materializadas**. Gerar materializa os dias (se ainda não existem) e preenche a
  alocação; edição manual de um dia já entra no próximo reprocessamento.

## 5. Escala diária

- **Materialização (cópia)** dos planos ativos da data; ciclo próprio: planejada → publicada →
  executada. Mudanças no plano lógico não reescrevem dias já materializados.
- **Dia operacional ≠ dia civil:** tabelas que passam da meia-noite pertencem à data operacional;
  interjornada e noturno calculados sobre ela.
- **Data → plano por linha:** cada linha usa o `VehiclePlan` ativo do dayType resolvido para ela
  (`resolveDayType`). Com `LineCalendarException` parcial (linha A como útil, B como sábado), carros
  e tabelas que cruzam linhas ficam desencaixados.
- **O dia nasce como está, sem ajuste automático.** A escala diária tem detecção de pendências
  própria (no espírito de `Duty.issues`): veículo em dois lugares, viagem sem carro/condutor,
  condutor com tabelas sobrepostas, condutor em linha não habilitada, etc. O usuário decide quando
  e com qual direcionamento acionar o **solver de reparo** (simplificado), que corrige só as
  pendências.

## 6. Perfil operacional do condutor (`CrewMember`)

Extensão do `Employee` (não polui o cadastro de RH): função, turno, regime de folga, CNH
(categoria/validade), curso de transporte coletivo, branch base, preferências, perfil de portal.
Mais especificações virão quando a fase for detalhada.

> CONSIDERACAO: a função efetiva do condutor eh definid ano contrato, aqui deve ser role amarrad a um CrewRole (entendo),  e branch base acho que nao faz sentido, um employee já eh cadastrado a uma branch

### Linhas — tabela própria

Um modelo único de vínculo condutor ↔ linha; **uma linha por par (condutor, linha)**.

- **Modo por branch** (configuração): `habilitada` (lista = onde pode; linha nova não tem
  ninguém até habilitar) ou `inabilitada` (lista = onde não pode; linha nova liberada para todos).
- Vínculo: `ENABLED` / `BLOCKED` conforme o modo, mais `rank` de preferência (1 primária,
  2 secundária, 3 terciária — até N, inicialmente 3).
- Preferencial **sempre** dentre as habilitadas; no modo inabilitada, preferencial não pode estar
  inabilitada — garantido por construção (um único vínculo por linha).
- Por linha individual, **não** por `LineGroup` (foi pensado para outro fim).
- Habilitação/inabilitação: **somente o gestor**. Ordem das preferências: o condutor (portal).
- Mudança de preferência só afeta as **próximas** gerações.
- Por que tabela e não JSON: consulta reversa ("quem pode operar a linha X?", "quem tem X como
  primária?") usada pelo reparo do dia e por relatórios de cobertura; integridade referencial.

### Demais preferências — JSON no `CrewMember`

Atributos sem consulta reversa e que vão crescer: preferência de jornada (gosta de hora extra),
entre outros.

### Score de linha

Um único peso **"Linha preferencial"**: primária recebe 100%, secundária e terciária uma gradação
(configurável; default sugerido 100/60/30). Linha apenas habilitada: 0 ou leve penalização. Linha
inabilitada: **pendência** + penalização forte. Substitui a semântica atual de `driverPrefLine`.

## 7. Veículo acompanha o condutor

Não é preferência cadastrada — é **continuidade operacional** derivada pelo motor.

- **Carro habitual** do condutor = o mais frequente nos últimos N dias trabalhados (não o do
  último dia — manutenção ou cobertura pontual não contaminam a referência).
- Quando o condutor troca de tabela no giro, o motor tenta levar o carro habitual junto.
- Conflito manhã × tarde no mesmo carro: se conseguir levar ambos, melhor; senão, **âncora é o
  condutor da manhã**.
- Depende de evolução do domínio `fleet`: disponibilidade (manutenção), compatibilidade com o tipo
  de veículo do bloco, tecnologia.

> CONSIDERACAO: estou pensando que eciste empresas que gostam de definição mais amarrada de condutor / carro, acho que CrewMember (ou outro) poderia term campo opcional de carro preferencial, que se marcado gerador daria preferencia a manter este carro, e so segue a ideia do carro habitual caso em branco.. uma questão que é necessária eh habilitação de condutor a tipo de tecnologia, exemplo tem condutor que nao pode operar carro articulado, isso precisa ser configurado


## 8. Ausências e folgas

- **Ausências com período** (férias, atestados, afastamentos) — eventos com intervalo de datas.
  Solicitáveis pelo portal, com limites por tipo de ausência no período (definidos no perfil de
  portal).
- **Regime de folgas** (6x1, 5x2, 12x36, ciclo de folgas, domingo a cada N semanas pela CCT):
  padrão nomeado ao qual o condutor se vincula, com offset no ciclo. **Implementado junto com a
  escala real** — não afeta a escala lógica.
- Rostering entre dias: interjornada real entre datas, limites semanais/mensais.

## 9. Reserva

- **Não** se cria reserva lógica por padrão. Meta configurada **por branch e por tipo de dia**:
  quantidade + horário de início + fim opcional + local de apresentação (`TransitLocality`).
- Ao gerar: havendo condutores sobrando, sugere os plantões até a meta; o restante o usuário
  decide (mais plantão, folga compensada para abater banco de horas, etc.).
- `Duty.kind = STANDBY` **permanece** como forma alternativa de montar reserva. Regra: STANDBY
  lógico **conta** para a meta (2 STANDBY 04–12h + meta 3 → sugere 1 plantão, não 3).

## 10. Branch

- Gerador **bloqueia** condutor de um branch em tabela de outro.
- Alocação manual permite; o sistema apenas sinaliza (como `BRANCH_MISMATCH` hoje).

## 11. Portal do condutor

Ambiente restrito, **sem criar `User`**. Login = `Employee.code` (matrícula) + PIN.

- **Credencial em tabela própria 1:1** (não no `CrewMember` — o `BaseService` devolve o registro
  inteiro e o hash vazaria pelo CRUD genérico): hash do PIN (argon2/bcrypt), `forcePasswordChange`,
  tentativas falhas, bloqueio temporário, último acesso, `tokenVersion`. Nunca exposta por
  controller genérico.
- **PIN de 6 dígitos.** Inicial (na omissão): 6 primeiros dígitos do CPF; troca obrigatória no
  primeiro acesso. Reset pelo gestor volta ao fluxo de troca obrigatória.
- **Sessão isolada:** token com secret distinto (ou no mínimo `aud: 'crew'`); o guard atual
  rejeita token de portal e o guard do portal rejeita token de usuário. Endpoints sob prefixo
  próprio (ex.: `/api/portal/*`), default deny. No frontend: chave de storage/cookie própria
  (hoje `token` é usado pelos usuários) e layout próprio mobile-first.
- **Desligamento corta na hora:** o guard do portal confere, a cada requisição, `Employee.status`
  ativo e `tokenVersion` — não depende de expiração do JWT.
- **Força bruta:** matrícula é sequencial/adivinhável e PIN tem só 10⁶ combinações → rate limit
  e bloqueio por tentativas são obrigatórios.
- **Perfil de portal** como template (consukltar escala, solicitar ausência, limites por tipo de ausência no período,
  alterar linha preferencial…), `CrewMember` vinculado a um perfil, override opcional — mesmo
  padrão do turno.
- **Auditoria:** ações do portal registram o condutor como autor; hoje os campos de autoria
  (`createdById` em `core.prisma`) apontam só para `User` — precisa de ajuste.

**Risco do PIN inicial pelo CPF:** CPF circula com facilidade (holerite, cadastros). Quem souber
matrícula + CPF de um condutor que ainda não acessou pode assumir a conta e definir o PIN antes
dele. Mitigações a decidir: PIN inicial expira após N dias sem primeiro acesso; ou conta nasce
inativa e o gestor ativa no momento da entrega ao condutor.

> CONSIDERACOES: usa o mesmo que jṕadrão de criptografia já usado no resto da aplicação (acho que eh argon2) se entender (por segurança) não compartilhar a mesma chave podemos criar chave exclusiva no env... operacoes são basicamente de consulta ou solicitações simples e ambiente será isolado, risco real eh muito baixo, se outror funcionário "tomar a conta" gestor pode redefinir a senha, não me preocupa isso num primeiro momento

---

## Fases

| Fase | Escopo | Camada |
|---|---|---|
| 1 | Turno (cadastro + cadeia de herança), turno derivado na `Duty`, capacidade por turno no summary | Escala lógica — **fechar antes do resto** |
| 2 | `CrewMember`, vínculo condutor↔linha, ausências com período, carga mensal via contrato, regime de folgas | Cadastros |
| 3 | Evolução de `fleet`: disponibilidade, compatibilidade, tecnologia | Cadastros |
| 4 | Escala diária materializada, pendências do dia, dia operacional | Escala real |
| 5 | Gerador (rostering): continuidade, carga mensal, preferências, carro habitual, reserva, horizonte/reprocessamento | Escala real |
| 6 | Solver de reparo do dia | Escala real |
| 7 | Portal do condutor | Acesso |

## Em aberto

- Conversão `weeklyHours` → carga mensal (divisor CLT 220h para 44h? CCT?).
R.: exato, jornada aqui será de 210 mensais, e projeta a semanal
- Detalhamento do `CrewMember` (o usuário vai especificar ao chegar na Fase 2).
R.: me sugira modelo baseado em tudo o que descrito ate aqui
- Escopo do cadastro de turno: por branch ou por scope.
R. por branch, isso pode variar de acordo com empresa
- Mitigação do risco do PIN inicial (seção 11).
R. nao me preocupo com isso num primeiro momento
- Lista completa de pendências da escala diária e direcionamentos do solver de reparo.
- Modelo do regime de folgas (ciclos, offset, regras CCT de domingo).