(function () {
  const cfg = window.COMPARE_CONFIG;
  const app = document.getElementById('compareApp');
  if (!cfg || !app) return;

  const workspace = document.getElementById('compareWorkspace');
  const resizer = document.getElementById('compareResizer');
  const scrollSyncToggle = document.getElementById('compareScrollSync');
  const btnSearch = document.getElementById('btnCompareSearch');
  const findBar = document.getElementById('compareFindBar');
  const findInput = document.getElementById('compareFindInput');
  const findCount = document.getElementById('compareFindCount');
  const btnFindPrev = document.getElementById('btnCompareFindPrev');
  const btnFindNext = document.getElementById('btnCompareFindNext');
  const btnFindClose = document.getElementById('btnCompareFindClose');

  const HLJS_LANGUAGE_ALIASES = { html: 'xml', htm: 'xml' };

  const MAX_DIFF_LINES = 5000;

  let fileCatalog = [];
  let scrollSyncEnabled = true;
  let isScrollSyncing = false;
  let isResizing = false;
  let activePane = null;
  let diffLineStatus = { left: [], right: [] };

  const panes = [
    {
      id: 'left',
      select: document.getElementById('compareLeftSelect'),
      fileInput: document.getElementById('compareLeftFile'),
      filenameEl: document.getElementById('compareLeftFilename'),
      editor: document.getElementById('compareLeftEditor'),
      highlight: document.getElementById('compareLeftHighlight'),
      lineNumbers: document.getElementById('compareLeftLineNumbers'),
      textWrap: document.getElementById('compareLeftWrap'),
      filename: '',
      language: 'plaintext',
      localKey: null,
      findMatches: [],
      findIndex: -1,
    },
    {
      id: 'right',
      select: document.getElementById('compareRightSelect'),
      fileInput: document.getElementById('compareRightFile'),
      filenameEl: document.getElementById('compareRightFilename'),
      editor: document.getElementById('compareRightEditor'),
      highlight: document.getElementById('compareRightHighlight'),
      lineNumbers: document.getElementById('compareRightLineNumbers'),
      textWrap: document.getElementById('compareRightWrap'),
      filename: '',
      language: 'plaintext',
      localKey: null,
      findMatches: [],
      findIndex: -1,
    },
  ];

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getExtension(filename) {
    const name = (filename || '').trim();
    if (name.toLowerCase().endsWith('.env')) return 'env';
    const idx = name.lastIndexOf('.');
    if (idx <= 0 || idx === name.length - 1) return '';
    return name.slice(idx + 1).toLowerCase();
  }

  function getLanguage(filename) {
    const ext = getExtension(filename);
    return cfg.extensionLanguages?.[ext] || 'plaintext';
  }

  function resolveHljsLanguage(lang) {
    if (!lang || lang === 'plaintext' || typeof hljs === 'undefined') return null;
    if (hljs.getLanguage(lang)) return lang;
    const alias = HLJS_LANGUAGE_ALIASES[lang];
    if (alias && hljs.getLanguage(alias)) return alias;
    return null;
  }

  function getLineColumn(text, position) {
    const before = text.slice(0, position);
    const lines = before.split('\n');
    return { line: lines.length, column: lines[lines.length - 1].length + 1 };
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

  /** Line statuses: null (same), 'compare-diff-removed', 'compare-diff-added', 'compare-diff-changed' */
  function computeLineDiffStatuses(leftText, rightText) {
    const leftLines = leftText.split('\n');
    const rightLines = rightText.split('\n');
    const n = leftLines.length;
    const m = rightLines.length;

    if (!n && !m) {
      return { left: [], right: [] };
    }

    if (n > MAX_DIFF_LINES || m > MAX_DIFF_LINES) {
      const max = Math.max(n, m);
      const left = [];
      const right = [];
      for (let i = 0; i < max; i++) {
        const l = leftLines[i];
        const r = rightLines[i];
        if (l === undefined) {
          right.push('compare-diff-added');
          left.push(null);
        } else if (r === undefined) {
          left.push('compare-diff-removed');
          right.push(null);
        } else if (l === r) {
          left.push(null);
          right.push(null);
        } else {
          left.push('compare-diff-changed');
          right.push('compare-diff-changed');
        }
      }
      return { left, right };
    }

    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (leftLines[i - 1] === rightLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const left = new Array(n).fill(null);
    const right = new Array(m).fill(null);
    let i = n;
    let j = m;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        right[j - 1] = 'compare-diff-added';
        j--;
      } else if (i > 0) {
        left[i - 1] = 'compare-diff-removed';
        i--;
      }
    }

    return { left, right };
  }

  function paneHasContent(pane) {
    return Boolean((pane.editor?.value ?? '').trim());
  }

  function bothSidesHaveContent() {
    return paneHasContent(panes[0]) && paneHasContent(panes[1]);
  }

  function recomputeDiff() {
    if (!bothSidesHaveContent()) {
      diffLineStatus = { left: [], right: [] };
      return;
    }
    diffLineStatus = computeLineDiffStatuses(
      panes[0].editor.value,
      panes[1].editor.value,
    );
  }

  function highlightSingleLine(line, lang) {
    if (!lang) return escapeHtml(line);
    try {
      return hljs.highlight(line, { language: lang }).value;
    } catch {
      return escapeHtml(line);
    }
  }

  function getLineFindMatches(pane, lineIndex, lineStart) {
    const query = findInput?.value || '';
    if (!query || activePane !== pane || !pane.findMatches.length) {
      return { offsets: [], activeLocal: -1 };
    }
    const qLen = query.length;
    const lineLen = (pane.editor.value.split('\n')[lineIndex] || '').length;
    const offsets = [];
    let activeLocal = -1;
    pane.findMatches.forEach((start, idx) => {
      if (start >= lineStart && start + qLen <= lineStart + lineLen) {
        offsets.push(start - lineStart);
        if (idx === pane.findIndex) activeLocal = offsets.length - 1;
      }
    });
    return { offsets, activeLocal };
  }

  function applyFindMarksToLineHtml(lineHtml, offsets, queryLen, activeLocal) {
    if (!offsets.length || !queryLen) return lineHtml;
    const root = document.createElement('div');
    root.innerHTML = lineHtml;
    const ordered = [...offsets]
      .map((start, i) => ({ start, end: start + queryLen, active: i === activeLocal }))
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
      mark.className = match.active ? 'compare-find-active' : 'compare-find-match';
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

  function buildPaneHighlightHtml(pane, text, lineStatuses) {
    const lines = text.split('\n');
    const lang = resolveHljsLanguage(pane.language);
    let charOffset = 0;
    const parts = lines.map((line, i) => {
      const status = lineStatuses?.[i] || '';
      let inner = highlightSingleLine(line, lang);
      const { offsets, activeLocal } = getLineFindMatches(pane, i, charOffset);
      charOffset += line.length + 1;
      if (offsets.length) {
        inner = applyFindMarksToLineHtml(inner, offsets, findInput.value.length, activeLocal);
      }
      if (!status) return `${inner}\n`;
      return `<span class="compare-diff-line ${status}">${inner}\n</span>`;
    });
    return parts.join('');
  }

  function syncLineNumbers(pane, lineStatuses) {
    if (!pane.editor || !pane.lineNumbers) return;
    const lines = pane.editor.value.split('\n');
    const count = lines.length || 1;
    const html = Array.from({ length: count }, (_, i) => {
      const num = i + 1;
      const status = lineStatuses?.[i] || '';
      if (!status) return `${num}\n`;
      return `<span class="compare-diff-gutter ${status}">${num}\n</span>`;
    }).join('');
    pane.lineNumbers.innerHTML = html;
  }

  function getEditorContentHeight(pane) {
    if (!pane.editor) return 240;
    const style = getComputedStyle(pane.editor);
    const lineHeight = parseFloat(style.lineHeight) || 20.8;
    const paddingTop = parseFloat(style.paddingTop) || 16;
    const paddingBottom = parseFloat(style.paddingBottom) || 16;
    const lineCount = Math.max(1, pane.editor.value.split('\n').length);
    pane.editor.style.height = '0px';
    const scrollHeight = pane.editor.scrollHeight;
    const lineBasedHeight = lineCount * lineHeight + paddingTop + paddingBottom;
    return Math.max(scrollHeight, lineBasedHeight);
  }

  function resizeEditor(pane) {
    if (!pane.editor || !pane.textWrap) return;
    const minH = Math.max(240, pane.textWrap.clientHeight);
    const contentH = getEditorContentHeight(pane);
    pane.editor.style.height = `${Math.max(minH, contentH)}px`;
  }

  function syncAllPanes() {
    recomputeDiff();
    const showDiff = bothSidesHaveContent();
    panes.forEach((pane, index) => {
      if (!pane.editor || !pane.highlight) return;
      const statuses = showDiff
        ? (index === 0 ? diffLineStatus.left : diffLineStatus.right)
        : null;
      pane.highlight.innerHTML = buildPaneHighlightHtml(
        pane,
        pane.editor.value,
        statuses,
      );
      syncLineNumbers(pane, statuses);
      resizeEditor(pane);
    });
  }

  function syncPaneHighlight() {
    syncAllPanes();
  }

  function getDisplayFilename(filename) {
    const name = (filename || '').trim();
    if (!name) return '';
    return name.split(/[/\\]/).pop() || name;
  }

  function updatePaneMeta(pane) {
    pane.language = getLanguage(pane.filename);
    if (!pane.filenameEl) return;
    const display = getDisplayFilename(pane.filename);
    pane.filenameEl.textContent = display || 'No file';
    pane.filenameEl.classList.toggle('is-empty', !display);
    pane.filenameEl.title = display ? pane.filename : 'No file selected';
  }

  function pasteKey(pane) {
    return `paste:${pane.id}`;
  }

  function isManualPane(pane) {
    return pane.localKey === pasteKey(pane);
  }

  function setPaneContent(pane, title, content, options = {}) {
    const { manual = false, localKey = null, selectValue } = options;
    pane.filename = title || '';
    if (manual) {
      pane.localKey = pasteKey(pane);
    } else if (localKey) {
      pane.localKey = localKey;
    } else {
      pane.localKey = null;
    }
    pane.findMatches = [];
    pane.findIndex = -1;
    if (pane.editor) pane.editor.value = content || '';
    updatePaneMeta(pane);
    syncPaneHighlight(pane);
    populateSelects();
    if (pane.select) {
      const next = selectValue ?? pane.localKey ?? '';
      if ([...pane.select.options].some((o) => o.value === next) || next === '') {
        pane.select.value = next;
      }
    }
    if (activePane === pane) runFind();
  }

  function markPaneManual(pane) {
    if (!pane.editor) return;
    const hasText = Boolean(pane.editor.value);
    if (!hasText) {
      pane.localKey = null;
      pane.filename = '';
      if (pane.select) pane.select.value = '';
      updatePaneMeta(pane);
      populateSelects();
      return;
    }
    if (!pane.filename) pane.filename = 'Pasted content';
    pane.localKey = pasteKey(pane);
    updatePaneMeta(pane);
    populateSelects();
    if (pane.select) pane.select.value = pane.localKey;
  }

  function onPaneInput(pane) {
    markPaneManual(pane);
    syncPaneHighlight();
    if (activePane === pane) runFind();
  }

  const TAB_INSERT = '  ';

  function onPaneKeydown(pane, e) {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = pane.editor;
    if (!el) return;

    e.preventDefault();

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = el.value;

    if (e.shiftKey) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const remove =
        value.slice(lineStart, lineStart + 2) === '  '
          ? 2
          : value[lineStart] === '\t'
            ? 1
            : 0;
      if (!remove) return;
      const from = start <= lineStart + remove ? lineStart : start - remove;
      el.value = value.slice(0, from) + value.slice(from + remove);
      const next = Math.max(lineStart, start - remove);
      el.setSelectionRange(next, next);
      onPaneInput(pane);
      return;
    }

    if (start !== end) {
      const firstLine = value.lastIndexOf('\n', start - 1) + 1;
      let blockEnd = value.indexOf('\n', end - 1);
      if (blockEnd === -1) blockEnd = value.length;
      const lines = value.slice(firstLine, blockEnd).split('\n');
      const indented = lines.map((line) => TAB_INSERT + line).join('\n');
      const added = TAB_INSERT.length * lines.length;
      el.value = value.slice(0, firstLine) + indented + value.slice(blockEnd);
      el.setSelectionRange(start + TAB_INSERT.length, end + added);
    } else {
      el.value = value.slice(0, start) + TAB_INSERT + value.slice(end);
      const pos = start + TAB_INSERT.length;
      el.setSelectionRange(pos, pos);
    }
    onPaneInput(pane);
  }

  function populateSelects() {
    panes.forEach((pane) => {
      if (!pane.select) return;
      const current = pane.select.value;
      pane.select.innerHTML = '<option value="">Choose…</option>';

      const manualOpt = document.createElement('optgroup');
      manualOpt.label = 'Manual';
      if (isManualPane(pane)) {
        const opt = document.createElement('option');
        opt.value = pane.localKey;
        opt.textContent = `[Pasted] ${pane.filename}`;
        manualOpt.appendChild(opt);
      }

      const localOpt = document.createElement('optgroup');
      localOpt.label = 'Local';
      if (pane.localKey && pane.localKey.startsWith('local:')) {
        const opt = document.createElement('option');
        opt.value = pane.localKey;
        opt.textContent = `[Local] ${pane.filename}`;
        localOpt.appendChild(opt);
      }

      const arcOpt = document.createElement('optgroup');
      arcOpt.label = 'ArcBook files';
      fileCatalog.forEach((f) => {
        const opt = document.createElement('option');
        opt.value = f.key;
        opt.textContent = f.label;
        arcOpt.appendChild(opt);
      });

      if (manualOpt.children.length) pane.select.appendChild(manualOpt);
      if (localOpt.children.length) pane.select.appendChild(localOpt);
      pane.select.appendChild(arcOpt);

      if (current && [...pane.select.options].some((o) => o.value === current)) {
        pane.select.value = current;
      } else if (pane.localKey) {
        pane.select.value = pane.localKey;
      }
    });
  }

  async function loadCatalog() {
    const res = await fetch(cfg.urls.apiFiles);
    if (!res.ok) return;
    const data = await res.json();
    fileCatalog = data.files || [];
    populateSelects();
    applyUrlParams();
  }

  async function loadRemoteFile(pane, key) {
    const entry = fileCatalog.find((f) => f.key === key);
    if (!entry) return;
    const url = `${cfg.urls.apiFile}?source=${encodeURIComponent(entry.source)}&id=${entry.id}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    setPaneContent(pane, data.title, data.content, { selectValue: key });
    if (data.language) pane.language = data.language;
    syncPaneHighlight(pane);
  }

  function loadLocalFile(pane, file) {
    const reader = new FileReader();
    reader.onload = () => {
      const localKey = `local:${pane.id}:${file.name}`;
      setPaneContent(pane, file.name, reader.result || '', {
        localKey,
        selectValue: localKey,
      });
    };
    reader.readAsText(file);
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
    return scrollSyncEnabled && panes[0].textWrap && panes[1].textWrap;
  }

  function syncScrollFromSource(source, target) {
    if (!canScrollSync() || isScrollSyncing || !source?.textWrap || !target?.textWrap) return;
    isScrollSyncing = true;
    setScrollFromRatio(target.textWrap, getScrollRatio(source.textWrap));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isScrollSyncing = false;
      });
    });
  }

  function runFind() {
    const pane = activePane || panes[0];
    if (!pane?.editor || !findInput) return;
    const query = findInput.value;
    pane.findMatches = [];
    pane.findIndex = -1;

    if (!query) {
      if (findCount) findCount.textContent = '';
      panes.forEach(syncPaneHighlight);
      return;
    }

    const lowerText = pane.editor.value.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let pos = 0;
    while (pos < lowerText.length) {
      const idx = lowerText.indexOf(lowerQuery, pos);
      if (idx === -1) break;
      pane.findMatches.push(idx);
      pos = idx + lowerQuery.length;
    }

    if (findCount) {
      if (!pane.findMatches.length) findCount.textContent = 'No matches';
      else {
        findCount.textContent = `${pane.findMatches.length} match${pane.findMatches.length === 1 ? '' : 'es'}`;
      }
    }
    syncAllPanes();
  }

  function goToFindMatch(pane, index) {
    if (!pane?.editor || !findInput || !pane.findMatches.length) return;
    pane.findIndex = ((index % pane.findMatches.length) + pane.findMatches.length) % pane.findMatches.length;
    const start = pane.findMatches[pane.findIndex];
    const end = start + findInput.value.length;
    activePane = pane;
    syncAllPanes();

    pane.editor.focus({ preventScroll: true });
    pane.editor.setSelectionRange(start, end);
    const lineHeight = parseInt(getComputedStyle(pane.editor).lineHeight, 10) || 20;
    const line = getLineColumn(pane.editor.value, start).line;
    if (pane.textWrap) {
      pane.textWrap.scrollTop = Math.max(0, (line - 1) * lineHeight - 80);
    }
    if (findCount) {
      findCount.textContent = `${pane.findIndex + 1} of ${pane.findMatches.length}`;
    }
  }

  function showFindBar() {
    findBar?.classList.remove('hidden');
    findInput?.focus();
    findInput?.select();
  }

  function hideFindBar() {
    findBar?.classList.add('hidden');
    if (findInput) findInput.value = '';
    panes.forEach((p) => {
      p.findMatches = [];
      p.findIndex = -1;
    });
    if (findCount) findCount.textContent = '';
    syncAllPanes();
  }

  function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const left = params.get('left');
    const right = params.get('right');
    if (left && panes[0].select) {
      panes[0].select.value = left;
      loadRemoteFile(panes[0], left);
    }
    if (right && panes[1].select) {
      panes[1].select.value = right;
      loadRemoteFile(panes[1], right);
    }
  }

  function updateUrlParams() {
    const params = new URLSearchParams();
    if (panes[0].select?.value && !panes[0].localKey) params.set('left', panes[0].select.value);
    if (panes[1].select?.value && !panes[1].localKey) params.set('right', panes[1].select.value);
    const qs = params.toString();
    const url = qs ? `${cfg.urls.index}?${qs}` : cfg.urls.index;
    history.replaceState(null, '', url);
  }

  function startResize(clientX) {
    if (!workspace) return;
    isResizing = true;
    document.body.classList.add('compare-resizing');
    const rect = workspace.getBoundingClientRect();
    const onMove = (e) => {
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(85, Math.max(15, pct));
      workspace.style.setProperty('--compare-left-width', `${clamped}%`);
    };
    const onUp = () => {
      isResizing = false;
      document.body.classList.remove('compare-resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    onMove({ clientX });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  panes.forEach((pane) => {
    pane.select?.addEventListener('change', () => {
      const val = pane.select.value;
      if (!val) {
        setPaneContent(pane, '', '');
        updateUrlParams();
        return;
      }
      if (val.startsWith('local:') || val.startsWith('paste:')) return;
      loadRemoteFile(pane, val).then(updateUrlParams);
    });

    pane.editor?.addEventListener('input', () => onPaneInput(pane));
    pane.editor?.addEventListener('keydown', (e) => onPaneKeydown(pane, e));
    pane.editor?.addEventListener('paste', () => {
      requestAnimationFrame(() => onPaneInput(pane));
    });

    pane.fileInput?.addEventListener('change', () => {
      const file = pane.fileInput.files?.[0];
      if (file) loadLocalFile(pane, file);
      pane.fileInput.value = '';
    });

    pane.editor?.addEventListener('focus', () => {
      activePane = pane;
    });

    pane.textWrap?.addEventListener('scroll', () => {
      if (isScrollSyncing || !scrollSyncEnabled) return;
      const other = pane.id === 'left' ? panes[1] : panes[0];
      syncScrollFromSource(pane, other);
    });
  });

  scrollSyncToggle?.addEventListener('change', () => {
    scrollSyncEnabled = scrollSyncToggle.checked;
    if (scrollSyncEnabled) syncScrollFromSource(panes[0], panes[1]);
  });

  btnSearch?.addEventListener('click', showFindBar);
  btnFindClose?.addEventListener('click', hideFindBar);
  findInput?.addEventListener('input', runFind);
  btnFindPrev?.addEventListener('click', () => {
    const pane = activePane || panes[0];
    goToFindMatch(pane, (pane.findIndex < 0 ? 0 : pane.findIndex) - 1);
  });
  btnFindNext?.addEventListener('click', () => {
    const pane = activePane || panes[0];
    goToFindMatch(pane, pane.findIndex + 1);
  });

  resizer?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startResize(e.clientX);
  });
  resizer?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = parseFloat(getComputedStyle(workspace).getPropertyValue('--compare-left-width')) || 50;
    const delta = e.key === 'ArrowLeft' ? -2 : 2;
    workspace.style.setProperty('--compare-left-width', `${Math.min(85, Math.max(15, cur + delta))}%`);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      showFindBar();
    }
    if (e.key === 'Escape' && findBar && !findBar.classList.contains('hidden')) {
      hideFindBar();
    }
  });

  window.addEventListener('resize', () => panes.forEach(resizeEditor));

  activePane = panes[0];
  if (workspace) workspace.style.setProperty('--compare-left-width', '50%');
  loadCatalog();
})();
