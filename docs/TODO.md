### TODO

---
# Outros
> Aumentar horario de inicio ideal turnos (2P em especial) para evitar mostrar alertas de fora do ideal


## Alto
[ ] Na lista de OSOs deixa filtro de ativos true por default, e deixar destaque (color;badge;etc) nas ativas
[ ] Versionamento do GTFS, entendo que cada daytype deveria ter seu versionamento para ficar consistente
[ ] Ao remover pontos na Seq da edição de rotas, contador nao pode ajustar na lista antes de gravar, pois perde a referencia no mapa
[ ] Modal de exportar OSO, linhas filhas nao são mostradas na lista, sao geradas junto com as pai
[ ] Edição da escala diária

## Medio
[ ] Tipar parâmetro db/tx (PrismaService | Prisma.TransactionClient) nos services/utils que hoje usam `any` pra aceitar os dois — eslint tem no-unsafe-* desligado em apps/api por causa disso (eslint.config.mjs)

## Baixo
[ ] Separar conceito de preparo e conclusao de servico
[-] Converter exports para GTFS format (plano em docs/proposal/plan_gtfs_export_v1.md)
[-] Unificar metodo de geração de CSV entre listpages (fragmentado em cada pagina hoje)


## Pendencias
- VehiclePlan, menu Gerar > item Ajustar Ciclo : no caso de ciclo maior (que não cabe nas viagens) sistema esta tratando correto? avisando corretamente os casos?
- VehiclePlan, menu Gerar > item Redistribuir  : avaliar se recurso eh valido (talvez valha remover), ideia era redistribuir viagens de uma linha ao carregar uma oso adicionando margem de manobra, mais fica confuso e hoje quase nunca mostra enable (se tiver bloco com outras linhas ja nao ativa)