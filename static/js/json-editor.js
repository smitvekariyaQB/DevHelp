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
  const textEditor = document.getElementById('jsonTextEditor');
  const textStack = document.querySelector('.json-text-stack');
  const lineGutter = document.getElementById('jsonLineGutter');
  const lineNumbers = document.getElementById('jsonLineNumbers');
  const treeViewer = document.getElementById('jsonTreeViewer');
  const treeError = document.getElementById('jsonTreeError');
  const viewerWrap = document.getElementById('jsonViewerWrap');
  const textWrap = document.getElementById('jsonTextWrap');
  const tabViewer = document.getElementById('tabJsonViewer');
  const tabText = document.getElementById('tabJsonText');
  const validBadge = document.getElementById('jsonValidBadge');
  const parseErrorEl = document.getElementById('jsonParseError');
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
  const viewerActions = document.getElementById('jsonViewerActions');
  const btnExpandAll = document.getElementById('btnExpandAll');
  const btnCollapseAll = document.getElementById('btnCollapseAll');

  let saving = false;
  let pending = false;
  let findMatches = [];
  let findIndex = -1;
  let activeTab = 'text';
  let treeRefreshTimer;
  let lastParseError = null;

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

  function getLineColumn(text, position) {
    const before = text.slice(0, position);
    const lines = before.split('\n');
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
    };
  }

  function getErrorRange(text, position) {
    if (position == null || position < 0 || position >= text.length) return null;
    let start = position;
    let end = Math.min(text.length, position + 1);
    while (end < text.length && end - position < 24 && !/[\s,\[\]{}:]/.test(text[end])) {
      end += 1;
    }
    return { start, end };
  }

  function cleanParseMessage(message) {
    return String(message || 'Invalid JSON')
      .replace(/^JSON\.parse:\s*/i, '')
      .replace(/\s*at position\s+\d+\s*(\([^)]*\))?/i, '')
      .replace(/\s*in JSON\s*(\([^)]*\))?/i, '')
      .trim();
  }

  function analyzeJson(text) {
    if (!text.trim()) {
      return { valid: false, empty: true };
    }
    try {
      return { valid: true, data: JSON.parse(text) };
    } catch (e) {
      const fullMessage = e.message || 'Invalid JSON';
      let position = null;
      const posMatch = fullMessage.match(/position\s+(\d+)/i);
      if (posMatch) position = parseInt(posMatch[1], 10);

      let line = null;
      let column = null;
      const lineColMatch = fullMessage.match(/line\s+(\d+)\s+column\s+(\d+)/i);
      if (lineColMatch) {
        line = parseInt(lineColMatch[1], 10);
        column = parseInt(lineColMatch[2], 10);
        if (position == null) {
          position = getPositionFromLineColumn(text, line, column);
        }
      } else if (position != null) {
        ({ line, column } = getLineColumn(text, position));
      }

      const message = cleanParseMessage(fullMessage);
      const errorRange = position != null ? getErrorRange(text, position) : null;
      const snippetLine = line != null ? (text.split('\n')[line - 1] ?? '') : '';

      return {
        valid: false,
        message,
        fullMessage,
        position,
        line,
        column,
        errorRange,
        snippetLine,
      };
    }
  }

  function getPositionFromLineColumn(text, line, column) {
    const lines = text.split('\n');
    if (line < 1 || line > lines.length) return null;
    let pos = 0;
    for (let i = 0; i < line - 1; i += 1) {
      pos += lines[i].length + 1;
    }
    return pos + Math.max(0, column - 1);
  }

  function buildErrorSnippet(lineText, column) {
    if (!lineText) return '';
    const col = Math.max(1, column || 1);
    const before = escapeHtml(lineText.slice(0, col - 1));
    const badChar = lineText[col - 1] ?? '';
    const after = escapeHtml(lineText.slice(col));
    return `${before}<mark class="json-error-mark">${escapeHtml(badChar || '?')}</mark>${after}`;
  }

  function formatErrorDetails(error) {
    if (!error || error.empty) return '';
    const loc = error.line != null
      ? `Line ${error.line}, column ${error.column}`
      : (error.position != null ? `Position ${error.position}` : 'Syntax error');
    let html = `<strong>${loc}:</strong> ${escapeHtml(error.message)}`;
    if (error.snippetLine) {
      html += `<pre class="json-error-snippet">${buildErrorSnippet(error.snippetLine, error.column)}</pre>`;
    }
    return html;
  }

  function applySyntaxHighlight(escaped) {
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

  function highlightJsonText(text, errorRange, findState) {
    const findLen = findState?.queryLength ?? 0;
    const findActiveIndex = findState?.activeIndex ?? -1;
    const findMatchList = findState?.matches ?? [];

    const ranges = [];
    if (errorRange) {
      ranges.push({ start: errorRange.start, end: errorRange.end, type: 'error' });
    }
    if (findLen > 0 && findMatchList.length) {
      findMatchList.forEach((start, i) => {
        ranges.push({
          start,
          end: start + findLen,
          type: i === findActiveIndex ? 'find-active' : 'find',
        });
      });
    }

    if (!ranges.length) {
      return `${applySyntaxHighlight(escapeHtml(text))}\n`;
    }

    const boundaries = new Set([0, text.length]);
    ranges.forEach((range) => {
      boundaries.add(range.start);
      boundaries.add(range.end);
    });
    const points = [...boundaries].sort((a, b) => a - b);

    const wrapClass = {
      error: 'json-hl-error',
      find: 'json-hl-find',
      'find-active': 'json-hl-find-active',
    };

    let html = '';
    for (let i = 0; i < points.length - 1; i += 1) {
      const segStart = points[i];
      const segEnd = points[i + 1];
      if (segStart >= segEnd) continue;

      const mid = (segStart + segEnd) / 2;
      const covering = ranges.filter((range) => mid >= range.start && mid < range.end);
      let type = null;
      if (covering.some((range) => range.type === 'find-active')) type = 'find-active';
      else if (covering.some((range) => range.type === 'error')) type = 'error';
      else if (covering.some((range) => range.type === 'find')) type = 'find';

      const segment = applySyntaxHighlight(escapeHtml(text.slice(segStart, segEnd)));
      html += type ? `<span class="${wrapClass[type]}">${segment}</span>` : segment;
    }
    return `${html}\n`;
  }

  function getFindHighlightState() {
    if (!findBar || findBar.classList.contains('hidden') || !findInput?.value) {
      return null;
    }
    return {
      matches: findMatches,
      activeIndex: findIndex,
      queryLength: findInput.value.length,
    };
  }

  function syncLineNumbers() {
    if (!editor || !lineNumbers) return;
    const lines = editor.value.split('\n');
    const errorLine = lastParseError?.line;
    if (errorLine) {
      lineNumbers.innerHTML = lines.map((_, i) => {
        const num = i + 1;
        const cls = num === errorLine ? 'json-line-num json-line-num-error' : 'json-line-num';
        return `<span class="${cls}">${num}</span>`;
      }).join('');
    } else {
      lineNumbers.textContent = lines.map((_, i) => i + 1).join('\n');
    }
  }

  function syncTextHighlight() {
    if (!editor || !highlight) return;
    highlight.innerHTML = highlightJsonText(
      editor.value,
      lastParseError?.errorRange ?? null,
      getFindHighlightState(),
    );
    syncLineNumbers();
    syncTextEditorHeight();
    syncHighlightScroll();
  }

  function showParseError(error) {
    if (!parseErrorEl) return;
    if (!error || error.valid || error.empty) {
      parseErrorEl.classList.add('hidden');
      parseErrorEl.innerHTML = '';
      return;
    }
    parseErrorEl.innerHTML = formatErrorDetails(error);
    parseErrorEl.classList.remove('hidden');
  }

  function scrollToParseError(error) {
    if (!editor || !error?.errorRange) return;
    const { start, end } = error.errorRange;
    editor.focus();
    editor.setSelectionRange(start, end);
    const lineHeight = parseInt(getComputedStyle(editor).lineHeight, 10) || 21;
    const line = error.line || getLineColumn(editor.value, start).line;
    if (textWrap) {
      textWrap.scrollTop = Math.max(0, (line - 1) * lineHeight - 80);
    }
    syncHighlightScroll();
  }

  function getEditorMinHeight() {
    if (!textWrap) return 240;
    return Math.max(240, textWrap.clientHeight);
  }

  function syncTextEditorHeight() {
    if (!editor || !textStack) return;
    editor.style.height = 'auto';
    const contentHeight = editor.scrollHeight;
    const minHeight = getEditorMinHeight();
    const height = Math.max(contentHeight, minHeight);
    editor.style.height = `${height}px`;
    highlight.style.height = `${height}px`;
    textStack.style.minHeight = `${height}px`;
    if (lineGutter) lineGutter.style.minHeight = `${height}px`;
    if (textEditor) textEditor.style.minHeight = `${height}px`;
  }

  function syncHighlightScroll() {
    if (!editor || !highlight) return;
    highlight.style.transform = `translate(${-editor.scrollLeft}px, 0)`;
  }

  async function runSave() {
    if (!cfg.currentDocId || !editor) return;
    if (saving) {
      pending = true;
      return;
    }
    saving = true;
    const saveLabel = btnSave?.textContent;
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.textContent = 'Saving…';
    }
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
      syncSidebarTitle(cfg.currentDocId, titleInput?.value || 'Untitled.json');
      if (btnSave) btnSave.textContent = 'Saved';
    } catch {
      if (btnSave) btnSave.textContent = 'Save failed';
    } finally {
      saving = false;
      if (btnSave) {
        btnSave.disabled = false;
        setTimeout(() => {
          if (btnSave.textContent === 'Saved' || btnSave.textContent === 'Save failed') {
            btnSave.textContent = saveLabel || 'Save';
          }
        }, 1500);
      }
      if (pending) {
        pending = false;
        runSave();
      }
    }
  }

  function parseEditorJson() {
    const text = editor?.value.trim() || '';
    if (!text) return null;
    return JSON.parse(text);
  }

  function updateValidBadge() {
    if (!validBadge || !editor) return false;

    const result = analyzeJson(editor.value);
    lastParseError = result.valid || result.empty ? null : result;

    if (result.empty) {
      validBadge.dataset.state = 'unknown';
      validBadge.textContent = 'Empty';
      validBadge.title = '';
      editor.classList.remove('json-editor-invalid');
      textEditor?.classList.remove('json-editor-invalid-wrap');
      showParseError(null);
      return false;
    }

    if (result.valid) {
      validBadge.dataset.state = 'valid';
      validBadge.textContent = 'Valid JSON';
      validBadge.title = '';
      editor.classList.remove('json-editor-invalid');
      textEditor?.classList.remove('json-editor-invalid-wrap');
      showParseError(null);
      return true;
    }

    validBadge.dataset.state = 'invalid';
    validBadge.textContent = result.line != null
      ? `Invalid · Line ${result.line}`
      : 'Invalid JSON';
    validBadge.title = result.message;
    editor.classList.add('json-editor-invalid');
    textEditor?.classList.add('json-editor-invalid-wrap');
    showParseError(result);
    return false;
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
    treeError.innerHTML = '';

    const text = editor?.value ?? '';
    if (!text.trim()) {
      treeError.textContent = 'JSON is empty.';
      treeError.classList.remove('hidden');
      return;
    }

    const result = analyzeJson(text);
    if (result.valid) {
      if (result.data !== null && typeof result.data === 'object') {
        treeViewer.appendChild(createBranchNode(null, result.data, 0, true));
      } else {
        treeViewer.appendChild(createLeafRow('value', result.data));
      }
      return;
    }

    treeError.innerHTML = formatErrorDetails(result);
    treeError.classList.remove('hidden');
  }

  function scheduleTreeRefresh() {
    if (activeTab !== 'viewer') return;
    clearTimeout(treeRefreshTimer);
    treeRefreshTimer = setTimeout(renderTreeViewer, 200);
  }

  function setActiveTab(tab) {
    activeTab = tab;
    const isViewer = tab === 'viewer';

    document.querySelector('.json-workspace')?.classList.toggle('json-workspace-viewer', isViewer);

    tabViewer?.classList.toggle('active', isViewer);
    tabText?.classList.toggle('active', !isViewer);
    tabViewer?.setAttribute('aria-selected', isViewer ? 'true' : 'false');
    tabText?.setAttribute('aria-selected', !isViewer ? 'true' : 'false');

    viewerWrap?.classList.toggle('hidden', !isViewer);
    viewerActions?.classList.toggle('hidden', !isViewer);
    textWrap?.classList.toggle('hidden', isViewer);

    if (isViewer) renderTreeViewer();
    else {
      syncTextHighlight();
      syncTextEditorHeight();
      if (lastParseError) scrollToParseError(lastParseError);
      else editor?.focus();
    }
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
      syncTextHighlight();
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
        findCount.textContent = `${findMatches.length} match${findMatches.length === 1 ? '' : 'es'}`;
      }
    }
    syncTextHighlight();
  }

  function goToFindMatch(index, updateCount = true) {
    if (!editor || !findInput || !findMatches.length) return;
    findIndex = ((index % findMatches.length) + findMatches.length) % findMatches.length;
    const start = findMatches[findIndex];
    const end = start + findInput.value.length;

    if (activeTab !== 'text') setActiveTab('text');
    syncTextHighlight();

    const revealMatch = () => {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(start, end);
      const lineHeight = parseInt(getComputedStyle(editor).lineHeight, 10) || 20;
      const line = getLineColumn(editor.value, start).line;
      if (textWrap) {
        textWrap.scrollTop = Math.max(0, (line - 1) * lineHeight - 80);
      }
      findInput?.focus();
    };

    // Defer so Enter in the find bar does not insert into the editor.
    setTimeout(revealMatch, 0);

    if (updateCount && findCount) {
      findCount.textContent = `${findIndex + 1} of ${findMatches.length}`;
    }
  }

  function findNextMatch() {
    if (!findInput?.value.trim()) return;
    if (!findMatches.length) runFind();
    if (!findMatches.length) return;
    goToFindMatch(findIndex === -1 ? 0 : findIndex + 1);
  }

  function findPrevMatch() {
    if (!findMatches.length) return;
    goToFindMatch(findIndex === -1 ? findMatches.length - 1 : findIndex - 1);
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
      body: JSON.stringify({ title: 'Untitled.json', content: '' }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (window.routerNavigate) window.routerNavigate(`${cfg.urls.index}?doc=${data.document.id}`);
    else window.location.href = `${cfg.urls.index}?doc=${data.document.id}`;
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
      if (window.routerNavigate) window.routerNavigate(cfg.urls.index);
      else window.location.href = cfg.urls.index;
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
    if (window.routerNavigate) window.routerNavigate(`${cfg.urls.index}?doc=${docId}`);
    else window.location.href = `${cfg.urls.index}?doc=${docId}`;
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

  function onDocClick(e) {
    if (!e.target.closest('.json-file-context-menu')) hideFileContextMenu();
  }
  document.addEventListener('click', onDocClick);

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

  btnExpandAll?.addEventListener('click', () => {
    if (!treeViewer) return;
    treeViewer.querySelectorAll('.json-tree-children').forEach((children) => {
      children.classList.remove('collapsed');
      const toggle = children.parentElement?.querySelector('.json-tree-toggle');
      if (toggle) {
        toggle.textContent = '−';
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'Collapse');
      }
    });
  });

  btnCollapseAll?.addEventListener('click', () => {
    if (!treeViewer) return;
    // Collapse all except the root node
    const rootChildren = treeViewer.querySelector('.json-tree-children');
    treeViewer.querySelectorAll('.json-tree-children').forEach((children) => {
      if (children === rootChildren) return;
      children.classList.add('collapsed');
      const toggle = children.parentElement?.querySelector('.json-tree-toggle');
      if (toggle) {
        toggle.textContent = '+';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Expand');
      }
    });
  });

  if (editor) {
    editor.addEventListener('input', () => {
      updateValidBadge();
      scheduleTreeRefresh();
      if (findBar && !findBar.classList.contains('hidden') && findInput?.value) {
        runFind();
      } else {
        syncTextHighlight();
      }
    });
    editor.addEventListener('scroll', syncHighlightScroll);
    updateValidBadge();
    syncTextHighlight();
  }

  parseErrorEl?.addEventListener('click', () => {
    if (!lastParseError) return;
    setActiveTab('text');
    scrollToParseError(lastParseError);
  });

  treeError?.addEventListener('click', () => {
    if (!lastParseError) return;
    setActiveTab('text');
    scrollToParseError(lastParseError);
  });

  titleInput?.addEventListener('input', () => {
    syncSidebarTitle(cfg.currentDocId, titleInput.value || 'Untitled.json');
  });

  btnSave?.addEventListener('click', () => {
    runSave();
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
    findIndex = -1;
    syncTextHighlight();
    if (activeTab === 'text') editor?.focus();
  });

  findInput?.addEventListener('input', runFind);
  findInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      findPrevMatch();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      findNextMatch();
    }
  });

  btnFindNext?.addEventListener('click', findNextMatch);
  btnFindPrev?.addEventListener('click', findPrevMatch);

  function onDocKeydown(e) {
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
      runSave();
    }
  }
  document.addEventListener('keydown', onDocKeydown);

  let resizeObserver;
  if (textWrap && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => syncTextEditorHeight());
    resizeObserver.observe(textWrap);
  }

  if (cfg.currentDocId) {
    setActiveTab('text');
  }

  // Register cleanup for the router so listeners/timers are removed on navigate
  if (window.__routerCleanup) {
    window.__routerCleanup.push(() => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onDocKeydown);
      clearTimeout(treeRefreshTimer);
      resizeObserver?.disconnect();
    });
  }
})();
