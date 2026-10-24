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
- `withMeta(schema, { ..., importNested: { contract: { schema, columns } } })`: um registro relacionado preenchido na mesma linha (ex.: o contrato do funcionário), com as colunas nomeadas pelo mapa. O grupo só conta se a linha preencher alguma coluna dele — aí os obrigatórios do grupo passam a valer. O service grava via `importWrite`.
- `withMeta(schema, { ..., importFields: { ... } })`: colunas só de import, que não são campos do registro (ex.: senha temporária do usuário). Validadas com a linha e entregues ao service em `ImportOp.extra`.
- `withMeta(schema, { ..., importNotice: '...' })`: aviso exibido no modal (ex.: o arquivo contém senhas).
- `.meta({ importable: false })`: tira um campo do import (ex.: `action` da permissão, importada em conjunto por `actions`). `importable: true` traz um campo que o form esconde (ex.: `lng` da localidade, preenchido pelo mapa).
- `.meta({ importName: '...' })`: nome da coluna quando o padrão fica ruim (ex.: `operatorBranchIds` → `operatorBranches`).
- `afterImport()` no service: roda uma vez depois de um import que gravou algo (ex.: recálculo da matriz de tempos das localidades).
- `withMeta(schema, { ..., importExamples: [{ ... }] })`: linhas fictícias do CSV de modelo, por nome de coluna e já no formato do arquivo (datas dd/mm/aaaa, SIM/NAO). Todo resource com import deve declarar exemplos que mostrem os casos de uso (ex.: feriado geral e de filial) e **todos os valores de cada enum** — é assim que o usuário descobre os valores aceitos. O teste `import.examples.spec.ts` falha se faltar algum.
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
- Validação contra o registro de resources: o resource precisa ser um dos que a matriz de permissões oferece; as quatro ações valem para qualquer um, como na matriz.
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

Domínio mais complexo. Os modelos foram separados por complexidade nas etapas 9 a 11.

**Ordem de carga:** fica com o usuário. As referências são resolvidas contra o banco, então quem depende de outro modelo é importado depois dele (ex.: Line antes de CrewMember, linha-base antes das derivadas).

### Locality
- Chave: `code`. Sem relações.
- `lng` está oculto no form (preenchido pelo mapa junto com `lat`): precisa poder ser importável mesmo fora do form.
- Criar/editar uma localidade dispara o recálculo da matriz de tempos (OSRM): no import, rodar uma vez ao final, não por linha — gancho genérico "depois do import".

### Line
- Chave: `code`.
- `scope` por nome; `operatorBranches` como lista de filiais (`|`), gravada com as regras do service (a operadora precisa operar o escopo).
- `parentLine` pela linha-base (código): a linha-base precisa já existir — vem em arquivo anterior.
- `metrics` e `vehicleTypes` (estruturas editadas em telas próprias) ficam fora.

### CrewMember
- Chave: o funcionário, pela matrícula.
- Listas (`blockedVehicleTypes`) e referências (regime de folga, carro preferido pelo prefixo) já suportadas.
- Novo: `notBeforeMinutes` / `notAfterMinutes` são minutos no banco — no CSV como `H:MM` (conversor novo).
- Novo: turno obrigatório na criação — não é campo do operador, gera o histórico de turno (`CrewMemberShiftService`); coluna só de import (`shift`) e o service adaptado para rodar na transação.

### VehiclePlan, HourBank, Vacation — a definir
- **VehiclePlan:** é o planejamento inteiro (blocos, viagens, deslocamentos), não um cadastro. Topbar com split button **Importar** / **Importar Globus** (fluxo existente) — falta definir o que o arquivo padrão representaria.
- **HourBank:** página única (sem lista), lançamentos e saldos por operador e mês. Import Globus existente vira **Importar Globus**; falta definir o conteúdo do CSV padrão (lançamentos manuais? saldo inicial?).
- **Vacation:** página única; o lançamento de férias é uma ação sobre vários operadores com período, não um registro simples — falta definir o formato.

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

### 6. Vehicle ✅
- Primeira referência composta (`brand` + `model`) e referência a `branch`.

### 7. Employee + Contract ✅
- Hook de contrato novo (finalizar o vigente, erro em contrato futuro, ignorar mesmo `startDate`).
- Colunas do contrato: `contractStart`, `jobTitle`, `contractType`, `salary`, `contractEnd`, `weeklyHours`, `workDaysPerWeek` — todo contrato importado nasce `ACTIVE`.
- Regras de contrato extraídas para `contract.rules.ts`, usadas pelo CRUD e pelo import (dentro da transação).
- `employee-sync` removido; a página de Funcionários usa o Importar padrão.

### 8. User + UserPermission ✅
- Hook de senha temporária, `branches` e `permissionsFrom`.
- Import de permissões e split button na lista de User.
- `password`, `branches` e `permissionsFrom` são colunas só de import (`importFields`), entregues ao service à parte.
- Usuário existente: senha, `permissionsFrom` e permissões não mudam; `branches` preenchido define as filiais, mantendo o papel das que já existiam.
- Permissões: a linha substitui as ações do recurso; recurso validado contra os mesmos da matriz de permissões, com as mesmas quatro ações.
- O split button de User sai sozinho: Permissões é filho de User com import (ver etapa 4).

### 9. Transit simples: Locality e Line ✅
- Locality: `lng` importável fora do form; gancho "depois do import" para o recálculo OSRM.
- Line: `operatorBranches` com as regras do service; `parentLine` pela linha-base já existente.

