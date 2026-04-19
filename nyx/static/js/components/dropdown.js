NyxDom.register('dropdown', el => {
    const toggle = NyxDom.find('[data-dropdown-toggle]', el);
    const menu   = NyxDom.find('[data-dropdown-menu]', el);

    const onToggle = e => {
        e.stopPropagation();
        menu.classList.toggle('open');
    };

    const onOutside = e => {
        if (!el.contains(e.target)) menu.classList.remove('open');
    };

    toggle?.addEventListener('click', onToggle);
    document.addEventListener('click', onOutside);

    return () => {
        toggle?.removeEventListener('click', onToggle);
        document.removeEventListener('click', onOutside);
    };
});
