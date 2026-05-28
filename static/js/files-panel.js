(function () {
  function initFilesPanelCollapse({ panel, toggle, storageKey }) {
    if (!panel || !toggle) return;

    function setCollapsed(collapsed) {
      panel.classList.toggle('files-panel-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      toggle.setAttribute('aria-label', toggle.title);
      if (storageKey) {
        localStorage.setItem(storageKey, collapsed ? '1' : '0');
      }
    }

    if (storageKey && localStorage.getItem(storageKey) === '1') {
      setCollapsed(true);
    }

    toggle.addEventListener('click', () => {
      setCollapsed(!panel.classList.contains('files-panel-collapsed'));
    });
  }

  initFilesPanelCollapse({
    panel: document.querySelector('#codeApp .code-files-panel'),
    toggle: document.getElementById('btnToggleCodeSidebar'),
    storageKey: 'codeFilesPanelCollapsed',
  });

  initFilesPanelCollapse({
    panel: document.querySelector('#jsonApp .json-files-panel'),
    toggle: document.getElementById('btnToggleJsonSidebar'),
    storageKey: 'jsonFilesPanelCollapsed',
  });

  initFilesPanelCollapse({
    panel: document.querySelector('#markdownApp .md-files-panel'),
    toggle: document.getElementById('btnToggleMdSidebar'),
    storageKey: 'mdFilesPanelCollapsed',
  });
})();
