### TODO

---
# Outros
## Alto
[ ] Dashboard de escala
[ ] Alternar List de feriados para layout de calendario (similar as ferias de condutores)
## Medio
[ ] Edições em vehicle-plan (pending), adicionar history rollback (voltar ações) (q+backspace)
[ ] Adição de ponto / waypoint no cadastro da rota, permitir remover um ponto ainda nao persistido (pending), e alt+l deve descartar pendencias (q+backspace)
[ ] Tipar parâmetro db/tx (PrismaService | Prisma.TransactionClient) nos services/utils que hoje usam `any` pra aceitar os dois — eslint tem no-unsafe-* desligado em apps/api por causa disso (eslint.config.mjs)

## Baixo
[ ] Separar conceito de preparo e conclusao de servico
[-] Converter exports para GTFS format (plano em docs/proposal/plan_gtfs_export_v1.md)
[ ] Unificar metodo de geração de CSV entre listpages (fragmentado em cada pagina hoje)


## Pendencias
- VehiclePlan, menu Gerar > item Ajustar Ciclo : no caso de ciclo maior (que não cabe nas viagens) sistema esta tratando correto? avisando corretamente os casos?
- VehiclePlan, menu Gerar > item Redistribuir  : avaliar se recurso eh valido (talvez valha remover), ideia era redistribuir viagens de uma linha ao carregar uma oso adicionando margem de manobra, mais fica confuso e hoje quase nunca mostra enable (se tiver bloco com outras linhas ja nao ativa)