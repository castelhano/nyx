NyxDom.register('sidebar', el => {
    const BREAKPOINT = 768;

    // ── Active state ─────────────────────────────────────────────
    const updateActive = () => {
        const path = window.location.pathname;
        el.querySelectorAll('[data-sidebar-link]').forEach(link => {
            const href = link.getAttribute('href');
            const active = !!href && href !== '/' && path.startsWith(href);
            link.classList.toggle('active', active);
        });
        // Auto-open group that contains the active link
        el.querySelectorAll('[data-sidebar-group]').forEach(group => {
            if (group.querySelector('[data-sidebar-link].active')) {
                group.classList.add('open');
            }
        });
    };

    // ── Collapsible groups (accordion) ───────────────────────────
    const onGroupToggle = e => {
        const group = e.currentTarget.closest('[data-sidebar-group]');
        if (!group) return;
        const opening = !group.classList.contains('open');
        el.querySelectorAll('[data-sidebar-group].open').forEach(g => {
            if (g !== group) g.classList.remove('open');
        });
        group.classList.toggle('open', opening);
    };

    const groupToggles = el.querySelectorAll('[data-sidebar-group-toggle]');
    groupToggles.forEach(btn => btn.addEventListener('click', onGroupToggle));

    // ── Sidebar collapse toggle ───────────────────────────────────
    const toggleCollapsed = () => el.classList.toggle('sidebar--collapsed');

    const toggleBtns = document.querySelectorAll('[data-sidebar-toggle]');
    toggleBtns.forEach(btn => btn.addEventListener('click', toggleCollapsed));

    const onResize = () => {
        if (window.innerWidth <= BREAKPOINT) {
            el.classList.add('sidebar--collapsed');
        }
    };

    if (window.innerWidth <= BREAKPOINT) el.classList.add('sidebar--collapsed');
    window.addEventListener('resize', onResize);

    // ── Search ───────────────────────────────────────────────────
    const searchInput = el.querySelector('[data-sidebar-search]');
    const onSearch = e => {
        const q = e.target.value.toLowerCase().trim();
        el.querySelectorAll('[data-sidebar-link]').forEach(link => {
            const label = link.querySelector('.sidebar__link-label')?.textContent.toLowerCase() ?? '';
            link.hidden = !!q && !label.includes(q);
        });
    };

    if (searchInput) {
        searchInput.addEventListener('input', onSearch);
        // f3 focuses search (keywatch picks this up, but also handle expand-then-focus)
        document.addEventListener('keydown', e => {
            if (e.key === 'F3') {
                e.preventDefault();
                if (el.classList.contains('sidebar--collapsed')) {
                    el.classList.remove('sidebar--collapsed');
                }
                searchInput.focus();
                searchInput.select();
            }
        });
    }

    // ── Active update on HTMX navigation ─────────────────────────
    const onAfterSwap = () => updateActive();
    document.addEventListener('htmx:afterSwap', onAfterSwap);

    updateActive();

    return () => {
        groupToggles.forEach(btn => btn.removeEventListener('click', onGroupToggle));
        toggleBtns.forEach(btn => btn.removeEventListener('click', toggleCollapsed));
        window.removeEventListener('resize', onResize);
        if (searchInput) searchInput.removeEventListener('input', onSearch);
        document.removeEventListener('htmx:afterSwap', onAfterSwap);
    };
});
