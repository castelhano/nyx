### TODO

---
# Outros
## Alto
[ ] Implementar / refinar logica para viagens reservadas, e variações de viagens, observações, etc
[ ] Adicionar comando de conversão de viagem em deadrun DISPLACEMENT (confirmado: reservada continua como BlockDeadrun.DISPLACEMENT, não vira TransitTrip — km improdutiva e o pipeline de marcação no OSO já dependem dessa modelagem, ver docs/proposal/trash/plan_trip_markings_v1.md)
[ ] Classificar TransitTrip por padrão de parada (paradora/semiexpressa/expressa) — comportamento de embarque da viagem, eixo distinto de "reservada" (não-produtiva) e de "reforço" (motivo de existir da viagem), não misturar. Implementação sugerida: enum TripStopPattern (LOCAL/LIMITED/EXPRESS) @default(LOCAL) em transit.prisma + campo em trip.schema.ts (widget select, optionLabels Paradora/Semiexpressa/Expressa); v1 é só diferenciação visual no Gantt, cálculo de oferta por padrão fica pra depois
[ ] Ajustar ideia do intervalo, deve computar sem cortar a borda (1min) entre as viagens
## Medio
[ ] Edições em vehicle-plan (pending), adicionar history rollback (voltar ações)
[ ] Adição de ponto / waypoint no cadastro da rota, permitir remover um ponto ainda nao persistido (pending), e alt+l deve descartar pendencias
[ ] Tipar parâmetro db/tx (PrismaService | Prisma.TransactionClient) nos services/utils que hoje usam `any` pra aceitar os dois — eslint tem no-unsafe-* desligado em apps/api por causa disso (eslint.config.mjs)

## Baixo
[ ] Unificar metodo de geração de CSV entre listpages (fragmentado em cada pagina hoje)