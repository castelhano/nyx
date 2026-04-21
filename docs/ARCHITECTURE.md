# Nyx — Arquitetura do Sistema

> Documento primário de arquitetura. Leia este arquivo para obter uma visão completa do sistema antes de qualquer tarefa.
> Subpastas em `docs/` detalham camadas específicas; este arquivo é a fonte de verdade para regras, convenções e interações entre módulos.

---

## 1. Visão Geral

Nyx é um sistema web Django com frontend orientado a fragmentos HTMX. A filosofia central é **convenção sobre configuração**: views, URLs, breadcrumbs, permissões e navegação são inferidos automaticamente a partir da declaração de um `model` — configuração explícita só é necessária quando a convenção não é suficiente.

**Stack:**
- Backend: Django (CBVs genéricas + mixins customizados)
- Templates: Django Templates + Cotton (componentes declarativos)
- Frontend: HTMX (navegação sem reload) + JS vanilla modular
- CSS: Custom design system com CSS variables (nyx.css + components.css)
- Atalhos: Keywatch (lib interna)

---

## 2. Mapa de Módulos

### 2.1 Backend (`nyx/framework/`)

```
framework/
├── routing.py          — geração automática de URLPatterns por convenção
├── registry.py         — registro de navegação: hierarquia, parents, actions
├── views.py            — classes base: BaseListView, BaseCreateView, BaseUpdateView, BaseDeleteView
├── ui.py               — estruturas declarativas de UI (FormLayout, ListLayout, toolbar, columns)
├── messages.py         — mensagens padrão do sistema (CREATED, UPDATED, DELETED, FORM_ERROR)
├── apps.py             — FrameworkConfig: dispara registry._flush() no ready()
├── context_processors.py
├── mixins/
│   ├── breadcrumbs.py  — BreadcrumbMixin + BreadcrumbItem
│   └── scoping.py      — FilialScopeMixin (escopo automático por filial)
└── templatetags/
    └── nyx_ui.py       — template tags utilitários
```

### 2.2 Frontend (`nyx/static/js/`)

```
static/js/
├── app.js                  — orquestrador: Keywatch, NyxModules, ciclo de vida HTMX
├── preload.js              — executa antes do CSS/body (ex: tema)
├── libs/
│   └── keywatch.js         — gerenciador de atalhos de teclado
├── core/
│   ├── dom.js              — NyxDom: registro e ciclo de vida de componentes UI
│   ├── utils.js            — NyxUtils: funções utilitárias stateless (ex: autoPlace)
│   ├── toast.js            — NyxToast: criação e gerenciamento de toasts
│   └── response.js         — NyxResponse: processamento de intenções declaradas pelo servidor
└── components/
    ├── dropdown.js
    ├── tabs.js
    ├── sidebar.js
    └── hcard.js
```

### 2.3 Templates (`nyx/templates/`)

```
templates/
├── layout/
│   ├── base.html           — shell completo (sidebar, topbar, toast_container, scripts)
│   ├── fragment.html       — shell mínimo para respostas HTMX
│   ├── breadcrumb.html     — renderização do breadcrumb
│   ├── sidebar.html
│   └── topbar.html
├── generic/
│   ├── list.html           — template padrão de listagem
│   ├── form.html           — template padrão de criação/edição
│   └── confirm_delete.html
└── cotton/                 — componentes Cotton reutilizáveis
    ├── hcard.html
    ├── tabs.html
    ├── dropdown.html
    └── toast.html
```

### 2.4 CSS (`nyx/static/css/`)

```
static/css/
├── nyx.css         — design tokens (CSS variables), reset, utilitários, tipografia
├── layout.css      — shell de layout (sidebar, topbar, main-content)
└── components.css  — estilos de componentes UI (breadcrumb, toast, hcard, tabs, etc.)
```

---

## 3. Fluxo de uma Requisição

### Full page load
```
Browser → Django URL → View (NyxBaseMixin)
    → get_context_data()
        → BreadcrumbMixin.get_breadcrumbs()   — monta breadcrumb via registry
        → NyxBaseMixin._get_schema()           — descobre ui_schema (explícito ou registry)
    → render(base_template='layout/base.html')
        → base.html carrega scripts na ordem:
            keywatch.js → utils.js → dom.js → toast.js → response.js → components → app.js
        → DOMContentLoaded:
            NyxDom.init(document)        — inicializa componentes
            NyxResponse.scan(document)   — processa <template data-response> (Django messages)
            mountPage()                  — inicia NyxModule da página se existir
```

