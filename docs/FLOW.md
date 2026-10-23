# Revisão e padronização de importação de dados

> Status atual: existem fragmentos de importação usando arquivos diversos vindos do ERP Globus (`employee-sync`, import de `hour-bank`, import Globus do `vehicle-plan`), sempre com informações parciais.

Objetivo: padronizar a importação de dados, permitindo o cadastro completo dos modelos principais via arquivo CSV, tanto para criação quanto para atualização (sincronização) de registros.

---

## Fluxo do usuário

1. Botão **Importar** no topbar da lista do resource abre o modal de importação.
2. No modal:
   - Área para carregar o arquivo (clique ou arrastar).
   - Botão **Modelo** (discreto): baixa um CSV com todas as colunas importáveis e registros de exemplo fictícios, declarados no schema (`importExamples`).
   - Ao lado, um popover **Campos** que lista as colunas disponíveis: o identificador sempre em primeiro, os obrigatórios na criação em destaque e cópia fácil, de um campo ou do cabeçalho inteiro.
3. Ao carregar o arquivo, o backend executa uma **simulação** e o modal mostra:
   - Cards de resumo: total, válidos, inválidos, a criar e a atualizar.
   - Prévia dos registros em uma **tabela de altura fixa** com cabeçalho fixo e scroll interno. O modal não cresce com o volume (o retorno pode ter centenas de linhas).
   - Filtros **Todos / Válidos / Inválidos**.
   - Erros identificados por linha e coluna: `Linha 42 · taxId: CPF inválido`.
4. **Gravar** só fica habilitado sem linhas inválidas. **Cancelar** aborta sem persistir nada.

Layout elegante, sem exageros, seguindo os componentes existentes (hand-rolled, sem libs externas).

---

## Formato do CSV

| Item | Regra |
|---|---|
| Separador | `;` |
| Encoding | Aceita UTF-8 e Latin-1. O modelo é gerado em UTF-8 com BOM |
| Cabeçalho | Chave do campo (`taxId`), nunca o label |
| Datas | `dd/mm/aaaa` |
| Decimais | Vírgula (`1234,56`) |
| Booleanos | `SIM` / `NAO` (sem acento) |
| Enums | Valor do banco, em maiúsculas |
| Listas | Separador `\|` dentro da célula (ex.: `branches`) |
| Aspas | Valores com `;`, aspas ou quebra de linha seguem o padrão CSV (entre aspas) |

---

## Regras de importação

- **Tudo ou nada**: qualquer linha inválida bloqueia a gravação. O usuário corrige o arquivo e carrega de novo.
- **Simulação no próprio endpoint**: `POST /<domain>/<resource>/import?dryRun=true` executa o import completo dentro de uma transação e faz rollback no final. A prévia pega também os erros do banco (unique, FK, duplicatas no próprio arquivo), e simulação e gravação usam o mesmo código.
- **Revalidação ao gravar**: o Gravar envia o arquivo de novo, e o servidor revalida tudo, já que os dados podem ter mudado desde a prévia.
- **Chave de sincronização**: cada resource declara seu identificador (`importKey`). Se a chave existe, a linha atualiza o registro; se não existe, cria.
- **Criação**: exige os campos obrigatórios do schema. **Atualização**: todos os campos são opcionais.
- **Célula vazia = não mexer**: na atualização, célula vazia mantém o valor atual. Não há como apagar um valor via import (por enquanto).
- **Sem remoção**: registros ausentes no arquivo permanecem intactos. A importação nunca exclui.
- **Limite**: até 5.000 linhas por arquivo.
- **Relações pela chave natural**: o CSV nunca usa `id`. Cada relação declara qual campo do resource relacionado é a referência, inclusive composta (ex.: `brand` + `model`).
- **Normalização**: `trim` em todos os valores. Referências comparadas sem diferenciar maiúsculas de minúsculas.
- **Colunas**: `id`, `createdAt`, `updatedAt`, campos calculados e campos `showInForm: false` não são importáveis. Coluna desconhecida no cabeçalho é erro, não é ignorada.
- **Permissão**: quem pode editar o resource pode importar, sem permissão especial. Para não-admins, o `scopeField` vale: linha que cria ou altera registro de outra filial é inválida.

