### TODO
```
# Lista processos em execucao
ss -tlnp | grep -E ':(3000|3001)\b'

# Mata processo
fuser -k 3001/tcp 3000/tcp
```


---
# Outros
## Alto
## Medio
[ ] Edições em vehicle-plan (pending), adicionar history rollback (voltar ações)
[ ] Adição de ponto / waypoint no cadastro da rota, permitir remover um ponto ainda nao persistido (pending), e alt+l deve descartar pendencias
[ ] Tipar parâmetro db/tx (PrismaService | Prisma.TransactionClient) nos services/utils que hoje usam `any` pra aceitar os dois — eslint tem no-unsafe-* desligado em apps/api por causa disso (eslint.config.mjs)

## Baixo
[-] Converter exports para GTFS format (plano em docs/proposal/plan_gtfs_export_v1.md)
[ ] Unificar metodo de geração de CSV entre listpages (fragmentado em cada pagina hoje)



1. "Tag Input" / "Multi-value Input" com parsing de paste
É o padrão mais comum. Um campo de input onde:

Ao colar texto (Ctrl+V), o componente detecta separadores (quebra de linha, tab, vírgula, ponto-e-vírgula)
Cada valor separado vira um "chip"/"tag" individual, editável e removível
Exemplos reais: campos de "destinatários" em ferramentas de email marketing (Mailchimp, SendGrid), campos de "adicionar múltiplos emails", inputs de tags no GitHub/Jira

2. "Bulk Paste" / "Bulk Add" — específico para colar do Excel
Mais comum em SaaS de planilha-like ou CRMs:

Um textarea ou modal dedicado "Colar lista"
O usuário cola o range de células (que vem separado por \t entre colunas e \n entre linhas)
O componente faz parse automaticamente em uma tabela/preview antes de confirmar
Exemplos: Airtable (colar em bulk cria linhas), Notion databases, Google Sheets → apps de import, Trello Power-Ups de bulk create de cards

3. Data grid components com "paste-to-rows"
Bibliotecas como AG Grid, Handsontable, react-data-grid já implementam nativamente: você seleciona células no Excel, cola dentro do grid, e ele distribui automaticamente em linhas/colunas — tratando cada célula como um registro.

4. "Smart paste detection"
Um padrão de UX (não uma lib específica) onde o campo detecta se o conteúdo colado tem múltiplas linhas/tabs e pergunta "Detectamos N itens, deseja adicioná-los individualmente?" — usado em ferramentas de importação em massa (ex: adicionar múltiplos usuários de uma vez).

Resumindo: a abordagem mais próxima do que você descreveu (colar range do Excel → virar registros) é o bulk paste com parsing de delimitadores (\t e \n), seja como tag input simples ou como grid completo. Não há um nome único universal, mas "paste to list", "bulk paste parser" ou "CSV/TSV paste input" são os termos que mais aparecem em discussões e bibliotecas sobre isso.