/**
 * NyxResponse — Processamento de intenções declaradas pelo servidor.
 *
 * O servidor retorna <template data-response="tipo"> dentro do fragmento.
 * O scan lê, despacha para o handler correto e remove o elemento.
 *
 * USO NO TEMPLATE DJANGO:
 *   <template data-response="toast" data-status="success">Salvo com sucesso.</template>
 *   <template data-response="field" data-field="email" data-status="error">E-mail inválido.</template>
 *
 * HANDLERS EMBUTIDOS:
 *   toast — exibe um NyxToast. Opções: data-status, data-dismiss (ms)
 *   field — marca campo com feedback visual. Opções: data-field (name/id), data-status
 *
 * REGISTRAR HANDLER CUSTOMIZADO:
 *   NyxResponse.register('redirect', el => { location.href = el.dataset.url; });
 */
const NyxResponse = (() => {
    const _handlers = {

        toast(el) {
            NyxToast.show(
                el.dataset.status  || 'info',
                el.content.textContent.trim(),
                { dismiss: parseInt(el.dataset.dismiss ?? 4000, 10) }
            );
        },

        field(el) {
            const name    = el.dataset.field;
            const status  = el.dataset.status || 'error';
            const message = el.content.textContent.trim();
            const input   = document.querySelector(`[name="${name}"], #id_${name}, #${name}`);
            if (!input) return;

            input.classList.remove('is-valid', 'is-invalid', 'is-warning');
            input.classList.add(status === 'success' ? 'is-valid' : status === 'warning' ? 'is-warning' : 'is-invalid');

            let feedback = input.parentElement.querySelector('.field-feedback');
            if (!feedback) {
                feedback = document.createElement('span');
                input.after(feedback);
            }
            feedback.className = `field-feedback field-feedback--${status}`;
            feedback.textContent = message;
        },

    };

    function register(type, handler) {
        _handlers[type] = handler;
    }

    function scan(root = document) {
        root.querySelectorAll('[data-response]').forEach(el => {
            const handler = _handlers[el.dataset.response];
            if (handler) handler(el);
            el.remove();
        });
    }

    return { register, scan };
})();
