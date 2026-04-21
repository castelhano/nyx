/**
 * Hover Card — Painel flutuante ativado por hover ou clique.
 *
 * HTML mínimo:
 *   <div data-component="hover-card">
 *     <div data-hcard-trigger>...</div>
 *     <div data-hcard-panel>...</div>
 *   </div>
 *
 * Cotton:
 *   <c-hcard name="João Silva" sub="@joao" avatar="foto.jpg"
 *            mode="hover" placement="auto" delay="300" balloon="true">
 *     <c-slot name="trigger">
 *       <button class="btn btn-sm">João</button>
 *     </c-slot>
 *     Texto do corpo aqui.
 *     <c-slot name="footer">
 *       <span><strong>128</strong> seguindo</span>
 *     </c-slot>
 *   </c-hcard>
 *
 * Opções (data-attrs no container):
 *   data-trigger="hover"          modo de abertura: hover | click | both  (padrão: hover)
 *   data-placement="auto"         posição do painel: auto | top | bottom | start | end  (padrão: auto)
 *   data-dismiss="auto"           fechamento: auto (fora do elemento) | manual  (padrão: auto)
 *   data-delay="300"              delay em ms para abrir no hover  (padrão: 0)
 *   data-disabled="true"          desativa o componente
 *
 * Dismiss manual:
 *   Com data-dismiss="manual", adicione dentro do panel um botão com data-hcard-close.
 *
 * Placement auto:
 *   Calcula o melhor lado com base no espaço disponível no viewport via NyxUtils.autoPlace.
 *   O alinhamento (start/end) também é ajustado automaticamente.
 */
NyxDom.register('hover-card', el => {
    const trigger   = NyxDom.find('[data-hcard-trigger]', el);
    const panel     = NyxDom.find('[data-hcard-panel]', el);
    const mode      = el.dataset.trigger || 'hover';
    const dismiss   = el.dataset.dismiss || 'auto';
    const openDelay = parseInt(el.dataset.delay ?? 0, 10);
    const isAuto    = !el.dataset.placement || el.dataset.placement === 'auto';

    let openTimer  = null;
    let closeTimer = null;

    const open = () => {
        if (el.dataset.disabled === 'true') return;
        clearTimeout(closeTimer);
        clearTimeout(openTimer);
        if (isAuto) NyxUtils.autoPlace(el, panel);
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
        panel.classList.contains('open') ? close() : open();
    };

    const onOutside = e => { if (!el.contains(e.target)) close(); };

    if (mode === 'click' || mode === 'both') {
        trigger?.addEventListener('click', onToggle);
        document.addEventListener('click', onOutside);
    }

    if (dismiss === 'manual') {
        NyxDom.find('[data-hcard-close]', panel)?.addEventListener('click', close);
    }

    // Posiciona antes do primeiro paint para não causar scroll horizontal
    if (isAuto) NyxUtils.autoPlace(el, panel);

    return () => {
        clearTimeout(openTimer);
        clearTimeout(closeTimer);
        document.removeEventListener('click', onOutside);
    };
});