### Navegação HTMX (fragmento)
```
User clica link com hx-get / hx-target="#main-content"
    → Django detecta request.htmx → base_template = 'layout/fragment.html'
    → Resposta: fragmento HTML + opcionalmente <template data-response>
    → htmx:beforeSwap:
        NyxDom.destroy(#main-content)    — remove listeners externos dos componentes saindo
        keys.unbindGroup(group)          — remove atalhos do fragmento saindo
    → htmx:afterSwap:
        NyxDom.init(#main-content)       — inicializa componentes do novo fragmento
        NyxResponse.scan(#main-content)  — processa respostas declarativas
        mountPage(#main-content)         — inicia NyxModule da nova página
        keys.scanBindings(#main-content) — registra atalhos declarados via data-keybind
```

---

## 4. Subsistemas Detalhados

### 4.1 Registry de Navegação (`registry.py`)

Populado automaticamente pelo `generate_urls()` no `urls.py` de cada app. Resolvido no `FrameworkConfig.ready()`.

Para cada model registrado, o registry infere:
- `parent` — model pai pela FK (ou declarado explicitamente)
- `actions` — `NavAction[]` dos filhos diretos (usados como dropdown no breadcrumb)
- `list_url` — nome da URL de listagem (`app:modelo_list`)
- `app_label` — verbose name do app
- `ui` — classe UI descoberta em `app/ui/modelo.py`

Acesso: `get_nav(ModelClass)` → `NavEntry | None`

### 4.2 Breadcrumb (`mixins/breadcrumbs.py`)

Construído automaticamente em `BreadcrumbMixin.get_breadcrumbs()`:
1. Começa com "Inicio" (`core:index`)
2. Sobe recursivamente pelos parents via `_resolve_ancestors()`
3. Adiciona o nível atual (sem link se listagem, com link se form)
4. Appenda itens extras via `get_breadcrumb_extra()` (sobrescrito na view quando necessário)

`back_url` — injetado no contexto: URL do último item clicável do breadcrumb. Usado pelo atalho `alt+v` declarado no `breadcrumb.html`.

Customização:
- `get_breadcrumb_extra()` — adiciona níveis após o automático
- `get_breadcrumbs()` — sobrescreve tudo para casos fora do padrão

### 4.3 NyxDom — Ciclo de Vida de Componentes (`core/dom.js`)

```
NyxDom.register('nome', el => {
    // setup: bind de eventos, estado local
    return () => { /* destroy: remover listeners de document/window */ };
});
```

- `NyxDom.init(root)` — inicializa todos `[data-component]` dentro de root
- `NyxDom.destroy(root)` — chama destroyFn e remove da instâncias Map
- Componentes já inicializados são ignorados (sem double-init)
- A destroyFn **deve** remover apenas listeners em `document`/`window` — listeners no próprio elemento são coletados pelo GC

### 4.4 NyxResponse — Respostas Declarativas (`core/response.js`)

O servidor declara intenções via `<template data-response>` dentro do fragmento retornado.

```html
<template data-response="toast" data-status="success">Salvo com sucesso.</template>
<template data-response="field" data-field="email" data-status="error">E-mail inválido.</template>
```

`NyxResponse.scan(root)` encontra todos os elementos, despacha para o handler, remove o elemento.

Handlers embutidos:
- `toast` — chama `NyxToast.show(status, message, { dismiss })`
- `field` — adiciona `is-invalid`/`is-warning`/`is-valid` no input + cria `.field-feedback`

Extensível: `NyxResponse.register('tipo', handlerFn)`

### 4.5 NyxToast (`core/toast.js`)

```javascript
NyxToast.show('success', 'Mensagem')
NyxToast.show('danger',  'Erro',  { dismiss: 0 })  // 0 = não fecha automaticamente
```

- Injeta no `#toast_container` (fixo no layout, fora do ciclo HTMX)
- Auto-dismiss padrão: 4000ms
- Animação de entrada (`toast-in`) e saída (`toast-out` via `.is-removing`)
- Fechamento manual via delegação de evento no container — cobre toasts programáticos e Cotton

### 4.6 Keywatch + Atalhos de Teclado

Instância global `keys` criada em `app.js`.

Atalhos declarativos via `data-keybind` no HTML — varridos automaticamente pelo `keys.scanBindings()` após cada swap. Requerem `data-keybind-group` no container para ciclo de vida correto.

