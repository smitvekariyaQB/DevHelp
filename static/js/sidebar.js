(function () {
  'use strict';

  const SESSION_KEY = 'appSidebarCollapsed';
  const sidebar = document.getElementById('appSidebar');
  const toggle = document.getElementById('btnToggleSidebar');
  if (!sidebar || !toggle) return;

  function setCollapsed(collapsed, persistSession) {
    sidebar.classList.toggle('sidebar-collapsed', collapsed);
    document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggle.setAttribute('aria-label', toggle.title);
    if (persistSession !== false) {
      try {
        sessionStorage.setItem(SESSION_KEY, collapsed ? '1' : '0');
      } catch (_) {}
    }
  }

  if (document.documentElement.classList.contains('sidebar-collapsed')) {
    sidebar.classList.add('sidebar-collapsed');
  } else {
    try {
      const session = sessionStorage.getItem(SESSION_KEY);
      if (session === '1') setCollapsed(true, false);
      else if (session === '0') setCollapsed(false, false);
    } catch (_) {}
  }

  toggle.addEventListener('click', () => {
    setCollapsed(!sidebar.classList.contains('sidebar-collapsed'));
  });
})();
