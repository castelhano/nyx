/**
 * Keywatch — Gerenciador de atalhos de teclado
 *
 * @version  7.0
 * @since    05/08/2024
 * @release  2026 [v7: remoção de i18n/gettext, suporte a data-keybind, modal com classes externas (nyx.css),
 *                     watchHtmx(), scanBindings(), ciclo de vida automático por group]
 * @author   Rafael Gustavo Alves
 *
 * ---------------------------------------------------------------------------
 * USO BÁSICO (API programática — igual às versões anteriores)
 * ---------------------------------------------------------------------------
 * @example
 *   const keys = new Keywatch();
 *   keys.bind('ctrl+s', () => salvar());
 *   keys.bind('alt+e;ctrl+e', () => editar(), { desc: 'Editar registro', context: 'default' });
 *   keys.bind('g+i', (ev, shortcut) => ir(), { keyup: true, keydown: false });
 *
 * ---------------------------------------------------------------------------
 * USO COM DATA-ATTRS (declarativo no HTML)
 * ---------------------------------------------------------------------------
 * Atributos disponíveis (todos opcionais exceto data-keybind):
 *
 *   data-keybind="alt+s"              OBRIGATÓRIO — define o atalho
 *   data-keybind-context="modal"      contexto (default: 'default')
 *   data-keybind-desc="Salvar"        descrição para o modal de atalhos
 *   data-keybind-icon="bi bi-save"    classes do ícone para o modal de atalhos
 *   data-keybind-origin="nyx.foo"    módulo/origem que registrou o atalho (informativo)
 *   data-keybind-group="form-viagem"  grupo para controle de ciclo de vida
 *   data-keybind-keyup="true"         dispara no keyup (default: false)
 *   data-keybind-keydown="false"      desativa keydown (default: true)
 *   data-keybind-prevent="false"      desativa preventDefault (default: true)
 *   data-keybind-capture="true"       usa useCapture (default: false)
 *   data-keybind-display="false"      oculta do modal de atalhos (default: true)
 *   data-keybind-order="0"            prioridade de exibição no modal 0–10, crescente (default: 5)
 *   data-keybind-action="click"       ação: "click" | "focus" | "submit"
 *
 * Comportamento padrão de data-keybind-action (quando omitido):
 *   - <button> ou <a>  → dispara .click()
 *   - qualquer outro   → dispara .focus()
 *
 * data-keybind-action="submit" → submete o form pai do elemento
 *
 * Para ações complexas, use bind() programático normalmente.
 *
 * @example
 *   <!-- Auto-click em button -->
 *   <button data-keybind="alt+s" data-keybind-desc="Salvar">Salvar</button>
 *
 *   <!-- Foco em input -->
 *   <input data-keybind="alt+b" data-keybind-desc="Ir para busca">
 *
 *   <!-- Contexto específico (ex: modal aberto) -->
 *   <button data-keybind="esc" data-keybind-context="modal" data-keybind-action="click">Fechar</button>
 *
 * ---------------------------------------------------------------------------
 * CICLO DE VIDA COM HTMX (integração automática)
 * ---------------------------------------------------------------------------
 * Chame watchHtmx() UMA vez após instanciar.
 * Todo fragmento HTMX deve ter um container com data-keybind-group.
 * Antes do swap, a lib faz unbindGroup do group saindo.
 * Após o swap, a lib chama scanBindings no novo fragmento.
 *
 * @example
 *   const keys = new Keywatch();
 *   keys.watchHtmx(); // registra listeners do HTMX uma vez
 *
 *   <!-- No fragmento HTMX -->
 *   <div data-keybind-group="viagem-form">
 *     <button data-keybind="alt+s">Salvar</button>
 *     <button data-keybind="alt+x" data-keybind-desc="Cancelar">Cancelar</button>
 *   </div>
 *
 * ---------------------------------------------------------------------------
 * VARREDURA MANUAL (sem HTMX ou para casos específicos)
 * ---------------------------------------------------------------------------
 * @example
 *   keys.scanBindings();                    // varre document inteiro
 *   keys.scanBindings(document.querySelector('#meu-modal')); // varre só o modal
 *
 * ---------------------------------------------------------------------------
 * CONTEXTOS — separação de responsabilidade
 * ---------------------------------------------------------------------------
 * Context controla QUANDO um atalho dispara (estado do app).
 * Group controla O CICLO DE VIDA (quando limpar).
 * São independentes — um atalho pode ter ambos.
 *
 * @example
 *   keys.setContext('modal');   // ativa contexto modal (empilha o anterior)
 *   keys.setContext();          // volta ao contexto anterior (desempilha)
 *
 * ---------------------------------------------------------------------------
 * DESABILITAR ATALHOS EM ELEMENTOS ESPECÍFICOS
 * ---------------------------------------------------------------------------
 * @example
 *   <textarea data-keywatch="escape"></textarea>  <!-- desativa tudo neste elemento -->
 *   <input data-keywatch="none">                  <!-- Enter não tabula nem submete -->
 *   <input data-keywatch="default">               <!-- Enter executa submit padrão -->
 */

