/**
 * Scrollspy — Marca links como .active conforme as seções entram/saem do viewport.
 * Suporta seções aninhadas: pai fica .active enquanto qualquer filho estiver visível.
 *
 * HTML mínimo:
 *   <ul data-component="scrollspy">
 *     <li><a href="#sec1">Seção 1</a>
 *       <ul>
 *         <li><a href="#sec1-1">1.1</a></li>
 *         <li><a href="#sec1-2">1.2</a></li>
 *       </ul>
 *     </li>
 *     <li><a href="#sec2">Seção 2</a></li>
 *   </ul>
 *
 * Opções via data-attr:
 *   data-scrollspy-threshold="0"   — fração visível para ativar (default: 0)
 *   data-scrollspy-margin="0px"    — rootMargin do observer (default: "0px")
 */
NyxDom.register('scrollspy', el => {
    const threshold = parseFloat(el.dataset.scrollspyThreshold ?? 0.2);
    const margin    = el.dataset.scrollspyMargin ?? '0px 0px -20px 0px';

    const links    = [...el.querySelectorAll('a[href^="#"]')];
    const sections = links
        .map(a => document.querySelector(a.getAttribute('href')))
        .filter(Boolean);

    if (!sections.length) return;

    // Mapa de ancestrais: calculado uma vez no init
    // section → [seções observadas que a contêm]
    const ancestorMap = new Map(
        sections.map(s => [s, sections.filter(other => other !== s && other.contains(s))])
    );

    const visible = new Set();

    const sync = () => {
        const visibleArr = sections.filter(s => visible.has(s));

        // Remove wrappers: mantém só seções que não contêm outra visível (folhas)
        const leaves = visibleArr.filter(
            s => !visibleArr.some(other => other !== s && s.contains(other))
        );

        // Primeira folha (ordem do nav) + suas ancestrais = conjunto de links ativos
        const activeIds = new Set();
        const primary = leaves[0];
        if (primary) {
            activeIds.add(primary.id);
            ancestorMap.get(primary).forEach(a => activeIds.add(a.id));
        }

        links.forEach(a => a.classList.toggle('active', activeIds.has(a.getAttribute('href').slice(1))));
    };

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) visible.add(entry.target);
            else visible.delete(entry.target);
        });
        sync();
    }, { rootMargin: margin, threshold });

    sections.forEach(s => observer.observe(s));

    return () => observer.disconnect();
});
