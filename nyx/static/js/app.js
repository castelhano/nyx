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

// ── Módulos de página ─────────────────────────────────────────────────────────
const NyxModules = {};

// ── Instância global do Keywatch ──────────────────────────────────────────────
const keys = new Keywatch({
    shortcutMaplist:     "alt+k",
    shortcutMaplistDesc: "Exibir atalhos disponíveis",
});
keys.scanBindings(document); // realiza primeiro scan na pagina

// ── Integração HTMX ───────────────────────────────────────────────────────────
keys.watchHtmx();
htmx.config.allowScriptTags = true;

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

    // Destrói componentes antes do swap (remove listeners de document, etc.)
    document.addEventListener("htmx:beforeSwap", e => {
        if (e.detail?.target) NyxDom.destroy(e.detail.target);
    });

    // Remonta após cada swap do HTMX
    document.addEventListener("htmx:afterSwap", (e) => {
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
