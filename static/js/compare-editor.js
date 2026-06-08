(function () {
  const cfg = window.COMPARE_CONFIG;
  const app = document.getElementById('compareApp');
  if (!cfg || !app) return;

  const workspace = document.getElementById('compareWorkspace');
  const resizer = document.getElementById('compareResizer');
  const diffGutterScroll = document.getElementById('compareDiffGutterScroll');
  const diffGutterInner = document.getElementById('compareDiffGutterInner');
  const diffActionsEl = document.getElementById('compareDiffActions');
  const scrollSyncToggle = document.getElementById('compareScrollSync');
  const btnSearch = document.getElementById('btnCompareSearch');
  const findBar = document.getElementById('compareFindBar');
  const findInput = document.getElementById('compareFindInput');
  const findCount = document.getElementById('compareFindCount');
  const btnFindPrev = document.getElementById('btnCompareFindPrev');
  const btnFindNext = document.getElementById('btnCompareFindNext');
  const btnFindClose = document.getElementById('btnCompareFindClose');
  const btnUndo = document.getElementById('btnCompareUndo');
  const btnRedo = document.getElementById('btnCompareRedo');
  const btnReset = document.getElementById('btnCompareReset');

  const HLJS_LANGUAGE_ALIASES = { html: 'xml', htm: 'xml' };

  const MAX_DIFF_LINES = 5000;
  const COMPARE_SESSION_KEY = 'arcbook:compare:session';
  const SAVE_SESSION_DELAY = 300;
  /** Group rapid typing into one undo step (like VS Code). */
  const HISTORY_BURST_DELAY = 500;

  const paneHistories = {
    left: window.createEditorHistory?.(60, { manageButtons: false }),
    right: window.createEditorHistory?.(60, { manageButtons: false }),
  };

  let saveSessionTimer;
  let historyBurstTimer;
  let historyBurst = null;
  let isRestoring = false;

  let fileCatalog = [];
  let scrollSyncEnabled = true;
  let isScrollSyncing = false;
  let isResizing = false;
  let activePane = null;
  let diffLineStatus = { left: [], right: [] };
  let diffHunks = [];
  let charDiffPairs = new Map();
  let charDiffPairsReverse = new Map();
  let lineMetrics = { paddingTop: 16, lineHeight: 20.8 };
  let resizeDragCleanup = null;

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
      minimap: document.getElementById('compareLeftMinimap'),
      filename: '',
      language: 'plaintext',
      localKey: null,
      findMatches: [],
      findIndex: -1,
      baseline: null,
      historyAnchor: '',
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
      minimap: document.getElementById('compareRightMinimap'),
      filename: '',
      language: 'plaintext',
      localKey: null,
      findMatches: [],
      findIndex: -1,
      baseline: null,
      historyAnchor: '',
    },
  ];

  panes.forEach((pane) => {
    pane.textStack = pane.highlight?.parentElement || null;
    pane.textEditorEl = pane.textStack?.closest('.compare-text-editor') || null;
    pane.lineGutter = pane.lineNumbers?.parentElement || null;
  });

  function syncHistoryAnchor(pane) {
    pane.historyAnchor = pane.editor?.value ?? '';
  }

  function snapshotPaneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function serializePaneState(state) {
    return JSON.stringify(state);
  }

  function getPaneState(pane) {
    return {
      content: pane.editor?.value ?? '',
      filename: pane.filename,
      localKey: pane.localKey,
      language: pane.language,
      selectValue: pane.select?.value ?? '',
    };
  }

  function getActivePane() {
    return activePane || panes[0];
  }

  function getPaneHistory(pane) {
    return paneHistories[pane?.id || 'left'];
  }

  function refreshHistoryButtons() {
    const pane = getActivePane();
    const history = getPaneHistory(pane);
    if (btnUndo) btnUndo.disabled = !history?.canUndo();
    if (btnRedo) btnRedo.disabled = !history?.canRedo();
    if (btnReset) {
      const canReset =
        pane?.baseline &&
        serializePaneState(getPaneState(pane)) !== serializePaneState(pane.baseline);
      btnReset.disabled = !canReset;
    }
  }

  function setPaneBaseline(pane) {
    pane.baseline = snapshotPaneState(getPaneState(pane));
    getPaneHistory(pane)?.reset(getPaneState(pane));
    refreshHistoryButtons();
  }

  function paneStateWithContent(pane, content) {
    return {
      content,
      filename: pane.filename,
      localKey: pane.localKey,
      language: pane.language,
      selectValue: pane.select?.value ?? '',
    };
  }

  function pushPaneHistory(pane, content) {
    if (isRestoring || !paneHistories[pane.id]) return;
    const history = paneHistories[pane.id];
    history.clearDedup();
    history.push(
      snapshotPaneState(paneStateWithContent(pane, content)),
    );
    refreshHistoryButtons();
  }

  function commitHistoryBurst() {
    clearTimeout(historyBurstTimer);
    if (!historyBurst) return;
    const pane = panes.find((p) => p.id === historyBurst.paneId);
    if (pane) {
      pushPaneHistory(pane, historyBurst.prior);
      syncHistoryAnchor(pane);
    }
    historyBurst = null;
  }

  function scheduleHistoryBurst(pane) {
    if (isRestoring || !paneHistories[pane.id]) return;
    if (!historyBurst || historyBurst.paneId !== pane.id) {
      commitHistoryBurst();
      historyBurst = { paneId: pane.id, prior: pane.historyAnchor ?? '' };
    }
    clearTimeout(historyBurstTimer);
    historyBurstTimer = setTimeout(commitHistoryBurst, HISTORY_BURST_DELAY);
  }

  function recordHistoryNow(pane) {
    if (isRestoring || !paneHistories[pane.id]) return;
    commitHistoryBurst();
    pushPaneHistory(pane, pane.editor?.value ?? '');
    syncHistoryAnchor(pane);
  }

  function restorePaneState(pane, state) {
    isRestoring = true;
    historyBurst = null;
    clearTimeout(historyBurstTimer);
    pane.filename = state.filename;
    pane.localKey = state.localKey;
    if (pane.editor) pane.editor.value = state.content;
    syncHistoryAnchor(pane);
    updatePaneMeta(pane);
    // updatePaneMeta resets language from filename; preserve the snapshotted language.
    if (state.language) pane.language = state.language;
    populateSelects();
    if (pane.select && state.selectValue !== undefined) {
      const hasOption = [...pane.select.options].some((o) => o.value === state.selectValue);
      pane.select.value = hasOption ? state.selectValue : pane.localKey || '';
    }
    syncAllPanes();
    if (activePane === pane) runFind();
    isRestoring = false;
    refreshHistoryButtons();
    scheduleSaveSession();
  }

  function doUndo() {
    const pane = getActivePane();
    const history = getPaneHistory(pane);
    if (!history) return;
    commitHistoryBurst();
    if (!history.canUndo()) return;
    const prev = history.undo(getPaneState(pane));
    if (prev) {
      restorePaneState(pane, prev);
      history.clearDedup();
    }
    refreshHistoryButtons();
  }

  function doRedo() {
    const pane = getActivePane();
    const history = getPaneHistory(pane);
    if (!history) return;
    commitHistoryBurst();
    if (!history.canRedo()) return;
    const next = history.redo(getPaneState(pane));
    if (next) {
      restorePaneState(pane, next);
      history.clearDedup();
    }
    refreshHistoryButtons();
  }

  function resetActivePane() {
    const pane = getActivePane();
    if (!pane?.baseline || btnReset?.disabled) return;
    recordHistoryNow(pane);
    restorePaneState(pane, snapshotPaneState(pane.baseline));
    scheduleSaveSession();
  }

  function collectSessionState() {
    return {
      version: 1,
      panes: panes.map((pane) => ({
        id: pane.id,
        ...getPaneState(pane),
        baseline: pane.baseline,
      })),
      activePaneId: activePane?.id || 'left',
      scrollSync: scrollSyncEnabled,
      leftWidth:
        workspace?.style.getPropertyValue('--compare-left-width')?.trim() ||
        getComputedStyle(workspace || document.documentElement).getPropertyValue('--compare-left-width')?.trim() ||
        '50%',
      scroll: panes.map((pane) => ({
        id: pane.id,
        top: pane.textWrap?.scrollTop || 0,
      })),
      find:
        findBar && !findBar.classList.contains('hidden')
          ? { open: true, query: findInput?.value || '' }
          : { open: false, query: '' },
    };
  }

  function hasMeaningfulSession(state) {
    if (!state?.panes?.length) return false;
    return state.panes.some(
      (p) => (p.content || '').length > 0 || p.filename || p.localKey,
    );
  }

  function saveSessionState() {
    const state = collectSessionState();
    try {
      sessionStorage.setItem(COMPARE_SESSION_KEY, JSON.stringify(state));
      window.__compareSessionBackup = state;
    } catch (err) {
      window.__compareSessionBackup = state;
      console.warn('[Compare] could not save session to storage:', err);
    }
  }

  function loadSessionState() {
    try {
      const raw = sessionStorage.getItem(COMPARE_SESSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn('[Compare] could not load session from storage:', err);
    }
    return window.__compareSessionBackup || null;
  }

  function scheduleSaveSession() {
    clearTimeout(saveSessionTimer);
    saveSessionTimer = setTimeout(saveSessionState, SAVE_SESSION_DELAY);
  }

  function restoreSessionState(state) {
    isRestoring = true;
    state.panes.forEach((saved) => {
      const pane = panes.find((p) => p.id === saved.id);
      if (!pane) return;
      pane.filename = saved.filename || '';
      pane.localKey = saved.localKey ?? null;
      pane.baseline = saved.baseline ? snapshotPaneState(saved.baseline) : null;
      if (pane.editor) pane.editor.value = saved.content || '';
      syncHistoryAnchor(pane);
    });
    populateSelects();
    panes.forEach((pane) => {
      const saved = state.panes.find((s) => s.id === pane.id);
      if (!saved) return;
      if (pane.select) {
        const val = saved.selectValue ?? pane.localKey ?? '';
        if ([...pane.select.options].some((o) => o.value === val) || val === '') {
          pane.select.value = val;
        }
      }
      updatePaneMeta(pane);
      // updatePaneMeta resets language from filename; restore explicit language if saved
      if (saved.language) pane.language = saved.language;
      getPaneHistory(pane)?.reset(getPaneState(pane));
    });
    activePane = panes.find((p) => p.id === state.activePaneId) || panes[0];
    scrollSyncEnabled = state.scrollSync !== false;
    if (scrollSyncToggle) scrollSyncToggle.checked = scrollSyncEnabled;
    if (workspace && state.leftWidth) {
      workspace.style.setProperty('--compare-left-width', state.leftWidth);
    }
    syncAllPanes();
    requestAnimationFrame(() => {
      state.scroll?.forEach(({ id, top }) => {
        const pane = panes.find((p) => p.id === id);
        if (pane?.textWrap) pane.textWrap.scrollTop = top;
      });
      syncDiffGutterScroll(panes[0]);
    });
    if (state.find?.open) {
      showFindBar();
      if (findInput && state.find.query) {
        findInput.value = state.find.query;
        runFind();
      }
    }
    isRestoring = false;
    refreshHistoryButtons();
    updateUrlParams();
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

  function computeDiffOps(leftLines, rightLines) {
    const n = leftLines.length;
    const m = rightLines.length;
    if (!n && !m) return [];

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

    const ops = [];
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
        ops.push({ type: 'equal', left: i - 1, right: j - 1 });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.push({ type: 'insert', right: j - 1 });
        j--;
      } else {
        ops.push({ type: 'delete', left: i - 1 });
        i--;
      }
    }
    ops.reverse();
    return ops;
  }

  /** Line statuses: null, compare-diff-removed, compare-diff-added, compare-diff-changed */
  function buildDiffModel(leftText, rightText) {
    const leftLines = leftText.split('\n');
    const rightLines = rightText.split('\n');
    const n = leftLines.length;
    const m = rightLines.length;

    if (!n && !m) {
      return { left: [], right: [], hunks: [], charDiffPairs: new Map() };
    }

    if (n > MAX_DIFF_LINES || m > MAX_DIFF_LINES) {
      const max = Math.max(n, m);
      const left = [];
      const right = [];
      const hunks = [];
      for (let idx = 0; idx < max; idx++) {
        const l = leftLines[idx];
        const r = rightLines[idx];
        if (l === undefined) {
          right.push('compare-diff-added');
          left.push(null);
          hunks.push({
            type: 'insert',
            leftStart: 0,
            leftCount: 0,
            rightStart: idx,
            rightCount: 1,
          });
        } else if (r === undefined) {
          left.push('compare-diff-removed');
          right.push(null);
          hunks.push({
            type: 'delete',
            leftStart: idx,
            leftCount: 1,
            rightStart: idx,
            rightCount: 0,
          });
        } else if (l === r) {
          left.push(null);
          right.push(null);
        } else {
          left.push('compare-diff-changed');
          right.push('compare-diff-changed');
          hunks.push({
            type: 'modify',
            leftStart: idx,
            leftCount: 1,
            rightStart: idx,
            rightCount: 1,
          });
        }
      }
      const pairs = new Map();
      hunks.forEach((h) => {
        if (h.type === 'modify') pairs.set(h.leftStart, h.rightStart);
      });
      return { left, right, hunks, charDiffPairs: pairs };
    }

    const ops = computeDiffOps(leftLines, rightLines);
    const left = new Array(n).fill(null);
    const right = new Array(m).fill(null);
    const hunks = [];
    const pairs = new Map();

    let k = 0;
    let li = 0;
    let ri = 0;
    while (k < ops.length) {
      if (ops[k].type === 'equal') {
        li++;
        ri++;
        k++;
        continue;
      }

      const hunkLeftStart = li;
      const hunkRightStart = ri;
      const deleteIndices = [];
      const insertIndices = [];

      while (k < ops.length && ops[k].type !== 'equal') {
        if (ops[k].type === 'delete') {
          deleteIndices.push(ops[k].left);
          li++;
        } else {
          insertIndices.push(ops[k].right);
          ri++;
        }
        k++;
      }

      const leftCount = deleteIndices.length;
      const rightCount = insertIndices.length;
      const leftStart = leftCount ? deleteIndices[0] : hunkLeftStart;
      let type;

      if (leftCount && rightCount) {
        type = 'modify';
        deleteIndices.forEach((idx) => {
          left[idx] = 'compare-diff-changed';
        });
        insertIndices.forEach((idx) => {
          right[idx] = 'compare-diff-changed';
        });
        const pairCount = Math.min(leftCount, rightCount);
        for (let p = 0; p < pairCount; p++) {
          pairs.set(deleteIndices[p], insertIndices[p]);
        }
      } else if (leftCount) {
        type = 'delete';
        deleteIndices.forEach((idx) => {
          left[idx] = 'compare-diff-removed';
        });
      } else {
        type = 'insert';
        insertIndices.forEach((idx) => {
          right[idx] = 'compare-diff-added';
        });
      }

      hunks.push({
        type,
        leftStart,
        leftCount,
        rightStart: hunkRightStart,
        rightCount,
      });
    }

    return { left, right, hunks, charDiffPairs: pairs };
  }

  function computeCharDiffSpans(a, b) {
    const n = a.length;
    const m = b.length;
    if (!n && !m) return { left: [], right: [] };
    if (a === b) {
      return {
        left: [{ start: 0, end: n, kind: 'same' }],
        right: [{ start: 0, end: m, kind: 'same' }],
      };
    }

    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const left = [];
    const right = [];
    let i = n;
    let j = m;
    const leftRev = [];
    const rightRev = [];

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        leftRev.push({ index: i - 1, kind: 'same' });
        rightRev.push({ index: j - 1, kind: 'same' });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        rightRev.push({ index: j - 1, kind: 'add' });
        j--;
      } else {
        leftRev.push({ index: i - 1, kind: 'remove' });
        i--;
      }
    }

    leftRev.reverse();
    rightRev.reverse();

    function toSpans(items, textLen) {
      if (!items.length) return [{ start: 0, end: textLen, kind: 'same' }];
      const spans = [];
      let spanStart = 0;
      let kind = items[0].kind;
      for (let p = 1; p <= items.length; p++) {
        const atEnd = p === items.length;
        const nextKind = atEnd ? null : items[p].kind;
        if (atEnd || nextKind !== kind) {
          const end = atEnd ? textLen : items[p].index;
          spans.push({ start: spanStart, end, kind });
          if (!atEnd) {
            spanStart = items[p].index;
            kind = nextKind;
          }
        }
      }
      return spans;
    }

    return {
      left: toSpans(leftRev, n),
      right: toSpans(rightRev, m),
    };
  }

  function wrapCharDiffHtml(text, spans, side) {
    if (!spans.length) return escapeHtml(text);
    let html = '';
    let pos = 0;
    spans.forEach((span) => {
      if (span.start > pos) {
        html += escapeHtml(text.slice(pos, span.start));
      }
      const chunk = text.slice(span.start, span.end);
      if (span.kind === 'same') {
        html += escapeHtml(chunk);
      } else if (side === 'left' && span.kind === 'remove') {
        html += `<span class="compare-diff-char-removed">${escapeHtml(chunk)}</span>`;
      } else if (side === 'right' && span.kind === 'add') {
        html += `<span class="compare-diff-char-added">${escapeHtml(chunk)}</span>`;
      } else {
        html += escapeHtml(chunk);
      }
      pos = span.end;
    });
    if (pos < text.length) html += escapeHtml(text.slice(pos));
    return html;
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
      diffHunks = [];
      charDiffPairs = new Map();
      charDiffPairsReverse = new Map();
      return;
    }
    const model = buildDiffModel(panes[0].editor.value, panes[1].editor.value);
    diffLineStatus = { left: model.left, right: model.right };
    diffHunks = model.hunks;
    charDiffPairs = model.charDiffPairs;
    charDiffPairsReverse = new Map();
    for (const [lIdx, rIdx] of charDiffPairs) {
      charDiffPairsReverse.set(rIdx, lIdx);
    }
  }

  function updateLineMetrics() {
    const el = panes[0].editor || panes[1].editor;
    if (!el) return;
    const style = getComputedStyle(el);
    lineMetrics = {
      paddingTop: parseFloat(style.paddingTop) || 16,
      lineHeight: parseFloat(style.lineHeight) || 20.8,
    };
  }

  function lineTopForIndex(lineIndex) {
    return lineMetrics.paddingTop + lineIndex * lineMetrics.lineHeight;
  }

  /** Align diff gutter with editor body (below pane header). */
  function syncGutterHeadOffset() {
    const head = document.querySelector('#compareLeftPane .compare-pane-head');
    if (!head || !diffGutterScroll) return;
    diffGutterScroll.style.paddingTop = `${head.offsetHeight}px`;
  }

  /** Measure a logical line's Y offset inside the pane scroll content. */
  function getLineTop(pane, lineIndex) {
    const marker =
      pane.lineNumbers?.querySelector(`[data-line="${lineIndex}"]`) ||
      pane.highlight?.querySelector(`[data-line="${lineIndex}"]`);
    const wrap = pane.textWrap;
    if (!marker || !wrap) return lineTopForIndex(lineIndex);
    const wrapRect = wrap.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    return markerRect.top - wrapRect.top + wrap.scrollTop;
  }

  function getLineCenterTop(pane, lineIndex) {
    const marker =
      pane.lineNumbers?.querySelector(`[data-line="${lineIndex}"]`) ||
      pane.highlight?.querySelector(`[data-line="${lineIndex}"]`);
    const lineTop = getLineTop(pane, lineIndex);
    const lineHeight = marker?.offsetHeight || lineMetrics.lineHeight;
    const btnSize = 22;
    return lineTop + Math.max(0, (lineHeight - btnSize) / 2);
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

  function buildLineInnerHtml(pane, line, lineIndex, lang, leftLines, rightLines) {
    const isLeft = pane.id === 'left';
    let inner;
    if (charDiffPairs.size) {
      let pairedIndex = null;
      if (isLeft && charDiffPairs.has(lineIndex)) {
        pairedIndex = charDiffPairs.get(lineIndex);
      } else if (!isLeft && charDiffPairsReverse.has(lineIndex)) {
        pairedIndex = charDiffPairsReverse.get(lineIndex);
      }
      if (pairedIndex !== null) {
        const leftLine = leftLines[isLeft ? lineIndex : pairedIndex] || '';
        const rightLine = rightLines[isLeft ? pairedIndex : lineIndex] || '';
        const spans = computeCharDiffSpans(leftLine, rightLine);
        inner = wrapCharDiffHtml(
          line,
          isLeft ? spans.left : spans.right,
          isLeft ? 'left' : 'right',
        );
      }
    }
    if (!inner) inner = highlightSingleLine(line, lang);
    return inner;
  }

  function buildPaneHighlightHtml(pane, text, lineStatuses) {
    const lines = text.split('\n');
    const lang = resolveHljsLanguage(pane.language);
    const leftLines = panes[0].editor?.value.split('\n') || [];
    const rightLines = panes[1].editor?.value.split('\n') || [];
    let charOffset = 0;
    const parts = lines.map((line, i) => {
      const status = lineStatuses?.[i] || '';
      let inner = buildLineInnerHtml(pane, line, i, lang, leftLines, rightLines);
      const { offsets, activeLocal } = getLineFindMatches(pane, i, charOffset);
      charOffset += line.length + 1;
      if (offsets.length) {
        inner = applyFindMarksToLineHtml(inner, offsets, findInput.value.length, activeLocal);
      }
      const lineClass = status
        ? `compare-line compare-diff-line ${status}`
        : 'compare-line';
      return `<span class="${lineClass}" data-line="${i}">${inner}</span>`;
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
      if (!status) {
        return `<span class="compare-line-num" data-line="${i}">${num}</span>`;
      }
      return `<span class="compare-line-num compare-diff-gutter ${status}" data-line="${i}">${num}</span>`;
    }).join('');
    pane.lineNumbers.innerHTML = html;
  }

  function getEditorMinHeight(pane) {
    if (!pane.textWrap) return 240;
    return Math.max(240, pane.textWrap.clientHeight);
  }

  function getEditorContentHeight(pane) {
    if (!pane.editor) return 240;
    const style = getComputedStyle(pane.editor);
    const lineHeight = parseFloat(style.lineHeight) || 20.8;
    const paddingTop = parseFloat(style.paddingTop) || 16;
    const paddingBottom = parseFloat(style.paddingBottom) || 16;
    const lineCount = Math.max(1, pane.editor.value.split('\n').length);
    const lineBasedHeight = lineCount * lineHeight + paddingTop + paddingBottom;

    const prevHeight = pane.editor.style.height;
    pane.editor.style.height = '0px';
    const measured = pane.editor.scrollHeight;
    pane.editor.style.height = prevHeight;

    return Math.max(measured, lineBasedHeight);
  }

  function resizeEditor(pane) {
    if (!pane.editor || !pane.textWrap) return;
    const contentHeight = getEditorContentHeight(pane);
    const minHeight = getEditorMinHeight(pane);
    const height = Math.max(contentHeight, minHeight);
    const heightPx = `${height}px`;

    pane.editor.style.height = heightPx;
    if (pane.highlight) pane.highlight.style.height = heightPx;
    if (pane.textStack) {
      pane.textStack.style.height = heightPx;
      pane.textStack.style.minHeight = heightPx;
    }
    if (pane.textEditorEl) {
      pane.textEditorEl.style.height = heightPx;
      pane.textEditorEl.style.minHeight = heightPx;
    }
    if (pane.lineGutter) {
      pane.lineGutter.style.height = heightPx;
      pane.lineGutter.style.minHeight = heightPx;
    }
    if (pane.lineNumbers) {
      pane.lineNumbers.style.height = heightPx;
      pane.lineNumbers.style.minHeight = heightPx;
    }
  }

  function syncHighlightScroll(pane) {
    if (!pane.editor || !pane.highlight) return;
    pane.highlight.style.transform = `translate(${-pane.editor.scrollLeft}px, 0)`;
  }

  function applyHunk(hunkIndex, toRight) {
    const hunk = diffHunks[hunkIndex];
    if (!hunk) return;
    const target = toRight ? panes[1] : panes[0];
    const source = toRight ? panes[0] : panes[1];
    if (!target.editor || !source.editor) return;

    recordHistoryNow(target);
    const sourceLines = source.editor.value.split('\n');
    const targetLines = target.editor.value.split('\n');
    const sourceCount = toRight ? hunk.leftCount : hunk.rightCount;
    const sourceStart = toRight ? hunk.leftStart : hunk.rightStart;
    const targetCount = toRight ? hunk.rightCount : hunk.leftCount;
    const targetStart = toRight ? hunk.rightStart : hunk.leftStart;
    const replacementLines = sourceCount
      ? sourceLines.slice(sourceStart, sourceStart + sourceCount)
      : [];
    const newTarget = [
      ...targetLines.slice(0, targetStart),
      ...replacementLines,
      ...targetLines.slice(targetStart + targetCount),
    ];
    target.editor.value = newTarget.join('\n');

    // Mark as user-modified but keep filename so the diff context stays meaningful.
    if (target.editor.value && !target.localKey) {
      target.localKey = pasteKey(target);
      if (!target.filename) target.filename = 'Pasted content';
      updatePaneMeta(target);
      populateSelects();
      if (target.select) target.select.value = target.localKey;
    }
    syncHistoryAnchor(target);
    activePane = target;
    syncAllPanes();
    runFind();
    refreshHistoryButtons();
    scheduleSaveSession();
  }

  function applyHunkToRight(hunkIndex) {
    applyHunk(hunkIndex, true);
  }

  function renderDiffActions() {
    if (!diffActionsEl || !diffGutterInner) return;
    diffActionsEl.innerHTML = '';
    if (!bothSidesHaveContent() || !diffHunks.length) {
      diffGutterInner.style.height = '';
      return;
    }

    const contentH = Math.max(
      getEditorContentHeight(panes[0]),
      getEditorContentHeight(panes[1]),
    );
    diffGutterInner.style.height = `${contentH}px`;
    diffActionsEl.style.minHeight = `${contentH}px`;

    syncGutterHeadOffset();
    const leftPane = panes[0];
    if (leftPane.textWrap) leftPane.textWrap.offsetHeight;
    diffHunks.forEach((hunk, index) => {
      // Only left → right: copy/insert original content into the changed file.
      if (hunk.type !== 'delete' && hunk.type !== 'modify') return;

      const lineIndex = hunk.leftStart ?? 0;
      const top = getLineCenterTop(leftPane, lineIndex);
      const group = document.createElement('div');
      group.className = 'compare-diff-action-group';
      group.style.top = `${top}px`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'compare-diff-action';
      btn.title =
        hunk.type === 'modify'
          ? 'Replace changed lines with original'
          : 'Copy removed lines from original into changed';
      btn.setAttribute('aria-label', 'Apply original block to changed file');
      btn.textContent = '→';
      btn.addEventListener('click', () => applyHunkToRight(index));
      group.appendChild(btn);
      diffActionsEl.appendChild(group);
    });
  }

  function renderMinimap(pane, lineStatuses) {
    if (!pane.minimap || !pane.textWrap) return;
    pane.minimap.innerHTML = '';
    if (!lineStatuses?.length || !pane.textWrap.clientHeight) return;

    const scrollH = pane.textWrap.scrollHeight;
    if (scrollH <= 0) return;

    lineStatuses.forEach((status, i) => {
      if (!status) return;
      const top = lineTopForIndex(i);
      const mark = document.createElement('div');
      mark.className = `compare-diff-minimap-mark ${status}`;
      mark.style.top = `${(top / scrollH) * 100}%`;
      pane.minimap.appendChild(mark);
    });
  }

  function syncDiffGutterScroll(source) {
    if (!diffGutterScroll || !source?.textWrap) return;
    diffGutterScroll.scrollTop = source.textWrap.scrollTop;
  }

  function syncAllPanes() {
    recomputeDiff();
    updateLineMetrics();
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
      renderMinimap(pane, statuses);
    });
    requestAnimationFrame(() => {
      renderDiffActions();
      if (panes[0].textWrap) syncDiffGutterScroll(panes[0]);
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
    const {
      manual = false,
      localKey = null,
      selectValue,
      skipBaseline = false,
      language,
    } = options;
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
    syncHistoryAnchor(pane);
    updatePaneMeta(pane);
    if (language) pane.language = language;
    syncPaneHighlight(pane);
    populateSelects();
    if (pane.select) {
      const next = selectValue ?? pane.localKey ?? '';
      if ([...pane.select.options].some((o) => o.value === next) || next === '') {
        pane.select.value = next;
      }
    }
    if (activePane === pane) runFind();
    if (!skipBaseline) setPaneBaseline(pane);
    scheduleSaveSession();
  }

  function markPaneManual(pane) {
    if (!pane.editor) return;
    const hasText = Boolean(pane.editor.value);
    if (!hasText) {
      pane.localKey = null;
      pane.filename = '';
      if (pane.select) pane.select.value = '';
      syncHistoryAnchor(pane);
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
    if (!isRestoring) scheduleHistoryBurst(pane);
    markPaneManual(pane);
    syncPaneHighlight();
    if (activePane === pane) runFind();
    refreshHistoryButtons();
    scheduleSaveSession();
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
    if (!res.ok) return false;
    const data = await res.json();
    fileCatalog = data.files || [];
    populateSelects();
    return true;
  }

  async function initCompare() {
    await loadCatalog();
    const saved = loadSessionState();
    if (saved && hasMeaningfulSession(saved)) {
      restoreSessionState(saved);
      return;
    }
    applyUrlParams();
    panes.forEach((pane) => {
      if (!pane.baseline) setPaneBaseline(pane);
    });
    refreshHistoryButtons();
  }

  async function loadRemoteFile(pane, key) {
    const entry = fileCatalog.find((f) => f.key === key);
    if (!entry) return;
    const url = `${cfg.urls.apiFile}?source=${encodeURIComponent(entry.source)}&id=${entry.id}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    setPaneContent(pane, data.title, data.content, {
      selectValue: key,
      language: data.language || undefined,
    });
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
    syncDiffGutterScroll(source);
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
    scheduleSaveSession();
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
    if (resizeDragCleanup) resizeDragCleanup();
    isResizing = true;
    document.body.classList.add('compare-resizing');
    const rect = workspace.getBoundingClientRect();
    const onMove = (e) => {
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(85, Math.max(15, pct));
      workspace.style.setProperty('--compare-left-width', `${clamped}%`);
    };
    const cleanup = () => {
      isResizing = false;
      document.body.classList.remove('compare-resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      resizeDragCleanup = null;
    };
    const onUp = () => {
      cleanup();
      scheduleSaveSession();
    };
    resizeDragCleanup = cleanup;
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
    pane.editor?.addEventListener('scroll', () => syncHighlightScroll(pane));
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
      if (activePane !== pane) commitHistoryBurst();
      activePane = pane;
      refreshHistoryButtons();
      if (findBar && !findBar.classList.contains('hidden')) runFind();
    });

    pane.textWrap?.addEventListener('scroll', () => {
      syncDiffGutterScroll(pane);
      if (isScrollSyncing || !scrollSyncEnabled) return;
      const other = pane.id === 'left' ? panes[1] : panes[0];
      syncScrollFromSource(pane, other);
    });
  });

  scrollSyncToggle?.addEventListener('change', () => {
    scrollSyncEnabled = scrollSyncToggle.checked;
    if (scrollSyncEnabled) syncScrollFromSource(panes[0], panes[1]);
    scheduleSaveSession();
  });

  btnSearch?.addEventListener('click', showFindBar);
  btnFindClose?.addEventListener('click', hideFindBar);
  findInput?.addEventListener('input', () => {
    runFind();
    scheduleSaveSession();
  });
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

  btnUndo?.addEventListener('click', doUndo);
  btnRedo?.addEventListener('click', doRedo);
  btnReset?.addEventListener('click', resetActivePane);

  function onCompareDocKeydown(e) {
    const key = e.key.toLowerCase();

    if (e.key === 'Escape' && findBar && !findBar.classList.contains('hidden')) {
      hideFindBar();
      return;
    }

    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

    const active = document.activeElement;
    const inCompare = app?.contains(active);
    if (!inCompare) return;

    if (key === 'f') {
      e.preventDefault();
      e.stopPropagation();
      showFindBar();
      return;
    }

    // Don't intercept undo/redo when typing in the find bar — let the browser
    // handle the input's own undo there.
    const inFindInput = active === findInput;
    const inEditor = panes.some((p) => p.editor === active);
    if (!inEditor && inFindInput) return;

    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      doUndo();
      return;
    }

    if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      doRedo();
    }
  }

  function onCompareResize() {
    syncGutterHeadOffset();
    panes.forEach(resizeEditor);
    renderDiffActions();
  }

  document.addEventListener('keydown', onCompareDocKeydown, true);
  window.addEventListener('resize', onCompareResize);

  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => {
      panes.forEach(resizeEditor);
    });
    panes.forEach((pane) => {
      if (pane.textWrap) resizeObserver.observe(pane.textWrap);
    });
    if (window.__routerCleanup) {
      window.__routerCleanup.push(() => resizeObserver.disconnect());
    }
  }

  if (window.__routerCleanup) {
    window.__routerCleanup.push(() => {
      commitHistoryBurst();
      saveSessionState();
      clearTimeout(saveSessionTimer);
      clearTimeout(historyBurstTimer);
      if (resizeDragCleanup) resizeDragCleanup();
      document.removeEventListener('keydown', onCompareDocKeydown, true);
      window.removeEventListener('resize', onCompareResize);
    });
  }

  activePane = panes[0];
  if (workspace) workspace.style.setProperty('--compare-left-width', '50%');
  syncGutterHeadOffset();
  initCompare();
})();
