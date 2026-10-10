### TODO

---
# Outros
## Alto
[-] Adicionar a linha conceito de Timepoint, que registra partidas importantes, em um daytype / sentido, exemplo um horário critico de saida de escola que precisa ser atendido, ou um horário de entrada de empresa, imagino além do horário informar essa dinamica de embarque ou desembarque, pois o gerador vai ter que olhar para estes casos e forçar / validadar estes atendimentos... uma saida de escola (por exemplo) as 17h00 associado ao volta deve forçar na geração uma viagem de volta 17h00 ou mais alguns minutos... outra possibildiade seria informar range ideal para existencia de uma viagem (plano em docs/proposal/plan_line_service_requirement_v1.md)

## Medio
[ ] Edições em vehicle-plan (pending), adicionar history rollback (voltar ações) (q+backspace)
[ ] Adição de ponto / waypoint no cadastro da rota, permitir remover um ponto ainda nao persistido (pending), e alt+l deve descartar pendencias (q+backspace)
[ ] Tipar parâmetro db/tx (PrismaService | Prisma.TransactionClient) nos services/utils que hoje usam `any` pra aceitar os dois — eslint tem no-unsafe-* desligado em apps/api por causa disso (eslint.config.mjs)

## Baixo
[ ] Separar conceito de preparo e conclusao de servico
[-] Converter exports para GTFS format (plano em docs/proposal/plan_gtfs_export_v1.md)
[ ] Unificar metodo de geração de CSV entre listpages (fragmentado em cada pagina hoje)