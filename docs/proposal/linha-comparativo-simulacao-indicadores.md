# Indicadores do protótipo Comparativo / Simulação O/D

Referência: `apps/web/src/app/playground/page.tsx` (protótipo Figma recriado, dados mock)

Checklist de tudo que existe hoje no protótipo, para marcar o que interessa levar a implementação futura (modelo, cálculo, persistência). Nada aqui está implementado de fato — é só o que a tela mock exibe.  

> Leg: I - Inclusão de modelo / atributo (requer migração), entradas (definir valor para persistencia em ingles):
> Leg: N - Não será incluso (indicador não necessário ou não possivel de ser inferido com precisão)  
> Leg: + - Ausente na proposta mais necessário na implementação final
> Leg: * - Não será incluso (indicador não necessário ou não possivel de ser inferido com precisão)  

## Dados estruturais da linha (TransitLine)
[x] Nome/identificação da linha
[x] Tipo (LineType)
[N] Corredor / eixo viário

## Indicadores comparados (Atual × Proposta) — aba Comparativo

### Operação
[x] Extensão produtiva (km)
[x] Frota
[x] Viagens dia
[x] Horas Operacionais
[x] Intervalo pico (min)
[x] Intervalo entrepico (min)

### Oferta e Demanda
[x] Capacidade por veículo (pax)
[x] Passageiros por dia (pax/dia)
[x] Quilômetros produzidos (km/dia)
[x] PPH pico — capacidade ofertada (pax/h/sentido)

### Qualidade de Serviço
[x] Velocidade média operacional (km/h)
[x] Pontualidade (%)
[x] Índice de Ocupação — IOC
[x] Índice de Frequência de Serviço — IFS (viag/h)

### Gestão
[N] Custo por quilômetro (R$/km)
[N] Idade média da frota (anos)

### Derivados / cabeçalho
[x] Variação percentual de passageiros/dia (atual → proposta), destaque no card
[x] Variação percentual por indicador na tabela detalhada (↑ melhoria / ↓ degradação, com inversão de sinal para indicadores "quanto menor melhor")

## Simulação O/D — aba Simulação

### Parâmetros ajustáveis (sliders)
[x] Intervalo de pico manhã (min) — ajustável, ancorado no valor da proposta
[x] Intervalo entrepico (min) — ajustável, ancorado no valor da proposta
[+] Intervalo de pico tarde (min) — ajustável, ancorado no valor da proposta
[x] Capacidade do veículo (pax) — ajustável, ancorado no valor da proposta
[x] Oferta calculada no pico (pax/h), derivada de viagens/h × capacidade

### Perfil de demanda horária
[ ] Percentual da demanda diária por hora (curva 04h–23h, soma = 100%)
[ ] Marcação de horários de pico (06–08h e 16–18h) usada para aplicar intervalo de pico vs entrepico

### Série por hora (Oferta × Demanda)
[ ] Demanda estimada por hora (pax)
[ ] Oferta estimada por hora (pax), a partir do intervalo e capacidade vigentes
[ ] Fator de Ocupação por hora (FOC = demanda / oferta)
[ ] Déficit de atendimento por hora (demanda − oferta, quando positivo)

### Classificação do Fator de Ocupação (FOC)
[ ] Faixas: <0.75 Confortável · 0.75–0.90 Moderado · 0.90–1.0 Elevado · >1.0 Saturado

### KPIs agregados do dia
[ ] Demanda total diária (pax/dia)
[ ] Fator de Ocupação médio do dia + status (Subutilizado/Adequado/Elevado/Saturado)
[ ] Quantidade de horas com saturação (FOC > 1.0)
[ ] Passageiros não atendidos no dia (soma dos déficits horários)
