# Transit Schema — Ajustes Pendentes

## `TransitLine`
- [ ] `code` volta a ser `@unique`
  — linha nunca é duplicada por empresa; unicidade global é segura

## `VehiclePlan`
- [ ] Remover campos avulsos `fleetCount`, `score`, `deadrunKm`
- [ ] Adicionar `summary Json?` no lugar
  — campo único extensível cobre km produtiva, vazio, horas, frota, score etc; evita proliferação de colunas

## `VehicleBlock`
- [ ] Remover campos avulsos `totalMinutes`, `totalKm`
- [ ] Adicionar `summary Json?` no lugar
  — mesmo motivo do VehiclePlan; solver popula ao persistir, nunca atualizado manualmente

## `VehicleBlock.branchId`
- [ ] Documentar comportamento: solver preenche automaticamente quando o escopo tem empresa definida; `null` apenas em planejamento compartilhado entre empresas
  — sem alteração de schema, apenas clareza na camada de serviço

## `VehiclePlanLine`
- [ ] Manter o modelo
  — necessário para filtrar planos por linha ("todos os planos que cobrem a linha X")

## `DayType`
- [ ] Adicionar campo `priority Int` (estava no doc como `[TODO]`)
  — necessário para resolver conflito quando mais de um DayType tem pattern ativo para a mesma data