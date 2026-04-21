

const NyxUtils = {
    toggleTheme() {
      const html  = document.documentElement;
      const label = document.getElementById('theme-label');
      const curr  = html.getAttribute('data-theme');
      const next  = curr === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      label.textContent = next === 'dark' ? 'Light' : 'Dark';
    },

    // Calcula o melhor placement para um painel flutuante relativo ao anchor,
    // evitando overflow no viewport. Aplica data-placement e data-align no anchor.
    autoPlace(anchor, panel, { gap = 8 } = {}) {
        const rect = anchor.getBoundingClientRect();
        const vw   = window.innerWidth;
        const vh   = window.innerHeight;
        const pw   = panel.offsetWidth  || 272;
        const ph   = panel.offsetHeight || 200;

        let placement;
        if      (vh - rect.bottom >= ph + gap) placement = 'bottom';
        else if (rect.top         >= ph + gap) placement = 'top';
        else if (vw - rect.right  >= pw + gap) placement = 'end';
        else                                   placement = 'start';

        const align = (placement === 'bottom' || placement === 'top')
            ? ((rect.left + pw > vw) ? 'end' : 'start')
            : null;

        anchor.dataset.placement = placement;
        if (align) anchor.dataset.align = align;
        else       delete anchor.dataset.align;

        return { placement, align };
    },

    // formatDate(date, format = 'dd/mm/yyyy') { ... },
    // formatCPF(value) { ... },
    // debounce(fn, delay) { ... },
    // isEmpty(value) { ... },
};