---

## Metadados no schema

Seguindo o princípio de que o schema Zod é a fonte única de verdade, o import é configurado no próprio schema:

- `withMeta(schema, { ..., importKey: 'code' })`: chave de sincronização (string ou array para chave composta). Resource sem `importKey` não tem import.
- `withMeta(schema, { ..., importExamples: [{ ... }] })`: linhas fictícias do CSV de modelo, por nome de coluna e já no formato do arquivo (datas dd/mm/aaaa, SIM/NAO). Todo resource com import deve declarar exemplos que mostrem os casos de uso (ex.: feriado geral e de filial).
- `.meta({ importRef: 'name' })` nos campos de relação: campo do resource relacionado usado como referência no CSV.
- Colunas importáveis, modelo de CSV e o popover de campos são derivados desses metadados. Nenhuma configuração por resource no frontend.

Resources com regras próprias (Employee + Contract, User) estendem o comportamento padrão no service, com hooks por linha.

---

## Ajustes de schema necessários

- `JobTitle.name` → `@unique` (sem duplicados hoje)
- `Branch.name` → `@unique` (referência nas colunas `branch` / `branches`; o caractere `|` fica proibido nesse campo)

---

## DOMAIN Core

### Holiday
- Chave: `date` + `branch`.
- Atenção: `branchId` é nulo em feriados gerais, e no Postgres `NULL` não colide em unique. A busca da chave precisa tratar `branch` vazio explicitamente, e a simulação deve detectar duplicatas desse caso.

### User
- Chave: `username`.
- Colunas especiais:
  - `password`: senha temporária, obrigatória na criação. É criptografada, salva com `forcePasswordChange = true` e não passa pela política de senha. Quem importou informa a senha ao usuário. **Ignorada para usuário existente.**
  - `role`: coluna simples.
  - `branches`: nomes das filiais separados por `|`. O `UserBranch.role` é sempre `member`, e os diferentes são ajustados manualmente.
  - `permissionsFrom`: `username` de um usuário **já existente no banco** cujas permissões são copiadas. Só age na criação (ignorado para usuário existente). A cópia é um retrato do momento, sem vínculo: mudanças futuras no usuário modelo não se propagam.
- Aviso discreto no modal: o arquivo contém senhas em texto puro.

### UserPermission (import separado)
- O topbar da lista de User vira um split button: **Importar** (usuários) e **Importar permissões**.
- Colunas: `username;resource;actions` (ex.: `joao;Vehicle;read|update`).
- Chave: `username` + `resource`. A linha **substitui** as ações daquele recurso para aquele usuário. Recursos ausentes no arquivo ficam intactos.
- `actions` vazio é linha inválida. A remoção total de um recurso é feita pela tela.
- Validação contra o registro de resources: o resource precisa existir e a ação precisa ser válida para ele (settings não têm `create`/`delete`).
- Uso típico: a carga inicial usa `permissionsFrom`, e os ajustes em lote posteriores usam este import.

---

## DOMAIN HR

### Employee (+ Contract)
- Chave: `code` (matrícula).
- Relações: `branch` por `name`, `jobTitle` por `name`.
- As colunas de contrato no mesmo arquivo representam **sempre um contrato novo**. Não há edição de contrato via import (por enquanto).
  - Colunas de contrato vazias: atualiza só o funcionário, sem tocar em contratos.
  - Funcionário novo sem colunas de contrato: criado sem contrato, como no fluxo manual.
  - Contrato vigente existente: é finalizado um dia antes do início do novo, como já ocorre hoje.
  - Contrato futuro existente: erro na linha.
  - Contrato com o mesmo `startDate` do vigente: linha ignorada (é o mesmo contrato), o que permite reimportar o mesmo arquivo sem efeito colateral.

---

## DOMAIN Fleet

### VehicleBrand
- Chave: `name`.

### VehicleModel
- Chave: `brand` + `name` (já existe `@@unique([name, brandId])`).

### Vehicle
- Chave: `code`.
- Relações: `brand` + `model` (referência composta ao VehicleModel), `branch` por `name`.

---

