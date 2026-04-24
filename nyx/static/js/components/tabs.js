/**
 * Tabs — Navegação por abas.
 *
 * HTML mínimo:
 *   <div data-component="tabs">
 *     <button data-tab="a" class="tabs__tab active">Aba A</button>
 *     <button data-tab="b" class="tabs__tab">Aba B</button>
 *     <div data-panel="a" class="tabs__panel active">...</div>
 *     <div data-panel="b" class="tabs__panel">...</div>
 *   </div>
 *
 * Cotton:
 *   <c-tabs variant="tabs--pills">
 *     <c-slot name="tabs">
 *       <button class="tabs__tab active" data-tab="a">Aba A</button>
 *       <button class="tabs__tab"        data-tab="b">Aba B</button>
 *     </c-slot>
 *     <div class="tabs__panel active" data-panel="a">...</div>
 *     <div class="tabs__panel"        data-panel="b">...</div>
 *   </c-tabs>
 *
 * Foco automático ao entrar na aba:
 *   Adicione data-autofocus no elemento que deve receber foco dentro do panel.
 *   <input data-autofocus ...>
 *
 * Navegação por teclado (data-navigate="true", default):
 *   ctrl+arrowleft  — aba anterior
 *   ctrl+arrowright — próxima aba
 *   Requer data-keybind-group no container ancestral para limpeza correta no swap HTMX.
 *   Desative com data-navigate="false" ou <c-tabs navigate="false">.
 */
NyxDom.register('tabs', el => {
    const tabs   = NyxDom.findAll('[data-tab]', el);
    const panels = NyxDom.findAll('[data-panel]', el);

    const focusPanel = panel => {
        const target = panel.querySelector('[data-autofocus]')
            ?? panel.querySelector('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])');
        target?.focus();
    };

    const activate = key => {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === key));
        panels.forEach(p => p.classList.toggle('active', p.dataset.panel === key));
        const active = panels.find(p => p.dataset.panel === key);
        if (active) focusPanel(active);
    };

    const onClick = e => activate(e.currentTarget.dataset.tab);
    tabs.forEach(t => t.addEventListener('click', onClick));

    // ── Atalhos de navegação ─────────────────────────────────────────────────
    const navigate = el.dataset.navigate !== 'false' && tabs.length > 1;

    if (navigate && typeof keys !== 'undefined') {
        const group = el.closest('[data-keybind-group]')?.dataset.keybindGroup || null;
        if (group) {
            const navStep = delta => {
                const current = tabs.findIndex(t => t.classList.contains('active'));
                const next = (current + delta + tabs.length) % tabs.length;
                activate(tabs[next].dataset.tab);
            };

            keys.bind('ctrl+arrowleft', () => navStep(-1), {
                group,
                desc:   'Aba anterior',
                icon:   'bi bi-arrow-left',
                origin: 'nyx.tabs',
            });
            keys.bind('ctrl+arrowright', () => navStep(1), {
                group,
                desc:   'Próxima aba',
                icon:   'bi bi-arrow-right',
                origin: 'nyx.tabs',
            });
        }
    }

    return () => tabs.forEach(t => t.removeEventListener('click', onClick));
    // Limpeza keywatch via unbindGroup (htmx:beforeSwap em app.js) — sem necessidade de unbind manual aqui
});
