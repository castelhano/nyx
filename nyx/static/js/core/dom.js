/**
 * NyxDom — Utilitários de DOM e ciclo de vida de componentes.
 *
 * É a única entidade responsável por registrar, inicializar e destruir
 * componentes de UI. Nenhum componente deve gerenciar seu próprio ciclo
 * de vida fora daqui.
 *
 * REGISTRO DE COMPONENTE:
 *   NyxDom.register('nome', el => {
 *       // setup: bind de eventos, estado local, etc.
 *       return () => { /* cleanup: remover listeners de document/window *\/ };
 *   });
 *
 *   A função init recebe o elemento raiz do componente.
 *   Deve retornar uma função de destroy se houver listeners externos
 *   (document, window) que precisam ser removidos. Listeners no próprio
 *   elemento são limpos automaticamente pelo GC quando o elemento sai do DOM.
 *
 * HTML:
 *   <div data-component="nome">...</div>
 *
 * CICLO DE VIDA (orquestrado pelo NyxApp em app.js):
 *   htmx:beforeSwap → NyxDom.destroy(target)  remove listeners externos
 *   htmx:afterSwap  → NyxDom.init(target)     inicializa novos componentes
 *   DOMContentLoaded → NyxDom.init()           carga inicial da página
 *
 * ATENÇÃO — remoção manual de elementos:
 *   Se um elemento com data-component for removido do DOM fora do fluxo
 *   HTMX (ex: via JS direto), chame NyxDom.destroy(el) antes de remover
 *   para evitar listeners órfãos em document/window.
 */
const NyxDom = {

    // ── Queries com escopo ────────────────────────────────────────────────────
    find(selector, root = document) {
        return root.querySelector(selector);
    },
    findAll(selector, root = document) {
        return [...root.querySelectorAll(selector)];
    },

    // ── Registro de componentes ───────────────────────────────────────────────
    _definitions: {},   // { name: initFn }
    _instances:   new Map(),  // Map<Element, destroyFn | null>

    register(name, initFn) {
        this._definitions[name] = initFn;
    },

    // ── Ciclo de vida ─────────────────────────────────────────────────────────

    init(root = document) {
        this.findAll('[data-component]', root).forEach(el => {
            if (this._instances.has(el)) return;
            const initFn = this._definitions[el.dataset.component];
            if (!initFn) return;
            const destroyFn = initFn(el);
            this._instances.set(el, destroyFn ?? null);
        });
    },

    destroy(root = document) {
        this.findAll('[data-component]', root).forEach(el => {
            this._instances.get(el)?.();
            this._instances.delete(el);
        });
    },
};
