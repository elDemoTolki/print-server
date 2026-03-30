/* ── Theme manager — Electivo de Fotografía y Multimedia ── */
(function () {
  const KEY    = 'pf-theme';
  const DARK   = 'dark';
  const SAKURA = 'sakura';

  function get()  { return localStorage.getItem(KEY) || SAKURA; }
  function save(t){ localStorage.setItem(KEY, t); }

  function apply(theme) {
    if (theme === SAKURA) {
      document.documentElement.classList.add('theme-sakura');
    } else {
      document.documentElement.classList.remove('theme-sakura');
    }
    updateButtons(theme);
  }

  function updateButtons(theme) {
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      if (theme === SAKURA) {
        btn.innerHTML = '<span class="theme-toggle-icon">🌙</span><span class="theme-toggle-label">Modo oscuro</span>';
        btn.title = 'Cambiar a modo oscuro';
      } else {
        btn.innerHTML = '<span class="theme-toggle-icon">🌸</span><span class="theme-toggle-label">Modo sakura</span>';
        btn.title = 'Cambiar a modo sakura';
      }
    });
  }

  function toggle() {
    const next = get() === SAKURA ? DARK : SAKURA;
    save(next);
    apply(next);
  }

  // Expose API
  window.themeManager = { toggle, get, apply };

  // Apply on DOM ready (buttons may not exist yet)
  document.addEventListener('DOMContentLoaded', () => {
    updateButtons(get());
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.addEventListener('click', toggle);
    });
  });
})();
