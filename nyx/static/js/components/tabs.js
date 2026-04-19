NyxDom.register('tabs', el => {
    const tabs   = NyxDom.findAll('[data-tab]', el);
    const panels = NyxDom.findAll('[data-panel]', el);

    const activate = key => {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === key));
        panels.forEach(p => p.classList.toggle('active', p.dataset.panel === key));
    };

    const onClick = e => activate(e.currentTarget.dataset.tab);

    tabs.forEach(t => t.addEventListener('click', onClick));

    return () => tabs.forEach(t => t.removeEventListener('click', onClick));
});
