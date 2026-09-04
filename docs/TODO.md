### TODO


## VehiclePlan
`apps/web/src/app/transit/vehicle-plan/[id]/page.tsx`
[ ] No resumo, ajustar grafico de oferta x demanda para mostrar por sentido

---
# Outros
## Alto
[ ] Implementar / refinar logica para viagens reservadas, e variações de viagens, observações, etc
## Medio
[ ] Edições em vehicle-plan (pending), adicionar history rollback (voltar ações)
[ ] Adição de ponto / waypoint no cadastro da rota, permitir remover um ponto ainda nao persistido (pending), e alt+l deve descartar pendencias
## Baixo
[ ] Unificar metodo de geração de CSV entre listpages (fragmentado em cada pagina hoje)
[ ] Revisar renewalIndex shape, se mantem da forma que ficou ou se simplifica granularidade




Seu entendimento está certo — só é mais preciso dizer que não é cascade de banco (TransitTrip não tem FK pra VehiclePlan, de propósito, já que uma trip pode em teoria ser referenciada por mais de um plano em algum ponto do fluxo), é uma varredura em nível de aplicação: VehiclePlanService.remove() (vehicle-plan.service.ts:668-690) apaga blocos/blockTrips do plano e só então varre TransitTrip cujo id não sobrou em nenhum BlockTrip em lugar nenhum — mesmo padrão usado ao remover uma linha de um plano (vehicle-plan.service.ts:1066-1068).

E tem uma implicação a mais que vale registrar: ao duplicar/clonar um plano, o código sempre cria TransitTrip novas (tx.transitTrip.create, vehicle-plan.service.ts:620-630), copiando campos como constraints/notes linha a linha pro novo id — nunca reaproveita o id da trip original. Ou seja, TransitTrip não é uma identidade estável entre planos, é mesmo, como você descreveu, a materialização daquele plano específico em cima da grade oficial (LineSchedule/LineDeparture). Isso é relevante pro nosso desenho porque já existe o precedente exato de como um campo novo de marcação se comportaria num clone: copiado linha por linha, igual notes/constraints já são hoje — nada de mecanismo novo aí.