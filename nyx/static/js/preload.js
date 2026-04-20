/**
 * preload.js — Inicialização antecipada de estado da UI.
 *
 * Roda no <head> antes do CSS ser aplicado, eliminando FOUC em estados
 * persistidos (sidebar collapsed, tema, etc.).
 *
 * Padrão:
 *   1. Lê localStorage / preferências do sistema
 *   2. Seta atributos/classes em <html> que o CSS já conhece
 *   3. Expõe window.NyxPreload para os componentes JS lerem no init
 *
 * Os componentes JS são responsáveis por:
 *   - Ler NyxPreload e aplicar classes ao elemento correto
 *   - Limpar os atributos de <html> após assumir o controle
 */
window.NyxPreload = (function () {

    // ── Sidebar ───────────────────────────────────────────────────
    var SIDEBAR_KEY = 'nyx:sidebar:collapsed';
    var sidebarCollapsed =
        localStorage.getItem(SIDEBAR_KEY) === '1' ||
        window.innerWidth <= 768;

    if (sidebarCollapsed) {
        document.documentElement.setAttribute('data-sidebar-init', 'collapsed');
    }

    // ── API pública ───────────────────────────────────────────────
    return {
        sidebar: { collapsed: sidebarCollapsed },
    };

})();
