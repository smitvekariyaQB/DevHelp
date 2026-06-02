(function () {
  const cfg = window.CODE_EDITOR_CONFIG;
  const app = document.getElementById('codeApp');
  if (!cfg || !app) return;

  const fileList = document.getElementById('codeFileList');
  const fileSearch = document.getElementById('codeFileSearch');
  const btnNewCode = document.getElementById('btnNewCode');
  const newFileWrap = document.getElementById('codeNewFileWrap');
  const newFileInput = document.getElementById('codeNewFileInput');
  const btnNewCodeWelcome = document.getElementById('btnNewCodeWelcome');
  const titleInput = document.getElementById('codeTitleInput');
  const langBadge = document.getElementById('codeLangBadge');
  const btnSave = document.getElementById('btnCodeSave');
  const btnDelete = document.getElementById('btnDeleteCode');
  const editor = document.getElementById('codeEditor');
  const highlight = document.getElementById('codeHighlight');
  const textEditor = document.getElementById('codeTextEditor');
  const textWrap = document.getElementById('codeEditorWrap');
  const textStack = document.querySelector('.code-text-stack');
  const lineGutter = document.getElementById('codeLineGutter');
  const lineNumbers = document.getElementById('codeLineNumbers');
  const btnSearch = document.getElementById('btnCodeSearch');
  const btnCopy = document.getElementById('btnCodeCopy');
  const findBar = document.getElementById('codeFindBar');
  const findInput = document.getElementById('codeFindInput');
  const findCount = document.getElementById('codeFindCount');
  const btnFindPrev = document.getElementById('btnCodeFindPrev');
  const btnFindNext = document.getElementById('btnCodeFindNext');
  const btnFindClose = document.getElementById('btnCodeFindClose');

  let findMatches = [];
  let findIndex = -1;
  let saving = false;
  let pending = false;
  let saveTimer = null;
  let dirty = false;
  let fileContextMenu = null;
  let fileContextTarget = null;
  let resizeObserver;

  const AUTOSAVE_DELAY = 800;

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

  function getExtension(filename) {
    const name = (filename || '').trim();
    const idx = name.lastIndexOf('.');
    if (idx <= 0 || idx === name.length - 1) return '';
    return name.slice(idx + 1).toLowerCase();
  }

  function getLanguage(filename) {
    const ext = getExtension(filename);
    return cfg.extensionLanguages?.[ext] || 'plaintext';
  }

  const HLJS_LANGUAGE_ALIASES = {
    html: 'xml',
    htm: 'xml',
  };

  function resolveHljsLanguage(lang) {
    if (!lang || lang === 'plaintext' || typeof hljs === 'undefined') return null;
    if (hljs.getLanguage(lang)) return lang;
    const alias = HLJS_LANGUAGE_ALIASES[lang];
    if (alias && hljs.getLanguage(alias)) return alias;
    return null;
  }

  function updateLanguageBadge() {
    if (!langBadge) return;
    const filename = titleInput?.value || '';
    const ext = getExtension(filename);
    langBadge.textContent = ext || getLanguage(filename);
  }

  function getLineColumn(text, position) {
    const before = text.slice(0, position);
    const lines = before.split('\n');
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
    };
  }

  function getHighlightedHtml(text, filename) {
    const lang = resolveHljsLanguage(getLanguage(filename));
    const content = text.endsWith('\n') ? text : `${text}\n`;
    if (!lang) {
      return escapeHtml(content);
    }
    try {
      return hljs.highlight(content, { language: lang }).value;
    } catch {
      return escapeHtml(content);
    }
  }

  function locateTextRange(root, start, end) {
    let charCount = 0;
    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    let node = walker.nextNode();
    while (node) {
      const len = node.textContent.length;
      const nodeStart = charCount;
      const nodeEnd = charCount + len;

      if (!startNode && start < nodeEnd) {
        startNode = node;
        startOffset = start - nodeStart;
      }
      if (!endNode && end <= nodeEnd) {
        endNode = node;
        endOffset = end - nodeStart;
        break;
      }

      charCount = nodeEnd;
      node = walker.nextNode();
    }

    return { startNode, startOffset, endNode, endOffset };
  }

  function applyFindMarks(highlightedHtml, matches, queryLen, activeIdx) {
    if (!matches.length || !queryLen) return highlightedHtml;

    const root = document.createElement('div');
    root.innerHTML = highlightedHtml;

    const ordered = [...matches]
      .map((start, i) => ({ start, end: start + queryLen, active: i === activeIdx }))
      .sort((a, b) => b.start - a.start);

    ordered.forEach((match) => {
      const { startNode, startOffset, endNode, endOffset } = locateTextRange(
        root,
        match.start,
        match.end,
      );
      if (!startNode || !endNode) return;

      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);

      const mark = document.createElement('mark');
      mark.className = match.active ? 'code-find-active' : 'code-find-match';

      try {
        range.surroundContents(mark);
      } catch {
        const contents = range.extractContents();
        mark.appendChild(contents);
        range.insertNode(mark);
      }
    });

    return root.innerHTML;
  }

  function highlightCode(text, filename) {
    let html = getHighlightedHtml(text, filename);
    const query = findInput?.value || '';
    if (query && findMatches.length) {
      html = applyFindMarks(html, findMatches, query.length, findIndex);
    }
    return html;
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
    const filename = titleInput?.value || '';
    const lang = resolveHljsLanguage(getLanguage(filename));
    highlight.className = lang
      ? `code-text-highlight hljs language-${lang}`
      : 'code-text-highlight hljs';
    highlight.innerHTML = highlightCode(editor.value, filename);
    syncLineNumbers();
    syncTextEditorHeight();
    syncHighlightScroll();
    updateLanguageBadge();
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

  async function copyCode() {
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

  function getSavePayload() {
    return {
      title: titleInput ? normalizeFileName(titleInput.value) : '',
      content: editor ? editor.value : '',
    };
  }

  async function persistDocument({ manual = false } = {}) {
    if (!cfg.currentDocId || !editor) return;
    if (saving) {
      pending = true;
      return;
    }
    saving = true;
    const saveLabel = btnSave?.textContent;
    if (manual && btnSave) {
      btnSave.disabled = true;
      btnSave.textContent = 'Saving…';
    }
    try {
      const res = await fetch(cfg.urls.docAutosave(cfg.currentDocId), {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify(getSavePayload()),
      });
      if (!res.ok) throw new Error();
      syncSidebarTitle(cfg.currentDocId, titleInput?.value || 'Untitled.txt');
      dirty = false;
      if (manual && btnSave) btnSave.textContent = 'Saved';
    } catch {
      if (manual && btnSave) btnSave.textContent = 'Save failed';
    } finally {
      saving = false;
      if (btnSave && manual) {
        btnSave.disabled = false;
        setTimeout(() => {
          if (btnSave.textContent === 'Saved' || btnSave.textContent === 'Save failed') {
            btnSave.textContent = saveLabel || 'Save';
          }
        }, 1500);
      }
      if (pending) {
        pending = false;
        persistDocument({ manual });
      }
    }
  }

  function scheduleAutosave(immediate = false) {
    if (!cfg.currentDocId || !editor) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistDocument({ manual: false });
    }, immediate ? 0 : AUTOSAVE_DELAY);
  }

  async function flushAutosave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!cfg.currentDocId || !editor) return;
    if (!dirty && !saving && !pending) return;
    await persistDocument({ manual: false });
  }

  function runSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    dirty = true;
    return persistDocument({ manual: true });
  }

  function saveBeforeLeave() {
    if (!cfg.currentDocId || !editor || !dirty) return;
    try {
      fetch(cfg.urls.docAutosave(cfg.currentDocId), {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify(getSavePayload()),
        keepalive: true,
      });
    } catch {
      /* best effort */
    }
  }

  function syncSidebarTitle(docId, title) {
    if (!fileList) return;
    const item = fileList.querySelector(`.code-file-item[data-doc-id="${docId}"]`);
    const nameEl = item?.querySelector('.code-file-name');
    if (nameEl) nameEl.textContent = title || 'Untitled.txt';
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
      updateLanguageBadge();
      syncTextHighlight();
    }
  }

  function startSidebarRename(item) {
    if (!item || item.querySelector('.code-file-name-input')) return;

    const docId = item.dataset.docId;
    const nameEl = item.querySelector('.code-file-name');
    if (!nameEl) return;

    const original = nameEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'code-file-name-input';
    input.value = original;
    input.setAttribute('aria-label', 'Edit file name');
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const newTitle = (save ? input.value.trim() : original) || 'Untitled.txt';
      const span = document.createElement('span');
      span.className = 'code-file-name';
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
    fileList.querySelectorAll('.code-file-item').forEach((item) => {
      const title = item.dataset.docTitle || '';
      item.hidden = q && !title.includes(q);
    });
  }

  function normalizeFileName(value) {
    return (value || '').replace(/^\s+|\s+$/g, '');
  }

  function showNewFileInput() {
    newFileWrap?.classList.remove('hidden');
    newFileInput?.focus();
  }

  function hideNewFileInput(clear = true) {
    newFileWrap?.classList.add('hidden');
    if (clear && newFileInput) newFileInput.value = '';
    newFileInput?.classList.remove('code-new-file-input-invalid');
  }

  async function createDocument() {
    const title = normalizeFileName(newFileInput?.value);
    if (!title) {
      showNewFileInput();
      newFileInput?.focus();
      newFileInput?.classList.add('code-new-file-input-invalid');
      setTimeout(() => newFileInput?.classList.remove('code-new-file-input-invalid'), 1200);
      return;
    }

    const res = await fetch(cfg.urls.docCreate, {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return;
    const data = await res.json();
    hideNewFileInput(true);
    const url = `${cfg.urls.index}?doc=${data.document.id}`;
    if (window.routerNavigate) window.routerNavigate(url);
    else window.location.href = url;
  }

  function openNewFileInput() {
    showNewFileInput();
    newFileInput?.select();
  }

  async function deleteDocument(docId) {
    const id = docId || cfg.currentDocId;
    if (!id) return;

    const item = fileList?.querySelector(`.code-file-item[data-doc-id="${id}"]`);
    const fileName = item?.querySelector('.code-file-name')?.textContent || 'this file';

    if (window.AppModal) {
      const ok = await AppModal.confirm({
        title: 'Delete code file',
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
  }

  function hideFileContextMenu() {
    fileContextMenu?.classList.add('hidden');
    fileContextTarget = null;
  }

  function ensureFileContextMenu() {
    if (fileContextMenu) return;
    fileContextMenu = document.createElement('div');
    fileContextMenu.className = 'code-file-context-menu hidden';
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

  async function openDocument(docId) {
    if (String(docId) === String(cfg.currentDocId)) return;
    await flushAutosave();
    const url = `${cfg.urls.index}?doc=${docId}`;
    if (window.routerNavigate) window.routerNavigate(url);
    else window.location.href = url;
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
    if (e.key === 'Escape') {
      hideFileContextMenu();
      if (newFileWrap && !newFileWrap.classList.contains('hidden')) {
        hideNewFileInput(true);
      }
    }
  }

  btnNewCode?.addEventListener('click', openNewFileInput);
  btnNewCodeWelcome?.addEventListener('click', openNewFileInput);
  newFileInput?.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      createDocument();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideNewFileInput(true);
    }
  });
  btnSave?.addEventListener('click', runSave);
  btnDelete?.addEventListener('click', () => deleteDocument(cfg.currentDocId));
  fileSearch?.addEventListener('input', filterFileList);

  fileList?.addEventListener('contextmenu', (e) => {
    const nameEl = e.target.closest('.code-file-name');
    if (!nameEl) return;
    const item = nameEl.closest('.code-file-item');
    if (!item) return;
    e.preventDefault();
    showFileContextMenu(e.clientX, e.clientY, item);
  });

  fileList?.addEventListener('click', async (e) => {
    if (!e.target.closest('.code-file-context-menu')) hideFileContextMenu();
    const btn = e.target.closest('.code-file-btn');
    if (!btn) return;
    e.preventDefault();
    await openDocument(btn.dataset.docId);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.code-file-context-menu')) hideFileContextMenu();
  });

  if (!editor) {
    return;
  }

  function onEditorInput() {
    syncTextHighlight();
    if (findBar && !findBar.classList.contains('hidden')) runFind();
    scheduleAutosave();
  }

  function onTitleInput() {
    syncTextHighlight();
    syncSidebarTitle(cfg.currentDocId, normalizeFileName(titleInput?.value || '') || 'Untitled.txt');
    scheduleAutosave();
  }

  editor.addEventListener('input', onEditorInput);
  editor.addEventListener('scroll', syncHighlightScroll);
  titleInput?.addEventListener('input', onTitleInput);

  btnSearch?.addEventListener('click', openFindBar);
  btnCopy?.addEventListener('click', copyCode);

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
  document.addEventListener('keydown', onGlobalKeydown);

  if (textWrap && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => syncTextEditorHeight());
    resizeObserver.observe(textWrap);
  }

  window.__codeEditorSyncHighlight = syncTextHighlight;

  function initCodeHighlight() {
    if (window.AppPreferences?.syncHighlightTheme) {
      window.AppPreferences.syncHighlightTheme();
    } else {
      syncTextHighlight();
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(syncTextHighlight);
    });
  }

  initCodeHighlight();

  if (window.__routerCleanup) {
    window.__routerCleanup.push(() => {
      if (window.__codeEditorSyncHighlight === syncTextHighlight) {
        window.__codeEditorSyncHighlight = null;
      }
      saveBeforeLeave();
      clearTimeout(saveTimer);
      resizeObserver?.disconnect();
      document.removeEventListener('keydown', onGlobalKeydown);
      hideFileContextMenu();
      fileContextMenu?.remove();
      fileContextMenu = null;
    });
  }
})();