## DOMAIN Transit

Domínio mais complexo. As regras por modelo serão fechadas antes da implementação dele.

1. Line
2. CrewMember
3. VehiclePlan: o topbar vira um split button, com **Importar** (padrão deste documento) e **Importar Globus** (fluxo existente).
4. Locality
5. HourBank
6. Vacation

Como as relações são resolvidas pelo banco, a ordem de carga importa (ex.: VehiclePlan depende de Line e CrewMember). A ordem de carga para bases novas será documentada.

---

## Etapas de implementação

### 1. Ajustes de schema ✅
- `JobTitle.name` e `Branch.name` → `@unique` + migration.

### 2. Metadados ✅
- `importKey` em `withMeta()` e `importRef` em `.meta()` (`packages/schemas`), com os tipos em `packages/types`.
- Exposição desses metadados no endpoint de metadata existente.

### 3. Backend genérico (`apps/api/src/core`) ✅
- Parser de CSV: separador `;`, aspas, detecção de UTF-8/Latin-1, limite de 5.000 linhas.
- Conversores por tipo: data `dd/mm/aaaa`, decimal com vírgula, `SIM`/`NAO`, enum, listas com `|`.
- Resolução de relações por `importRef` (simples e composta), sem diferenciar maiúsculas de minúsculas.
- Motor de import: parse → conversão → validação Zod (create ou update conforme a chave existir) → resolução de referências → upsert em transação → rollback no `dryRun`.
- Resposta: resumo (total, válidos, inválidos, a criar, a atualizar), linhas da prévia e erros por linha/coluna.
- Endpoints no `BaseController`: `POST import?dryRun=` e `GET import/template`.
- Checagem de permissão de edição e de `scopeField`.
- Hooks por linha no `BaseService` para resources com regras próprias.
- Testes do parser, dos conversores e do motor (simulação, tudo ou nada, célula vazia).

### 4. Frontend genérico ✅
- Componente `ImportModal`: upload, botão Modelo, popover de campos, cards de resumo, tabela de prévia com altura fixa e filtros, lista de erros, Gravar/Cancelar.
- Botão **Importar** automático no topbar das listas de resources com `importKey`.
- Variante split button para resources com imports adicionais: usa o `menu` já existente do `TopbarAction` com o mesmo `ImportModal` — entra junto com o primeiro resource que precisar (User, VehiclePlan, HourBank).

### 5. Piloto: Core e Fleet simples ✅
- Holiday, VehicleBrand e VehicleModel: validam o fluxo inteiro com chaves simples, compostas e com nulo.

### 6. Vehicle
- Primeira referência composta (`brand` + `model`) e referência a `branch`.

### 7. Employee + Contract
- Hook de contrato novo (finalizar o vigente, erro em contrato futuro, ignorar mesmo `startDate`).

### 8. User + UserPermission
- Hook de senha temporária, `branches` e `permissionsFrom`.
- Import de permissões e split button na lista de User.

### 9. Transit
- Fechar as regras por modelo e a ordem de carga.
- Implementar seguindo a ordem da lista, com o split button do VehiclePlan.

---

## Notas de implementação

- `importRef` é opcional: sem ele, a referência usa o `labelField` da relação. Relação com `dependsOn` (ex.: modelo dentro da marca) busca restrita ao registro que a coluna irmã resolveu.
- Coluna de chave anulável (ex.: `branch` do Holiday) pode ser omitida do arquivo — vale como vazia.
- Chave comparada exatamente como no banco (maiúsculas importam); só as referências ignoram maiúsculas.
- `scopeField`: para não-admins, o import rejeita linhas de filiais fora do `branchIds`, com a mesma regra do CRUD do `BaseService`.

## Pontos em aberto

- Destino dos fragmentos existentes (`employee-sync` e import de `hour-bank`): substituir pelo import padrão ou manter como variante "Importar Globus" no split button. Decidir na etapa de cada resource.
> RESPOSTA:
>> employee-sync: REMOVER, manter somente o padrão definido
>> hour-bank: manter como Importar Globus no split button

- Regras específicas de cada modelo do Transit (etapa 9).
> Tratadas individualmente quando for implementar