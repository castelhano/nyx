/**
 * Dropdown — Menu suspenso com suporte a três variantes.
 *
 * HTML mínimo (default):
 *   <div class="dropdown" data-component="dropdown">
 *     <button class="btn btn-outline btn-dropdown" data-dropdown-toggle>Opções</button>
 *     <ul class="dropdown-menu" data-dropdown-menu>
 *       <li class="dropdown-item">Editar</li>
 *       <li class="dropdown-item dropdown-item--danger">Excluir</li>
 *     </ul>
 *   </div>
 *
 * HTML mínimo (split):
 *   <div class="dropdown" data-component="dropdown" data-variant="split">
 *     <div class="dropdown__split">
 *       <a class="btn btn-outline btn-sm dropdown__split-link"
 *          hx-get="/rota" hx-target="#main">Label</a>
 *       <button class="btn btn-outline btn-sm dropdown__split-trigger"
 *               data-dropdown-toggle aria-label="Mais opções">
 *         <i class="bi bi-chevron-down"></i>
 *       </button>
 *     </div>
 *     <ul class="dropdown-menu dropdown-menu--end" data-dropdown-menu>
 *       <li class="dropdown-item">Duplicar</li>
 *     </ul>
 *   </div>
 *
 * HTML mínimo (hover):
 *   <div class="dropdown" data-component="dropdown"
 *        data-variant="hover" data-delay-open="300" data-delay-close="150">
 *     <button class="btn btn-outline btn-dropdown" data-dropdown-toggle>Opções</button>
 *     <ul class="dropdown-menu" data-dropdown-menu>
 *       <li class="dropdown-item">Editar</li>
 *     </ul>
 *   </div>
 *
 * Cotton (default — trigger no slot padrão, itens no slot "menu"):
 *   <c-dropdown>
 *     <button class="btn btn-outline btn-dropdown" data-dropdown-toggle>Opções</button>
 *     <c-slot name="menu">
 *       <li class="dropdown-item">Editar</li>
 *     </c-slot>
 *   </c-dropdown>
 *
 *   Ou com label gerado pelo template (sem slot padrão):
 *   <c-dropdown label="Opções" btn_class="btn-outline">
 *     <c-slot name="menu">
 *       <li class="dropdown-item">Editar</li>
 *     </c-slot>
 *   </c-dropdown>
 *
 * Cotton (split — link no slot "link", itens no slot "menu"):
 *   <c-dropdown variant="split" align="end" btn_class="btn-outline btn-sm">
 *     <c-slot name="link">
 *       <a class="btn btn-outline btn-sm dropdown__split-link"
 *          hx-get="/rota" hx-target="#main">Label</a>
 *     </c-slot>
 *     <c-slot name="menu">
 *       <li class="dropdown-item">Duplicar</li>
 *     </c-slot>
 *   </c-dropdown>
 *
 *   Ou com label gerado (sem slot "link"):
 *   <c-dropdown variant="split" label="Editar" align="end">...</c-dropdown>
 *
 * Cotton (hover):
 *   <c-dropdown variant="hover" delay_open="300" delay_close="150" long_press="600">
 *     <button class="btn btn-outline btn-dropdown" data-dropdown-toggle>Opções</button>
 *     <c-slot name="menu">
 *       <li class="dropdown-item">Editar</li>
 *     </c-slot>
 *   </c-dropdown>
 *
 * Props Cotton (c-vars com defaults no template):
 *   variant=""           split | hover  (omitir = default)
 *   align=""             end | top      (omitir = esquerda/baixo)
 *   label=""             texto do trigger gerado pelo template
 *   btn_class="btn-outline"  classes do botão gerado
 *   menu_class=""        classes extras no <ul>
 *   delay_open="300"     ms para abrir no hover
 *   delay_close="150"    ms para fechar no hover
 *   long_press="500"     ms do long press mobile
 *
 * Opções (data-attrs no HTML puro):
 *   data-variant="split"        divide o trigger em link + chevron
 *   data-variant="hover"        abre no hover (desktop) ou long press (mobile)
 *   data-delay-open="300"       ms para abrir no hover  (padrão: 300)
 *   data-delay-close="150"      ms para fechar no hover (padrão: 150)
 *   data-long-press="500"       ms do long press mobile (padrão: 500)
 *
 * Modificadores de menu (classe em .dropdown-menu):
 *   .dropdown-menu--end         alinha à direita do trigger
 *   .dropdown-menu--top         abre para cima
 *   .dropdown-menu--brand       variante de cor brand
 *
 * Notas:
 *   split — o listener de fechar no link principal só é adicionado se o link
 *            não tiver atributo hx-*. Com HTMX, o htmx:beforeSwap já destrói
 *            o componente via NyxDom.destroy antes do swap.
 *   hover — touch detection via matchMedia('(hover: none)'); no mobile usa
 *            long press em vez de hover.
 */
