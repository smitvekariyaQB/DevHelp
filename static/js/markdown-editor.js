(function () {
  const cfg = window.MARKDOWN_EDITOR_CONFIG;
  const app = document.getElementById('markdownApp');
  if (!cfg || !app) return;

  const fileList = document.getElementById('mdFileList');
  const fileSearch = document.getElementById('mdFileSearch');
  const btnNewMarkdown = document.getElementById('btnNewMarkdown');
  const btnNewMarkdownWelcome = document.getElementById('btnNewMarkdownWelcome');
  const titleInput = document.getElementById('markdownTitleInput');
  const btnSave = document.getElementById('btnMarkdownSave');
  const btnDelete = document.getElementById('btnDeleteMarkdown');

  const workspace = document.getElementById('markdownWorkspace');
  const editorPane = document.getElementById('markdownEditorPane');
  const previewPane = document.getElementById('markdownPreviewPane');
  const resizer = document.getElementById('markdownResizer');
  const btnToggleEditor = document.getElementById('btnToggleEditor');
  const btnTogglePreview = document.getElementById('btnTogglePreview');
  const editor = document.getElementById('markdownEditor');
  const highlight = document.getElementById('markdownHighlight');
  const textEditor = document.getElementById('markdownTextEditor');
  const textWrap = document.getElementById('markdownEditorWrap');
  const textStack = document.querySelector('.markdown-text-stack');
  const lineGutter = document.getElementById('markdownLineGutter');
  const lineNumbers = document.getElementById('markdownLineNumbers');
  const preview = document.getElementById('markdownPreview');
  const previewWrap = document.getElementById('markdownPreviewWrap');
  const scrollSyncToggle = document.getElementById('markdownScrollSync');
  const btnSearch = document.getElementById('btnMarkdownSearch');
  const btnCopy = document.getElementById('btnMarkdownCopy');
  const findBar = document.getElementById('markdownFindBar');
  const findInput = document.getElementById('markdownFindInput');
  const findCount = document.getElementById('markdownFindCount');
  const btnFindPrev = document.getElementById('btnMarkdownFindPrev');
  const btnFindNext = document.getElementById('btnMarkdownFindNext');
  const btnFindClose = document.getElementById('btnMarkdownFindClose');

  let findMatches = [];
  let findIndex = -1;
  let previewTimer;
  let isResizing = false;
  let resizeObserver;
  let scrollSyncEnabled = true;
  let isScrollSyncing = false;
  const drafts = window.createEditorDraftStore?.('markdown') || {
    save() {},
    load() {
      return null;
    },
    clear() {},
  };

  let saving = false;
  let pending = false;
  let draftTimer;
  let fileContextMenu = null;
  let fileContextTarget = null;

  const MIN_PANE_PCT = 15;

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

  function buildFindHighlightHtml(text) {
    const query = findInput?.value || '';
    if (!query || !findMatches.length) {
      return escapeHtml(text) + '\n';
    }

    const parts = [];
    let last = 0;
    findMatches.forEach((start, i) => {
      const end = start + query.length;
      parts.push(escapeHtml(text.slice(last, start)));
      const cls = i === findIndex ? 'markdown-find-active' : 'markdown-find-match';
      parts.push(`<mark class="${cls}">${escapeHtml(text.slice(start, end))}</mark>`);
      last = end;
    });
    parts.push(escapeHtml(text.slice(last)));
    return parts.join('') + '\n';
  }

  function syncLineNumbers() {
    if (!editor || !lineNumbers) return;
    const lines = editor.value.split('\n').length || 1;
    lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  }

  function getEditorMinHeight() {
    if (!textWrap) return 240;
    return Math.max(240, textWrap.clientHeight);
  }

  function getEditorContentHeight() {
    if (!editor) return 240;
    const style = getComputedStyle(editor);
    const lineHeight = parseFloat(style.lineHeight) || 20.8;
    const paddingTop = parseFloat(style.paddingTop) || 16;
    const paddingBottom = parseFloat(style.paddingBottom) || 16;
    const lineCount = Math.max(1, editor.value.split('\n').length);

    editor.style.height = '0px';
    const scrollHeight = editor.scrollHeight;
    const lineBasedHeight = lineCount * lineHeight + paddingTop + paddingBottom;

    return Math.max(scrollHeight, lineBasedHeight);
  }

  function syncTextEditorHeight() {
    if (!editor || !textStack) return;
    const contentHeight = getEditorContentHeight();
    const minHeight = getEditorMinHeight();
    const height = Math.max(contentHeight, minHeight);

    editor.style.height = `${height}px`;
    if (highlight) highlight.style.height = `${height}px`;
    textStack.style.minHeight = `${height}px`;
    if (lineGutter) lineGutter.style.minHeight = `${height}px`;
    if (lineNumbers) lineNumbers.style.minHeight = `${height}px`;
    if (textEditor) textEditor.style.minHeight = `${height}px`;
  }

  function syncHighlightScroll() {
    if (!editor || !highlight) return;
    highlight.style.transform = `translate(${-editor.scrollLeft}px, 0)`;
  }

  function syncTextHighlight() {
    if (!editor || !highlight) return;
    highlight.innerHTML = buildFindHighlightHtml(editor.value);
    syncLineNumbers();
    syncTextEditorHeight();
    syncHighlightScroll();
  }

  function renderPreview() {
    if (!editor || !preview || typeof marked === 'undefined') return;
    try {
      preview.innerHTML = marked.parse(editor.value, { breaks: true, gfm: true });
    } catch {
      preview.innerHTML = '<p class="markdown-preview-error">Unable to render preview.</p>';
    }
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const ratio = scrollSyncEnabled && textWrap ? getScrollRatio(textWrap) : null;
      renderPreview();
      if (ratio != null && previewWrap) {
        requestAnimationFrame(() => setScrollFromRatio(previewWrap, ratio));
      }
    }, 120);
  }

  function getScrollRatio(el) {
    if (!el) return 0;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return 0;
    return el.scrollTop / max;
  }

  function setScrollFromRatio(el, ratio) {
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.max(0, ratio * max);
  }

  function canScrollSync() {
    return scrollSyncEnabled
      && !isPaneCollapsed(editorPane)
      && !isPaneCollapsed(previewPane)
      && textWrap
      && previewWrap;
  }

  function syncScrollFromSource(source, target) {
    if (!canScrollSync() || isScrollSyncing || !source || !target) return;
    isScrollSyncing = true;
    setScrollFromRatio(target, getScrollRatio(source));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isScrollSyncing = false;
      });
    });
  }

  function onEditorWrapScroll() {
    if (isScrollSyncing || !scrollSyncEnabled) return;
    syncScrollFromSource(textWrap, previewWrap);
  }

  function onPreviewWrapScroll() {
    if (isScrollSyncing || !scrollSyncEnabled) return;
    syncScrollFromSource(previewWrap, textWrap);
  }

  function setScrollSyncEnabled(enabled) {
    scrollSyncEnabled = enabled;
    if (scrollSyncToggle) scrollSyncToggle.checked = enabled;
  }

  function onScrollSyncToggle() {
    setScrollSyncEnabled(scrollSyncToggle?.checked ?? false);
    if (scrollSyncEnabled && textWrap && previewWrap) {
      syncScrollFromSource(textWrap, previewWrap);
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

    syncTextHighlight();

    const revealMatch = () => {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(start, end);
      const lineHeight = parseInt(getComputedStyle(editor).lineHeight, 10) || 20;
      const line = getLineColumn(editor.value, start).line;
      if (textWrap) {
        textWrap.scrollTop = Math.max(0, (line - 1) * lineHeight - 80);
      }
      syncHighlightScroll();
      findInput?.focus();
    };

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

  async function copyMarkdown() {
    if (!editor) return;
    try {
      await navigator.clipboard.writeText(editor.value);
    } catch {
      editor.select();
      document.execCommand('copy');
    }
    if (btnCopy) {
      const original = btnCopy.textContent;
      btnCopy.textContent = 'Copied!';
      setTimeout(() => {
        btnCopy.textContent = original;
      }, 1500);
    }
  }

  function openFindBar() {
    findBar?.classList.remove('hidden');
    findInput?.focus();
    findInput?.select();
  }

  function closeFindBar() {
    findBar?.classList.add('hidden');
    findMatches = [];
    findIndex = -1;
    if (findInput) findInput.value = '';
    if (findCount) findCount.textContent = '';
    syncTextHighlight();
    editor?.focus();
  }

  function getDraftPayload() {
    return {
      title: titleInput ? titleInput.value : '',
      content: editor ? editor.value : '',
    };
  }

  function scheduleDraftSave() {
    if (!cfg.currentDocId || !editor) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      drafts.save(cfg.currentDocId, getDraftPayload());
    }, 300);
  }

  function flushDraftSave() {
    clearTimeout(draftTimer);
    if (!cfg.currentDocId || !editor) return;
    drafts.save(cfg.currentDocId, getDraftPayload());
  }

  function restoreDraftIfAny() {
    if (!cfg.currentDocId || !editor) return;
    const draft = drafts.load(cfg.currentDocId);
    if (!draft) return;
    if (titleInput) titleInput.value = draft.title;
    editor.value = draft.content;
    syncSidebarTitle(cfg.currentDocId, draft.title || 'Untitled.md');
    syncTextHighlight();
    schedulePreview();
    if (findBar && !findBar.classList.contains('hidden')) runFind();
  }

  function onEditorInput() {
    syncTextHighlight();
    schedulePreview();
    scheduleDraftSave();
    if (findBar && !findBar.classList.contains('hidden')) runFind();
  }

  function isPaneCollapsed(pane) {
    return pane?.classList.contains('markdown-pane-collapsed');
  }

  function updateResizerVisibility() {
    if (!resizer) return;
    const editorHidden = isPaneCollapsed(editorPane);
    const previewHidden = isPaneCollapsed(previewPane);
    resizer.hidden = editorHidden || previewHidden;
    workspace?.classList.toggle('markdown-editor-collapsed', editorHidden);
    workspace?.classList.toggle('markdown-preview-collapsed', previewHidden);
  }

  function isVerticalLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function setPaneCollapsed(pane, button, collapsed) {
    if (!pane || !button) return;
    pane.classList.toggle('markdown-pane-collapsed', collapsed);
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    const isEditor = pane === editorPane;
    button.title = collapsed
      ? (isEditor ? 'Show editor' : 'Show preview')
      : (isEditor ? 'Hide editor' : 'Hide preview');
    button.setAttribute('aria-label', button.title);
    updateResizerVisibility();
    if (!collapsed) {
      requestAnimationFrame(() => {
        syncTextEditorHeight();
      });
    }
  }

  function toggleEditorPane() {
    if (!editorPane || !btnToggleEditor) return;
    if (isPaneCollapsed(editorPane)) {
      setPaneCollapsed(editorPane, btnToggleEditor, false);
      return;
    }
    if (!isPaneCollapsed(previewPane)) {
      setPaneCollapsed(editorPane, btnToggleEditor, true);
    }
  }

  function togglePreviewPane() {
    if (!previewPane || !btnTogglePreview) return;
    if (isPaneCollapsed(previewPane)) {
      setPaneCollapsed(previewPane, btnTogglePreview, false);
      return;
    }
    if (!isPaneCollapsed(editorPane)) {
      setPaneCollapsed(previewPane, btnTogglePreview, true);
    }
  }

  function clampSplitPct(pct) {
    return Math.min(100 - MIN_PANE_PCT, Math.max(MIN_PANE_PCT, pct));
  }

  function setSplitPct(pct) {
    if (!workspace || isPaneCollapsed(editorPane) || isPaneCollapsed(previewPane)) return;
    const clamped = clampSplitPct(pct);
    if (isVerticalLayout()) {
      workspace.style.setProperty('--md-editor-height', `${clamped}%`);
    } else {
      workspace.style.setProperty('--md-editor-width', `${clamped}%`);
    }
  }

  function getSplitPct() {
    if (!workspace || !editorPane) return 50;
    const rect = workspace.getBoundingClientRect();
    const editorRect = editorPane.getBoundingClientRect();
    if (isVerticalLayout()) {
      if (!rect.height) return 50;
      return (editorRect.height / rect.height) * 100;
    }
    if (!rect.width) return 50;
    return (editorRect.width / rect.width) * 100;
  }

  function onResizeMove(clientX, clientY) {
    if (!workspace || !isResizing) return;
    const rect = workspace.getBoundingClientRect();
    const resizerSize = isVerticalLayout()
      ? (resizer?.offsetHeight || 0)
      : (resizer?.offsetWidth || 0);

    if (isVerticalLayout()) {
      const available = rect.height - resizerSize;
      const offset = clientY - rect.top;
      setSplitPct((offset / available) * 100);
      return;
    }

    const available = rect.width - resizerSize;
    const offset = clientX - rect.left;
    setSplitPct((offset / available) * 100);
  }

  function startResize(e) {
    if (resizer?.hidden) return;
    isResizing = true;
    document.body.classList.add('markdown-resizing');
    if (e.type === 'mousedown') {
      e.preventDefault();
    }
  }

  function stopResize() {
    if (!isResizing) return;
    isResizing = false;
    document.body.classList.remove('markdown-resizing');
  }

  function onResizerKeydown(e) {
    if (!resizer || resizer.hidden) return;
    const step = e.shiftKey ? 10 : 2;
    const vertical = isVerticalLayout();
    if ((!vertical && e.key === 'ArrowLeft') || (vertical && e.key === 'ArrowUp')) {
      e.preventDefault();
      setSplitPct(getSplitPct() - step);
    } else if ((!vertical && e.key === 'ArrowRight') || (vertical && e.key === 'ArrowDown')) {
      e.preventDefault();
      setSplitPct(getSplitPct() + step);
    }
  }

  function onGlobalKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && editor && document.contains(editor)) {
      e.preventDefault();
      openFindBar();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && editor && cfg.currentDocId) {
      e.preventDefault();
      runSave();
    }
    if (e.key === 'Escape') hideFileContextMenu();
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
      syncSidebarTitle(cfg.currentDocId, titleInput?.value || 'Untitled.md');
      drafts.clear(cfg.currentDocId);
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

  function syncSidebarTitle(docId, title) {
    if (!fileList) return;
    const item = fileList.querySelector(`.md-file-item[data-doc-id="${docId}"]`);
    const nameEl = item?.querySelector('.md-file-name');
    if (nameEl) nameEl.textContent = title || 'Untitled.md';
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
    if (!item || item.querySelector('.md-file-name-input')) return;

    const docId = item.dataset.docId;
    const nameEl = item.querySelector('.md-file-name');
    if (!nameEl) return;

    const original = nameEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'md-file-name-input';
    input.value = original;
    input.setAttribute('aria-label', 'Edit file name');
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const newTitle = (save ? input.value.trim() : original) || 'Untitled.md';
      const span = document.createElement('span');
      span.className = 'md-file-name';
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

  function filterFileList() {
    if (!fileSearch || !fileList) return;
    const q = fileSearch.value.trim().toLowerCase();
    fileList.querySelectorAll('.md-file-item').forEach((item) => {
      const title = item.dataset.docTitle || '';
      item.hidden = q && !title.includes(q);
    });
  }

  async function createDocument() {
    const res = await fetch(cfg.urls.docCreate, {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ title: 'Untitled.md' }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const url = `${cfg.urls.index}?doc=${data.document.id}`;
    if (window.routerNavigate) window.routerNavigate(url);
    else window.location.href = url;
  }

  async function deleteDocument(docId) {
    const id = docId || cfg.currentDocId;
    if (!id) return;

    const item = fileList?.querySelector(`.md-file-item[data-doc-id="${id}"]`);
    const fileName = item?.querySelector('.md-file-name')?.textContent || 'this file';

    if (window.AppModal) {
      const ok = await AppModal.confirm({
        title: 'Delete markdown file',
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
    drafts.clear(id);

    if (String(id) === String(cfg.currentDocId)) {
      if (window.routerNavigate) window.routerNavigate(cfg.urls.index);
      else window.location.href = cfg.urls.index;
      return;
    }

    item?.remove();
    if (fileList && !fileList.querySelector('.md-file-item')) {
      document.getElementById('mdEmptyList')?.classList.remove('hidden');
    }
  }

  function hideFileContextMenu() {
    fileContextMenu?.classList.add('hidden');
    fileContextTarget = null;
  }

  function ensureFileContextMenu() {
    if (fileContextMenu) return;
    fileContextMenu = document.createElement('div');
    fileContextMenu.className = 'md-file-context-menu hidden';
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
    flushDraftSave();
    const url = `${cfg.urls.index}?doc=${docId}`;
    if (window.routerNavigate) window.routerNavigate(url);
    else window.location.href = url;
  }

  btnNewMarkdown?.addEventListener('click', createDocument);
  btnNewMarkdownWelcome?.addEventListener('click', createDocument);
  btnSave?.addEventListener('click', runSave);
  btnDelete?.addEventListener('click', () => deleteDocument(cfg.currentDocId));
  fileSearch?.addEventListener('input', filterFileList);

  fileList?.addEventListener('contextmenu', (e) => {
    const nameEl = e.target.closest('.md-file-name');
    if (!nameEl) return;
    const item = nameEl.closest('.md-file-item');
    if (!item) return;
    e.preventDefault();
    showFileContextMenu(e.clientX, e.clientY, item);
  });

  fileList?.addEventListener('click', (e) => {
    if (!e.target.closest('.md-file-context-menu')) hideFileContextMenu();
    const btn = e.target.closest('.md-file-btn');
    if (!btn) return;
    openDocument(btn.dataset.docId);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.md-file-context-menu')) hideFileContextMenu();
  });

  if (!editor) {
    return;
  }

  titleInput?.addEventListener('input', () => {
    syncSidebarTitle(cfg.currentDocId, titleInput.value || 'Untitled.md');
    scheduleDraftSave();
  });

  editor?.addEventListener('input', onEditorInput);
  window.bindEditorTabKey?.(editor, onEditorInput);
  editor?.addEventListener('scroll', syncHighlightScroll);
  textWrap?.addEventListener('scroll', onEditorWrapScroll, { passive: true });
  previewWrap?.addEventListener('scroll', onPreviewWrapScroll, { passive: true });
  scrollSyncToggle?.addEventListener('change', onScrollSyncToggle);

  btnSearch?.addEventListener('click', openFindBar);
  btnCopy?.addEventListener('click', copyMarkdown);
  btnToggleEditor?.addEventListener('click', toggleEditorPane);
  btnTogglePreview?.addEventListener('click', togglePreviewPane);

  btnFindClose?.addEventListener('click', closeFindBar);
  findInput?.addEventListener('input', runFind);
  findInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      findPrevMatch();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      findNextMatch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFindBar();
    }
  });
  btnFindPrev?.addEventListener('click', findPrevMatch);
  btnFindNext?.addEventListener('click', findNextMatch);

  resizer?.addEventListener('mousedown', startResize);
  resizer?.addEventListener('keydown', onResizerKeydown);
  document.addEventListener('mousemove', (e) => onResizeMove(e.clientX, e.clientY));
  document.addEventListener('mouseup', stopResize);
  document.addEventListener('keydown', onGlobalKeydown);

  if (textWrap && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      syncTextEditorHeight();
    });
    resizeObserver.observe(textWrap);
  }

  restoreDraftIfAny();
  syncTextHighlight();
  renderPreview();
  updateResizerVisibility();

  if (window.__routerCleanup) {
    window.__routerCleanup.push(() => {
      flushDraftSave();
      clearTimeout(previewTimer);
      clearTimeout(draftTimer);
      stopResize();
      resizeObserver?.disconnect();
      document.removeEventListener('keydown', onGlobalKeydown);
      hideFileContextMenu();
      fileContextMenu?.remove();
      fileContextMenu = null;
    });
  }
})();
