## Implementação de status de viagens
Referências importantes:  
`apps/api/prisma/schema/transit.prisma`  
`apps/web/src/app/transit/vehicle-plan/[id]/page.tsx`  
`apps/api/src/modules/transit/timetabling/vehicle-plan/oso/**`  

Alguns problemas precisam ser tratados:
[ ] Viagens em reservado hoje são carregadas como deadrun (type: DISPLACEMENT), uma linha de exemplo para analise eh a 390 (6075ee0d-9692-49ee-8eab-55e021e39b28) ela tem varias viagens deste tipo, no OSO gerado estas viagens deverams er exibidas junto a viagem correspondente, com variação visual que iremos escolher (provavel negrito+italico)
[ ] Em linhas onde existe viagens deadrun (type: DISPLACEMENT), deve ser adicionado comentario (legenda) na parte de observações "Linahs em italico retornam reservado no contrafluxo"
[ ] Outras marcações (customizadas) em viagens poderão ser feitas pelo usuário. Aqui penso em duas necessídades, novo modelo para cadastro de marcações "comuns" algumas marcações muito recorrentes que usuario ja deixa precadastrado, mais algumas são muito especificas, e imagino permitir inserir direto no planejamento... me ajude a desenhar esta ideia (se precisar adicionar atributos em modelos existentes sem problema); Podemos definir um numero limitado de design possiveis para identificação das viagens, e usuário associa a um destes casos

aqui ainda é uma ideia muito vaga, precisa ser amadurecida, me de suas considerações sobre o descrito