NyxDom.register('dropdown', el => {
    const variant = el.dataset.variant ?? 'default';
    const toggle  = NyxDom.find('[data-dropdown-toggle]', el);
    const menu    = NyxDom.find('[data-dropdown-menu]', el);

    const openMenu  = () => menu.classList.add('open');
    const closeMenu = () => menu.classList.remove('open');

    const onOutside = e => {
        if (!el.contains(e.target)) closeMenu();
    };

    // ── Hover ──────────────────────────────────────────────────────────────────
    if (variant === 'hover') {
        const delayOpen  = +(el.dataset.delayOpen  ?? 300);
        const delayClose = +(el.dataset.delayClose ?? 150);
        const longPress  = +(el.dataset.longPress  ?? 500);
        const isTouch    = window.matchMedia('(hover: none)').matches;

        let openTimer = null, closeTimer = null, pressTimer = null;

        const onEnter = () => {
            clearTimeout(closeTimer);
            openTimer = setTimeout(openMenu, delayOpen);
        };
        const onLeave = () => {
            clearTimeout(openTimer);
            closeTimer = setTimeout(closeMenu, delayClose);
        };
        const onClickToggle = e => { e.stopPropagation(); menu.classList.toggle('open'); };

        const onTouchStart = e => {
            pressTimer = setTimeout(() => { openMenu(); e.preventDefault(); }, longPress);
        };
        const onTouchEnd = () => clearTimeout(pressTimer);

        if (isTouch) {
            toggle?.addEventListener('touchstart',  onTouchStart, { passive: false });
            toggle?.addEventListener('touchend',    onTouchEnd);
            toggle?.addEventListener('touchcancel', onTouchEnd);
            toggle?.addEventListener('click',       onClickToggle);
        } else {
            el.addEventListener('mouseenter', onEnter);
            el.addEventListener('mouseleave', onLeave);
            toggle?.addEventListener('click', onClickToggle);
        }
        document.addEventListener('click', onOutside);

        return () => {
            if (isTouch) {
                toggle?.removeEventListener('touchstart',  onTouchStart);
                toggle?.removeEventListener('touchend',    onTouchEnd);
                toggle?.removeEventListener('touchcancel', onTouchEnd);
                toggle?.removeEventListener('click',       onClickToggle);
            } else {
                el.removeEventListener('mouseenter', onEnter);
                el.removeEventListener('mouseleave', onLeave);
                toggle?.removeEventListener('click', onClickToggle);
            }
            clearTimeout(openTimer);
            clearTimeout(closeTimer);
            clearTimeout(pressTimer);
            document.removeEventListener('click', onOutside);
        };
    }

    // ── Default + Split ────────────────────────────────────────────────────────
    const onToggleClick = e => { e.stopPropagation(); menu.classList.toggle('open'); };
    toggle?.addEventListener('click', onToggleClick);

    // Split: fecha o menu ao clicar no link principal apenas quando não usa HTMX.
    // Com HTMX o htmx:beforeSwap → NyxDom.destroy já faz o cleanup do componente.
    let splitLink = null, onSplitLinkClick = null;
    if (variant === 'split') {
        splitLink = NyxDom.find('.dropdown__split-link', el);
        const htmxAttrs   = ['hx-get', 'hx-post', 'hx-put', 'hx-delete', 'hx-patch'];
        const linkHasHtmx = splitLink && htmxAttrs.some(a => splitLink.hasAttribute(a));
        if (splitLink && !linkHasHtmx) {
            onSplitLinkClick = () => closeMenu();
            splitLink.addEventListener('click', onSplitLinkClick);
        }
    }

    document.addEventListener('click', onOutside);

    return () => {
        toggle?.removeEventListener('click', onToggleClick);
        splitLink?.removeEventListener('click', onSplitLinkClick);
        document.removeEventListener('click', onOutside);
    };
});
