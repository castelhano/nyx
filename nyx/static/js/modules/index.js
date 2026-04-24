// NyxModules["index"] = {
//     init(container) {
//         const group = container.dataset.keybindGroup;

//         keys.bind('g+i', () => console.log('ACIONADO'), {
//             group,
//             element: document.getElementById('nome'),
//             desc:    'Teste de bind no index',
//             origin:  'nyx.index',
//         });
//     },
//     destroy() {
//         keys.unbindGroup(container.dataset.keybindGroup);
//     },
// };