# Plano para geração de planejamento (grade de horário de linhas)

Referencias: `apps/web/src/app/transit/vehicle-plan/[id]/page.tsx`, `apps/web/src/app/transit/vehicle-plan/[id]/components/LineScheduleGeneratorModal.tsx`, `apps/web/src/app/transit/vehicle-plan/[id]/line-generator-logic.ts`


## Definições iniciais
Existem dois conceitos chamados de Geração (ou Gerar) hoje, um deles no modo de edição (o que eh tratado neste documento) e outro (solver), quero já ajustar a definição de ambos, trocando referencias de gerar no solver para Otimizar tanto na interface do usuario quando nas referencias internas



## Ajustes em outros modelos
TransitRoute:
layoverPolicy: (enum) DEFAULT | HOLD | DEPOT, define comportamento do gerador para este local quando ocorre parada intermediaria, se carro deve ficar parado para reinicio, ou se deve recolher para a garagem
homeDepot: (pk), aponta para qual garagem preferencial para rota, opcional  


TransitSettings:
defaultLayoverPolicy: (enum) HOLD | DEPOT   (hold eh o default) comportamento base a ser usado caso nao especificado na rota

## Dados importantes para geração de um planejamento (disponobilização no modal de geração):
[ x ] Tempo de ciclo por sentido (janelas)
[ x ] Inicio e fim de operação (primeria e ultima viagem)
[ x ] Demanda por faixa / sentido, com respectivo indice de renovação
[ + ] Parametrização com critérios de geração (parcialmente inseridos), falta:
[ _ ] Informar em qual "sentido" primeira e ultima viagem devem ser considerados, default IDA (ou circular na ausencia de IDA) para inicio e VOLTA para fim (ou circular na ausencia)
[ _ ] Margem de "manobra" para geração das viagens (int, default 3 min), a geração quando for atribuir uma viagem ao bloco vai verificar se existe algum bloco com possibilidade de viagem entrar, usando essa margem para "apertar" a viagem anterior para evitar (ou atrasar) abertura de outro bloco 





## Etapas de geração

# Estagio 1 - Grade de horarios

1) Definição da frequência de atendimento: Horários corridos gerados buscando manter equidistancia entre viagens (partidas)
2) Aplicação do ciclo nas respectivas viagens (definindo fim, e demais atributos, aqui já eh criado a extrutura de uma viagem conceitual)
3) Distribuição das viagens entre blocos (veiculos), fluxo:  
3.1) Primeira viagem bloco 1 inicia horario informado para inicio de operação  
3.2) Próxima viagem da sequência entra nos bloco(s) criados? sim: insere no bloco, não: abre outro bloco  
3.3) Na mudança de patamar (frequencia estava em 5min vai para 20min fora do pico), se smoothTransition = true, distribuir variação (definir abordagem, impactar em duas ou no máximo 3 viagens essa transição)  

# Atendimento multilinha
> Logica deve permitir geração multilinha, critério neste caso eh que linhas a serem geradas devem compartilhar origem OU destino OU delta (usado na intercalação de horários)
[ ] No modal de geração deve ser permitido escolher um ponto de intercalação para cada sentido
[ ] FrequencyPanel deve permitir escolher ver q frequencia de uma linha ou do delta
[ ] LineFreqPanel deve incluir entrada "Multilinha" no seletor de linha (caso multilinha), no caso de delta buscando tempo da matrix do osrm, apenas se existir entrada na matrix, caso nao exibir toast de alerta informando que delta nao foi calculado devido falta de mapeamento

## Funções auxiliares da ferramenta de geração
[ ] Comparar parametrização atual (plan ativo da linha) com proposta (aqui antes mesmo de gerar, ainda no modal de parametrização da geração)
[ ] Comparar plano atual (plan ativo da linha) com proposta gerada (viagens, km total, produtivo, osioso, horas trabalhadas, etc)