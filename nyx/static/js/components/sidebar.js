NyxDom.register('sidebar', el => {
    const BREAKPOINT = 768;

    // ── Active state ─────────────────────────────────────────────
    const updateActive = () => {
        const path = window.location.pathname;
        el.querySelectorAll('[data-sidebar-link]').forEach(link => {
            const href = link.getAttribute('href');
            // Strip last segment to get base: '/core/empresa/list/' → '/core/empresa/'
            const base = href ? href.replace(/[^/]+\/$/, '') : '';
            const active = !!base && base !== '/' && path.startsWith(base);
            link.classList.toggle('active', active);
        });
        el.querySelectorAll('[data-sidebar-group]').forEach(group => {
            const hasActive = !!group.querySelector('[data-sidebar-link].active');
            const toggle = group.querySelector('[data-sidebar-group-toggle]');
            if (toggle) toggle.classList.toggle('sidebar__group--current', hasActive);
            if (hasActive) group.classList.add('open');
        });
    };

    // ── Collapsible groups (accordion) ───────────────────────────
    const onGroupToggle = e => {
        if (el.classList.contains('sidebar--collapsed')) {
            el.classList.remove('sidebar--collapsed');
        }
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

    const expandAndFocusSearch = () => {
        el.classList.remove('sidebar--collapsed');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    };

    if (searchInput) {
        searchInput.addEventListener('input', onSearch);
        document.addEventListener('keydown', e => {
            if (e.key === 'F3') {
                e.preventDefault();
                expandAndFocusSearch();
            }
        });
    }

    const searchBtn = el.querySelector('[data-sidebar-search-btn]');
    if (searchBtn) searchBtn.addEventListener('click', expandAndFocusSearch);

    // ── Active update on HTMX navigation ─────────────────────────
    const onAfterSwap = () => updateActive();
    document.addEventListener('htmx:afterSwap', onAfterSwap);

    updateActive();

    return () => {
        groupToggles.forEach(btn => btn.removeEventListener('click', onGroupToggle));
        toggleBtns.forEach(btn => btn.removeEventListener('click', toggleCollapsed));
        window.removeEventListener('resize', onResize);
        if (searchInput) searchInput.removeEventListener('input', onSearch);
        if (searchBtn) searchBtn.removeEventListener('click', expandAndFocusSearch);
        document.removeEventListener('htmx:afterSwap', onAfterSwap);
    };
});