Atributos relevantes:
- `data-keybind="alt+v"` — obrigatório
- `data-keybind-desc="Descrição"` — exibida no modal de atalhos (alt+k)
- `data-keybind-icon="bi bi-*"` — ícone no modal
- `data-keybind-origin="modulo"` — informativo, indica o módulo que declarou o atalho
- `data-keybind-group="nome"` — associa ao grupo para unbind no swap

Atalhos do sistema:
| Atalho | Descrição | Origem |
|--------|-----------|--------|
| `alt+k` | Exibir todos os atalhos | app.js |
| `alt+v` | Voltar um nível no breadcrumb | nyx.breadcrumbs |
| `ctrl+s` | Salvar formulário | generic/form.html |
| `esc` | Cancelar formulário | generic/form.html |

### 4.7 NyxUtils.autoPlace (`core/utils.js`)

Utilitário para posicionamento de painéis flutuantes. Calcula o melhor placement baseado no espaço disponível no viewport e aplica `data-placement` e `data-align` no elemento âncora.

```javascript
NyxUtils.autoPlace(anchor, panel, { gap = 8 } = {})
// Retorna { placement, align }
```

Usado pelo `hcard.js`. Disponível para qualquer componente que precise de posicionamento inteligente.

---

## 5. Convenções de Nomenclatura

### Backend

| Tipo | Convenção | Exemplo |
|------|-----------|---------|
| View de listagem | `ModeloListView` | `EmpresaListView` |
| View de criação | `ModeloCreateView` | `EmpresaCreateView` |
| View de edição | `ModeloUpdateView` | `EmpresaUpdateView` |
| View de exclusão | `ModeloDeleteView` | `EmpresaDeleteView` |
| View extra | `ModeloContextView` | `EmpresaDashboardView` |
| URL de listagem | `app:modelo_list` | `pessoal:funcionario_list` |
| URL de criação | `app:modelo_create` | `pessoal:funcionario_create` |
| URL de edição | `app:modelo_update` | `pessoal:funcionario_update` |
| Classe UI | `ModeloUI` em `app/ui/modelo.py` | `EmpresaUI` |

### Frontend JS

| Tipo | Convenção | Exemplo |
|------|-----------|---------|
| Módulo core | `NyxNome` (singleton IIFE) | `NyxToast`, `NyxResponse` |
| Módulo global utilitário | `NyxUtils.nomeMetodo` | `NyxUtils.autoPlace` |
| Componente registrado | `NyxDom.register('nome-kebab', ...)` | `'hover-card'`, `'tabs'` |
| Módulo de página | `NyxModules["nome-da-pagina"]` | `NyxModules["viagem-form"]` |
| data-attr de componente | `data-component="nome-kebab"` | `data-component="hover-card"` |
| data-attr interno | `data-[componente]-[papel]` | `data-hcard-trigger`, `data-hcard-panel` |

### CSS

| Tipo | Convenção | Exemplo |
|------|-----------|---------|
| Componente | `.nome` | `.hcard`, `.toast`, `.tabs` |
| Elemento filho | `.nome__elemento` | `.hcard__panel`, `.toast__body` |
| Modificador | `.nome--variante` | `.hcard--balloon`, `.toast--success` |
| Estado | `.estado` | `.open`, `.active`, `.is-invalid` |
| Variável privada | `--_nome` | `--_hc-gap` |

### Templates Cotton

| Tipo | Convenção | Exemplo |
|------|-----------|---------|
| Arquivo | `nome.html` em `cotton/` | `cotton/hcard.html` |
| Uso | `<c-nome prop="valor">` | `<c-hcard name="João">` |
| Slot nomeado | `<c-slot name="nome">` | `<c-slot name="trigger">` |
| Defaults | `<c-vars prop="default" />` no topo | `<c-vars mode="hover" />` |

---

## 6. Regras Obrigatórias

### Componentes JS (NyxDom)

1. **Sempre retornar destroyFn** se houver listeners em `document` ou `window`
2. **Cancelar timers na destroyFn** (`clearTimeout`, `clearInterval`)
3. **Não gerenciar próprio ciclo de vida** — apenas registrar via `NyxDom.register`
4. **Listeners no próprio elemento** não precisam ser removidos — GC cuida quando o elemento sai do DOM
5. **Componentes com atalhos** devem ter `data-keybind-group` no container para unbind correto no swap

### Templates de Fragmento HTMX

