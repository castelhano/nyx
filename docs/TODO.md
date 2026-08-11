### TODO

1. [ x ] Cadastro de rotas, waypoints devem aparecer no mapa 
2. [ x ] * Controle adicionar ponto mudar icon para plus e texto apenas Ponto, alt+n aciona controle
3. [ x ] * Visão de mapa: Adicionar controle para apontamento no mapa, apenas icon map-pin-plus respondendo no atalho q+m (section Visão de Mapa)
4. [ _ ] * Sugerir ponto deve plotar previa no mapa, click no ponto abre modal para ponto ja selecionado apenas para acertar a ordem
5. [ _ ] Visão de mapa plotar todos os sentidos, apenas o selecionado editavel
6. [ x ] Trocar controle (star) de isPrimary por botao que exibe dropdown com detalhes e operações do sentido:
         6.1 Inicio do dropdown com detalhes do sentido, extensão, total de pontos, etc
         6.2 divider de seção
         6.3 Principal;Inativar (ou ativar);Excluir
7. [ x ] Rotas inativas devem ficar no painel de rotas, com um separador entre as ativas, e com visual muted
8. [ _ ] Adicionar no settings de transit variavel propagateExtensionToOfficialKm (default=true), se true, ao persistir alteração em rota isPrimary altera TransitLine.metrics.extensionKm (no sentido equivalente) a extsão ajustada



x. [ _ ] Unificar metodo de geração de CSV entre listpages (fragmentado em cada pagina hoje)

* Referencia itens [1-8] apps/web/src/app/transit/transit-route/page.tsx