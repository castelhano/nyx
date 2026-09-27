# Proposta — Otimizar › Reduzir trocas de carro

Objetivo: reduzir as trocas de carro dos condutores da **escala ativa** **redistribuindo viagens
entre carros** do `VehiclePlan` — sem alterar partidas e sem abrir carros novos. É a primeira opção
do botão **Otimizar** (split button no topbar da escala), que no futuro também vai chamar o solver.

**Só na escala ativa.** O `VehiclePlan` é compartilhado por todas as versões de escala; ajustá-lo
deve favorecer a escala aprovada (a que vai para a rua), não um rascunho. Isso também dá uma única
referência para análise, decisão e impacto. Fluxo esperado: montar a escala → ativar → otimizar.

Pré-requisito: escala lógica (`docs/proposal/plan_crew_plan_v1.md`).

Status: **implementado** (2026-09-26) — `apps/api/src/modules/transit/timetabling/vehicle-swap/`
(`vehicle-swap.calc.ts` puro, service, controller) e `VehicleSwapModal.tsx` na tela da escala.

---

## Exemplo

```
Escala A: [Carro 1 04:50–08:00] [Carro 2 14:00–17:00]   ← troca de carro
Escala B: [Carro 2 06:00–13:00]
Escala C: [Carro 1 15:00–22:00]
```

Trocando tudo o que o Carro 1 faz **a partir das 15:00** com tudo o que o Carro 2 faz **a partir
das 14:00**:

```
Carro 1: [A 04:50–08:00] | [A 14:00–17:00 …]    ← A fica no mesmo carro
Carro 2: [B 06:00–13:00] | [C 15:00–22:00 …]
```

A troca é do **final do bloco inteiro** a partir do corte (tudo o que vem depois), não só do trecho
14:00–17:00. Trocar um trecho do meio equivale a duas trocas de final; a troca de final é a operação
básica.

---

## Operação: troca de finais de bloco

Para cada jornada de **condutor** com troca de carro entre duas pegadas consecutivas — sai do carro
X em `t1`, entra no carro Y em `t2` — o candidato é:

> final de X a partir de `t1` ⇄ final de Y a partir de `t2`

O corte é a fronteira de pegada (fim da pegada em X, início da pegada em Y), e também divide os
deadruns do intervalo entre as viagens: os que terminam até o corte fazem parte da parte inicial
(ex.: o deslocamento até onde o carro espera, dirigido pelo condutor que sai); os que começam depois
são a entrada do final. Um `RETURN` logo após a parte inicial também fica com ela.

O corte em cada carro pode ficar em qualquer ponto do tempo ocioso dele (X: entre `t1` e a
primeira viagem do seu final; Y: entre o fim da sua parte inicial e `t2`). As viagens, deadruns e
intervalos (`BlockInterval`) do final mudam de carro junto.

### Condições (candidato descartado se alguma falhar)

| Condição | Regra |
|---|---|
| Tempo | X alcança o início do final de Y, e Y o de X, no tempo disponível (deslocamento incluso) |
| Corte entre viagens | o corte não pode cair no meio de uma viagem — pegada que termina/começa num ponto de troca intermediário (`CREW_CHANGE_STOP`) não gera candidato |
| Mesmo operador | `VehicleBlock.branchId` igual — não mistura operadores |
| Mesmo tipo de veículo | `VehicleBlock.vehicleType` igual (estrito) — não mistura tecnologias |
| Tempo de deslocamento conhecido | deslocamento necessário sem tempo na mesma fonte usada pelo plano de veículos → descartado |
| Ganho | saldo de trocas de carro (abaixo) > 0 e nenhuma pendência nova (`DutyIssue`) nas jornadas afetadas |

### Emenda no corte — três casos

A emenda de cada carro (sua parte inicial → o final que ele recebe) é classificada:

| Caso | O que acontece | No modal |
|---|---|---|
| **(a) Direta** | fim da parte inicial e início do final no mesmo local | marcado |
| **(b) Via garagem** | o carro já recolhia e saía de novo; só muda o destino do `ACCESS` (e o `RETURN` final, para a garagem do próprio carro) | marcado, com Δ km/min |
| **(c) Deslocamento novo** | exige `DISPLACEMENT` novo entre terminais | **desmarcado e destacado**, com Δ km/min |

Cada carro mantém sua garagem (`VehicleBlock.depotId`); o recolhimento do final trocado é refeito
para a garagem do carro que o recebe. Garagem diferente não bloqueia, só aparece no Δ km.

