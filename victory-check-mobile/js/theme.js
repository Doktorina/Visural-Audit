const VCTheme = (() => {
  const KEY = 'vc_theme';

  function systemTheme() {
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (_) {
      return 'dark';
    }
  }

  function getStored() {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (_) {
      return null;
    }
  }

  function resolveTheme() {
    return getStored() || 'dark';
  }

  function apply(theme, options) {
    const persist = !options || options.persist !== false;
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    if (persist) {
      try {
        localStorage.setItem(KEY, t);
      } catch (_) {}
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'light' ? '#f1f4f3' : '#0f1a15';
    document.querySelectorAll('[data-theme-btn]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.themeBtn === t);
    });
  }

  function get() {
    const cur = document.documentElement.getAttribute('data-theme');
    if (cur === 'light' || cur === 'dark') return cur;
    return resolveTheme();
  }

  function init() {
    apply(resolveTheme(), { persist: false });
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if (!getStored()) apply(systemTheme(), { persist: false });
      };
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
      else if (typeof mq.addListener === 'function') mq.addListener(onChange);
    } catch (_) {}
  }

  return { init, apply, get, systemTheme, usesSystem: () => !getStored() };
})();

VCTheme.init();
