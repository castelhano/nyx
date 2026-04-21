/**
 * NyxToast — Criação e gerenciamento de toasts.
 *
 * USO PROGRAMÁTICO:
 *   NyxToast.show('success', 'Salvo com sucesso.')
 *   NyxToast.show('danger',  'Erro ao salvar.', { dismiss: 0 })  // 0 = não fecha
 *
 * Status disponíveis: success | danger | warning | info
 * dismiss: tempo em ms para fechar automaticamente (padrão: 4000)
 *
 * O fechamento manual via botão × é gerenciado por delegação no #toast_container,
 * cobrindo tanto toasts programáticos quanto os renderizados pelo servidor.
 */
const NyxToast = (() => {
    const _container = () => document.getElementById('toast_container');

    function _dismiss(toast) {
        if (!toast || toast.classList.contains('is-removing')) return;
        toast.classList.add('is-removing');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }

    // Delegação única para todos os botões de fechar no container
    document.addEventListener('DOMContentLoaded', () => {
        _container()?.addEventListener('click', e => {
            const btn = e.target.closest('.toast__close');
            if (btn) _dismiss(btn.closest('.toast'));
        });
    });

    function show(status, message, { dismiss = 4000 } = {}) {
        const toast = document.createElement('div');
        toast.className = `toast toast--${status}`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');
        toast.innerHTML = `<span class="toast__body">${message}</span>
            <button class="toast__close" aria-label="Fechar">×</button>`;

        _container()?.appendChild(toast);

        if (dismiss > 0) setTimeout(() => _dismiss(toast), dismiss);
    }

    return { show };
})();