### 9b. Melhorias de Locality e Line ✅
- **Objetos simples achatados em colunas:** campo objeto marcado com `.meta({ importFlatten: true })` vira uma coluna por subcampo (texto, número, enum ou lista), nomeada `campo.subcampo`. É opcional por campo — sem a marca, objetos continuam fora (ex.: `depot` da Locality, `metrics` da Line):
  - `externalCodes.GLOBUS` (Locality e Line) — códigos de integração; um sistema novo em `EXTERNAL_SYSTEMS` gera sua coluna sozinho.
  - `vehicleTypes.allowed` (lista com `|`) e `vehicleTypes.preferred` (Line).
  - Na atualização, só os subcampos preenchidos mudam — o resto do objeto é mantido (merge); célula vazia não apaga o valor. O motor traz o valor atual junto com a busca pela chave, faz o merge na validação e entrega o objeto completo à gravação (o `importWrite` não precisa saber do achatamento).
  - Na criação, o objeto é montado com os subcampos preenchidos mais os padrões do schema (ex.: `allowed: []`, `preferred: null`).
  - `vehicleTypes.preferred` não precisa estar em `allowed` — mesma regra do form.
  - Os valores aceitos (tipos de veículo) aparecem no painel Campos e entram no teste de exemplos.
- **Referência ao próprio recurso no mesmo arquivo** (ex.: `parentLine` de uma linha-base criada no mesmo CSV):
  - Hoje as referências são resolvidas contra o banco na fase de validação, antes de qualquer gravação — por isso a linha-base nova não é encontrada.
  - Vale só quando a referência aponta para o próprio recurso e o campo comparado é a chave (simples) do import — na Line, chave `code` e `parentLine` pelo `code`. Nos demais casos, a resolução segue só contra o banco.
  - Quando não existe no banco, procurar uma linha **anterior** do arquivo com essa chave; a referência fica pendente e é ligada ao id dela na gravação (que segue a ordem do arquivo).
  - Linha-base depois da derivada: erro "a linha base X precisa vir antes no arquivo (linha N)". Linha-base que falhou ao gravar: a derivada recebe "linha base com erro (linha N)".
  - A regra de não encadear segue valendo (roda na transação e enxerga a linha-base recém-criada); a prévia mostra o resultado completo, pois também grava antes de desfazer.
- **Janelas de ciclo** (`metrics.windows`) ficam fora: são listas de faixas por tipo de dia e sentido, que não cabem em uma linha por linha de ônibus. Se necessário, um import próprio com uma linha por janela (`line;dayType;direction;from;to;minutes;intervalMinutes`).

### 10. Transit médio: CrewMember
- Conversor `H:MM` para os campos de horário.
- Coluna `shift` (só de import) e `CrewMemberShiftService` rodando na transação.

### 11. Transit a definir: VehiclePlan, HourBank, Vacation
- Definir o que o CSV padrão de cada um contém antes de implementar.

---

## Notas de implementação

- `importRef` é opcional: sem ele, a referência usa o `labelField` da relação. Relação com `dependsOn` (ex.: modelo dentro da marca) busca restrita ao registro que a coluna irmã resolveu.
- Coluna de chave anulável (ex.: `branch` do Holiday) pode ser omitida do arquivo — vale como vazia.
- Campo com `defaultValue` no `.meta()` não é obrigatório no arquivo: na criação, recebe o padrão, como no form (ex.: `vehicleType`, `fuelType` e `status` do Vehicle).
- `dependsOn` só restringe a referência quando o campo pai também é coluna do import — o `companyId` virtual do form de Vehicle é ignorado (`Branch.name` é único).
- Marcadores de padrão do form (`$today`) não valem no import: o campo fica obrigatório no arquivo (ex.: `hireDate`).
- Campos com máscara (CPF, CNPJ, CEP, telefone) aceitam só dígitos ou já formatados, e são gravados formatados como no form.
- Uploads (`widget: 'avatar'`, ex.: foto) não são importáveis.
- Campos de lista (`z.array` de enum, de relação ou de texto) viram uma coluna com valores separados por `|`.
- Coluna cuja célula já falhou na conversão não recebe também o erro de obrigatório.
- Painel **Campos**: colunas com valores fixos têm um botão que lista os valores aceitos, com rótulo e agrupados, e um clique copia o valor. Enums usam os `optionLabels` do schema; o service pode fornecer listas próprias via `importValues()` (ex.: os recursos válidos da permissão, por domínio).
- A prévia mostra todos os erros de uma vez: mesmo com linhas inválidas, as válidas executam a gravação (desfeita no fim) para revelar erros do banco e de regra de negócio.
- Chave comparada exatamente como no banco (maiúsculas importam); só as referências ignoram maiúsculas.
- `scopeField`: para não-admins, o import rejeita linhas de filiais fora do `branchIds`, com a mesma regra do CRUD do `BaseService`.

## Pontos em aberto

- Destino dos fragmentos existentes (`employee-sync` e import de `hour-bank`): substituir pelo import padrão ou manter como variante "Importar Globus" no split button. Decidir na etapa de cada resource.
> RESPOSTA:
>> employee-sync: REMOVER, manter somente o padrão definido ✅ (removido na etapa 7)
>> hour-bank: manter como Importar Globus no split button

- Regras específicas de cada modelo do Transit.
> Levantadas por modelo na seção DOMAIN Transit (etapas 9 a 11); VehiclePlan, HourBank e Vacation ainda precisam de definição.