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
 */
NyxDom.register('tabs', el => {
    const tabs   = NyxDom.findAll('[data-tab]', el);
    const panels = NyxDom.findAll('[data-panel]', el);

    const activate = key => {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === key));
        panels.forEach(p => p.classList.toggle('active', p.dataset.panel === key));
        panels.find(p => p.dataset.panel === key)?.querySelector('[data-autofocus]')?.focus();
    };

    const onClick = e => activate(e.currentTarget.dataset.tab);

    tabs.forEach(t => t.addEventListener('click', onClick));

    return () => tabs.forEach(t => t.removeEventListener('click', onClick));
});
