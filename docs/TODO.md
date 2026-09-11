### TODO

---
# Outros
## Alto
[ ] Adicionar settings ao transit export
## Medio
[ ] Edições em vehicle-plan (pending), adicionar history rollback (voltar ações)
[ ] Adição de ponto / waypoint no cadastro da rota, permitir remover um ponto ainda nao persistido (pending), e alt+l deve descartar pendencias
[ ] Tipar parâmetro db/tx (PrismaService | Prisma.TransactionClient) nos services/utils que hoje usam `any` pra aceitar os dois — eslint tem no-unsafe-* desligado em apps/api por causa disso (eslint.config.mjs)

## Baixo
[ ] Unificar metodo de geração de CSV entre listpages (fragmentado em cada pagina hoje)