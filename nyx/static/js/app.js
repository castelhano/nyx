/**
 * app.js — Orquestrador principal do frontend Nyx.
 *
 * Responsabilidades:
 *   1. Instanciar o Keywatch e expor globalmente como `keys`
 *   2. Integrar Keywatch com HTMX (ciclo de vida automático de atalhos)
 *   3. Orquestrar módulos de página (init / destroy)
 *
 * Módulos de página:
 *   Cada fragmento HTMX pode ter um container com data-page-module="nome".
 *   O módulo correspondente em NyxModules será iniciado após o swap
 *   e destruído antes do próximo.
 *
 * @example — registrar um módulo de página:
 *   NyxModules["viagem-form"] = {
 *       init(container) {
 *           keys.bind("alt+s", () => container.querySelector("form").requestSubmit(), {
 *               group: "viagem-form",
 *               order: 3,
 *               desc:  "Salvar viagem",
 *           });
 *       },
 *       destroy() {
 *           keys.unbindGroup("viagem-form");
 *       },
 *   };
 */

// ── Mapa de nome interno do modificador → sufixo do atributo de hint ─────────
const _kwModAttr = { control: 'ctrl', alt: 'alt', shift: 'shift', meta: 'meta' };

// Garante existência do wrapper de badges dentro do container
function _kwBadgesWrapper(container) {
    let w = container.querySelector(':scope > .kw-input-badges');
    if (!w) {
        w = document.createElement('div');
        w.className = 'kw-input-badges';
        container.appendChild(w);
    }
    return w;
}

// ── Composed hint — badge de confirmação para atalhos compostos em inputs ─────
function _composedHint({ state, target }) {
    const container = target?.closest('[data-kw-field-container]');
    if (!container) return;

    if (state === 1) {
        const wrapper = _kwBadgesWrapper(container);
        if (wrapper.querySelector('.kw-hint')) return;
        const badge = document.createElement('div');
        badge.className = 'kw-hint';
        badge.innerHTML = `<i class="bi bi-keyboard"></i><span>${keys.composedTrigger.toUpperCase()}</span>`;
        wrapper.appendChild(badge);
    } else {
        container.querySelector('.kw-input-badges .kw-hint')?.remove();
    }
}

// ── Input hints — adiciona spans de hint nos containers dos inputs ────────────
function _nyxInputHints(root = document) {
    const els = root.querySelectorAll('[data-keybind]');
    els.forEach(el => {
        const shortcut = el.dataset.keybind;
        if (!shortcut) return;

        // Somente elementos focus-target
        const tag    = el.tagName.toLowerCase();
        const action = el.dataset.keybindAction?.toLowerCase();
        if (action === 'click' || action === 'submit') return;
        if (!action && (tag === 'button' || tag === 'a')) return;

        // Primeiro scope; somente 1 modificador padrão (alt/ctrl/shift) + 1 tecla
        const first = shortcut.split(';')[0].trim().toLowerCase();
        const parts = first.split('+').filter(Boolean);
        const key   = parts[parts.length - 1];
        const mods  = parts.slice(0, -1);
        if (mods.length !== 1) return;

        const mod = mods[0] === 'control' ? 'ctrl' : mods[0];
        if (!['ctrl', 'alt', 'shift'].includes(mod)) return;

        const container = el.closest('[data-kw-field-container]');
        if (!container) return;
        if (container.querySelector(`[data-keywatch-${mod}hint]`)) return; // evita duplicatas

        const wrapper = _kwBadgesWrapper(container);
        const span    = document.createElement('span');
        span.className = 'kw-field-hint';
        span.setAttribute(`data-keywatch-${mod}hint`, '');
        span.textContent = key.toUpperCase();
        span.hidden = true;
        wrapper.appendChild(span);
    });
}

// ── Modifier hint — mostra/oculta hints ao pressionar/soltar o modificador ────
function _setupModifierHint({ state, modifier }) {
    const attr = _kwModAttr[modifier];
    if (!attr) return;
    document.querySelectorAll(`[data-keywatch-${attr}hint]`).forEach(el => {
        el.hidden = state === 0;
    });
}

