### TODO


## VehiclePlan
`apps/web/src/app/transit/vehicle-plan/[id]/page.tsx`
[ ] No resumo, ajustar grafico de oferta x demanda para mostrar por sentido

---
# Outros
## Alto
[ ] Implementar / refinar logica para viagens reservadas, e variações de viagens, observações, etc
[ ] Adicionar comando de conversão de viagem em deadrun DISPLACEMENTS (confirmar se displacements eh deadrun ou deveria ser uma trip com type distinto, mesma ideia de para expresso, semiexpresso)
## Medio
[ ] Edições em vehicle-plan (pending), adicionar history rollback (voltar ações)
[ ] Adição de ponto / waypoint no cadastro da rota, permitir remover um ponto ainda nao persistido (pending), e alt+l deve descartar pendencias
[ ] Tipar parâmetro db/tx (PrismaService | Prisma.TransactionClient) nos services/utils que hoje usam `any` pra aceitar os dois — eslint tem no-unsafe-* desligado em apps/api por causa disso (eslint.config.mjs)
## Baixo
[ ] Unificar metodo de geração de CSV entre listpages (fragmentado em cada pagina hoje)
[ ] Revisar renewalIndex shape, se mantem da forma que ficou ou se simplifica granularidade