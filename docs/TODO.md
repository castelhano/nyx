### TODO

---
# Outros
> Aumentar horario de inicio ideal turnos (2P em especial) para evitar mostrar alertas de fora do ideal


## Alto
[ ] Problema escala diaria, condutor preferencial ignora restrição de horários (dentre outros) e é respeitado no gerador, mudar nome (nos labels apenas) onde esta "preferencial" para "fixo"
[ ] Permitir na geração da escala diaria seleciona intervalo diferente da seleção de visão
[ ] Na tela do condutor implementar solicitação de troca de turno...
[ ] Na tela do condutor, ao selecionar um dia mostrar detalhamento da operação, viagens, itinerário, observações, marcos, etc
[ ] Como implementar escalas 5x2? (3 moldes simulados)
## Medio
[ ] Tela operador (e logica do app) como representar um pedido de "troca de folga" (nao eh folga adicional)
[ ] Edições em vehicle-plan (pending), adicionar history rollback (voltar ações) (q+backspace)
[ ] Adição de ponto / waypoint no cadastro da rota, permitir remover um ponto ainda nao persistido (pending), e alt+l deve descartar pendencias (q+backspace)
[ ] Tipar parâmetro db/tx (PrismaService | Prisma.TransactionClient) nos services/utils que hoje usam `any` pra aceitar os dois — eslint tem no-unsafe-* desligado em apps/api por causa disso (eslint.config.mjs)

## Baixo
[ ] Separar conceito de preparo e conclusao de servico
[-] Converter exports para GTFS format (plano em docs/proposal/plan_gtfs_export_v1.md)
[-] Unificar metodo de geração de CSV entre listpages (fragmentado em cada pagina hoje)


## Pendencias
- VehiclePlan, menu Gerar > item Ajustar Ciclo : no caso de ciclo maior (que não cabe nas viagens) sistema esta tratando correto? avisando corretamente os casos?
- VehiclePlan, menu Gerar > item Redistribuir  : avaliar se recurso eh valido (talvez valha remover), ideia era redistribuir viagens de uma linha ao carregar uma oso adicionando margem de manobra, mais fica confuso e hoje quase nunca mostra enable (se tiver bloco com outras linhas ja nao ativa)