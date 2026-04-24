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

// ── Composed hint — badge de confirmação para atalhos compostos em inputs ─────
NyxDom.register('kw-composed-hint', () => {});

let _composedHintPortal = null;

function _composedHint(active) {
    if (active) {
        if (_composedHintPortal) return;
        const input = document.activeElement;
        if (!input || !['INPUT', 'SELECT', 'TEXTAREA'].includes(input.nodeName)) return;

        const rect  = input.getBoundingClientRect();
        const badge = document.createElement('div');
        badge.setAttribute('data-component', 'kw-composed-hint');
        badge.className = 'kw-hint';
        badge.innerHTML = `<i class="bi bi-keyboard"></i><span>${keys.composedTrigger.toUpperCase()}</span>`;
        badge.style.top    = `${rect.top    + 3}px`;
        badge.style.right  = `${window.innerWidth - rect.right + 3}px`;
        badge.style.height = `${rect.height - 6}px`;

        const portal = document.createElement('div');
        portal.appendChild(badge);
        document.body.appendChild(portal);
        NyxDom.init(portal);
        _composedHintPortal = portal;
    } else {
        if (!_composedHintPortal) return;
        NyxDom.destroy(_composedHintPortal);
        _composedHintPortal.remove();
        _composedHintPortal = null;
    }
}

// ── Instância global do Keywatch ──────────────────────────────────────────────
const keys = new Keywatch({
    shortcutMaplist:     "alt+k",
    shortcutMaplistDesc: "Exibir atalhos disponíveis",
    composedListener:    _composedHint,
});
keys.scanBindings(document); // realiza primeiro scan na pagina

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
        }
    });

    // Restauração do histórico HTMX (browser back/forward):
    // o body inteiro é substituído, então todos os componentes e bindings
    // precisam ser reinicializados a partir dos novos elementos do DOM.
    document.addEventListener("htmx:historyRestore", () => {
        NyxDom.reset();
        keys.reinit();
        keys.scanBindings(document);
        NyxResponse.scan(document);
        mountPage(document);
    });

    return { mountPage };
})();
