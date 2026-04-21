NyxDom.register('hover-card', el => {
    const trigger  = NyxDom.find('[data-hcard-trigger]', el);
    const panel    = NyxDom.find('[data-hcard-panel]', el);
    const mode     = el.dataset.trigger  || 'hover';
    const dismiss  = el.dataset.dismiss  || 'auto';
    const openDelay = parseInt(el.dataset.delay ?? 0, 10);

    let openTimer  = null;
    let closeTimer = null;

    const open = () => {
        if (el.dataset.disabled === 'true') return;
        clearTimeout(closeTimer);
        clearTimeout(openTimer);
        if (openDelay > 0) {
            openTimer = setTimeout(() => panel.classList.add('open'), openDelay);
        } else {
            panel.classList.add('open');
        }
    };

    const close = () => {
        clearTimeout(openTimer);
        clearTimeout(closeTimer);
        panel.classList.remove('open');
    };

    const delayClose = () => { closeTimer = setTimeout(close, 120); };

    if (mode === 'hover' || mode === 'both') {
        el.addEventListener('mouseenter', open);
        el.addEventListener('mouseleave', delayClose);
        panel.addEventListener('mouseenter', () => clearTimeout(closeTimer));
        panel.addEventListener('mouseleave', delayClose);
    }

    const onToggle = e => {
        if (el.dataset.disabled === 'true') return;
        e.stopPropagation();
        panel.classList.toggle('open');
    };

    const onOutside = e => {
        if (!el.contains(e.target)) close();
    };

    if (mode === 'click' || mode === 'both') {
        trigger?.addEventListener('click', onToggle);
        document.addEventListener('click', onOutside);
    }

    if (dismiss === 'manual') {
        NyxDom.find('[data-hcard-close]', panel)?.addEventListener('click', close);
    }

    return () => document.removeEventListener('click', onOutside);
});
