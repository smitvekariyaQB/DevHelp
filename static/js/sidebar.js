(function () {
  'use strict';

  const STORAGE_KEY = 'appSidebarCollapsed';
  const sidebar = document.getElementById('appSidebar');
  const toggle = document.getElementById('btnToggleSidebar');
  if (!sidebar || !toggle) return;

  function setCollapsed(collapsed) {
    sidebar.classList.toggle('sidebar-collapsed', collapsed);
    document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggle.setAttribute('aria-label', toggle.title);
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch (_) {}
  }

  if (document.documentElement.classList.contains('sidebar-collapsed')) {
    sidebar.classList.add('sidebar-collapsed');
  } else {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setCollapsed(true);
    } catch (_) {}
  }

  toggle.addEventListener('click', () => {
    setCollapsed(!sidebar.classList.contains('sidebar-collapsed'));
  });
})();