1. **Todo fragmento com componentes** deve ter `data-keybind-group` no container raiz
2. **Listagens** usam `data-keybind-group="{{ ui.title|slugify }}-list"` (já em `generic/list.html`)
3. **Forms** usam `data-keybind-group="{{ ui.title|slugify }}-form"` (já em `generic/form.html`)
4. **Respostas do servidor** devem usar `<template data-response>`, nunca `<script>` inline

### Views

1. **Sempre herdar** de `BaseListView`, `BaseCreateView`, `BaseUpdateView` ou `BaseDeleteView`
2. **Permissões** são inferidas automaticamente — declarar `permission_required` só para exceções
3. **Mensagens de sucesso** usam `nyx.framework.messages` como base
4. **success_url** é inferido por convenção (`app:modelo_list`) — declarar só se diferente

### CSS

1. **Usar variáveis de `nyx.css`** — nunca valores hardcoded para cores, espaçamento, tipografia
2. **Variáveis privadas `--_nome`** somente quando há variação interna real no componente
3. **Estados de hover/focus** sempre via CSS, nunca JS
4. **Painéis flutuantes** (absolute/fixed) devem ter o container pai com `overflow-x: clip` ou usar `NyxUtils.autoPlace` para não causar scroll horizontal

---

## 7. Interações entre Módulos

```
generate_urls()  ──→  registry._queue()  ──→  FrameworkConfig.ready()
                                                    │
                                                registry._flush()
                                                    │
                              ┌─────────────────────┼──────────────────────┐
                              ▼                     ▼                      ▼
                        BreadcrumbMixin        sidebar.html           NyxBaseMixin
                    (get_breadcrumbs)        (nav items)           (_get_schema → ui)

NyxApp (app.js)
    │
    ├── DOMContentLoaded ──→ NyxDom.init(document)
    │                   ──→ NyxResponse.scan(document)   ──→ NyxToast.show()
    │                   ──→ mountPage()                  ──→ NyxModules[name].init()
    │
    ├── htmx:beforeSwap ──→ NyxDom.destroy(target)
    │                   ──→ keys.unbindGroup(group)
    │
    └── htmx:afterSwap  ──→ NyxDom.init(target)
                        ──→ NyxResponse.scan(target)     ──→ NyxToast.show()
                        ──→ mountPage(target)             ──→ NyxModules[name].init()
                        ──→ keys.scanBindings(target)
```

---

## 8. Extensibilidade

### Adicionar um componente UI
1. `components/nome.js` — `NyxDom.register('nome', ...)`
2. `components.css` — bloco `.nome { }` com documentação de estrutura
3. `cotton/nome.html` — com `<c-vars>` para defaults
4. `base.html` — adicionar `<script src="...components/nome.js">`
5. `docs/components/nome.md` — documentar API e exemplos

### Adicionar um handler de NyxResponse
```javascript
NyxResponse.register('redirect', el => {
    window.location.href = el.dataset.url;
});
```

### Adicionar um módulo de página
```javascript
// js/modules/meu-modulo.js
NyxModules["meu-modulo"] = {
    init(container) {
        const group = container.dataset.keybindGroup; // lê do elemento, não hardcoda

        keys.bind('alt+n', () => novaAcao(), { group, desc: 'Nova ação' });
    },
    destroy() {
        keys.unbindGroup(container.dataset.keybindGroup);
    },
};
```
```html
<!-- No fragmento -->
<div data-page-module="meu-modulo" data-keybind-group="meu-modulo">
```

> **Regra:** sempre ler o grupo via `container.dataset.keybindGroup` — nunca hardcodar o nome.
> O container já carrega o valor autoritativo; o módulo fica desacoplado da convenção de nomenclatura do template.

---

## 9. Arquivos de Referência Rápida

| Necessidade | Arquivo |
|-------------|---------|
| Adicionar view CRUD | `nyx/framework/views.py` |
| Registrar URLs de um app | `app/urls.py` via `generate_urls()` |
| Entender hierarquia de navegação | `nyx/framework/registry.py` |
| Customizar breadcrumb | `nyx/framework/mixins/breadcrumbs.py` |
| Estilos base e tokens | `nyx/static/css/nyx.css` |
| Estilos de componentes | `nyx/static/css/components.css` |
| Ciclo de vida JS | `nyx/static/js/core/dom.js` |
| Atalhos de teclado | `nyx/static/js/libs/keywatch.js` |
| Mensagens padrão | `nyx/framework/messages.py` |
