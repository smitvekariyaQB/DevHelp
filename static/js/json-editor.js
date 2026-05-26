(function () {
  const cfg = window.JSON_EDITOR_CONFIG;
  if (!cfg) return;

  const fileList = document.getElementById('jsonFileList');
  const fileSearch = document.getElementById('jsonFileSearch');
  const btnNewJson = document.getElementById('btnNewJson');
  const btnNewJsonWelcome = document.getElementById('btnNewJsonWelcome');
  const titleInput = document.getElementById('jsonTitleInput');
  const editor = document.getElementById('jsonEditor');
  const highlight = document.getElementById('jsonHighlight');
  const textStack = document.querySelector('.json-text-stack');
  const treeViewer = document.getElementById('jsonTreeViewer');
  const treeError = document.getElementById('jsonTreeError');
  const viewerWrap = document.getElementById('jsonViewerWrap');
  const textWrap = document.getElementById('jsonTextWrap');
  const tabViewer = document.getElementById('tabJsonViewer');
  const tabText = document.getElementById('tabJsonText');
  const validBadge = document.getElementById('jsonValidBadge');
  const statusEl = document.getElementById('jsonAutosaveStatus');
  const statusTextEl = statusEl?.querySelector('.autosave-badge-text');
  const btnSave = document.getElementById('btnManualSave');
  const btnFormat = document.getElementById('btnJsonFormat');
  const btnMinify = document.getElementById('btnJsonMinify');
  const btnCopy = document.getElementById('btnJsonCopy');
  const btnSearch = document.getElementById('btnJsonSearch');
  const btnDelete = document.getElementById('btnDeleteJson');
  const findBar = document.getElementById('jsonFindBar');
  const findInput = document.getElementById('jsonFindInput');
  const findCount = document.getElementById('jsonFindCount');
  const btnFindPrev = document.getElementById('btnFindPrev');
  const btnFindNext = document.getElementById('btnFindNext');
  const btnFindClose = document.getElementById('btnFindClose');

  const AUTOSAVE_DELAY = 800;
  let saveTimer;
  let saving = false;
  let pending = false;
  let findMatches = [];
  let findIndex = -1;
  let activeTab = 'viewer';
  let treeRefreshTimer;

  function csrfHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-CSRFToken': cfg.csrfToken,
    };
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightJsonText(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(
      /("(\\.|[^"\\])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        if (/^"[^"\\]*(?:\\.[^"\\]*)*"\s*:$/.test(match)) {
          return `<span class="json-hl-key">${match}</span>`;
        }
        if (/^"/.test(match)) {
          return `<span class="json-hl-string">${match}</span>`;
        }
        if (/true|false/.test(match)) {
          return `<span class="json-hl-boolean">${match}</span>`;
        }
        if (/null/.test(match)) {
          return `<span class="json-hl-null">${match}</span>`;
        }
        return `<span class="json-hl-number">${match}</span>`;
      },
    );
  }

  function syncTextHighlight() {
    if (!editor || !highlight) return;
    highlight.innerHTML = `${highlightJsonText(editor.value)}\n`;
    syncTextEditorHeight();
    syncHighlightScroll();
  }

  function syncTextEditorHeight() {
    if (!editor || !textStack) return;
    editor.style.height = 'auto';
    const height = Math.max(320, editor.scrollHeight);
    editor.style.height = `${height}px`;
    highlight.style.minHeight = `${height}px`;
    textStack.style.minHeight = `${height}px`;
  }

  function syncHighlightScroll() {
    if (!editor || !highlight) return;
    highlight.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
  }

  function setStatus(state, text) {
    if (!statusEl) return;
    statusEl.dataset.state = state;
    const label = text || {
      saved: 'Saved',
      saving: 'Saving…',
      unsaved: 'Unsaved changes',
      error: 'Save failed',
    }[state] || state;
    if (statusTextEl) statusTextEl.textContent = label;
  }

  function parseEditorJson() {
    const text = editor?.value.trim() || '';
    if (!text) return null;
    return JSON.parse(text);
  }

  function updateValidBadge() {
    if (!validBadge || !editor) return;
    const text = editor.value.trim();
    if (!text) {
      validBadge.dataset.state = 'unknown';
      validBadge.textContent = 'Empty';
      editor.classList.remove('json-editor-invalid');
      textStack?.classList.remove('json-editor-invalid-wrap');
      return false;
    }
    try {
      JSON.parse(text);
      validBadge.dataset.state = 'valid';
      validBadge.textContent = 'Valid JSON';
      editor.classList.remove('json-editor-invalid');
      textStack?.classList.remove('json-editor-invalid-wrap');
      return true;
    } catch {
      validBadge.dataset.state = 'invalid';
      validBadge.textContent = 'Invalid JSON';
      editor.classList.add('json-editor-invalid');
      textStack?.classList.add('json-editor-invalid-wrap');
      return false;
    }
  }

  function valueTypeClass(val) {
    if (val === null) return 'json-val-null';
    if (typeof val === 'boolean') return 'json-val-boolean';
    if (typeof val === 'number') return 'json-val-number';
    if (typeof val === 'string') return 'json-val-string';
    return '';
  }

  function dotTypeClass(val) {
    if (val === null) return 'json-type-null';
    if (typeof val === 'boolean') return 'json-type-boolean';
    if (typeof val === 'number') return 'json-type-number';
    if (typeof val === 'string') return 'json-type-string';
    return '';
  }

  function formatPrimitive(val) {
    if (val === null) return 'null';
    if (typeof val === 'string') return `"${escapeHtml(val)}"`;
    return escapeHtml(String(val));
  }

  function createToggle(expanded) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'json-tree-toggle';
    btn.textContent = expanded ? '−' : '+';
    btn.setAttribute('aria-label', expanded ? 'Collapse' : 'Expand');
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    return btn;
  }

  function createLeafRow(key, val) {
    const row = document.createElement('div');
    row.className = 'json-tree-row json-tree-leaf';

    const gutter = document.createElement('span');
    gutter.className = 'json-tree-gutter';
    row.appendChild(gutter);

    const dot = document.createElement('span');
    dot.className = `json-type-dot ${dotTypeClass(val)}`;
    row.appendChild(dot);

    const keyEl = document.createElement('span');
    keyEl.className = 'json-tree-key';
    keyEl.textContent = key;
    row.appendChild(keyEl);

    const colon = document.createElement('span');
    colon.className = 'json-tree-colon';
    colon.textContent = ' : ';
    row.appendChild(colon);

    const valEl = document.createElement('span');
    valEl.className = `json-tree-value ${valueTypeClass(val)}`;
    valEl.innerHTML = formatPrimitive(val);
    row.appendChild(valEl);

    return row;
  }

  function createBranchNode(key, data, depth, expanded) {
    const isArray = Array.isArray(data);
    const node = document.createElement('div');
    node.className = 'json-tree-node';

    const row = document.createElement('div');
    row.className = 'json-tree-row json-tree-branch';

    const toggle = createToggle(expanded);
    row.appendChild(toggle);

    const icon = document.createElement('span');
    icon.className = `json-tree-icon ${isArray ? 'json-tree-icon-array' : 'json-tree-icon-object'}`;
    icon.textContent = isArray ? '[]' : '{}';
    row.appendChild(icon);

    if (key === null) {
      const rootLabel = document.createElement('span');
      rootLabel.className = 'json-tree-root-label';
      rootLabel.textContent = 'JSON';
      row.appendChild(rootLabel);
    } else {
      const keyEl = document.createElement('span');
      keyEl.className = 'json-tree-key';
      keyEl.textContent = key;
      row.appendChild(keyEl);
    }

    const children = document.createElement('div');
    children.className = 'json-tree-children';
    if (!expanded) children.classList.add('collapsed');

    const entries = isArray
      ? data.map((v, i) => [String(i), v])
      : Object.entries(data);

    entries.forEach(([entryKey, entryVal]) => {
      if (entryVal !== null && typeof entryVal === 'object') {
        children.appendChild(createBranchNode(entryKey, entryVal, depth + 1, false));
      } else {
        children.appendChild(createLeafRow(entryKey, entryVal));
      }
    });

    toggle.addEventListener('click', () => {
      const isOpen = !children.classList.contains('collapsed');
      children.classList.toggle('collapsed', isOpen);
      toggle.textContent = isOpen ? '+' : '−';
      toggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      toggle.setAttribute('aria-label', isOpen ? 'Expand' : 'Collapse');
    });

    node.appendChild(row);
    node.appendChild(children);
    return node;
  }

  function renderTreeViewer() {
    if (!treeViewer || !treeError) return;

    treeViewer.innerHTML = '';
    treeError.classList.add('hidden');
    treeError.textContent = '';

    const text = editor?.value.trim() || '';
    if (!text) {
      treeError.textContent = 'JSON is empty.';
      treeError.classList.remove('hidden');
      return;
    }

    try {
      const data = JSON.parse(text);
      if (data !== null && typeof data === 'object') {
        treeViewer.appendChild(createBranchNode(null, data, 0, true));
      } else {
        treeViewer.appendChild(createLeafRow('value', data));
      }
    } catch (e) {
      treeError.textContent = e.message || 'Invalid JSON — switch to Text tab to fix syntax.';
      treeError.classList.remove('hidden');
    }
  }

  function scheduleTreeRefresh() {
    if (activeTab !== 'viewer') return;
    clearTimeout(treeRefreshTimer);
    treeRefreshTimer = setTimeout(renderTreeViewer, 200);
  }

  function setActiveTab(tab) {
    activeTab = tab;
    const isViewer = tab === 'viewer';

    tabViewer?.classList.toggle('active', isViewer);
    tabText?.classList.toggle('active', !isViewer);
    tabViewer?.setAttribute('aria-selected', isViewer ? 'true' : 'false');
    tabText?.setAttribute('aria-selected', !isViewer ? 'true' : 'false');

    viewerWrap?.classList.toggle('hidden', !isViewer);
    textWrap?.classList.toggle('hidden', isViewer);

    if (isViewer) renderTreeViewer();
    else {
      syncTextHighlight();
      editor?.focus();
    }
  }

  async function runAutosave() {
    if (!cfg.currentDocId || !editor) return;
    if (saving) {
      pending = true;
      return;
    }
    saving = true;
    setStatus('saving');
    try {
      const res = await fetch(cfg.urls.docAutosave(cfg.currentDocId), {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify({
          title: titleInput ? titleInput.value : '',
          content: editor.value,
        }),
      });
      if (!res.ok) throw new Error();
      setStatus('saved');
      syncSidebarTitle(cfg.currentDocId, titleInput?.value || 'Untitled.json');
    } catch {
      setStatus('error');
    } finally {
      saving = false;
      if (pending) {
        pending = false;
        runAutosave();
      }
    }
  }

  function scheduleAutosave(immediate) {
    if (!cfg.currentDocId) return;
    setStatus('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(runAutosave, immediate ? 0 : AUTOSAVE_DELAY);
  }

  function syncSidebarTitle(docId, title) {
    if (!fileList) return;
    const item = fileList.querySelector(`.json-file-item[data-doc-id="${docId}"]`);
    const nameEl = item?.querySelector('.json-file-name');
    if (nameEl) nameEl.textContent = title || 'Untitled.json';
    if (item) item.dataset.docTitle = (title || '').toLowerCase();
  }

  async function saveDocumentTitle(docId, title) {
    const res = await fetch(cfg.urls.docAutosave(docId), {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error();
    syncSidebarTitle(docId, title);
    if (String(docId) === String(cfg.currentDocId) && titleInput) {
      titleInput.value = title;
    }
  }

  function startSidebarRename(item) {
    if (!item || item.querySelector('.json-file-name-input')) return;

    const docId = item.dataset.docId;
    const nameEl = item.querySelector('.json-file-name');
    if (!nameEl) return;

    const original = nameEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'json-file-name-input';
    input.value = original;
    input.setAttribute('aria-label', 'Edit file name');
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const newTitle = (save ? input.value.trim() : original) || 'Untitled.json';
      const span = document.createElement('span');
      span.className = 'json-file-name';
      span.title = 'Right-click for options';
      span.textContent = newTitle;
      input.replaceWith(span);
      item.dataset.docTitle = newTitle.toLowerCase();
      if (save) {
        try {
          await saveDocumentTitle(docId, newTitle);
        } catch {
          span.textContent = original;
          item.dataset.docTitle = original.toLowerCase();
        }
      }
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  function formatJson(spaces) {
    if (!editor) return false;
    try {
      const parsed = parseEditorJson();
      editor.value = JSON.stringify(parsed, null, spaces);
      updateValidBadge();
      syncTextHighlight();
      scheduleAutosave(true);
      scheduleTreeRefresh();
      if (findBar && !findBar.classList.contains('hidden')) runFind();
      return true;
    } catch {
      if (window.AppModal) {
        AppModal.alert({ title: 'Invalid JSON', message: 'Fix JSON syntax before formatting.' });
      }
      return false;
    }
  }

  async function copyJson() {
    if (!editor) return;
    try {
      await navigator.clipboard.writeText(editor.value);
      if (statusTextEl) {
        const prev = statusTextEl.textContent;
        const prevState = statusEl.dataset.state;
        statusTextEl.textContent = 'Copied!';
        statusEl.dataset.state = 'saved';
        setTimeout(() => {
          statusTextEl.textContent = prev;
          statusEl.dataset.state = prevState;
        }, 1500);
      }
    } catch {
      editor.select();
      document.execCommand('copy');
    }
  }

  function runFind() {
    if (!editor || !findInput) return;
    const query = findInput.value;
    findMatches = [];
    findIndex = -1;

    if (!query) {
      if (findCount) findCount.textContent = '';
      return;
    }

    const lowerText = editor.value.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let pos = 0;
    while (pos < lowerText.length) {
      const idx = lowerText.indexOf(lowerQuery, pos);
      if (idx === -1) break;
      findMatches.push(idx);
      pos = idx + lowerQuery.length;
    }

    if (findCount) {
      if (!findMatches.length) {
        findCount.textContent = 'No matches';
      } else {
        findIndex = 0;
        findCount.textContent = `1 of ${findMatches.length}`;
        goToFindMatch(0, false);
      }
    }
  }

  function goToFindMatch(index, updateCount = true) {
    if (!editor || !findInput || !findMatches.length) return;
    findIndex = ((index % findMatches.length) + findMatches.length) % findMatches.length;
    const start = findMatches[findIndex];
    const end = start + findInput.value.length;

    if (activeTab !== 'text') setActiveTab('text');

    editor.focus();
    editor.setSelectionRange(start, end);
    const lineHeight = parseInt(getComputedStyle(editor).lineHeight, 10) || 20;
    editor.scrollTop = Math.max(0, (start / editor.value.length) * editor.scrollHeight - lineHeight * 3);

    if (updateCount && findCount) {
      findCount.textContent = `${findIndex + 1} of ${findMatches.length}`;
    }
  }

  function filterFileList() {
    if (!fileSearch || !fileList) return;
    const q = fileSearch.value.trim().toLowerCase();
    fileList.querySelectorAll('.json-file-item').forEach((item) => {
      const title = item.dataset.docTitle || '';
      item.hidden = q && !title.includes(q);
    });
  }

  async function createDocument() {
    const res = await fetch(cfg.urls.docCreate, {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ title: 'Untitled.json', content: '{\n  \n}' }),
    });
    if (!res.ok) return;
    const data = await res.json();
    window.location.href = `${cfg.urls.index}?doc=${data.document.id}`;
  }

  async function deleteDocument(docId) {
    const id = docId || cfg.currentDocId;
    if (!id) return;

    const item = fileList?.querySelector(`.json-file-item[data-doc-id="${id}"]`);
    const fileName = item?.querySelector('.json-file-name')?.textContent || 'this file';

    if (window.AppModal) {
      const ok = await AppModal.confirm({
        title: 'Delete JSON file',
        message: `Delete "${fileName}" permanently?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true,
      });
      if (!ok) return;
    }

    await fetch(cfg.urls.docDelete(id), {
      method: 'POST',
      headers: csrfHeaders(),
    });

    if (String(id) === String(cfg.currentDocId)) {
      window.location.href = cfg.urls.index;
      return;
    }

    item?.remove();
    if (fileList && !fileList.querySelector('.json-file-item')) {
      document.getElementById('jsonEmptyList')?.classList.remove('hidden');
    }
  }

  let fileContextMenu = null;
  let fileContextTarget = null;

  function hideFileContextMenu() {
    fileContextMenu?.classList.add('hidden');
    fileContextTarget = null;
  }

  function ensureFileContextMenu() {
    if (fileContextMenu) return;
    fileContextMenu = document.createElement('div');
    fileContextMenu.className = 'json-file-context-menu hidden';
    fileContextMenu.innerHTML = `
      <button type="button" data-action="rename">Rename</button>
      <button type="button" data-action="delete" class="danger">Delete</button>
    `;
    document.body.appendChild(fileContextMenu);

    fileContextMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || !fileContextTarget) return;
      const action = btn.dataset.action;
      const item = fileContextTarget;
      hideFileContextMenu();
      if (action === 'rename') startSidebarRename(item);
      if (action === 'delete') deleteDocument(item.dataset.docId);
    });
  }

  function showFileContextMenu(x, y, item) {
    ensureFileContextMenu();
    fileContextTarget = item;
    fileContextMenu.classList.remove('hidden');

    const menuRect = fileContextMenu.getBoundingClientRect();
    const maxX = window.innerWidth - menuRect.width - 8;
    const maxY = window.innerHeight - menuRect.height - 8;
    fileContextMenu.style.left = `${Math.min(x, maxX)}px`;
    fileContextMenu.style.top = `${Math.min(y, maxY)}px`;
  }

  function openDocument(docId) {
    window.location.href = `${cfg.urls.index}?doc=${docId}`;
  }

  btnNewJson?.addEventListener('click', createDocument);
  btnNewJsonWelcome?.addEventListener('click', createDocument);

  fileList?.addEventListener('contextmenu', (e) => {
    const nameEl = e.target.closest('.json-file-name');
    if (!nameEl) return;
    const item = nameEl.closest('.json-file-item');
    if (!item) return;
    e.preventDefault();
    showFileContextMenu(e.clientX, e.clientY, item);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.json-file-context-menu')) hideFileContextMenu();
  });

  fileList?.addEventListener('click', (e) => {
    if (e.target.classList.contains('json-file-name-input')) return;

    const btn = e.target.closest('.json-file-btn');
    if (!btn) return;
    const docId = btn.dataset.docId;
    if (docId && String(docId) !== String(cfg.currentDocId)) {
      openDocument(docId);
    }
  });

  fileSearch?.addEventListener('input', filterFileList);

  tabViewer?.addEventListener('click', () => setActiveTab('viewer'));
  tabText?.addEventListener('click', () => setActiveTab('text'));

  if (editor) {
    editor.addEventListener('input', () => {
      updateValidBadge();
      syncTextHighlight();
      scheduleAutosave();
      scheduleTreeRefresh();
      if (findBar && !findBar.classList.contains('hidden')) runFind();
    });
    editor.addEventListener('scroll', syncHighlightScroll);
    updateValidBadge();
    syncTextHighlight();
  }

  titleInput?.addEventListener('input', () => {
    scheduleAutosave();
    syncSidebarTitle(cfg.currentDocId, titleInput.value || 'Untitled.json');
  });

  btnSave?.addEventListener('click', () => {
    clearTimeout(saveTimer);
    runAutosave();
  });

  btnFormat?.addEventListener('click', () => formatJson(2));
  btnMinify?.addEventListener('click', () => formatJson(0));
  btnCopy?.addEventListener('click', copyJson);
  btnDelete?.addEventListener('click', () => deleteDocument(cfg.currentDocId));

  btnSearch?.addEventListener('click', () => {
    setActiveTab('text');
    findBar?.classList.remove('hidden');
    findInput?.focus();
    findInput?.select();
  });

  btnFindClose?.addEventListener('click', () => {
    findBar?.classList.add('hidden');
    if (findCount) findCount.textContent = '';
    findMatches = [];
    if (activeTab === 'text') editor?.focus();
  });

  findInput?.addEventListener('input', runFind);
  findInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (findMatches.length) goToFindMatch(findIndex - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!findMatches.length) runFind();
      else goToFindMatch(findIndex + 1);
    }
  });

  btnFindNext?.addEventListener('click', () => goToFindMatch(findIndex + 1));
  btnFindPrev?.addEventListener('click', () => goToFindMatch(findIndex - 1));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideFileContextMenu();
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && editor) {
      e.preventDefault();
      setActiveTab('text');
      findBar?.classList.remove('hidden');
      findInput?.focus();
      findInput?.select();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      clearTimeout(saveTimer);
      runAutosave();
    }
  });

  if (cfg.currentDocId) {
    setStatus('saved');
    setActiveTab('viewer');
  }
})();
