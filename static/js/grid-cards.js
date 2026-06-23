(function () {
  const cfg = window.GRID_CARDS_CONFIG;
  if (!cfg) return;

  let openMenu = null;

  function csrfHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-CSRFToken': cfg.csrfToken,
    };
  }

  function closeMenu() {
    if (openMenu) {
      openMenu.classList.add('hidden');
      openMenu = null;
    }
  }

  function refreshGrid() {
    if (window.routerNavigate) window.routerNavigate(cfg.urls.index);
    else window.location.href = cfg.urls.index;
  }

  async function togglePin(wrap) {
    const url = wrap.dataset.pinUrl;
    if (!url) return;
    const res = await fetch(url, { method: 'POST', headers: csrfHeaders() });
    if (!res.ok) return;
    closeMenu();
    refreshGrid();
  }

  async function deleteCard(wrap) {
    const title = wrap.dataset.cardTitle || 'this item';
    const itemLabel = cfg.itemLabel || 'item';
    if (window.AppModal) {
      const ok = await AppModal.confirm({
        title: `Delete ${itemLabel}`,
        message: `Are you sure you want to delete "${title}"? This cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true,
      });
      if (!ok) return;
    }
    const url = wrap.dataset.deleteUrl;
    if (!url) return;
    const res = await fetch(url, { method: 'POST', headers: csrfHeaders() });
    if (!res.ok) return;
    closeMenu();
    refreshGrid();
  }

  function onDocumentClick(e) {
    const menuBtn = e.target.closest('.note-card-menu-btn');
    if (menuBtn) {
      e.preventDefault();
      e.stopPropagation();
      const wrap = menuBtn.closest('.note-card-wrap');
      const menu = wrap?.querySelector('.note-card-menu');
      if (!menu) return;
      if (openMenu === menu) {
        closeMenu();
        return;
      }
      closeMenu();
      menu.classList.remove('hidden');
      openMenu = menu;
      return;
    }

    const actionBtn = e.target.closest('.note-card-menu button[data-action]');
    if (actionBtn) {
      e.preventDefault();
      e.stopPropagation();
      const wrap = actionBtn.closest('.note-card-wrap');
      if (!wrap) return;
      const action = actionBtn.dataset.action;
      if (action === 'pin') togglePin(wrap);
      if (action === 'delete') deleteCard(wrap);
      return;
    }

    if (!e.target.closest('.note-card-menu')) closeMenu();
  }

  document.addEventListener('click', onDocumentClick);

  if (window.__routerCleanup) {
    window.__routerCleanup.push(() => {
      document.removeEventListener('click', onDocumentClick);
      closeMenu();
    });
  }
})();