// ── Instância global do Keywatch ──────────────────────────────────────────────
const keys = new Keywatch({
    shortcutMaplist:     "alt+k",
    shortcutMaplistDesc: "Exibir atalhos disponíveis",
    composedListener:    _composedHint,
    checkInputHint:      true,
    checkInputModifier:  ['alt', 'ctrl', 'shift'],
    checkInputHintDelay: 500,
    setupModifierHint:   _setupModifierHint,
});
keys.scanBindings(document); // realiza primeiro scan na pagina
_nyxInputHints(document);

// ── Integração HTMX ───────────────────────────────────────────────────────────
keys.watchHtmx();
htmx.config.allowScriptTags = true;

// ── Atalhos globais ───────────────────────────────────────────────────────────
keys.bind('alt+l', () => htmx.ajax('GET', window.location.href, { target: '#main-content', swap: 'innerHTML' }), {
    context: 'all',
    desc:    'Recarregar página',
    icon:    'bi bi-arrow-clockwise',
    origin:  'nyx.app',
    order:   2,
});

// ── Ciclo de vida dos módulos de página ───────────────────────────────────────
const NyxApp = (() => {
    let _current = null;

    function mountPage(root = document) {
        const pageEl = root.querySelector("[data-page-module]");
        if (!pageEl) return;

        const name = pageEl.dataset.pageModule;
        const mod  = NyxModules[name];

        if (_current?.destroy) _current.destroy();

        if (mod) {
            _current = mod;
            mod.init(pageEl);
        }
    }

    // Monta ao carregar a página inteira
    document.addEventListener("DOMContentLoaded", () => {
        NyxUtils.initTheme();
        NyxDom.init();
        NyxResponse.scan(document);
        mountPage();
    });

    // ── Auto-group: injeta o group do fragmento em keys.bind() sem group ─────────
    // Scripts inline no fragmento executam DURANTE o swap (entre beforeSwap e
    // afterSwap). Nessa janela, keys.bind é substituído por uma versão que
    // enfileira chamadas sem group. Após o swap, o group é lido do container
    // [data-keybind-group] e injetado retroativamente antes de registrar.
    let _pendingBinds = [];
    let _origBind     = null;

    function _patchBind() {
        _origBind = keys.bind.bind(keys);
        keys.bind = (shortcut, handler, opts = {}) => {
            if (!opts.group) {
                _pendingBinds.push({ shortcut, handler, opts });
                return;
            }
            return _origBind(shortcut, handler, opts);
        };
    }

    function _flushBinds(target) {
        if (_origBind) keys.bind = _origBind;
        _origBind = null;
        if (!_pendingBinds.length) return;
        const group = target?.querySelector('[data-keybind-group]')?.dataset.keybindGroup;
        for (const { shortcut, handler, opts } of _pendingBinds) {
            keys.bind(shortcut, handler, group ? { ...opts, group } : opts);
        }
        _pendingBinds = [];
    }

    // Destrói componentes antes do swap (remove listeners de document, etc.)
    document.addEventListener("htmx:beforeSwap", e => {
        if (e.detail?.target) NyxDom.destroy(e.detail.target);
        _patchBind();
    });

    // Remonta após cada swap do HTMX
    document.addEventListener("htmx:afterSwap", (e) => {
        _flushBinds(e.detail?.target);
        if (e.detail?.target) {
            NyxDom.init(e.detail.target);
            NyxResponse.scan(e.detail.target);
            mountPage(e.detail.target);
            _nyxInputHints(e.detail.target);
        }
    });

    // Restauração do histórico HTMX (browser back/forward):
    // o body inteiro é substituído, então todos os componentes e bindings
    // precisam ser reinicializados a partir dos novos elementos do DOM.
    document.addEventListener("htmx:historyRestore", () => {
        NyxDom.reset();
        keys.reinit();
        keys.scanBindings(document);
        _nyxInputHints(document);
        NyxResponse.scan(document);
        mountPage(document);
    });

    return { mountPage };
})();
