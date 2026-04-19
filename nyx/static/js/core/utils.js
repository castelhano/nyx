

const NyxUtils = {
    toggleTheme() {
      const html  = document.documentElement;
      const label = document.getElementById('theme-label');
      const curr  = html.getAttribute('data-theme');
      const next  = curr === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      label.textContent = next === 'dark' ? 'Light' : 'Dark';
    }
    // formatDate(date, format = 'dd/mm/yyyy') { ... },
    // formatCPF(value) { ... },
    // debounce(fn, delay) { ... },
    // isEmpty(value) { ... },
};