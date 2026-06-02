(function () {
  'use strict';

  const KEYS = {
    darkMode: 'appDarkMode',
    sidebarDefaultOpen: 'appSidebarDefaultOpen',
    sidebarSession: 'appSidebarCollapsed',
  };

  function getDarkMode() {
    try {
      return localStorage.getItem(KEYS.darkMode) === '1';
    } catch (_) {
      return false;
    }
  }

  function getSidebarDefaultOpen() {
    try {
      const value = localStorage.getItem(KEYS.sidebarDefaultOpen);
      if (value === '0') return false;
      if (value === '1') return true;
      return localStorage.getItem(KEYS.sidebarSession) !== '1';
    } catch (_) {
      return true;
    }
  }

  const HLJS_THEME_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles';

  function findHljsThemeLink() {
    return (
      document.getElementById('hljsTheme')
      || document.querySelector('link[data-dynamic][href*="highlight.js"][href*="/styles/"]')
      || document.querySelector('link[href*="highlight.js"][href*="/styles/"]')
    );
  }

  function syncHighlightTheme(enabled) {
    const dark = typeof enabled === 'boolean' ? enabled : getDarkMode();
    const link = findHljsThemeLink();
    if (!link) return;

    const href = `${HLJS_THEME_BASE}/${dark ? 'github-dark' : 'github'}.min.css`;
    const resync = () => window.__codeEditorSyncHighlight?.();

    if (link.getAttribute('href') === href) {
      resync();
      return;
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resync();
    };

    link.addEventListener('load', finish, { once: true });
    link.addEventListener('error', finish, { once: true });
    link.setAttribute('href', href);
    // Cached stylesheets may not emit load; resync shortly after href swap.
    setTimeout(finish, 150);
  }

  function applyDarkMode(enabled) {
    document.documentElement.classList.toggle('dark-mode', enabled);
    try {
      localStorage.setItem(KEYS.darkMode, enabled ? '1' : '0');
    } catch (_) {}
    syncHighlightTheme(enabled);
  }

  function applySidebarDefault(open, clearSession) {
    const collapsed = !open;
    document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
    const sidebar = document.getElementById('appSidebar');
    if (sidebar) sidebar.classList.toggle('sidebar-collapsed', collapsed);
    const toggle = document.getElementById('btnToggleSidebar');
    if (toggle) {
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      toggle.title = label;
      toggle.setAttribute('aria-label', label);
    }
    try {
      localStorage.setItem(KEYS.sidebarDefaultOpen, open ? '1' : '0');
      if (clearSession) sessionStorage.removeItem(KEYS.sidebarSession);
    } catch (_) {}
  }

  function initSettingsPage() {
    const darkToggle = document.getElementById('prefDarkMode');
    const sidebarToggle = document.getElementById('prefSidebarOpen');
    if (!darkToggle && !sidebarToggle) return;

    if (darkToggle && !darkToggle.dataset.prefBound) {
      darkToggle.dataset.prefBound = '1';
      darkToggle.addEventListener('change', () => {
        applyDarkMode(darkToggle.checked);
      });
    }
    if (darkToggle) darkToggle.checked = getDarkMode();

    if (sidebarToggle && !sidebarToggle.dataset.prefBound) {
      sidebarToggle.dataset.prefBound = '1';
      sidebarToggle.addEventListener('change', () => {
        applySidebarDefault(sidebarToggle.checked, true);
      });
    }
    if (sidebarToggle) sidebarToggle.checked = getSidebarDefaultOpen();
  }

  window.AppPreferences = {
    KEYS,
    getDarkMode,
    getSidebarDefaultOpen,
    applyDarkMode,
    applySidebarDefault,
    initSettingsPage,
    syncHighlightTheme,
  };

  syncHighlightTheme(getDarkMode());
})();
