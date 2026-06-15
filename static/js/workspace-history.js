(function () {
  const panel = document.getElementById('workspaceHistoryPanel');
  if (!panel) return;

  const body = document.getElementById('workspaceHistoryBody');
  const footer = document.getElementById('workspaceHistoryFooter');
  const btnMore = document.getElementById('btnWorkspaceHistoryMore');
  const btnClose = document.getElementById('btnCloseWorkspaceHistory');
  const backdrop = document.getElementById('workspaceHistoryBackdrop');
  const shell = document.querySelector('.app-shell-inner');

  let currentPage = 1;
  let loading = false;
  let hasMore = false;
  let activeObjectId = null;

  function currentTool() {
    return shell?.dataset.currentTool || '';
  }

  function workspaceQuery() {
    const params = new URLSearchParams(window.location.search);
    const w = params.get('w') || shell?.dataset.workspaceId || '';
    return w ? `w=${encodeURIComponent(w)}` : '';
  }

  function activityUrl(page) {
    const tool = currentTool();
    const parts = [`page=${page}`];
    const wq = workspaceQuery();
    if (wq) parts.push(wq);
    if (tool) parts.push(`tool=${encodeURIComponent(tool)}`);
    if (activeObjectId) parts.push(`object_id=${encodeURIComponent(activeObjectId)}`);
    return `/workspaces/api/activity/?${parts.join('&')}`;
  }

  function formatDateTime(iso) {
    try {
      const date = new Date(iso);
      return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch (_) {
      return iso;
    }
  }

  function renderItems(items, append) {
    if (!append) body.innerHTML = '';
    if (!items.length && !append) {
      body.innerHTML = '<p class="workspace-history-empty">No activity yet.</p>';
      return;
    }
    const empty = body.querySelector('.workspace-history-empty');
    if (empty) empty.remove();

    items.forEach(function (item) {
      const el = document.createElement('article');
      el.className = 'workspace-history-item';
      el.innerHTML =
        '<div class="workspace-history-item-name">' + escapeHtml(item.display_name) + '</div>' +
        '<time class="workspace-history-item-time">' + escapeHtml(formatDateTime(item.created_at)) + '</time>' +
        '<p class="workspace-history-item-details">' + escapeHtml(item.details) + '</p>';
      body.appendChild(el);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  async function loadHistory(page, append) {
    if (loading) return;
    loading = true;
    if (!append) {
      body.innerHTML = '<p class="workspace-history-loading">Loading…</p>';
    }
    try {
      const res = await fetch(activityUrl(page), {
        headers: { 'X-Requested-With': 'ArcBookRouter' },
      });
      if (!res.ok) throw new Error('Failed to load history');
      const data = await res.json();
      renderItems(data.items || [], append);
      hasMore = !!data.has_more;
      currentPage = data.page || page;
      footer?.classList.toggle('hidden', !hasMore);
    } catch (_) {
      if (!append) {
        body.innerHTML = '<p class="workspace-history-empty">Could not load history.</p>';
      }
      footer?.classList.add('hidden');
    } finally {
      loading = false;
    }
  }

  function openPanel() {
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    backdrop.hidden = false;
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('workspace-history-open');
    currentPage = 1;
    loadHistory(1, false);
  }

  function closePanel() {
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('workspace-history-open');
  }

  document.addEventListener('click', function (event) {
    const btn = event.target.closest('.btn-workspace-history');
    if (btn) {
      event.preventDefault();
      activeObjectId = btn.dataset.objectId || null;
      openPanel();
    }
  });

  btnClose?.addEventListener('click', closePanel);
  backdrop?.addEventListener('click', closePanel);

  btnMore?.addEventListener('click', function () {
    if (hasMore) loadHistory(currentPage + 1, true);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) closePanel();
  });

  window.refreshWorkspaceHistory = function () {
    if (!panel.hidden) loadHistory(1, false);
  };
})();
