
const NyxDom = {
    // QuerySelector com escopo — evita buscar no document inteiro
    find(selector, root = document) {
        return root.querySelector(selector);
    },
    findAll(selector, root = document) {
        return [...root.querySelectorAll(selector)];
    },
    // Aplica mascara em input
    // applyMask(input, type) { ... },
    // Inicializa todos os data-mask do container
    // initMasks(root = document) {
    //     NyxDom.findAll('[data-mask]', root).forEach(el => {
    //         NyxDom.applyMask(el, el.dataset.mask);
    //     });
    // },
};