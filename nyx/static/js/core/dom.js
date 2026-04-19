const NyxDom = {

    // ── Queries com escopo ────────────────────────────────────────────────────
    find(selector, root = document) {
        return root.querySelector(selector);
    },
    findAll(selector, root = document) {
        return [...root.querySelectorAll(selector)];
    },

    // ── Registro de componentes ───────────────────────────────────────────────
    // { name: initFn }  — initFn(el) deve retornar destroyFn ou nada
    _definitions: {},

    // Map<Element, destroyFn> — rastreia instâncias ativas
    _instances: new Map(),

    register(name, initFn) {
        this._definitions[name] = initFn;
    },

    // ── Ciclo de vida ─────────────────────────────────────────────────────────

    // Inicializa todos os [data-component] dentro de root
    init(root = document) {
        this.findAll('[data-component]', root).forEach(el => {
            if (this._instances.has(el)) return;        // já inicializado
            const initFn = this._definitions[el.dataset.component];
            if (!initFn) return;
            const destroyFn = initFn(el);
            this._instances.set(el, destroyFn ?? null);
        });
    },

    // Destrói todos os [data-component] dentro de root e limpa o Map
    destroy(root = document) {
        this.findAll('[data-component]', root).forEach(el => {
            this._instances.get(el)?.();
            this._instances.delete(el);
        });
    },
};