class Keywatch {
    constructor(options = {}) {
        // ── Estruturas internas ──────────────────────────────────────────────
        this.handlers     = {};   // { keydown: { context: { scope: [handler,...] } } }
        this.pressed      = [];   // teclas atualmente pressionadas
        this.contexts     = { all: 'Atalhos Globais', default: 'Atalhos Base' };
        this.contextPool  = [];   // pilha de contextos para setContext/restore
        this.composedMatch = [];  // estado intermediário de atalhos "composed"
        this.locked       = false;
        this.context      = 'default';

        // ── Defaults de cada handler ─────────────────────────────────────────
        this.handlerDefaults = {
            context:        'default',
            desc:           '',
            icon:           null,
            element:        document,
            origin:         undefined,
            keydown:        true,
            keyup:          false,
            group:          null,
            display:        true,
            order:          5,
            preventDefault: true,
            useCapture:     false,
            composed:       false,
        };

        // ── Defaults da instância ────────────────────────────────────────────
        const instanceDefaults = {
            splitKey:        '+',
            separator:       ';',
            tabOnEnter:      true,
            composedTrigger: ';',
            composedListener: () => {},
            reserve:         {},
            // Atalho para abrir o modal de mapa de atalhos (null = desabilita)
            shortcutMaplist:     'alt+k',
            shortcutMaplistDesc: 'Exibir atalhos disponíveis',
            shortcutMaplistIcon: 'bi bi-keyboard',
            shortcutMaplistOnlyContextActive: true,
            // Mapa de classes CSS do modal — cada chave pode ser sobrescrita ao instanciar
            // Exemplo: new Keywatch({ classes: { table: 'minha-tabela table-sm' } })
            classes: {},
        };

        for (const k in instanceDefaults) {
            this[k] = options.hasOwnProperty(k) ? options[k] : instanceDefaults[k];
        }
        this.classes = { ...this._defaultClasses(), ...(options.classes || {}) };

        // ── Mapa de aliases de teclas ─────────────────────────────────────────
        this.modifier = {
            'ctrl':    'control',
            '[space]': ' ',
            'esc':     'escape',
            '↑':       'arrowup',
            '↓':       'arrowdown',
            '→':       'arrowright',
            '←':       'arrowleft',
        };

        // ── Listeners base ───────────────────────────────────────────────────
        document.addEventListener('keydown', (ev) => this._eventHandler(ev), false);
        document.addEventListener('keyup',   (ev) => this._eventHandler(ev), false);
        document.addEventListener('change',  ()   => { this.pressed = []; },  false);
        // Evita teclas "travadas" ao receber foco (ex: Alt+Tab)
        window.addEventListener('focus', () => { this.pressed = []; }, false);

        // ── Modal de atalhos ─────────────────────────────────────────────────
        this._injectStyles();
        this._createModal();

        if (this.shortcutMaplist) {
            this.bind(this.shortcutMaplist, () => this.showKeymap(), {
                origin:  'Keywatch',
                context: 'all',
                icon:    this.shortcutMaplistIcon,
                desc:    this.shortcutMaplistDesc,
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLASSES & ESTILOS
    // ═══════════════════════════════════════════════════════════════════════════

    _defaultClasses() {
        return {
            overlay:    'modal-backdrop',
            box:        'bg-body border rounded-lg shadow-lg d-flex flex-column overflow-hidden',
            header:     'd-flex align-center gap-2 px-4 py-2 border-b flex-shrink-0',
            closeBtn:   'btn btn-ghost btn-icon btn-sm',
            searchWrap: 'flex-shrink-0 px-4 py-2',
            search:     'form-control form-control-sm w-full',
            tableWrap:  'flex-1 overflow-y px-4 pb-3',
            table:      'table table-striped table-hover table-sm',
        };
    }

    _injectStyles() {
        if (document.getElementById('keywatch-styles')) return;
        const style = document.createElement('style');
        style.id = 'keywatch-styles';
        style.textContent = `
            /* ── Keywatch: estado & animação ─────────────────────────────────── */
            #keywatch-modal {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 99999;
                align-items: flex-start;
                justify-content: center;
                padding-top: 60px;
            }
            #keywatch-modal.kw-open    { display: flex; animation: nyx-fade-in .18s ease; }
            #keywatch-modal.kw-closing { animation: nyx-fade-out .15s ease forwards; }
            #keywatch-modal-box        { animation: nyx-slide-down-in .2s cubic-bezier(.22,.68,0,1.2); }
            #keywatch-modal.kw-closing #keywatch-modal-box { animation: nyx-slide-down-out .15s ease forwards; }

            /* ── Contexto: hint sutil à direita do search ────────────────────── */
            #keywatch-context-badge {
                position: absolute;
                right: 8px; top: 50%;
                transform: translateY(-50%);
                pointer-events: none;
                opacity: .5;
                font-size: 10px;
                letter-spacing: .04em;
                text-transform: uppercase;
                white-space: nowrap;
            }

            /* ── Badge de tecla ──────────────────────────────────────────────── */
            .kw-keys {
                display: flex; align-items: center; justify-content: flex-end;
                gap: 3px; flex-wrap: nowrap;
            }
            kbd.kw-key {
                display: inline-flex; align-items: center; justify-content: center;
                font-family: var(--nyx-typeface-mono);
                font-size: 10px;
                color: var(--nyx-text-primary);
                background: var(--nyx-bg-tertiary);
                border: 1px solid var(--nyx-border-secondary);
                border-bottom-width: 2px;
                border-radius: 4px;
                padding: 2px 6px;
                min-width: 2.2em;
                white-space: nowrap;
            }
            .kw-key-sep { color: var(--nyx-text-tertiary); font-size: 10px; user-select: none; }
            .kw-or      { color: var(--nyx-text-tertiary); font-size: 11px; margin: 0 6px; user-select: none; }
            .kw-empty   { text-align: center; color: var(--nyx-text-tertiary); padding: 32px 0 !important; font-style: italic; }

            /* ── Thead sticky ────────────────────────────────────────────────── */
            #keywatch-table thead th { position: sticky; top: 0; background: var(--nyx-bg-body); z-index: 1; }

            /* ── Painel de detalhes flutuante ────────────────────────────────── */
            #keywatch-meta-panel { animation: nyx-fade-in .12s ease; }
            .kw-meta-inner { display: grid; grid-template-columns: auto 1fr; gap: 3px 14px; font-family: var(--nyx-typeface-mono); font-size: 11px; align-items: baseline; }
            .kw-meta-item  { display: contents; }
            .kw-meta-label { color: var(--nyx-text-tertiary); font-weight: 600; letter-spacing: .04em; }
            .kw-meta-value { color: var(--nyx-text-secondary); }

            /* ── Botão de detalhe ────────────────────────────────────────────── */
            .kw-detail-btn { background: none; border: none; cursor: pointer; color: var(--nyx-text-tertiary); font-size: 14px; padding: 2px 6px; border-radius: var(--nyx-radius-sm); transition: color .15s, background .15s; line-height: 1; }
            .kw-detail-btn:hover   { color: var(--nyx-text-primary); background: var(--nyx-bg-tertiary); }
            .kw-detail-btn.kw-open { color: var(--nyx-text-brand); }

            /* ── Scrollbar ───────────────────────────────────────────────────── */
            #keywatch-table-wrap::-webkit-scrollbar       { width: 6px; }
            #keywatch-table-wrap::-webkit-scrollbar-track { background: transparent; }
            #keywatch-table-wrap::-webkit-scrollbar-thumb { background: var(--nyx-border-primary); border-radius: 3px; }

            /* ─ Composed hint ─ */
            .kw-hint {
                position: fixed;
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 0 8px;
                background: var(--nyx-bg-brand);
                color: var(--nyx-text-brand);
                border: 1px solid var(--nyx-border-brand);
                border-radius: var(--nyx-radius-sm);
                font-family: var(--nyx-typeface-mono);
                font-size: 11px;
                font-weight: 600;
                letter-spacing: .04em;
                white-space: nowrap;
                pointer-events: none;
                z-index: 9998;
                box-shadow: var(--nyx-shadow-sm);
                animation: kw-hint-in .18s cubic-bezier(.22,.68,0,1.2) both;
            }
            .kw-hint i { font-size: 12px; opacity: .8; }

            @keyframes kw-hint-in {
                from { opacity: 0; transform: translateX(10px); }
                to   { opacity: 1; transform: translateX(0);    }
            }
        `;
        document.head.appendChild(style);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MODAL
    // ═══════════════════════════════════════════════════════════════════════════

    _createModal() {
        const cls = this.classes;

        // Overlay
        this._modal = document.createElement('div');
        this._modal.id = 'keywatch-modal';
        this._modal.className = cls.overlay;
        this._modal.setAttribute('role', 'dialog');
        this._modal.setAttribute('aria-modal', 'true');
        this._modal.setAttribute('aria-label', 'Mapa de atalhos');

        // Box
        const box = document.createElement('div');
        box.id = 'keywatch-modal-box';
        box.className = cls.box;
        box.style.cssText = 'width: min(860px, 92vw); max-height: 80vh;';

        // Header (compacto)
        const header = document.createElement('div');
        header.id = 'keywatch-modal-header';
        header.className = cls.header;
        header.innerHTML = `
            <i class="${this.shortcutMaplistIcon} text-secondary" style="font-size:18px;line-height:1;flex-shrink:0"></i>
            <span class="text-sm font-semibold flex-1">Atalhos de teclado</span>
            <button id="keywatch-close-btn" class="${cls.closeBtn}" title="Fechar (Esc)">✕</button>
        `;
        header.querySelector('#keywatch-close-btn').addEventListener('click', () => this.hideKeymap());

        // Search
        const searchWrap = document.createElement('div');
        searchWrap.id = 'keywatch-search-wrap';
        searchWrap.className = cls.searchWrap;

        const searchInner = document.createElement('div');
        searchInner.className = 'position-relative';

        this._searchInput = document.createElement('input');
        this._searchInput.id = 'keywatch-search';
        this._searchInput.className = cls.search;
        this._searchInput.type = 'search';
        this._searchInput.placeholder = 'Pesquisar atalho ou descrição...';
        this._searchInput.setAttribute('data-keywatch', 'escape');
        this._searchInput.style.paddingRight = '6rem';
        this._searchInput.addEventListener('input', () => this._filterTable());

        this._contextBadge = document.createElement('span');
        this._contextBadge.id = 'keywatch-context-badge';
        this._contextBadge.className = 'font-mono';
        this._contextBadge.textContent = this.context;

        searchInner.appendChild(this._searchInput);
        searchInner.appendChild(this._contextBadge);
        searchWrap.appendChild(searchInner);

        // Table
        const tableWrap = document.createElement('div');
        tableWrap.id = 'keywatch-table-wrap';
        tableWrap.className = cls.tableWrap;

        this._table = document.createElement('table');
        this._table.id = 'keywatch-table';
        this._table.className = cls.table;
        this._table.innerHTML = `
            <thead>
                <tr>
                    <th>Descrição</th>
                    <th style="width:180px;text-align:right">Atalho</th>
                    <th style="width:32px"></th>
                </tr>
            </thead>
        `;
        this._tbody = document.createElement('tbody');
        this._table.appendChild(this._tbody);
        tableWrap.appendChild(this._table);

        box.appendChild(header);
        box.appendChild(searchWrap);
        box.appendChild(tableWrap);
        this._modal.appendChild(box);
        document.body.appendChild(this._modal);

        // Fecha ao clicar no overlay
        this._modal.addEventListener('click', (e) => {
            if (e.target === this._modal) this.hideKeymap();
        });

        // Fecha com Escape (quando modal está aberto, locked impede outros atalhos)
        document.addEventListener('keydown', (e) => {
            if (this.locked && e.key === 'Escape') {
                e.preventDefault();
                this.hideKeymap();
            }
        });

        // Painel de detalhes flutuante (portal no body para evitar clipping do overflow)
        this._metaPanel = document.createElement('div');
        this._metaPanel.id = 'keywatch-meta-panel';
        this._metaPanel.className = 'bg-body border rounded-md shadow-lg';
        this._metaPanel.style.cssText = 'position:fixed;display:none;z-index:100000;padding:10px 14px;min-width:180px;';
        document.body.appendChild(this._metaPanel);
        this._activeMetaBtn = null;

        document.addEventListener('click', () => { if (this.locked) this._closeMetaPanel(); });
        tableWrap.addEventListener('scroll', () => this._closeMetaPanel());
    }

    showKeymap() {
        this._refreshTable();
        this._modal.classList.remove('kw-closing');
        this._modal.classList.add('kw-open');
        this.locked = true;
        this.pressed = [];
        // Foca no input de busca após animação
        setTimeout(() => this._searchInput?.focus(), 80);
    }

    hideKeymap() {
        this._closeMetaPanel();
        this._modal.classList.add('kw-closing');
        setTimeout(() => {
            this._modal.classList.remove('kw-open', 'kw-closing');
            this._searchInput.value = '';
            this._filterTable();
            this.locked = false;
        }, 150);
    }

    _closeMetaPanel() {
        if (!this._metaPanel || this._metaPanel.style.display === 'none') return;
        this._metaPanel.style.display = 'none';
        if (this._activeMetaBtn) {
            this._activeMetaBtn.classList.remove('kw-open');
            this._activeMetaBtn = null;
        }
    }

    _showMetaPanel(btn, html) {
        if (this._activeMetaBtn === btn) { this._closeMetaPanel(); return; }
        if (this._activeMetaBtn) this._activeMetaBtn.classList.remove('kw-open');
        this._activeMetaBtn = btn;
        btn.classList.add('kw-open');

        const panel = this._metaPanel;
        panel.innerHTML = `<div class="kw-meta-inner">${html}</div>`;
        panel.style.visibility = 'hidden';
        panel.style.display = 'block';

        const rect = btn.getBoundingClientRect();
        const ph   = panel.offsetHeight;
        const pw   = panel.offsetWidth;
        const top  = rect.top - ph - 8 > 8 ? rect.top - ph - 8 : rect.bottom + 8;
        const left = Math.max(8, rect.right - pw);
        panel.style.top  = top  + 'px';
        panel.style.left = left + 'px';
        panel.style.visibility = '';
    }

    _refreshTable() {
        this._closeMetaPanel();
        if (this._contextBadge) this._contextBadge.textContent = this.context;

        const visible = [];
        for (const type in this.handlers) {
            for (const ctx in this.handlers[type]) {
                if (this.shortcutMaplistOnlyContextActive && ctx !== this.context && ctx !== 'all') continue;
                for (const scope in this.handlers[type][ctx]) {
                    for (const handler of this.handlers[type][ctx][scope]) {
                        if (handler.display) visible.push(handler);
                    }
                }
            }
        }

        visible.sort((a, b) => (a.order ?? 5) - (b.order ?? 5));

        const fragment = document.createDocumentFragment();
        for (const handler of visible) {
            const tr = document.createElement('tr');

            const desc = `${handler.icon ? `<i class="${handler.icon}" style="margin-right:6px"></i>` : ''}${handler.desc || '<span style="opacity:.4">—</span>'}`;

            const metaHtml = [
                { label: 'context', value: handler.context },
                { label: 'event',   value: [handler.keydown && 'keydown', handler.keyup && 'keyup'].filter(Boolean).join('+') },
                handler.origin ? { label: 'origin', value: handler.origin } : null,
                handler.group  ? { label: 'group',  value: handler.group  } : null,
                { label: 'order',    value: handler.order ?? 5 },
                { label: 'capture',  value: handler.useCapture    ? 'sim' : 'nao' },
                { label: 'composed', value: handler.composed      ? 'sim' : 'nao' },
                { label: 'prevent',  value: handler.preventDefault ? 'sim' : 'nao' },
            ].filter(Boolean).map(i =>
                `<span class="kw-meta-item"><span class="kw-meta-label">${i.label}</span><span class="kw-meta-value">${i.value}</span></span>`
            ).join('');

            tr.innerHTML = `
                <td>${desc}</td>
                <td style="text-align:right"><div class="kw-keys">${this._humanize(handler.schema)}</div></td>
                <td style="text-align:center;padding:0 4px">
                    <button class="kw-detail-btn" title="Detalhes de rastreio"><i class="bi bi-info-circle"></i></button>
                </td>
            `;

            tr.querySelector('.kw-detail-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this._showMetaPanel(e.currentTarget, metaHtml);
            });

            fragment.appendChild(tr);
        }

        this._tbody.innerHTML = '';
        if (!visible.length) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td class="kw-empty" colspan="3">Nenhum atalho registrado para este contexto</td>`;
            this._tbody.appendChild(tr);
        } else {
            this._tbody.appendChild(fragment);
        }
    }

    _filterTable() {
        requestAnimationFrame(() => {
            const term = this._searchInput.value.toLowerCase().replace(/\s+/g, '');
            let visible = 0;

            this._closeMetaPanel();

            this._tbody.querySelectorAll('tr:not(.kw-empty)').forEach(tr => {
                const text = tr.textContent.toLowerCase().replace(/\s+/g, '');
                const show = text.includes(term);
                tr.style.display = show ? '' : 'none';
                if (show) visible++;
            });

            // Mensagem de lista vazia
            const empty = this._tbody.querySelector('.kw-empty');
            if (empty) empty.style.display = visible === 0 ? '' : 'none';
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VARREDURA DE DATA-ATTRS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Varre o container em busca de elementos com data-keybind e registra os atalhos.
     * Se o container (ou um filho direto) tiver data-keybind-group, faz unbindGroup
     * desse group antes de registrar — evita duplicatas em re-renders do HTMX.
     * Se não informado desc define display: false por padrão
     *
     * @param {HTMLElement} [root=document] - Onde buscar. Omita para varrer o document inteiro.
     *
     * @example
     *   keys.scanBindings();                          // varre tudo
     *   keys.scanBindings(document.querySelector('#modal')); // varre só o modal
     */
    scanBindings(root = document) {
        // Lê o group do container (se root for o container com data-keybind-group)
        const containerGroup = root instanceof HTMLElement
            ? (root.dataset.keybindGroup || root.querySelector('[data-keybind-group]')?.dataset.keybindGroup)
            : null;

        if (containerGroup) this.unbindGroup(containerGroup);

        const elements = root.querySelectorAll
            ? root.querySelectorAll('[data-keybind]')
            : document.querySelectorAll('[data-keybind]');

        elements.forEach(el => {
            const shortcut = el.dataset.keybind;
            if (!shortcut) return;

            // Herda group do container pai com data-keybind-group, ou do próprio attr
            const group = el.dataset.keybindGroup
                || el.closest('[data-keybind-group]')?.dataset.keybindGroup
                || null;

            const options = {
                context:        el.dataset.keybindContext        || this.handlerDefaults.context,
                desc:           el.dataset.keybindDesc           || el.title || el.textContent?.trim().slice(0, 60) || '',
                icon:           el.dataset.keybindIcon           || null,
                origin:         el.dataset.keybindOrigin         || undefined,
                group:          group,
                keydown:        el.dataset.keybindKeydown        !== 'false',
                keyup:          el.dataset.keybindKeyup          === 'true',
                preventDefault: el.dataset.keybindPrevent        !== 'false',
                useCapture:     el.dataset.keybindCapture        === 'true',
                display:        el.dataset.keybindDisplay === 'true' || !!(el.dataset.keybindDesc || el.title),
                order:          el.dataset.keybindOrder !== undefined ? Number(el.dataset.keybindOrder) : this.handlerDefaults.order,
                element:        document,
            };

            // ── Resolução do action ──────────────────────────────────────────
            const actionAttr = el.dataset.keybindAction;
            let method;

            if (actionAttr) {
                // Ação declarativa: "click" | "focus" | "submit"
                switch (actionAttr.toLowerCase()) {
                    case 'click':
                        method = () => el.click();
                        break;
                    case 'focus':
                        method = () => el.focus();
                        break;
                    case 'submit':
                        method = () => el.closest('form')?.requestSubmit();
                        break;
                    default:
                        // Tenta como nome de função global (uso avançado; prefira bind() programático)
                        method = typeof window[actionAttr] === 'function'
                            ? () => window[actionAttr](el)
                            : () => el.click();
                }
            } else {
                // Comportamento automático baseado no tipo do elemento
                const tag = el.tagName.toLowerCase();
                method = (tag === 'button' || tag === 'a')
                    ? () => el.click()
                    : () => el.focus();
            }

            this.bind(shortcut, method, options);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTEGRAÇÃO HTMX
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Registra listeners do HTMX para gerenciar o ciclo de vida dos atalhos
     * automaticamente. Chame UMA vez após instanciar.
     *
     * Comportamento:
     *   htmx:beforeSwap → faz unbindGroup do group do fragmento que vai sair
     *   htmx:afterSwap  → chama scanBindings no fragmento que chegou
     *
     * IMPORTANTE: O container do fragmento DEVE ter data-keybind-group.
     * Atalhos sem group não são afetados pela integração HTMX.
     *
     * @example
     *   const keys = new Keywatch();
     *   keys.watchHtmx();
     */
    watchHtmx() {
        document.addEventListener('htmx:beforeSwap', (e) => {
            const target = e.detail?.target;
            if (!target) return;
            const group = target.dataset?.keybindGroup
                || target.querySelector?.('[data-keybind-group]')?.dataset.keybindGroup;
            if (group) this.unbindGroup(group);
        });

        document.addEventListener('htmx:afterSwap', (e) => {
            const target = e.detail?.target;
            if (target) this.scanBindings(target);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CORE — PROCESSAMENTO DE EVENTOS
    // ═══════════════════════════════════════════════════════════════════════════

    _eventHandler(ev) {
        // Elemento com data-keywatch="escape" desativa análise completa
        if (this.locked || ev.target?.dataset?.keywatch?.toLowerCase() === 'escape') return;

        if (ev.type === 'keydown') {
            const key = this._normalize(ev.key);
            if (ev.key && !this.pressed.includes(key)) this.pressed.push(key);

            const scope = this._buildScope();
            const found = this._eventsMatch(scope, ev);

            // Limpa composedMatch se nenhum atalho found e não é o trigger
            if (!found && ev.key !== this.composedTrigger && this.composedMatch.length > 0) {
                this.composedMatch = [];
                this.composedListener(false, scope);
            }

            // tabOnEnter — avança foco ao pressionar Enter em inputs/selects
            if (!found && this.tabOnEnter && ev.key === 'Enter' && ev.target.form &&
                (ev.target.nodeName === 'INPUT' || ev.target.nodeName === 'SELECT')) {
                const kw = ev.target.dataset?.keywatch;
                if (kw === 'default') return;
                ev.preventDefault();
                if (kw === 'none') return;

                const form  = ev.target.form;
                const index = Array.prototype.indexOf.call(form.elements, ev.target);
                for (let i = index + 1; i < form.elements.length; i++) {
                    if (this._isFieldFocusable(form.elements[i])) {
                        form.elements[i].focus();
                        break;
                    }
                }
            }

        } else if (ev.type === 'keyup') {
            const scope = this._buildScope();
            this._eventsMatch(scope, ev);
            this._removeKeyFromPressed(ev);
            if (ev.key.toLowerCase() === 'escape') this.pressed = [];
        }
    }

    _buildScope() {
        if (this.pressed.length === 1) return this.pressed[0];
        return [...this.pressed.slice(0, -1).sort(), this.pressed[this.pressed.length - 1]].join();
    }

    _eventsMatch(scope, ev) {
        let preventDefault = false;
        let count = 0;

        // Resolve composedMatch pendente
        let resolvedScope = scope;
        if (scope === this.composedTrigger && this.composedMatch.length > 0) {
            resolvedScope = this.composedMatch[0];
        }

        const list = [
            ...(this.handlers?.[ev.type]?.[this.context]?.[resolvedScope] || []),
            ...(this.handlers?.[ev.type]?.['all']?.[resolvedScope] || []),
        ];

        list.forEach(handler => {
            if (handler.element !== document && handler.element !== ev.target) return;

            const isComposed = this.composedMatch.length === 0 || !this.composedMatch[1].includes(ev.type);

            if (handler.composed && isComposed &&
                ['input', 'textarea', 'select'].includes(ev.target.nodeName.toLowerCase())) {
                // Aguarda composedTrigger antes de executar
                if (this.composedMatch.length === 0) {
                    this.composedMatch = [resolvedScope, [ev.type]];
                } else if (!this.composedMatch[1].includes(ev.type)) {
                    this.composedMatch[1].push(ev.type);
                }
                this.composedListener(true, resolvedScope);
                count++;
                return;
            }

            // Limpa composedMatch consumido
            if (this.composedMatch.length > 0 && this.composedMatch[1].includes(ev.type)) {
                this.composedMatch = this.composedMatch[1].length === 1
                    ? []
                    : [this.composedMatch[0], this.composedMatch[1].filter(t => t !== ev.type)];
                if (this.composedMatch.length === 0) this.composedListener(false, resolvedScope);
            }

            handler.method(ev, handler);
            count++;
            preventDefault = preventDefault || handler.preventDefault;
        });

        if (preventDefault) ev.preventDefault();
        return count;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BIND / UNBIND
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Registra um atalho de teclado.
     *
     * @param {string}   scope   - Atalho(s), separados por ';'. Ex: 'ctrl+s' ou 'ctrl+s;alt+s'
     * @param {Function} method  - Callback. Recebe (ev, handler).
     * @param {Object}   options - Opções (ver handlerDefaults).
     *
     * @example
     *   keys.bind('ctrl+s', () => salvar(), { desc: 'Salvar', group: 'form' });
     *   keys.bind('alt+e;ctrl+e', editar, { context: 'default', icon: '✏️' });
     */
    bind(scope, method, options = {}) {
        const keys = this._getMultipleKeys(scope);
        const defaultMods = ['control', 'shift', 'alt', 'meta'];

        keys.forEach((entry, index) => {
            const handler = { ...this.handlerDefaults };
            for (const k in handler) {
                if (options.hasOwnProperty(k)) handler[k] = options[k];
            }

            [handler.mods, handler.key] = this._getScope(entry);
            handler.scope  = [...handler.mods, handler.key].flat().join();
            handler.schema = scope;
            handler.method = method;

            // Atalhos com múltiplos scopes: apenas o primeiro aparece no modal
            if (index > 0) handler.display = false;

            // composed = usa modificador não convencional (ex: 'g', 'c' em vez de ctrl/alt/meta)
            handler.composed = handler.mods.some(m => !defaultMods.includes((m || '').toLowerCase()));

            this._spreadHandler(handler);
        });
    }

    /**
     * Remove um atalho registrado.
     * Se omitir options.context, remove de todos os contextos.
     * Se omitir options.type, remove de keydown e keyup.
     *
     * @example
     *   keys.unbind('ctrl+s');
     *   keys.unbind('ctrl+s', { context: 'modal', type: 'keydown' });
     */
    unbind(scope, options = {}) {
        if (!options.type) {
            ['keydown', 'keyup'].forEach(type => this.unbind(scope, { ...options, type }));
            return;
        }
        if (!options.context) {
            for (const ctx in this.contexts) this.unbind(scope, { ...options, context: ctx });
            return;
        }
        if (!this.contexts.hasOwnProperty(options.context)) return;

        const key     = this._getScope(scope).flat().join();
        const matches = this.handlers?.[options.type]?.[options.context]?.[key] || [];
        if (!matches.length) return false;

        const residual = options.element
            ? matches.filter(h => h.element !== options.element)
            : [];

        if (residual.length > 0) {
            this.handlers[options.type][options.context][key] = residual;
        } else {
            delete this.handlers[options.type][options.context][key];
            if (!Object.keys(this.handlers[options.type][options.context]).length)
                delete this.handlers[options.type][options.context];
            if (!Object.keys(this.handlers[options.type]).length)
                delete this.handlers[options.type];
        }
        return true;
    }

    /** Remove todos os atalhos de um contexto. */
    unbindContext(context) {
        if (!this.contexts.hasOwnProperty(context)) return;
        for (const type in this.handlers) {
            delete this.handlers[type][context];
            if (!Object.keys(this.handlers[type]).length) delete this.handlers[type];
        }
    }

    /**
     * Remove todos os atalhos de um group.
     * Usado pelo ciclo de vida do HTMX e pelo destroy() de módulos de página.
     *
     * @example
     *   keys.unbindGroup('viagem-form');
     */
    unbindGroup(group) {
        if (!group) return;
        for (const type in this.handlers) {
            for (const ctx in this.handlers[type]) {
                for (const scope in this.handlers[type][ctx]) {
                    const filtered = this.handlers[type][ctx][scope].filter(h => h.group !== group);
                    if (filtered.length) {
                        this.handlers[type][ctx][scope] = filtered;
                    } else {
                        delete this.handlers[type][ctx][scope];
                    }
                }
                if (!Object.keys(this.handlers[type][ctx]).length) delete this.handlers[type][ctx];
            }
            if (!Object.keys(this.handlers[type]).length) delete this.handlers[type];
        }
    }

    /** Remove todos os atalhos. */
    unbindAll() { this.handlers = {}; }

    /** Reseta handlers para o estado pós-construtor (mantém apenas o atalho do modal). */
    reinit() {
        this.handlers = {};
        if (this.shortcutMaplist) {
            this.bind(this.shortcutMaplist, () => this.showKeymap(), {
                origin:  'Keywatch',
                context: 'all',
                icon:    this.shortcutMaplistIcon,
                desc:    this.shortcutMaplistDesc,
            });
        }
    }

    /** Sobrescreve um atalho existente (unbind + bind). */
    overwrite(scope, method, options = {}) {
        // unbind recebe apenas opções de localização (context, type, element)
        const { context, type, element } = options;
        this.unbind(scope, { context, type, element });
        this.bind(scope, method, options);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONTEXTOS
    // ═══════════════════════════════════════════════════════════════════════════

    getContext() { return this.context; }

    addContext(context, desc = '') {
        if (context && !this.contexts.hasOwnProperty(context)) this.contexts[context] = desc;
    }

    /**
     * Ativa um contexto (empilha o atual para restauração posterior).
     * Omita o argumento para restaurar o contexto anterior.
     *
     * @example
     *   keys.setContext('modal');   // ativa modal, empilha 'default'
     *   keys.setContext();          // restaura 'default'
     */
    setContext(context, desc = '') {
        if (!context) {
            this.context = this.contextPool.pop() || 'default';
            if (this._contextBadge) this._contextBadge.textContent = this.context;
            return;
        }
        if (!this.contexts.hasOwnProperty(context)) this.addContext(context, desc);
        else if (desc) this.contexts[context] = desc;
        this.contextPool.push(this.context);
        this.context = context;
        if (this._contextBadge) this._contextBadge.textContent = this.context;
    }

    updateContext(context, desc) {
        if (this.contexts.hasOwnProperty(context)) this.contexts[context] = desc;
    }

    /**
     * Move um atalho para outro contexto.
     *
     * @example
     *   keys.changeContext('ctrl+s', 'modal');
     */
    changeContext(scope, newContext, options = {}) {
        const handler = this.getShortcut(scope, options);
        if (!handler) return;

        const adjScope = this._getScope(scope).flat().join();
        const oldCtx   = handler.context;

        for (const type of ['keydown', 'keyup']) {
            if (!handler[type]) continue;
            const oldList = this.handlers[type]?.[oldCtx]?.[adjScope];
            if (oldList) {
                const i = oldList.indexOf(handler);
                if (i !== -1) oldList.splice(i, 1);
                if (!oldList.length) {
                    delete this.handlers[type][oldCtx][adjScope];
                    if (!Object.keys(this.handlers[type][oldCtx]).length)
                        delete this.handlers[type][oldCtx];
                }
            }
            const newList = ((this.handlers[type][newContext] ||= {})[adjScope] ||= []);
            handler.context = newContext;
            newList.push(handler);
            newList.sort((a, b) => b.useCapture - a.useCapture);
        }
        handler.context = newContext;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITÁRIOS PÚBLICOS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Retorna o handler registrado para o scope, ou false se não existir.
     *
     * @example
     *   const h = keys.getShortcut('ctrl+s');
     */
    getShortcut(scope, options = {}) {
        const { keydown = true, keyup = false, context = 'default' } = options;
        const adj  = this._getScope(scope).flat().join();
        const type = keydown ? 'keydown' : keyup ? 'keyup' : false;
        const list = this.handlers?.[type]?.[context]?.[adj];
        return list?.length ? list[0] : false;
    }

    /**
     * Verifica se um scope está disponível (não registrado).
     * Útil para detectar conflitos antes de registrar.
     *
     * @example
     *   if (keys.avail('ctrl+s')) keys.bind('ctrl+s', salvar);
     */
    avail(scope, options = {}) {
        const type = options.type || 'keydown';
        if (this.reserve.hasOwnProperty(scope)) console.log(this.reserve[scope]);
        // Usa _getScope para normalizar (ex: 'ctrl+s' → 'control,s'), igual ao bind
        const adj = this._getScope(scope).flat().join();
        if (options.context) {
            if (!this.contexts.hasOwnProperty(options.context)) return true;
            return !this.handlers?.[type]?.[options.context]?.[adj];
        }
        for (const ctx in this.contexts) {
            if (this.handlers?.[type]?.[ctx]?.[adj]) return false;
        }
        return true;
    }

    /**
     * Executa um atalho programaticamente, como se o usuário tivesse pressionado.
     *
     * @example
     *   keys.run('ctrl+s');
     */
    run(scope, options = {}) {
        const { type = 'keydown', context = 'default', element = document } = options;
        const adj = this._getScope(scope).flat().join();
        this.handlers?.[type]?.[context]?.[adj]?.forEach(h => {
            if (h.element === element) h.method();
        });
    }

    /** Retorna lista de atalhos duplicados (mesmo evento + contexto + elemento). */
    duplicated() {
        const seen = [];
        const dupes = [];
        for (const type in this.handlers) {
            for (const ctx in this.handlers[type]) {
                for (const scope in this.handlers[type][ctx]) {
                    for (const h of this.handlers[type][ctx][scope]) {
                        const key = JSON.stringify({
                            event:   type,
                            context: ctx,
                            scope,
                            element: h.element === document ? 'document' : h.element?.id,
                        });
                        if (seen.includes(key)) dupes.push(JSON.parse(key));
                        else seen.push(key);
                    }
                }
            }
        }
        return dupes;
    }

    getReserve() { return this.reserve; }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTERNOS
    // ═══════════════════════════════════════════════════════════════════════════

    _spreadHandler(handler) {
        const sorter = (a, b) => b.useCapture - a.useCapture;
        for (const type of ['keydown', 'keyup']) {
            if (!handler[type]) continue;
            const h = this.handlers;
            if (!h[type])                          h[type] = {};
            if (!h[type][handler.context])         h[type][handler.context] = {};
            if (!h[type][handler.context][handler.scope]) h[type][handler.context][handler.scope] = [];
            h[type][handler.context][handler.scope].push(handler);
            h[type][handler.context][handler.scope].sort(sorter);
        }
    }

    _normalize(str) {
        return str.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[çÇ]/g, 'c')
            .toLowerCase();
    }

    _isFieldFocusable(el) {
        return el && !el.disabled && !el.readOnly
            && el.offsetParent !== null && el.tabIndex >= 0;
    }

    _removeKeyFromPressed(ev) {
        let key   = this._normalize(ev.key);
        let index = this.pressed.indexOf(key);

        if (index === -1) {
            const modMap = {
                AltLeft: 'alt', AltRight: 'alt',
                ControlLeft: 'control', ControlRight: 'control',
                ShiftLeft: 'shift', ShiftRight: 'shift',
                MetaLeft: 'meta', MetaRight: 'meta',
            };
            key   = modMap[ev.code] || key;
            index = this.pressed.indexOf(key);
        }
        if (index > -1) this.pressed.splice(index, 1);
    }

    /** Retorna [mods[], mainKey] para um scope simples. Ex: 'ctrl+s' → [['control'], 's'] */
    _getScope(scope) {
        let keys  = scope.split(this.splitKey);
        let index = keys.lastIndexOf('');
        while (index >= 0) {
            keys[index - 1] += this.splitKey;
            keys.splice(index, 1);
            index = keys.lastIndexOf('');
        }
        const mapped  = keys.map(k => this.modifier[k] || k.toLowerCase());
        const mainKey = mapped.pop();
        return [mapped.sort(), mainKey];
    }

    /** Separa múltiplos scopes: 'ctrl+s;alt+s' → ['ctrl+s', 'alt+s'] */
    _getMultipleKeys(scope) {
        let keys  = scope.split(this.separator);
        let index = keys.lastIndexOf('');
        while (index >= 0) {
            keys[index - 1] += ';';
            keys.splice(index, 1);
            index = keys.lastIndexOf('');
        }
        return keys;
    }

    /** Formata scope para exibição no modal. Ex: 'control,s' → <badge>CTRL</badge>+<badge>S</badge> */
    _humanize(schema) {
        return this._getMultipleKeys(schema).map(entry => {
            const parts = this._getScope(entry);
            const keys  = [...parts[0], parts[1]];
            return keys.map(k => {
                // Inverte alias para exibição curta (control → ctrl)
                for (const alias in this.modifier) {
                    if (this.modifier[alias] === k) k = alias;
                }
                return `<kbd class="kw-key">${k.toUpperCase()}</kbd>`;
            }).join('<span class="kw-key-sep">+</span>');
        }).join('<span class="kw-or">ou</span>');
    }
}
