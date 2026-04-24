/**
 * Mask — Aplica IMask em inputs com data-mask dentro do container.
 *
 * Uso no template: adicione data-component="mask" no elemento pai.
 * Cada input filho com data-mask recebe a máscara automaticamente.
 * O destroy é gerenciado pelo NyxDom — funciona com fragmentos HTMX.
 *
 * @example
 *   <div data-component="mask">
 *     <input data-mask="00.000.000/0000-00" ...>
 *     <input data-mask="(00) 00000-0000" ...>
 *   </div>
 */
NyxDom.register('mask', el => {
    const instances = Array.from(el.querySelectorAll('[data-mask]'))
        .map(input => IMask(input, { mask: input.dataset.mask }));

    return () => instances.forEach(m => m.destroy());
});