Ordem de tentativa da emenda: (1) reaproveitar o deslocamento de entrada do final recebido quando
ele sai de onde o carro já está (ex.: o `ACCESS` da mesma garagem); (2) nada, se o carro já está no
início do final; (3) `ACCESS` novo (carro na garagem, chegando logo antes do final) ou `DISPLACEMENT` novo (carro num
terminal, saindo logo após a parte inicial — o carro espera no início do final:
`[viagens][deslocamento][intervalo][viagens]`). Os intervalos do próprio carro depois da parte
inicial são deslocados para depois desse deslocamento e aparados antes do final recebido (removidos
se não sobrar nada). A pegada da jornada que motivou a troca é estendida sobre o deslocamento novo
(o mesmo condutor segue com o carro), se a jornada estiver livre nesse horário.
Se isso invalidar uma pegada da escala ativa, tenta o fallback **via garagem**: carro num terminal
cujo final recebido começa com `ACCESS` da própria garagem ganha um `RETURN` novo e mantém esse
`ACCESS` (preserva a pegada que começa na saída da garagem). Tempos como em
`block-mutation.utils.ts`: `baseMinutes × speedRatio`, chegando 1 min antes da viagem.

---

## Saldo de trocas de carro

Todas as jornadas que estão nos dois finais **trocam de carro**, não só a que motivou o candidato
(no exemplo, C passa do Carro 1 para o Carro 2 — se C tivesse uma pegada anterior no Carro 1,
ganharia uma troca). O critério é o **saldo de `vehicleChanges` somado sobre todas as jornadas de
condutor (`DRIVER`) afetadas**. Pegadas de cobrador/auxiliar mudam de carro junto, mas não entram
no saldo.

---

## Candidatos independentes

Duas trocas que envolvem o mesmo carro não são independentes (a segunda foi calculada sobre o estado
sem a primeira). O motor escolhe, **por ordem de ganho, um conjunto em que cada carro aparece em no
máximo uma troca** — assim qualquer combinação de marcações no modal é válida. Ganhos adicionais:
aplicar e rodar de novo.

---

## Tela

Topbar da escala: **Otimizar** (split button) › **Reduzir trocas de carro**. Habilitado só na escala
`ACTIVE`; nas demais, desabilitado com a dica "Disponível na escala ativa". Abre um modal só de
análise; nada é gravado até confirmar.

Cada linha do modal:
- carros e horários do corte;
- jornadas afetadas e o saldo por jornada (ex.: `−1 A · 0 C`);
- caso da emenda (Emenda direta / Via garagem / Deslocamento novo) com Δ minutos e Δ km de ociosa;
- minutos sem motorista a mais nos dois carros (escala ativa), quando houver;
- efeito nas outras versões, só informativo: quantas pegadas ficarão stale (abaixo).

Vêm marcados os que não criam deslocamento novo nem tempo sem motorista; os demais vêm desmarcados.
"Aplicar" grava as marcadas. A alteração vai direto para produção, sem nova aprovação — o modal é a
proteção. (O Δ no score do plano de veículos fica para depois: o `recalculate` roda ao aplicar.)

---

## Aplicação

- **Plano de veículos ativo pode ser alterado**: as partidas são mantidas, só redistribuídas entre
  carros existentes.
- `POST /transit/crew-plan/:id/vehicle-swaps/apply { keys }` **refaz a análise** sobre o estado atual
  e aplica as chaves escolhidas; chave que não existe mais → 409 ("análise desatualizada").
- Gravação própria, numa única transação (não passa por `applyDiff`: ele cria deslocamentos antes
  de mover viagens, e os da emenda precisam do carro de destino): move viagens (sequências
  estacionadas em negativo e depois anexadas após a parte inicial do carro), deadruns e intervalos
  dos finais; apaga/cria/re-aponta os deslocamentos da emenda; apara intervalos do carro que não
  cabem mais; remaneja as pegadas; fecha com `VehiclePlanService.recalculate(planId, tx)`. Depois
  do commit, `recalculateForVehiclePlan` atualiza todas as escalas.
- Não há desfazer automático (duplicar a escala não serve de backup — a cópia também acompanha as
  viagens); o modal avisa.

### Outras versões de escala

A análise e a decisão usam só a escala ativa. Nas demais versões do mesmo `VehiclePlan` o
remanejamento é **mecânico**: a troca só muda qual carro faz quais viagens, então uma pegada que
cobria viagens de Y passa para X com os mesmos horários e locais (os pontos de troca continuam
válidos). Nada a conciliar entre versões — elas não geram nem alteram candidatos.

| Pegada | Tratamento |
|---|---|
| Da escala ativa | segue as viagens; se invalidar, o candidato é descartado |
| De outra versão, inteira de um lado do corte | segue as viagens |
| De outra versão, atravessando o corte | fica **stale** — revisão na próxima ativação daquela versão |

Pegada que segue o final e começava no layover do carro de origem (ex.: na chegada da viagem
anterior dele) passa a começar no primeiro ponto em que o carro que recebe está no mesmo local —
perde só tempo de espera no terminal.

---

## Fora de escopo

- Troca entre operadores ou tipos de veículo diferentes.
- Abrir carros novos ou alterar partidas.
- Otimizar escalas que não sejam a ativa (rascunhos, inativas).
- Histórico de alterações do plano de veículos (desejável, hoje não existe).
- Solver de escala (as outras opções do Otimizar).
