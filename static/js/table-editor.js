(function () {
  const cfg = window.TABLE_EDITOR_CONFIG;
  const container = document.getElementById('spreadsheetContainer');
  const titleInput = document.getElementById('tableTitle');
  const statusEl = document.getElementById('tableAutosaveStatus');
  const statusTextEl = statusEl?.querySelector('.autosave-badge-text');
  const btnSave = document.getElementById('btnManualSave');
  const btnAddColumn = document.getElementById('btnAddColumn');
  const btnAddRow = document.getElementById('btnAddRow');
  if (!cfg || !container) return;

  const canEdit = cfg.canEditContent !== false;
  const ROW_HEADER_WIDTH = 48;
  const AUTOSAVE_DELAY = 800;
  const HISTORY_DELAY = 900;

  const MIN_COL_WIDTH = 80;
  const DEFAULT_COL_WIDTH = 160;
  const CELL_MIN_HEIGHT = 44;
  const CELL_MAX_ROWS = 4;

  let sheetData = JSON.parse(JSON.stringify(cfg.initialData || { columns: [], rows: [] }));
  // Last state we know the server has; used as the common ancestor for merges.
  let baseData = JSON.parse(JSON.stringify(cfg.initialData || { columns: [], rows: [] }));
  // Cells edited locally but not yet confirmed saved; protected from remote overwrites.
  const dirtyCells = new Set();
  let saveTimer;
  let historyTimer;
  let historyCapture = null;
  let saving = false;
  let pending = false;
  let refreshing = false;
  let resizing = null;
  let colgroupEl = null;
  let isRestoring = false;
  let dragColId = null;
  let dragRowId = null;

  // ── Excel-like cell selection ──────────────────────────────────
  let selAnchor = null;   // { row: index, col: index }
  let selFocus = null;    // { row: index, col: index }
  let selDragging = false;
  let selDragMode = 'cells'; // 'cells' | 'cols' | 'rows' | 'table'
  let hasSelection = false;
  let cellTooltip = null;
  let textTooltip = null;
  let textColorPanel = null;
  let cellTooltipTimer = null;

  const TEXT_COLORS = ['#111111', '#d32f2f', '#e65100', '#2e7d32', '#1565c0', '#6a1b9a', '#616161'];
  const HIGHLIGHT_COLORS = ['transparent', '#fff59d', '#ffcdd2', '#c8e6c9', '#bbdefb', '#e1bee7', '#ffe0b2'];

  function cellKey(rowId, colId) {
    return `${rowId}\u0000${colId}`;
  }

  const history = window.createEditorHistory(60);

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

  function getFullState() {
    return {
      title: titleInput ? titleInput.value : '',
      color: cfg.initialColor,
      data: JSON.parse(JSON.stringify(collectData())),
    };
  }

  function getSavePayload() {
    const state = getFullState();
    state.base = baseData;
    return state;
  }

  function applyTableColor(hex) {
    const panel = document.getElementById('tableEditorPanel');
    if (panel && hex) panel.style.setProperty('--table-color', hex);
    const dot = document.querySelector('.color-picker-dot');
    if (dot && hex) dot.style.background = hex;
    cfg.initialColor = hex || '#FFFFFF';
  }

  function restoreState(state) {
    isRestoring = true;
    if (titleInput) titleInput.value = state.title;
    if (typeof state.color === 'string') {
      applyTableColor(state.color);
      const colorInput = document.querySelector(`#colorOptions input[value="${state.color}"]`);
      if (colorInput) colorInput.checked = true;
    }
    sheetData = JSON.parse(JSON.stringify(state.data));
    render();
    isRestoring = false;
    scheduleAutosave(true);
  }

  function recordHistoryNow() {
    if (isRestoring) return;
    historyCapture = null;
    clearTimeout(historyTimer);
    history.push(getFullState());
  }

  function scheduleHistoryCapture() {
    if (isRestoring) return;
    if (!historyCapture) historyCapture = getFullState();
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      if (historyCapture) {
        history.push(historyCapture);
        historyCapture = null;
      }
    }, HISTORY_DELAY);
  }

  function flushHistoryCapture() {
    if (!historyCapture) return;
    history.push(historyCapture);
    historyCapture = null;
    clearTimeout(historyTimer);
  }

  function ensureStructure() {
    if (!sheetData.columns.length) {
      for (let i = 0; i < 3; i += 1) {
        sheetData.columns.push({
          id: uid(),
          width: DEFAULT_COL_WIDTH,
          label: `Column ${i + 1}`,
        });
      }
    }
    sheetData.rows.forEach((row) => {
      if (!row.cells) row.cells = {};
      sheetData.columns.forEach((col) => {
        if (row.cells[col.id] === undefined) row.cells[col.id] = '';
      });
    });
    if (!sheetData.rows.length) {
      const cells = {};
      sheetData.columns.forEach((col) => { cells[col.id] = ''; });
      sheetData.rows.push({ id: uid(), cells });
    }
    if (!Array.isArray(sheetData.merges)) sheetData.merges = [];
    normalizeMerges();
  }

  function getMerges() {
    if (!Array.isArray(sheetData.merges)) sheetData.merges = [];
    return sheetData.merges;
  }

  function mergeToRect(merge) {
    const r1 = sheetData.rows.findIndex((row) => row.id === merge.rowId);
    const c1 = sheetData.columns.findIndex((col) => col.id === merge.colId);
    if (r1 < 0 || c1 < 0) return null;
    return {
      r1,
      c1,
      r2: Math.min(sheetData.rows.length - 1, r1 + Math.max(1, Number(merge.rowspan) || 1) - 1),
      c2: Math.min(sheetData.columns.length - 1, c1 + Math.max(1, Number(merge.colspan) || 1) - 1),
    };
  }

  function normalizeMerges() {
    const rowIds = new Set(sheetData.rows.map((row) => row.id));
    const colIds = new Set(sheetData.columns.map((col) => col.id));
    sheetData.merges = getMerges().filter((merge) => {
      if (!rowIds.has(merge.rowId) || !colIds.has(merge.colId)) return false;
      const rect = mergeToRect(merge);
      return rect && (rect.r2 > rect.r1 || rect.c2 > rect.c1);
    });
  }

  function buildMergeLookup() {
    const origin = new Map();
    const covered = new Map();
    getMerges().forEach((merge) => {
      const rect = mergeToRect(merge);
      if (!rect) return;
      origin.set(`${rect.r1},${rect.c1}`, { merge, rect });
      for (let r = rect.r1; r <= rect.r2; r += 1) {
        for (let c = rect.c1; c <= rect.c2; c += 1) {
          if (r === rect.r1 && c === rect.c1) continue;
          covered.set(`${r},${c}`, { merge, rect, originR: rect.r1, originC: rect.c1 });
        }
      }
    });
    return { origin, covered };
  }

  function expandRectToMerges(rect) {
    if (!rect) return rect;
    let { r1, r2, c1, c2 } = rect;
    let changed = true;
    while (changed) {
      changed = false;
      getMerges().forEach((merge) => {
        const mr = mergeToRect(merge);
        if (!mr) return;
        const overlaps = !(mr.r2 < r1 || mr.r1 > r2 || mr.c2 < c1 || mr.c1 > c2);
        if (!overlaps) return;
        const next = {
          r1: Math.min(r1, mr.r1),
          r2: Math.max(r2, mr.r2),
          c1: Math.min(c1, mr.c1),
          c2: Math.max(c2, mr.c2),
        };
        if (next.r1 !== r1 || next.r2 !== r2 || next.c1 !== c1 || next.c2 !== c2) {
          ({ r1, r2, c1, c2 } = next);
          changed = true;
        }
      });
    }
    return { r1, r2, c1, c2 };
  }

  function sanitizeCellHtml(html) {
    const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'SPAN', 'BR', 'DIV']);
    const wrap = document.createElement('div');
    wrap.innerHTML = String(html || '');
    function clean(node) {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === 3) return;
        if (child.nodeType !== 1) {
          child.remove();
          return;
        }
        if (!allowed.has(child.tagName)) {
          const parent = child.parentNode;
          while (child.firstChild) parent.insertBefore(child.firstChild, child);
          child.remove();
          return;
        }
        [...child.attributes].forEach((attr) => {
          if (child.tagName === 'SPAN' && attr.name === 'style') {
            const color = child.style.color;
            const bg = child.style.backgroundColor;
            child.removeAttribute('style');
            if (color) child.style.color = color;
            if (bg) child.style.backgroundColor = bg;
            if (!child.getAttribute('style')) child.removeAttribute('style');
          } else {
            child.removeAttribute(attr.name);
          }
        });
        clean(child);
      });
    }
    clean(wrap);
    const out = wrap.innerHTML.replace(/^<br\s*\/?>$/i, '').trim();
    return out === '<br>' ? '' : out;
  }

  function htmlToPlain(html) {
    if (!html) return '';
    if (!/[<>]/.test(html)) return normalizeCellText(html);
    const div = document.createElement('div');
    div.innerHTML = html;
    return normalizeCellText(div.innerText || div.textContent || '');
  }

  function getCellHtml(el) {
    if (!el) return '';
    if (el.isContentEditable) return sanitizeCellHtml(el.innerHTML);
    return el.value || '';
  }

  function setCellHtml(el, html) {
    if (!el) return;
    if (el.isContentEditable) el.innerHTML = sanitizeCellHtml(html);
    else el.value = htmlToPlain(html);
  }

  function getTableWidth() {
    return ROW_HEADER_WIDTH + sheetData.columns.reduce((sum, col) => sum + col.width, 0);
  }

  function normalizeColumnWidths() {
    sheetData.columns.forEach((col) => {
      const parsed = parseInt(col.width, 10);
      col.width = Number.isFinite(parsed)
        ? Math.max(MIN_COL_WIDTH, Math.min(800, parsed))
        : 160;
    });
  }

  function applyColumnWidths() {
    if (!colgroupEl) return;
    const cols = colgroupEl.querySelectorAll('col');
    if (!cols.length) return;

    cols[0].style.width = `${ROW_HEADER_WIDTH}px`;
    sheetData.columns.forEach((col, i) => {
      const colEl = cols[i + 1];
      if (colEl) colEl.style.width = `${col.width}px`;
    });

    const tableWidth = getTableWidth();
    const table = container.querySelector('.spreadsheet');
    if (table) {
      table.style.width = `${tableWidth}px`;
      table.style.minWidth = `${tableWidth}px`;
    }
    container.style.width = `${tableWidth}px`;
    container.style.minWidth = `${tableWidth}px`;
    applyPinnedLayout();
  }

  function updateTableLayout() {
    applyColumnWidths();
  }

  function collectData() {
    container.querySelectorAll('.cell-input').forEach((ta) => {
      const row = sheetData.rows.find((r) => r.id === ta.dataset.rowId);
      if (row) row.cells[ta.dataset.colId] = getCellHtml(ta);
    });
    container.querySelectorAll('.spreadsheet-col-head').forEach((th) => {
      const col = sheetData.columns.find((c) => c.id === th.dataset.colId);
      if (!col) return;
      const editing = th.querySelector('.col-head-inner.col-head-editing .col-header-input');
      if (editing) {
        col.label = editing.value;
        return;
      }
      const label = th.querySelector('.col-header-label');
      if (label) col.label = label.textContent;
    });
    return sheetData;
  }

  async function runAutosave() {
    if (saving) {
      pending = true;
      return;
    }
    saving = true;
    setStatus('saving');
    const savingSnapshot = new Set(dirtyCells);
    try {
      const res = await fetch(cfg.autosaveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': cfg.csrfToken },
        body: JSON.stringify(getSavePayload()),
      });
      if (!res.ok) throw new Error();
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      // Cells edited while this save was in flight stay dirty for the next save.
      savingSnapshot.forEach((key) => dirtyCells.delete(key));
      if (json && json.data) {
        baseData = JSON.parse(JSON.stringify(json.data));
        if (typeof json.color === 'string') {
          applyTableColor(json.color);
          const colorInput = document.querySelector(`#colorOptions input[value="${json.color}"]`);
          if (colorInput) colorInput.checked = true;
        }
        applyRemoteData(json.data);
        if (titleInput && document.activeElement !== titleInput && typeof json.title === 'string') {
          titleInput.value = json.title;
        }
      }
      setStatus('saved');
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
    if (!canEdit) return;
    setStatus('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(runAutosave, immediate ? 0 : AUTOSAVE_DELAY);
  }

  function structureSignature(data) {
    const cols = (data.columns || []).map((c) => c.id).join(',');
    const rows = (data.rows || []).map((r) => r.id).join(',');
    return `${cols}|${rows}`;
  }

  function applyInPlace(remote) {
    const active = document.activeElement;
    const focusRow = active?.dataset?.rowId;
    const focusCol = active?.dataset?.colId;

    let widthsChanged = false;
    remote.columns.forEach((rc) => {
      const col = sheetData.columns.find((c) => c.id === rc.id);
      if (!col) return;
      const editingHeader = container.querySelector(
        `.spreadsheet-col-head[data-col-id="${rc.id}"] .col-head-inner.col-head-editing`,
      );
      if (!editingHeader && typeof rc.label === 'string' && col.label !== rc.label) {
        col.label = rc.label;
        const span = container.querySelector(`.col-header-label[data-col-id="${rc.id}"]`);
        if (span) {
          span.textContent = rc.label;
          span.title = rc.label;
        }
      }
      if (!resizing && Number.isFinite(rc.width) && col.width !== rc.width) {
        col.width = rc.width;
        widthsChanged = true;
      }
      if (Boolean(rc.pinned) !== Boolean(col.pinned)) {
        col.pinned = Boolean(rc.pinned);
        widthsChanged = true;
      }
    });
    if (widthsChanged) applyColumnWidths();

    remote.rows.forEach((rr) => {
      const row = sheetData.rows.find((r) => r.id === rr.id);
      if (!row) return;
      Object.entries(rr.cells || {}).forEach(([colId, value]) => {
        if (dirtyCells.has(cellKey(rr.id, colId))) return;
        if (rr.id === focusRow && colId === focusCol) return;
        if (row.cells[colId] === value) return;
        row.cells[colId] = value;
        const ta = container.querySelector(
          `.cell-input[data-row-id="${rr.id}"][data-col-id="${colId}"]`,
        );
        if (ta) {
          setCellHtml(ta, value);
          autoResizeTextarea(ta);
        }
      });
    });
  }

  function applyStructural(remote) {
    const active = document.activeElement;
    const focusRow = active?.dataset?.rowId;
    const focusCol = active?.dataset?.colId;
    const selStart = active?.selectionStart;
    const selEnd = active?.selectionEnd;

    // Preserve locally unsaved (dirty) and currently focused cell values.
    const preserved = new Map();
    sheetData.rows.forEach((r) => {
      Object.entries(r.cells || {}).forEach(([colId, value]) => {
        const key = cellKey(r.id, colId);
        if (dirtyCells.has(key) || (r.id === focusRow && colId === focusCol)) {
          preserved.set(key, value);
        }
      });
    });

    sheetData = JSON.parse(JSON.stringify(remote));
    ensureStructure();
    sheetData.rows.forEach((r) => {
      sheetData.columns.forEach((c) => {
        const key = cellKey(r.id, c.id);
        if (preserved.has(key)) r.cells[c.id] = preserved.get(key);
      });
    });

    render();

    if (focusRow && focusCol) {
      const ta = container.querySelector(
        `.cell-input[data-row-id="${focusRow}"][data-col-id="${focusCol}"]`,
      );
      if (ta) {
        ta.focus({ preventScroll: true });
        if (typeof selStart === 'number' && typeof ta.setSelectionRange === 'function') {
          try {
            ta.setSelectionRange(selStart, selEnd);
          } catch {
            /* selection range not applicable */
          }
        }
      }
    }
  }

  function applyRemoteData(remote) {
    if (!remote || !Array.isArray(remote.columns) || !Array.isArray(remote.rows)) return;
    collectData();
    if (structureSignature(remote) === structureSignature(sheetData)) {
      applyInPlace(remote);
    } else {
      applyStructural(remote);
    }
  }

  async function refreshFromServer() {
    if (!cfg.dataUrl || refreshing || saving) return;
    refreshing = true;
    clearTimeout(saveTimer);
    const btnRefresh = document.getElementById('btnRefreshTable');
    btnRefresh?.setAttribute('disabled', 'disabled');
    try {
      if (canEdit && statusEl?.dataset.state === 'unsaved') {
        await runAutosave();
        if (statusEl?.dataset.state === 'error') return;
      }
      setStatus('saving', 'Refreshing…');
      const res = await fetch(cfg.dataUrl, { headers: { 'X-Requested-With': 'fetch' } });
      if (!res.ok) throw new Error();
      const json = await res.json();
      if (!json?.data) throw new Error();
      baseData = JSON.parse(JSON.stringify(json.data));
      if (typeof json.color === 'string') {
        applyTableColor(json.color);
        const colorInput = document.querySelector(`#colorOptions input[value="${json.color}"]`);
        if (colorInput) colorInput.checked = true;
      }
      applyRemoteData(json.data);
      if (titleInput && document.activeElement !== titleInput && typeof json.title === 'string') {
        titleInput.value = json.title;
      }
      if (findBar && !findBar.classList.contains('hidden') && findInput?.value) runFind();
      setStatus('saved', 'Refreshed');
      setTimeout(() => {
        if (dirtyCells.size > 0 || statusEl?.dataset.state === 'unsaved') setStatus('unsaved');
        else setStatus('saved');
      }, 1500);
    } catch {
      setStatus('error', 'Refresh failed');
    } finally {
      refreshing = false;
      btnRefresh?.removeAttribute('disabled');
    }
  }

  function autoResizeTextarea(ta) {
    if (ta.closest('.spreadsheet-cell.is-merged')) {
      ta.style.height = '100%';
      ta.style.overflowY = 'auto';
      return;
    }
    const style = getComputedStyle(ta);
    const lineHeight = parseFloat(style.lineHeight) || 19.5;
    const paddingTop = parseFloat(style.paddingTop) || 11;
    const paddingBottom = parseFloat(style.paddingBottom) || 11;
    const maxHeight = lineHeight * CELL_MAX_ROWS + paddingTop + paddingBottom;
    ta.style.height = 'auto';
    const contentHeight = ta.scrollHeight;
    const height = Math.min(Math.max(CELL_MIN_HEIGHT, contentHeight), maxHeight);
    ta.style.height = `${height}px`;
    ta.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
  }

  async function confirmDelete(message) {
    if (!window.AppModal) return true;
    return AppModal.confirm({
      title: 'Delete',
      message,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true,
    });
  }

  function getPinnedCount() {
    let count = 0;
    for (const col of sheetData.columns) {
      if (!col.pinned) break;
      count += 1;
    }
    return count;
  }

  function normalizePinnedFlags() {
    const freezeCount = getPinnedCount();
    sheetData.columns.forEach((col, i) => {
      col.pinned = i < freezeCount;
    });
  }

  function pinThroughColumn(colId) {
    if (!canEdit) return;
    const idx = sheetData.columns.findIndex((c) => c.id === colId);
    if (idx < 0) return;
    recordHistoryNow();
    collectData();
    sheetData.columns.forEach((col, i) => {
      col.pinned = i <= idx;
    });
    render();
    scheduleAutosave(true);
  }

  function unpinFromColumn(colId) {
    if (!canEdit) return;
    const idx = sheetData.columns.findIndex((c) => c.id === colId);
    if (idx < 0) return;
    recordHistoryNow();
    collectData();
    sheetData.columns.forEach((col, i) => {
      col.pinned = i < idx;
    });
    render();
    scheduleAutosave(true);
  }

  function applyPinnedLayout() {
    let left = ROW_HEADER_WIDTH;
    const freezeCount = getPinnedCount();
    sheetData.columns.forEach((col, i) => {
      const pinned = i < freezeCount;
      const isLast = pinned && i === freezeCount - 1;
      const th = container.querySelector(`.spreadsheet-col-head[data-col-id="${col.id}"]`);
      const cells = container.querySelectorAll(`.spreadsheet-cell[data-col-id="${col.id}"]`);
      const els = [th, ...cells].filter(Boolean);
      els.forEach((el) => {
        el.classList.toggle('is-pinned', pinned);
        el.classList.toggle('is-pinned-last', isLast);
        if (pinned) el.style.left = `${left}px`;
        else el.style.removeProperty('left');
      });
      if (pinned) left += col.width || DEFAULT_COL_WIDTH;
    });
  }

  function insertColumnAt(index) {
    recordHistoryNow();
    collectData();
    const freezeCount = getPinnedCount();
    const n = sheetData.columns.length + 1;
    const at = Math.max(0, Math.min(index, sheetData.columns.length));
    const col = {
      id: uid(),
      width: DEFAULT_COL_WIDTH,
      label: `Column ${n}`,
      pinned: freezeCount > 0 && at < freezeCount,
    };
    sheetData.columns.splice(at, 0, col);
    if (freezeCount > 0 && at < freezeCount) {
      sheetData.columns.forEach((c, i) => {
        c.pinned = i < freezeCount + 1;
      });
    } else {
      normalizePinnedFlags();
    }
    sheetData.rows.forEach((row) => { row.cells[col.id] = ''; });
    render();
    scheduleAutosave(true);
    return col;
  }

  function addColumn() {
    if (!canEdit) return;
    const col = insertColumnAt(sheetData.columns.length);
    requestAnimationFrame(() => {
      const scrollEl = container.closest('.spreadsheet-scroll');
      if (scrollEl) scrollEl.scrollLeft = scrollEl.scrollWidth;
    });
    return col;
  }

  function insertColumnRelative(colId, side) {
    const idx = sheetData.columns.findIndex((c) => c.id === colId);
    if (idx < 0) return;
    insertColumnAt(side === 'left' ? idx : idx + 1);
  }

  function insertRowAt(index) {
    recordHistoryNow();
    collectData();
    const cells = {};
    sheetData.columns.forEach((col) => { cells[col.id] = ''; });
    const row = { id: uid(), cells };
    const at = Math.max(0, Math.min(index, sheetData.rows.length));
    sheetData.rows.splice(at, 0, row);
    render();
    scheduleAutosave(true);
    return row;
  }

  function addRow() {
    if (!canEdit) return;
    insertRowAt(sheetData.rows.length);
  }

  function insertRowRelative(rowId, side) {
    const idx = sheetData.rows.findIndex((r) => r.id === rowId);
    if (idx < 0) return;
    insertRowAt(side === 'above' ? idx : idx + 1);
  }

  async function deleteColumn(colId) {
    if (sheetData.columns.length <= 1) {
      AppModal?.alert({ title: 'Cannot delete', message: 'At least one column is required.' });
      return;
    }
    const col = sheetData.columns.find((c) => c.id === colId);
    const ok = await confirmDelete(`Delete column "${col?.label || 'this column'}"?`);
    if (!ok) return;
    recordHistoryNow();
    collectData();
    sheetData.columns = sheetData.columns.filter((c) => c.id !== colId);
    sheetData.rows.forEach((row) => { delete row.cells[colId]; });
    render();
    scheduleAutosave(true);
  }

  async function deleteRow(rowId) {
    if (sheetData.rows.length <= 1) {
      AppModal?.alert({ title: 'Cannot delete', message: 'At least one row is required.' });
      return;
    }
    const idx = sheetData.rows.findIndex((r) => r.id === rowId);
    const ok = await confirmDelete(`Delete row ${idx + 1}?`);
    if (!ok) return;
    recordHistoryNow();
    collectData();
    sheetData.rows = sheetData.rows.filter((r) => r.id !== rowId);
    render();
    scheduleAutosave(true);
  }

  function reorderColumns(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    collectData();
    const fromIdx = sheetData.columns.findIndex((c) => c.id === sourceId);
    const toIdx = sheetData.columns.findIndex((c) => c.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    recordHistoryNow();
    const [moved] = sheetData.columns.splice(fromIdx, 1);
    sheetData.columns.splice(toIdx, 0, moved);
    normalizePinnedFlags();
    render();
    scheduleAutosave(true);
  }

  function clearColDragState() {
    dragColId = null;
    document.body.classList.remove('col-dragging');
    container.querySelectorAll('.spreadsheet-col-head').forEach((head) => {
      head.classList.remove('col-drag-source', 'col-drag-over');
    });
  }

  function defaultColumnLabel(index) {
    return `Column ${index + 1}`;
  }

  function startColumnLabelEdit(headInner, labelInput, labelSpan) {
    hideCellTooltip();
    hideTextTooltip();
    headInner.classList.add('col-head-editing');
    labelInput.value = labelSpan.textContent;
    labelInput.focus();
    labelInput.select();
  }

  function finishColumnLabelEdit(headInner, labelInput, labelSpan, col, index, revert) {
    headInner.classList.remove('col-head-editing');
    if (revert) {
      labelInput.value = labelSpan.textContent;
      return;
    }
    const next = labelInput.value.trim() || defaultColumnLabel(index);
    labelInput.value = next;
    labelSpan.textContent = next;
    labelSpan.title = next;
    col.label = next;
    scheduleHistoryCapture();
    scheduleAutosave();
    if (findBar && !findBar.classList.contains('hidden') && findInput?.value) runFind();
  }

  function bindColumnDrag(th, col, headInner) {
    headInner.draggable = true;

    headInner.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || headInner.classList.contains('col-head-editing')) return;
      if (e.target.closest('.col-resize-handle')) return;
      document.body.classList.add('col-drag-pending');
      const colIdx = sheetData.columns.findIndex((c) => c.id === col.id);
      didDragSelect = false;
      selDragging = true;
      selectColumn(colIdx, e.shiftKey);
    });

    th.addEventListener('mouseenter', (e) => {
      if (!selDragging || selDragMode !== 'cols' || e.buttons !== 1) return;
      const colIdx = sheetData.columns.findIndex((c) => c.id === col.id);
      if (colIdx < 0) return;
      didDragSelect = true;
      selectColumn(colIdx, true);
    });

    headInner.addEventListener('dragstart', (e) => {
      if (didDragSelect && selDragMode === 'cols') {
        e.preventDefault();
        return;
      }
      if (headInner.classList.contains('col-head-editing')) {
        e.preventDefault();
        return;
      }
      dragColId = col.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', col.id);
      th.classList.add('col-drag-source');
      document.body.classList.add('col-dragging');
    });

    headInner.addEventListener('dragend', () => {
      document.body.classList.remove('col-drag-pending');
      clearColDragState();
    });

    th.addEventListener('dragover', (e) => {
      if (!dragColId || dragColId === col.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.spreadsheet-col-head.col-drag-over').forEach((el) => {
        if (el !== th) el.classList.remove('col-drag-over');
      });
      th.classList.add('col-drag-over');
    });

    th.addEventListener('dragleave', (e) => {
      if (!th.contains(e.relatedTarget)) th.classList.remove('col-drag-over');
    });

    th.addEventListener('drop', (e) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData('text/plain') || dragColId;
      clearColDragState();
      reorderColumns(sourceId, col.id);
    });
  }

  function reorderRows(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    collectData();
    const fromIdx = sheetData.rows.findIndex((r) => r.id === sourceId);
    const toIdx = sheetData.rows.findIndex((r) => r.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    recordHistoryNow();
    const [moved] = sheetData.rows.splice(fromIdx, 1);
    sheetData.rows.splice(toIdx, 0, moved);
    render();
    scheduleAutosave(true);
  }

  function clearRowDragState() {
    dragRowId = null;
    document.body.classList.remove('row-dragging');
    container.querySelectorAll('tr.spreadsheet-data-row').forEach((tr) => {
      tr.classList.remove('row-drag-source', 'row-drag-over');
    });
  }

  function bindRowDrag(tr, row, rowLabel) {
    tr.classList.add('spreadsheet-data-row');
    tr.dataset.rowId = row.id;

    rowLabel.draggable = true;

    rowLabel.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      document.body.classList.add('row-drag-pending');
      const rowIdx = sheetData.rows.findIndex((r) => r.id === row.id);
      didDragSelect = false;
      selDragging = true;
      selectRow(rowIdx, e.shiftKey);
    });

    tr.addEventListener('mouseenter', (e) => {
      if (!selDragging || selDragMode !== 'rows' || e.buttons !== 1) return;
      const rowIdx = sheetData.rows.findIndex((r) => r.id === row.id);
      if (rowIdx < 0) return;
      didDragSelect = true;
      selectRow(rowIdx, true);
    });

    rowLabel.addEventListener('dragstart', (e) => {
      if (didDragSelect && selDragMode === 'rows') {
        e.preventDefault();
        return;
      }
      dragRowId = row.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.id);
      tr.classList.add('row-drag-source');
      document.body.classList.add('row-dragging');
    });

    rowLabel.addEventListener('dragend', () => {
      document.body.classList.remove('row-drag-pending');
      clearRowDragState();
    });

    tr.addEventListener('dragover', (e) => {
      if (!dragRowId || dragRowId === row.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('tr.spreadsheet-data-row.row-drag-over').forEach((el) => {
        if (el !== tr) el.classList.remove('row-drag-over');
      });
      tr.classList.add('row-drag-over');
    });

    tr.addEventListener('dragleave', (e) => {
      if (!tr.contains(e.relatedTarget)) tr.classList.remove('row-drag-over');
    });

    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData('text/plain') || dragRowId;
      clearRowDragState();
      reorderRows(sourceId, row.id);
    });
  }

  function startResize(e, colId) {
    e.preventDefault();
    e.stopPropagation();
    const col = sheetData.columns.find((c) => c.id === colId);
    if (!col) return;
    resizing = { colId, startX: e.clientX, startWidth: col.width };
    document.body.classList.add('col-resizing');
  }

  function onMouseMove(e) {
    if (!resizing) return;
    const col = sheetData.columns.find((c) => c.id === resizing.colId);
    if (!col) return;
    const delta = e.clientX - resizing.startX;
    col.width = Math.max(MIN_COL_WIDTH, Math.min(800, resizing.startWidth + delta));
    colgroupEl?.querySelector(`col[data-col-id="${col.id}"]`)?.style.setProperty('width', `${col.width}px`);
    const table = container.querySelector('.spreadsheet');
    if (table) {
      const tableWidth = getTableWidth();
      table.style.width = `${tableWidth}px`;
      table.style.minWidth = `${tableWidth}px`;
      container.style.width = `${tableWidth}px`;
      container.style.minWidth = `${tableWidth}px`;
    }
    applyPinnedLayout();
  }

  function stopResize() {
    if (!resizing) return;
    resizing = null;
    document.body.classList.remove('col-resizing');
    scheduleAutosave(true);
  }

  function clearDragPendingCursors() {
    document.body.classList.remove('col-drag-pending', 'row-drag-pending');
  }

  function onDocumentMouseUp() {
    stopResize();
    clearDragPendingCursors();
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onDocumentMouseUp);

  function buildColgroup() {
    const colgroup = document.createElement('colgroup');
    const cornerCol = document.createElement('col');
    cornerCol.style.width = `${ROW_HEADER_WIDTH}px`;
    colgroup.appendChild(cornerCol);
    sheetData.columns.forEach((col) => {
      const colEl = document.createElement('col');
      colEl.dataset.colId = col.id;
      colEl.style.width = `${col.width}px`;
      colgroup.appendChild(colEl);
    });
    return colgroup;
  }

  function render() {
    ensureStructure();
    normalizeColumnWidths();

    const table = document.createElement('table');
    table.className = 'spreadsheet';

    colgroupEl = buildColgroup();
    table.appendChild(colgroupEl);

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'spreadsheet-corner';
    corner.title = 'Select all';
    corner.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      didDragSelect = true;
      selDragging = true;
      selectEntireSheet();
    });
    headRow.appendChild(corner);

    sheetData.columns.forEach((col, index) => {
      const th = document.createElement('th');
      th.className = 'spreadsheet-col-head';
      th.dataset.colId = col.id;

      const headInner = document.createElement('div');
      headInner.className = 'col-head-inner';

      const labelText = col.label || defaultColumnLabel(index);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'col-header-label';
      labelSpan.dataset.colId = col.id;
      labelSpan.textContent = labelText;
      labelSpan.title = labelText;

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'col-header-input';
      labelInput.dataset.colId = col.id;
      labelInput.value = labelText;
      labelInput.placeholder = defaultColumnLabel(index);
      labelInput.setAttribute('aria-label', `Rename ${labelText}`);

      labelInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          labelInput.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finishColumnLabelEdit(headInner, labelInput, labelSpan, col, index, true);
          labelInput.blur();
        }
      });

      labelInput.addEventListener('blur', () => {
        if (!headInner.classList.contains('col-head-editing')) return;
        finishColumnLabelEdit(headInner, labelInput, labelSpan, col, index, false);
      });

      headInner.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideCellTooltip();
        startColumnLabelEdit(headInner, labelInput, labelSpan);
      });

      headInner.appendChild(labelSpan);
      headInner.appendChild(labelInput);
      bindColumnDrag(th, col, headInner);

      th.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showSheetContextMenu(e.clientX, e.clientY, 'column', col.id);
      });

      const resize = document.createElement('span');
      resize.className = 'col-resize-handle';
      resize.dataset.colId = col.id;

      th.appendChild(headInner);
      th.appendChild(resize);
      headRow.appendChild(th);
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const mergeLookup = buildMergeLookup();
    sheetData.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      const rowLabel = document.createElement('td');
      rowLabel.className = 'spreadsheet-row-label';

      const rowInner = document.createElement('div');
      rowInner.className = 'row-label-inner';

      const rowNum = document.createElement('span');
      rowNum.className = 'row-num';
      rowNum.textContent = String(rowIndex + 1);

      rowInner.appendChild(rowNum);
      rowLabel.appendChild(rowInner);
      tr.appendChild(rowLabel);
      bindRowDrag(tr, row, rowLabel);

      rowLabel.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showSheetContextMenu(e.clientX, e.clientY, 'row', row.id);
      });

      sheetData.columns.forEach((col, colIndex) => {
        if (mergeLookup.covered.has(`${rowIndex},${colIndex}`)) return;
        const origin = mergeLookup.origin.get(`${rowIndex},${colIndex}`);
        const td = document.createElement('td');
        td.className = 'spreadsheet-cell';
        td.dataset.colId = col.id;
        td.dataset.rowIdx = String(rowIndex);
        td.dataset.colIdx = String(colIndex);
        if (origin) {
          const rowspan = origin.rect.r2 - origin.rect.r1 + 1;
          const colspan = origin.rect.c2 - origin.rect.c1 + 1;
          if (rowspan > 1) td.rowSpan = rowspan;
          if (colspan > 1) td.colSpan = colspan;
          td.classList.add('is-merged');
        }

        const ta = document.createElement('div');
        ta.className = 'cell-input';
        ta.contentEditable = canEdit ? 'true' : 'false';
        ta.spellcheck = false;
        ta.role = 'textbox';
        ta.dataset.rowId = row.id;
        ta.dataset.colId = col.id;
        ta.dataset.rowIdx = String(rowIndex);
        ta.dataset.colIdx = String(colIndex);
        setCellHtml(ta, row.cells[col.id] || '');
        ta.addEventListener('beforeinput', () => {
          scheduleHistoryCapture();
        });
        ta.addEventListener('input', () => {
          dirtyCells.add(cellKey(ta.dataset.rowId, ta.dataset.colId));
          autoResizeTextarea(ta);
          scheduleAutosave();
          if (findBar && !findBar.classList.contains('hidden') && findInput?.value) runFind();
        });
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            document.execCommand('insertLineBreak');
          }
        });
        td.appendChild(ta);
        tr.appendChild(td);
        requestAnimationFrame(() => autoResizeTextarea(ta));
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);

    container.querySelectorAll('.col-resize-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        recordHistoryNow();
        startResize(e, handle.dataset.colId);
      });
    });

    applyColumnWidths();
    applyPinnedLayout();
    refreshFindAfterRender();
    paintSelection();
  }

  function doUndo() {
    flushHistoryCapture();
    const prev = history.undo(getFullState());
    if (prev) restoreState(prev);
  }

  function doRedo() {
    flushHistoryCapture();
    const next = history.redo(getFullState());
    if (next) restoreState(next);
  }

  btnAddColumn?.addEventListener('click', addColumn);
  btnAddRow?.addEventListener('click', addRow);
  container.addEventListener('paste', onCellPaste);

  // ── Selection helpers ──────────────────────────────────────────
  function getSelectionRect() {
    if (!selAnchor || !selFocus) return null;
    return expandRectToMerges({
      r1: Math.min(selAnchor.row, selFocus.row),
      r2: Math.max(selAnchor.row, selFocus.row),
      c1: Math.min(selAnchor.col, selFocus.col),
      c2: Math.max(selAnchor.col, selFocus.col),
    });
  }

  function clearSelection() {
    selAnchor = null;
    selFocus = null;
    selDragMode = 'cells';
    hasSelection = false;
    container.querySelectorAll('.spreadsheet-cell.sel-selected').forEach((el) => {
      el.classList.remove('sel-selected', 'sel-top', 'sel-bottom', 'sel-left', 'sel-right');
    });
    container.querySelectorAll('.spreadsheet-col-head.sel-col-active').forEach((el) => {
      el.classList.remove('sel-col-active');
    });
    container.querySelectorAll('.spreadsheet-row-label.sel-row-active').forEach((el) => {
      el.classList.remove('sel-row-active');
    });
    container.querySelector('.spreadsheet-corner')?.classList.remove('sel-table-active');
    hideCellTooltip();
    hideTextTooltip();
  }

  function paintSelection() {
    // Clear old paint
    container.querySelectorAll('.spreadsheet-cell.sel-selected').forEach((el) => {
      el.classList.remove('sel-selected', 'sel-top', 'sel-bottom', 'sel-left', 'sel-right');
    });
    container.querySelectorAll('.spreadsheet-col-head.sel-col-active').forEach((el) => {
      el.classList.remove('sel-col-active');
    });
    container.querySelectorAll('.spreadsheet-row-label.sel-row-active').forEach((el) => {
      el.classList.remove('sel-row-active');
    });
    container.querySelector('.spreadsheet-corner')?.classList.remove('sel-table-active');

    const rect = expandRectToMerges(getSelectionRect());
    if (!rect) return;

    const isSingleCell = rect.r1 === rect.r2 && rect.c1 === rect.c2;
    if (selDragMode === 'cells' && isSingleCell) {
      hasSelection = false;
      hideCellTooltip();
      return;
    }
    hasSelection = true;
    const mergeLookup = buildMergeLookup();

    // Paint cells
    container.querySelectorAll('.spreadsheet-cell').forEach((td) => {
      const r = parseInt(td.dataset.rowIdx, 10);
      const c = parseInt(td.dataset.colIdx, 10);
      const origin = mergeLookup.origin.get(`${r},${c}`);
      const cellR1 = origin ? origin.rect.r1 : r;
      const cellR2 = origin ? origin.rect.r2 : r;
      const cellC1 = origin ? origin.rect.c1 : c;
      const cellC2 = origin ? origin.rect.c2 : c;
      const overlaps = !(cellR2 < rect.r1 || cellR1 > rect.r2 || cellC2 < rect.c1 || cellC1 > rect.c2);
      if (!overlaps) return;
      td.classList.add('sel-selected');
      if (cellR1 === rect.r1) td.classList.add('sel-top');
      if (cellR2 === rect.r2) td.classList.add('sel-bottom');
      if (cellC1 === rect.c1) td.classList.add('sel-left');
      if (cellC2 === rect.c2) td.classList.add('sel-right');
    });

    // Highlight column headers
    const colHeads = container.querySelectorAll('.spreadsheet-col-head');
    colHeads.forEach((th, i) => {
      if (i >= rect.c1 && i <= rect.c2) th.classList.add('sel-col-active');
    });

    // Highlight row labels
    const rowLabels = container.querySelectorAll('.spreadsheet-row-label');
    rowLabels.forEach((td, i) => {
      if (i >= rect.r1 && i <= rect.r2) td.classList.add('sel-row-active');
    });

    const lastRow = Math.max(0, sheetData.rows.length - 1);
    const lastCol = Math.max(0, sheetData.columns.length - 1);
    if (rect.r1 === 0 && rect.c1 === 0 && rect.r2 === lastRow && rect.c2 === lastCol) {
      container.querySelector('.spreadsheet-corner')?.classList.add('sel-table-active');
    }
  }

  function lastRowIdx() {
    return Math.max(0, sheetData.rows.length - 1);
  }

  function lastColIdx() {
    return Math.max(0, sheetData.columns.length - 1);
  }

  function selectColumn(colIdx, extend) {
    if (colIdx < 0 || colIdx > lastColIdx()) return;
    const endRow = lastRowIdx();
    if (extend && selAnchor) {
      selAnchor = { row: 0, col: selAnchor.col };
      selFocus = { row: endRow, col: colIdx };
    } else {
      selAnchor = { row: 0, col: colIdx };
      selFocus = { row: endRow, col: colIdx };
    }
    selDragMode = 'cols';
    paintSelection();
    hideCellTooltip();
    hideTextTooltip();
    if (document.activeElement?.classList?.contains('cell-input')) {
      document.activeElement.blur();
    }
  }

  function selectRow(rowIdx, extend) {
    if (rowIdx < 0 || rowIdx > lastRowIdx()) return;
    const endCol = lastColIdx();
    if (extend && selAnchor) {
      selAnchor = { row: selAnchor.row, col: 0 };
      selFocus = { row: rowIdx, col: endCol };
    } else {
      selAnchor = { row: rowIdx, col: 0 };
      selFocus = { row: rowIdx, col: endCol };
    }
    selDragMode = 'rows';
    paintSelection();
    hideCellTooltip();
    hideTextTooltip();
    if (document.activeElement?.classList?.contains('cell-input')) {
      document.activeElement.blur();
    }
  }

  function selectEntireSheet() {
    selAnchor = { row: 0, col: 0 };
    selFocus = { row: lastRowIdx(), col: lastColIdx() };
    selDragMode = 'table';
    paintSelection();
    hideCellTooltip();
    hideTextTooltip();
    if (document.activeElement?.classList?.contains('cell-input')) {
      document.activeElement.blur();
    }
  }

  function cellIdxFromEvent(e) {
    const td = e.target.closest('.spreadsheet-cell');
    if (!td) return null;
    return {
      row: parseInt(td.dataset.rowIdx, 10),
      col: parseInt(td.dataset.colIdx, 10),
    };
  }

  let didDragSelect = false;

  function stopNativeTextSelect() {
    window.getSelection()?.removeAllRanges();
    const active = document.activeElement;
    if (active?.classList?.contains('cell-input')) active.blur();
  }

  // Mouse-based drag selection
  container.addEventListener('mousedown', (e) => {
    // Don't interfere with resize handles, context menus, or header edits
    if (e.target.closest('.col-resize-handle')) return;
    if (e.target.closest('.col-head-inner')) return;
    if (e.target.closest('.spreadsheet-row-label')) return;
    if (e.target.closest('.spreadsheet-corner')) return;
    if (e.button !== 0) return;

    const idx = cellIdxFromEvent(e);
    if (!idx) return;

    didDragSelect = false;
    const ta = e.target.closest('.cell-input');
    const alreadyEditing = ta && document.activeElement === ta;

    if (alreadyEditing && !e.shiftKey) {
      selDragging = false;
      return;
    }

    const mergeRect = getMergeRectFromCell(e.target);
    const selRect = getSelectionRect();
    const clickingSelectedMerge = mergeRect && hasSelection && selRect
      && selRect.r1 === mergeRect.r1 && selRect.r2 === mergeRect.r2
      && selRect.c1 === mergeRect.c1 && selRect.c2 === mergeRect.c2;

    if (clickingSelectedMerge && !e.shiftKey) {
      const input = e.target.closest('.spreadsheet-cell')?.querySelector('.cell-input');
      selDragging = false;
      clearSelection();
      focusCellInput(input);
      return;
    }

    window.getSelection()?.removeAllRanges();

    if (e.shiftKey && selAnchor) {
      e.preventDefault();
      selFocus = idx;
      selDragging = true;
      selDragMode = 'cells';
      document.body.classList.add('sheet-selecting');
      stopNativeTextSelect();
      paintSelection();
      hideCellTooltip();
      return;
    }

    if (mergeRect && !e.shiftKey) {
      selAnchor = { row: mergeRect.r1, col: mergeRect.c1 };
      selFocus = { row: mergeRect.r2, col: mergeRect.c2 };
    } else {
      selAnchor = idx;
      selFocus = idx;
    }
    selDragging = true;
    selDragMode = 'cells';
    paintSelection();
    hideCellTooltip();

    if (!alreadyEditing) {
      e.preventDefault();
      document.body.classList.add('sheet-selecting');
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!selDragging) return;
    if (selDragMode === 'cols' || selDragMode === 'rows' || selDragMode === 'table') return;
    const idx = cellIdxFromEvent(e);
    if (!idx) return;
    if (selFocus && idx.row === selFocus.row && idx.col === selFocus.col) return;
    const currentRect = getSelectionRect();
    if (currentRect && idx.row >= currentRect.r1 && idx.row <= currentRect.r2 && idx.col >= currentRect.c1 && idx.col <= currentRect.c2 && !didDragSelect) {
      return;
    }
    didDragSelect = true;
    document.body.classList.add('sheet-selecting');
    stopNativeTextSelect();
    selFocus = idx;
    paintSelection();
  });

  function cellInputFromEvent(e) {
    const cell = e.target.closest?.('.spreadsheet-cell');
    return cell?.querySelector('.cell-input') || e.target.closest?.('.cell-input') || null;
  }

  function focusCellInput(ta) {
    if (!ta || !canEdit) return;
    ta.focus({ preventScroll: true });
  }

  document.addEventListener('mouseup', (e) => {
    if (e.target.closest?.('.sheet-cell-tooltip, .sheet-text-tooltip')) return;
    if (selDragging) {
      selDragging = false;
      document.body.classList.remove('sheet-selecting');
      if (selDragMode === 'cols' || selDragMode === 'rows' || selDragMode === 'table' || hasSelection) {
        hideCellTooltip();
        hideTextTooltip();
        if (hasSelection && document.activeElement?.classList.contains('cell-input')) {
          document.activeElement.blur();
        }
        return;
      }
      const ta = cellInputFromEvent(e);
      if (ta && document.activeElement !== ta) {
        focusCellInput(ta);
      }
    }
    requestAnimationFrame(updateTextTooltip);
  });

  document.addEventListener('selectstart', (e) => {
    if (selDragging) {
      e.preventDefault();
      return;
    }
    if (hasSelection && e.target.closest?.('.spreadsheet') && !e.target.closest?.('.cell-input')) {
      e.preventDefault();
    }
  });

  container.addEventListener('dblclick', (e) => {
    const cell = e.target.closest('.spreadsheet-cell');
    const ta = e.target.closest('.cell-input') || cell?.querySelector('.cell-input');
    if (!ta || !canEdit) return;
    hideCellTooltip();
    focusCellInput(ta);
  });

  // Clear selection when user starts typing in a cell
  container.addEventListener('focus', (e) => {
    if (!e.target.classList.contains('cell-input')) return;
    if (hasSelection) clearSelection();
  }, true);

  // Build copy payload from selection
  function buildSelectionCopyPayload() {
    const rect = getSelectionRect();
    if (!rect) return null;
    collectData();

    const selectedCols = sheetData.columns.slice(rect.c1, rect.c2 + 1);
    const selectedRows = sheetData.rows.slice(rect.r1, rect.r2 + 1);

    const headers = selectedCols.map((col, i) =>
      cellValueForExport(col.label || defaultColumnLabel(rect.c1 + i)),
    );
    const rows = selectedRows.map((row) =>
      selectedCols.map((col) => cellValueForExport(row.cells[col.id])),
    );

    const tsvHeader = headers.map(cellForTsvExport).join('\t');
    const tsvRows = rows.map((r) => r.map(cellForTsvExport).join('\t'));
    const plain = [tsvHeader, ...tsvRows].join('\n');
    const tableHtml = buildCleanTableHtml(headers, rows);
    return { plain, tableHtml };
  }

  async function copySelection() {
    const payload = buildSelectionCopyPayload();
    if (!payload) return false;
    prepareTableCopy();
    const ok = await copyRichContentToClipboard(payload.plain, payload.tableHtml);
    if (ok) showCopiedFeedback();
    return ok;
  }

  function positionFloatingTip(el, anchorRect) {
    el.hidden = false;
    el.style.visibility = 'hidden';
    const tip = el.getBoundingClientRect();
    const headerBottom = container.querySelector('.spreadsheet-col-head')?.getBoundingClientRect().bottom ?? 0;
    const rowLabelRight = container.querySelector('.spreadsheet-row-label')?.getBoundingClientRect().right ?? 0;
    let left = anchorRect.left + (anchorRect.width - tip.width) / 2;
    let top = anchorRect.top - tip.height - 8;

    if (selDragMode === 'cols' || selDragMode === 'table') {
      top = Math.max(anchorRect.top, headerBottom) + 12;
      left = Math.max(anchorRect.left, rowLabelRight) + 12;
    } else if (selDragMode === 'rows') {
      left = Math.max(anchorRect.left, rowLabelRight) + 12;
      top = Math.max(anchorRect.top, headerBottom) + 12;
    } else if (top < headerBottom + 8 || top < 8) {
      top = Math.max(anchorRect.top, headerBottom) + 12;
    }

    left = Math.max(8, Math.min(left, window.innerWidth - tip.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - tip.height - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = '';
  }

  function getSelectedCellsBounds() {
    const cells = [...container.querySelectorAll('.spreadsheet-cell.sel-selected')];
    if (!cells.length) return null;
    const rects = cells.map((cell) => cell.getBoundingClientRect());
    return {
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
      get width() { return this.right - this.left; },
      get height() { return this.bottom - this.top; },
    };
  }

  function selectionIsExactMerge(rect) {
    return getMerges().some((merge) => {
      const mr = mergeToRect(merge);
      return mr && mr.r1 === rect.r1 && mr.r2 === rect.r2 && mr.c1 === rect.c1 && mr.c2 === rect.c2;
    });
  }

  function getMergeRectFromCell(el) {
    const td = el?.closest?.('.spreadsheet-cell');
    if (!td) return null;
    const r = parseInt(td.dataset.rowIdx, 10);
    const c = parseInt(td.dataset.colIdx, 10);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
    return buildMergeLookup().origin.get(`${r},${c}`)?.rect || null;
  }

  function hideCellTooltip() {
    clearTimeout(cellTooltipTimer);
    cellTooltipTimer = null;
    if (cellTooltip) cellTooltip.hidden = true;
  }

  function scheduleCellTooltip() {
    clearTimeout(cellTooltipTimer);
    cellTooltipTimer = setTimeout(() => {
      cellTooltipTimer = null;
      showCellTooltip();
    }, 280);
  }

  function hideTextTooltip() {
    if (textTooltip) textTooltip.hidden = true;
    if (textColorPanel) textColorPanel.hidden = true;
  }

  function ensureCellTooltip() {
    if (cellTooltip) return;
    cellTooltip = document.createElement('div');
    cellTooltip.className = 'sheet-cell-tooltip';
    cellTooltip.hidden = true;
    cellTooltip.innerHTML = `
      <button type="button" data-tip-action="copy">Copy</button>
      <button type="button" data-tip-action="merge">Merge cell</button>
      <button type="button" data-tip-action="clear">Clear</button>
    `;
    document.body.appendChild(cellTooltip);
    cellTooltip.addEventListener('mousedown', (e) => e.preventDefault());
    cellTooltip.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-tip-action]');
      if (!btn || !canEdit && btn.dataset.tipAction !== 'copy') return;
      const action = btn.dataset.tipAction;
      if (action === 'copy') {
        await copySelection();
      } else if (action === 'merge') {
        const focused = document.activeElement?.classList?.contains('cell-input')
          ? document.activeElement
          : null;
        const mergeRect = focused ? getMergeRectFromCell(focused) : null;
        if (!hasSelection && mergeRect) {
          selAnchor = { row: mergeRect.r1, col: mergeRect.c1 };
          selFocus = { row: mergeRect.r2, col: mergeRect.c2 };
        }
        toggleMergeSelection();
      } else if (action === 'clear') {
        clearSelectedCells();
      }
    });
  }

  function showCellTooltip() {
    if (!hasSelection) {
      hideCellTooltip();
      return;
    }
    ensureCellTooltip();
    const rect = getSelectionRect();
    const bounds = getSelectedCellsBounds();
    if (!rect || !bounds) {
      hideCellTooltip();
      return;
    }
    const mergeBtn = cellTooltip.querySelector('[data-tip-action="merge"]');
    if (mergeBtn) {
      mergeBtn.hidden = !canEdit;
      mergeBtn.textContent = selectionIsExactMerge(rect) ? 'Unmerge' : 'Merge cell';
    }
    const clearBtn = cellTooltip.querySelector('[data-tip-action="clear"]');
    if (clearBtn) clearBtn.hidden = !canEdit;
    positionFloatingTip(cellTooltip, bounds);
  }

  function toggleMergeSelection() {
    if (!canEdit) return;
    const rect = getSelectionRect();
    if (!rect) return;
    const rowspan = rect.r2 - rect.r1 + 1;
    const colspan = rect.c2 - rect.c1 + 1;
    if (rowspan === 1 && colspan === 1) return;
    recordHistoryNow();
    collectData();
    if (selectionIsExactMerge(rect)) {
      sheetData.merges = getMerges().filter((merge) => {
        const mr = mergeToRect(merge);
        return !(mr && mr.r1 === rect.r1 && mr.r2 === rect.r2 && mr.c1 === rect.c1 && mr.c2 === rect.c2);
      });
    } else {
      sheetData.merges = getMerges().filter((merge) => {
        const mr = mergeToRect(merge);
        if (!mr) return false;
        return mr.r2 < rect.r1 || mr.r1 > rect.r2 || mr.c2 < rect.c1 || mr.c1 > rect.c2;
      });
      const parts = [];
      for (let r = rect.r1; r <= rect.r2; r += 1) {
        for (let c = rect.c1; c <= rect.c2; c += 1) {
          const row = sheetData.rows[r];
          const col = sheetData.columns[c];
          const html = row?.cells?.[col.id] || '';
          if (htmlToPlain(html)) parts.push(html);
          if (!(r === rect.r1 && c === rect.c1) && row) row.cells[col.id] = '';
        }
      }
      const origin = sheetData.rows[rect.r1];
      const originCol = sheetData.columns[rect.c1];
      if (origin && originCol && parts.length) {
        origin.cells[originCol.id] = sanitizeCellHtml(parts.join('<br>'));
      }
      getMerges().push({
        rowId: sheetData.rows[rect.r1].id,
        colId: sheetData.columns[rect.c1].id,
        rowspan,
        colspan,
      });
    }
    normalizeMerges();
    render();
    selAnchor = { row: rect.r1, col: rect.c1 };
    selFocus = { row: rect.r1, col: rect.c1 };
    paintSelection();
    hideCellTooltip();
    const originRow = sheetData.rows[rect.r1];
    const originCol = sheetData.columns[rect.c1];
    const originInput = originRow && originCol
      ? container.querySelector(`.cell-input[data-row-id="${originRow.id}"][data-col-id="${originCol.id}"]`)
      : null;
    focusCellInput(originInput);
    scheduleAutosave(true);
  }

  function clearSelectedCells() {
    if (!canEdit) return;
    const rect = getSelectionRect();
    if (!rect) return;
    recordHistoryNow();
    collectData();
    for (let r = rect.r1; r <= rect.r2; r += 1) {
      for (let c = rect.c1; c <= rect.c2; c += 1) {
        const row = sheetData.rows[r];
        const col = sheetData.columns[c];
        if (!row || !col) continue;
        row.cells[col.id] = '';
        dirtyCells.add(cellKey(row.id, col.id));
        const el = container.querySelector(`.cell-input[data-row-id="${row.id}"][data-col-id="${col.id}"]`);
        if (el) {
          setCellHtml(el, '');
          autoResizeTextarea(el);
        }
      }
    }
    scheduleAutosave(true);
    hideCellTooltip();
  }

  function ensureTextTooltip() {
    if (textTooltip) return;
    textTooltip = document.createElement('div');
    textTooltip.className = 'sheet-text-tooltip';
    textTooltip.hidden = true;
    textTooltip.innerHTML = `
      <button type="button" data-text-action="bold" title="Bold"><b>B</b></button>
      <button type="button" data-text-action="italic" title="Italic"><i>I</i></button>
      <button type="button" data-text-action="color" title="Text color and highlight">A</button>
      <div class="sheet-text-color-panel" hidden>
        <div class="sheet-text-color-label">Text color</div>
        <div class="sheet-text-color-row" data-color-kind="foreColor"></div>
        <div class="sheet-text-color-label">Highlight</div>
        <div class="sheet-text-color-row" data-color-kind="hiliteColor"></div>
      </div>
    `;
    document.body.appendChild(textTooltip);
    textColorPanel = textTooltip.querySelector('.sheet-text-color-panel');
    const foreRow = textTooltip.querySelector('[data-color-kind="foreColor"]');
    const hiRow = textTooltip.querySelector('[data-color-kind="hiliteColor"]');
    TEXT_COLORS.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'sheet-text-swatch';
      swatch.style.background = color;
      swatch.title = color;
      swatch.addEventListener('mousedown', (e) => e.preventDefault());
      swatch.addEventListener('click', () => applyTextFormat('foreColor', color));
      foreRow.appendChild(swatch);
    });
    HIGHLIGHT_COLORS.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'sheet-text-swatch';
      swatch.style.background = color === 'transparent' ? '#fff' : color;
      swatch.title = color === 'transparent' ? 'No highlight' : color;
      if (color === 'transparent') swatch.classList.add('is-clear');
      swatch.addEventListener('mousedown', (e) => e.preventDefault());
      swatch.addEventListener('click', () => applyTextFormat('hiliteColor', color === 'transparent' ? 'transparent' : color));
      hiRow.appendChild(swatch);
    });
    textTooltip.addEventListener('mousedown', (e) => e.preventDefault());
    textTooltip.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-text-action]');
      if (!btn || !canEdit) return;
      const action = btn.dataset.textAction;
      if (action === 'bold') applyTextFormat('bold');
      else if (action === 'italic') applyTextFormat('italic');
      else if (action === 'color') {
        if (textColorPanel) textColorPanel.hidden = !textColorPanel.hidden;
      }
    });
  }

  function applyTextFormat(command, value) {
    restoreTextSelection();
    const el = document.activeElement;
    if (!el?.classList.contains('cell-input') || !el.isContentEditable) return;
    recordHistoryNow();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(command, false, value || null);
    dirtyCells.add(cellKey(el.dataset.rowId, el.dataset.colId));
    scheduleAutosave();
    autoResizeTextarea(el);
    if (textColorPanel && command !== 'hiliteColor' && command !== 'foreColor') {
      textColorPanel.hidden = true;
    }
  }

  function getSelectedTextInCell() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const node = sel.anchorNode;
    const el = (node.nodeType === 1 ? node : node.parentElement)?.closest?.('.cell-input');
    if (!el || !container.contains(el) || document.activeElement !== el) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { el, rect };
  }

  function updateTextTooltip() {
    hideTextTooltip();
  }

  document.addEventListener('selectionchange', () => {
    if (selDragging || hasSelection) return;
    updateTextTooltip();
  });

  document.addEventListener('scroll', () => {
    hideCellTooltip();
    hideTextTooltip();
    hideSheetContextMenu();
  }, true);

  let sheetContextMenu = null;
  let sheetContextTarget = null;
  let savedTextRange = null;

  function saveTextSelection() {
    const sel = window.getSelection();
    savedTextRange = sel && !sel.isCollapsed && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  }

  function restoreTextSelection() {
    if (!savedTextRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedTextRange);
    const node = savedTextRange.commonAncestorContainer;
    const el = (node.nodeType === 1 ? node : node.parentElement)?.closest?.('.cell-input');
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }

  function hideSheetContextMenu() {
    sheetContextMenu?.classList.add('hidden');
    sheetContextTarget = null;
  }

  function ensureSheetContextMenu() {
    if (sheetContextMenu) return;
    sheetContextMenu = document.createElement('div');
    sheetContextMenu.className = 'sheet-context-menu hidden';
    sheetContextMenu.innerHTML = `
    <button type="button" data-action="pin">Pin column</button>
    <button type="button" data-action="insert-left">Add left</button>
    <button type="button" data-action="insert-right">Add right</button>
    <button type="button" data-action="copy">Copy</button>
    <button type="button" data-action="merge">Merge cell</button>
    <button type="button" data-action="clear">Clear</button>
    <button type="button" data-action="bold">Bold</button>
    <button type="button" data-action="italic">Italic</button>
    <div class="sheet-context-colors" data-role="text-colors" hidden>
      <div class="sheet-context-color-label">Text color</div>
      <div class="sheet-context-swatches" data-color-kind="foreColor"></div>
      <div class="sheet-context-color-label">Highlight</div>
      <div class="sheet-context-swatches" data-color-kind="hiliteColor"></div>
    </div>
    <button type="button" data-action="delete" class="danger">Delete</button>
    `;
    document.body.appendChild(sheetContextMenu);
    sheetContextMenu.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-action="bold"], [data-action="italic"], .sheet-context-swatch, [data-role="text-colors"]')) {
        e.preventDefault();
      }
    });
    const foreSwatches = sheetContextMenu.querySelector('[data-color-kind="foreColor"]');
    const hiSwatches = sheetContextMenu.querySelector('[data-color-kind="hiliteColor"]');
    TEXT_COLORS.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'sheet-context-swatch';
      swatch.style.background = color;
      swatch.title = color;
      swatch.addEventListener('mousedown', (ev) => ev.preventDefault());
      swatch.addEventListener('click', () => {
        restoreTextSelection();
        applyTextFormat('foreColor', color);
        hideSheetContextMenu();
      });
      foreSwatches.appendChild(swatch);
    });
    HIGHLIGHT_COLORS.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'sheet-context-swatch';
      swatch.style.background = color === 'transparent' ? '#fff' : color;
      swatch.title = color === 'transparent' ? 'No highlight' : color;
      if (color === 'transparent') swatch.classList.add('is-clear');
      swatch.addEventListener('mousedown', (ev) => ev.preventDefault());
      swatch.addEventListener('click', () => {
        restoreTextSelection();
        applyTextFormat('hiliteColor', color);
        hideSheetContextMenu();
      });
      hiSwatches.appendChild(swatch);
    });

    sheetContextMenu.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || !sheetContextTarget) return;
      const { kind, id } = sheetContextTarget;
      const action = btn.dataset.action;
      hideSheetContextMenu();

      if (kind === 'column') {
        if (action === 'copy') copyColumn(id);
        else if (action === 'delete') await deleteColumn(id);
        else if (action === 'insert-left') insertColumnRelative(id, 'left');
        else if (action === 'insert-right') insertColumnRelative(id, 'right');
        else if (action === 'pin') {
          const idx = sheetData.columns.findIndex((c) => c.id === id);
          const freeze = getPinnedCount();
          if (idx >= 0 && idx < freeze) unpinFromColumn(id);
          else pinThroughColumn(id);
        }
      } else if (kind === 'row') {
        if (action === 'copy') copyRow(id);
        else if (action === 'delete') await deleteRow(id);
        else if (action === 'insert-left') insertRowRelative(id, 'above');
        else if (action === 'insert-right') insertRowRelative(id, 'below');
      } else if (kind === 'cells') {
        if (action === 'copy') copySelection();
        else if (action === 'merge') toggleMergeSelection();
        else if (action === 'clear') clearSelectedCells();
      } else if (kind === 'text') {
        restoreTextSelection();
        if (action === 'bold') applyTextFormat('bold');
        else if (action === 'italic') applyTextFormat('italic');
      }
    });
  }

  function updateSheetContextMenuLabels(kind, id) {
    if (!sheetContextMenu) return;
    const copyBtn = sheetContextMenu.querySelector('[data-action="copy"]');
    const leftBtn = sheetContextMenu.querySelector('[data-action="insert-left"]');
    const rightBtn = sheetContextMenu.querySelector('[data-action="insert-right"]');
    const pinBtn = sheetContextMenu.querySelector('[data-action="pin"]');
    const mergeBtn = sheetContextMenu.querySelector('[data-action="merge"]');
    const clearBtn = sheetContextMenu.querySelector('[data-action="clear"]');
    const boldBtn = sheetContextMenu.querySelector('[data-action="bold"]');
    const italicBtn = sheetContextMenu.querySelector('[data-action="italic"]');
    const colorBox = sheetContextMenu.querySelector('[data-role="text-colors"]');
    const deleteBtn = sheetContextMenu.querySelector('[data-action="delete"]');
    if (kind === 'column') {
      copyBtn.textContent = 'Copy column';
      leftBtn.textContent = 'Add column left';
      rightBtn.textContent = 'Add column right';
      deleteBtn.textContent = 'Delete column';
      if (pinBtn) {
        pinBtn.hidden = !canEdit;
        const idx = sheetData.columns.findIndex((c) => c.id === id);
        const freeze = getPinnedCount();
        const isPinned = idx >= 0 && idx < freeze;
        pinBtn.textContent = isPinned ? 'Unpin column' : 'Pin column';
      }
      copyBtn.hidden = false;
      leftBtn.hidden = !canEdit;
      rightBtn.hidden = !canEdit;
      deleteBtn.hidden = !canEdit;
      if (mergeBtn) mergeBtn.hidden = true;
      if (clearBtn) clearBtn.hidden = true;
      if (boldBtn) boldBtn.hidden = true;
      if (italicBtn) italicBtn.hidden = true;
      if (colorBox) colorBox.hidden = true;
    } else if (kind === 'row') {
      copyBtn.hidden = false;
      copyBtn.textContent = 'Copy row';
      leftBtn.textContent = 'Add row above';
      rightBtn.textContent = 'Add row below';
      deleteBtn.textContent = 'Delete row';
      if (pinBtn) pinBtn.hidden = true;
      leftBtn.hidden = !canEdit;
      rightBtn.hidden = !canEdit;
      deleteBtn.hidden = !canEdit;
      if (mergeBtn) mergeBtn.hidden = true;
      if (clearBtn) clearBtn.hidden = true;
      if (boldBtn) boldBtn.hidden = true;
      if (italicBtn) italicBtn.hidden = true;
      if (colorBox) colorBox.hidden = true;
    } else if (kind === 'text') {
      copyBtn.hidden = true;
      if (pinBtn) pinBtn.hidden = true;
      leftBtn.hidden = true;
      rightBtn.hidden = true;
      deleteBtn.hidden = true;
      if (mergeBtn) mergeBtn.hidden = true;
      if (clearBtn) clearBtn.hidden = true;
      if (boldBtn) boldBtn.hidden = false;
      if (italicBtn) italicBtn.hidden = false;
      if (colorBox) colorBox.hidden = false;
    } else {
      copyBtn.hidden = false;
      copyBtn.textContent = 'Copy';
      if (pinBtn) pinBtn.hidden = true;
      leftBtn.hidden = true;
      rightBtn.hidden = true;
      deleteBtn.hidden = true;
      const rect = getSelectionRect();
      const multi = rect && (rect.r1 !== rect.r2 || rect.c1 !== rect.c2);
      if (mergeBtn) {
        mergeBtn.hidden = !canEdit || !multi;
        mergeBtn.textContent = rect && selectionIsExactMerge(rect) ? 'Unmerge' : 'Merge cell';
      }
      if (clearBtn) {
        clearBtn.hidden = !canEdit;
        clearBtn.textContent = 'Clear';
      }
      if (boldBtn) boldBtn.hidden = true;
      if (italicBtn) italicBtn.hidden = true;
      if (colorBox) colorBox.hidden = true;
    }
  }

  function showSheetContextMenu(x, y, kind, id) {
    ensureSheetContextMenu();
    sheetContextTarget = { kind, id };
    updateSheetContextMenuLabels(kind, id);
    sheetContextMenu.classList.remove('hidden');

    const menuRect = sheetContextMenu.getBoundingClientRect();
    const maxX = window.innerWidth - menuRect.width - 8;
    const maxY = window.innerHeight - menuRect.height - 8;
    sheetContextMenu.style.left = `${Math.min(x, maxX)}px`;
    sheetContextMenu.style.top = `${Math.min(y, maxY)}px`;
  }

  function onSheetContextMenuDismiss(e) {
    if (!e.target.closest('.sheet-context-menu')) hideSheetContextMenu();
  }

  function selectCellForContextMenu(td) {
    const r = parseInt(td.dataset.rowIdx, 10);
    const c = parseInt(td.dataset.colIdx, 10);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;
    const rect = getSelectionRect();
    const inside = rect && r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
    if (inside && (hasSelection || selectionIsExactMerge(rect))) return;
    const mergeRect = getMergeRectFromCell(td);
    if (mergeRect) {
      selAnchor = { row: mergeRect.r1, col: mergeRect.c1 };
      selFocus = { row: mergeRect.r2, col: mergeRect.c2 };
    } else {
      selAnchor = { row: r, col: c };
      selFocus = { row: r, col: c };
    }
    selDragMode = 'cells';
    paintSelection();
  }

  container.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.spreadsheet-col-head') || e.target.closest('.spreadsheet-row-label') || e.target.closest('.spreadsheet-corner')) {
      return;
    }
    const td = e.target.closest('.spreadsheet-cell');
    if (!td) return;
    e.preventDefault();
    hideCellTooltip();
    hideTextTooltip();
    const textInfo = getSelectedTextInCell();
    if (textInfo) {
      saveTextSelection();
      showSheetContextMenu(e.clientX, e.clientY, 'text');
      return;
    }
    selectCellForContextMenu(td);
    showSheetContextMenu(e.clientX, e.clientY, 'cells');
  });

  document.addEventListener('click', onSheetContextMenuDismiss);
  document.addEventListener('scroll', hideSheetContextMenu, true);

  const btnSearch = document.getElementById('btnTableSearch');
  const findBar = document.getElementById('tableFindBar');
  const findInput = document.getElementById('tableFindInput');
  const findCount = document.getElementById('tableFindCount');
  const btnFindPrev = document.getElementById('btnTableFindPrev');
  const btnFindNext = document.getElementById('btnTableFindNext');
  const btnFindClose = document.getElementById('btnTableFindClose');

  let findMatches = [];
  let findIndex = -1;

  function clearFindHighlight() {
    container.querySelectorAll('.table-find-active, .table-find-match').forEach((el) => {
      el.classList.remove('table-find-active', 'table-find-match');
    });
  }

  function prepareTableCopy() {
    clearFindHighlight();
    window.getSelection()?.removeAllRanges();
    const active = document.activeElement;
    if (active?.closest?.('#spreadsheetContainer')) active.blur();
  }

  function getSearchableText(el) {
    if (el.matches?.('.col-header-label')) return el.textContent || '';
    if (el.isContentEditable) return el.innerText || el.textContent || '';
    return el.value || '';
  }

  function collectSearchTargets() {
    const targets = [];
    container.querySelectorAll('.spreadsheet-col-head').forEach((th) => {
      const el = th.querySelector('.col-head-inner.col-head-editing .col-header-input')
        || th.querySelector('.col-header-label');
      if (el) targets.push({ type: 'header', element: el });
    });
    container.querySelectorAll('.cell-input').forEach((el) => {
      targets.push({ type: 'cell', element: el });
    });
    return targets;
  }

  function markFindMatches() {
    findMatches.forEach((match) => {
      const parent = match.type === 'header'
        ? match.element.closest('.spreadsheet-col-head')
        : match.element.closest('.spreadsheet-cell');
      parent?.classList.add('table-find-match');
    });
  }

  function runFind(autoReveal = true) {
    if (!findInput) return;
    const query = findInput.value;
    findMatches = [];
    findIndex = -1;
    clearFindHighlight();

    if (!query) {
      if (findCount) findCount.textContent = '';
      return;
    }

    const lowerQuery = query.toLowerCase();
    collectSearchTargets().forEach(({ type, element }) => {
      const lowerText = getSearchableText(element).toLowerCase();
      let pos = 0;
      while (pos < lowerText.length) {
        const idx = lowerText.indexOf(lowerQuery, pos);
        if (idx === -1) break;
        findMatches.push({
          type,
          element,
          start: idx,
          end: idx + query.length,
        });
        pos = idx + lowerQuery.length;
      }
    });

    markFindMatches();

    if (findCount) {
      if (!findMatches.length) {
        findCount.textContent = 'No matches';
      } else {
        findCount.textContent = `${findMatches.length} match${findMatches.length === 1 ? '' : 'es'}`;
      }
    }

    if (autoReveal && findMatches.length) {
      goToFindMatch(0);
    }
  }

  function scrollElementIntoView(el) {
    if (!el) return;
    const scrollEl = container.closest('.spreadsheet-scroll');
    if (!scrollEl) {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      return;
    }
    const scrollRect = scrollEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const topPad = 56;
    const bottomPad = 48;
    const sidePad = 24;
    if (elRect.top < scrollRect.top + topPad) {
      scrollEl.scrollTop += elRect.top - scrollRect.top - topPad;
    } else if (elRect.bottom > scrollRect.bottom - bottomPad) {
      scrollEl.scrollTop += elRect.bottom - scrollRect.bottom + bottomPad;
    }
    if (elRect.left < scrollRect.left + sidePad) {
      scrollEl.scrollLeft += elRect.left - scrollRect.left - sidePad;
    } else if (elRect.right > scrollRect.right - sidePad) {
      scrollEl.scrollLeft += elRect.right - scrollRect.right + sidePad;
    }
  }

  function goToFindMatch(index, updateCount = true) {
    if (!findInput || !findMatches.length) return;
    findIndex = ((index % findMatches.length) + findMatches.length) % findMatches.length;
    const match = findMatches[findIndex];

    container.querySelectorAll('.table-find-active').forEach((el) => {
      el.classList.remove('table-find-active');
    });
    markFindMatches();

    const parent = match.type === 'header'
      ? match.element.closest('.spreadsheet-col-head')
      : match.element.closest('.spreadsheet-cell');
    parent?.classList.add('table-find-active');

    requestAnimationFrame(() => {
      scrollElementIntoView(parent || match.element);
      if (match.type === 'header' && match.element.matches('.col-header-label')) {
        match.element.tabIndex = -1;
        match.element.focus({ preventScroll: true });
      } else if (typeof match.element.setSelectionRange === 'function') {
        match.element.focus({ preventScroll: true });
        match.element.setSelectionRange(match.start, match.end);
      }
      findInput?.focus({ preventScroll: true });
    });

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
    if (!findInput?.value.trim()) return;
    if (!findMatches.length) runFind();
    if (!findMatches.length) return;
    goToFindMatch(findIndex === -1 ? findMatches.length - 1 : findIndex - 1);
  }

  function openFindBar() {
    findBar?.classList.remove('hidden');
    findInput?.focus();
    findInput?.select();
    if (findInput?.value) runFind();
  }

  function closeFindBar() {
    findBar?.classList.add('hidden');
    findMatches = [];
    findIndex = -1;
    if (findInput) findInput.value = '';
    if (findCount) findCount.textContent = '';
    clearFindHighlight();
  }

  function refreshFindAfterRender() {
    if (!findBar || findBar.classList.contains('hidden') || !findInput?.value) return;
    const savedIndex = findIndex;
    runFind(false);
    if (findMatches.length) {
      goToFindMatch(Math.min(savedIndex >= 0 ? savedIndex : 0, findMatches.length - 1));
    }
  }

  function onDocKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      openFindBar();
      return;
    }
    // Ctrl+C / Cmd+C — copy selected cells if a multi-cell selection exists
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && hasSelection) {
      e.preventDefault();
      copySelection();
      return;
    }
    // Escape clears selection
    if (e.key === 'Escape' && hasSelection) {
      clearSelection();
      return;
    }
    if (hasSelection && canEdit && (e.key === 'Delete' || e.key === 'Backspace')) {
      if (document.activeElement?.classList.contains('cell-input')) return;
      e.preventDefault();
      clearSelectedCells();
      return;
    }
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      doUndo();
    }
    if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
      e.preventDefault();
      doRedo();
    }
  }
  document.addEventListener('keydown', onDocKeydown, true);

  document.addEventListener('copy', (e) => {
    if (!hasSelection) return;
    const target = e.target;
    if (target && target !== document && target !== document.body && !container.contains(target)) return;
    const payload = buildSelectionCopyPayload();
    if (!payload) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', payload.plain);
    e.clipboardData?.setData('text/html', wrapHtmlDoc(payload.tableHtml));
    prepareTableCopy();
    showCopiedFeedback();
  }, true);

  if (titleInput) {
    titleInput.addEventListener('beforeinput', () => {
      scheduleHistoryCapture();
    });
    titleInput.addEventListener('input', () => {
      scheduleAutosave();
    });
  }

  btnSearch?.addEventListener('click', openFindBar);
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
  btnFindClose?.addEventListener('click', closeFindBar);

  btnSave?.addEventListener('click', () => {
    clearTimeout(saveTimer);
    runAutosave();
  });

  document.getElementById('btnRefreshTable')?.addEventListener('click', refreshFromServer);

  function closeColorPopover() {
    const popover = document.getElementById('colorPickerPopover');
    const pickerBtn = document.getElementById('btnColorPicker');
    if (popover) popover.hidden = true;
    if (pickerBtn) pickerBtn.setAttribute('aria-expanded', 'false');
  }

  function initColorPicker() {
    if (!canEdit) return;
    const pickerBtn = document.getElementById('btnColorPicker');
    const popover = document.getElementById('colorPickerPopover');

    if (pickerBtn && popover) {
      pickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = popover.hidden;
        popover.hidden = !open;
        pickerBtn.setAttribute('aria-expanded', String(open));
      });
      popover.addEventListener('click', (e) => e.stopPropagation());
    }

    document.querySelectorAll('#colorOptions input[name="color"]').forEach((input) => {
      const pick = () => {
        recordHistoryNow();
        applyTableColor(input.value);
        scheduleAutosave(true);
        closeColorPopover();
      };
      input.addEventListener('change', pick);
      input.addEventListener('click', pick);
    });
  }

  function onDocumentColorClick(e) {
    if (e.target.closest('.color-picker-wrap')) return;
    closeColorPopover();
  }

  initColorPicker();
  document.addEventListener('click', onDocumentColorClick);

  if (cfg.initialColor) applyTableColor(cfg.initialColor);

  function normalizeCellText(text) {
    return String(text || '')
      .replace(/\t/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
  }

  function cellForClipboard(text) {
    return normalizeCellText(text).replace(/\n/g, ' ');
  }

  function looksLikeMarkdownTableLine(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.indexOf('|', 1) !== -1;
  }

  function isMarkdownSeparatorLine(line) {
    const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    if (!trimmed.includes('|')) return /^[\s\-:|]+$/.test(trimmed);
    return trimmed.split('|').every((part) => /^[\s\-:|]+$/.test(part));
  }

  function parseMarkdownTableFromText(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const rows = [];
    lines.forEach((line) => {
      if (!looksLikeMarkdownTableLine(line)) return;
      if (isMarkdownSeparatorLine(line)) return;
      let trimmed = line.trim();
      if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
      if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
      rows.push(trimmed.split('|').map((cell) => cell.trim()));
    });
    return rows.length ? rows : null;
  }

  function parseTsvFromText(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (!lines.some((line) => line.includes('\t'))) return null;
    const rows = lines.map((line) => line.split('\t'));
    while (rows.length > 1 && rows[rows.length - 1].every((cell) => cell === '')) {
      rows.pop();
    }
    return rows.length ? rows : null;
  }

  function parseHtmlTableFromClipboard(html) {
    if (!html) return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;
    const rows = [];
    table.querySelectorAll('tr').forEach((tr) => {
      const cells = [];
      tr.querySelectorAll('th, td').forEach((cell) => {
        cells.push((cell.textContent || '').replace(/\u00a0/g, ' '));
      });
      if (cells.length) rows.push(cells);
    });
    return rows.length ? rows : null;
  }

  function isMultiCellGrid(grid) {
    return grid.length > 1 || (grid.length === 1 && grid[0].length > 1);
  }

  function parsePasteGrid(clipboardData) {
    if (!clipboardData) return null;

    const html = clipboardData.getData('text/html');
    const plain = clipboardData.getData('text/plain');

    const fromHtml = parseHtmlTableFromClipboard(html);
    if (fromHtml && isMultiCellGrid(fromHtml)) return fromHtml;

    const fromMarkdown = parseMarkdownTableFromText(plain);
    if (fromMarkdown && isMultiCellGrid(fromMarkdown)) return fromMarkdown;

    const fromTsv = parseTsvFromText(plain);
    if (fromTsv && isMultiCellGrid(fromTsv)) return fromTsv;

    return null;
  }

  function ensureCapacityForPaste(startRowIdx, startColIdx, gridRows, gridCols) {
    recordHistoryNow();
    collectData();

    const rowsNeeded = startRowIdx + gridRows - sheetData.rows.length;
    for (let i = 0; i < rowsNeeded; i += 1) {
      const cells = {};
      sheetData.columns.forEach((col) => { cells[col.id] = ''; });
      sheetData.rows.push({ id: uid(), cells });
    }

    const colsNeeded = startColIdx + gridCols - sheetData.columns.length;
    for (let i = 0; i < colsNeeded; i += 1) {
      const n = sheetData.columns.length + 1;
      const col = { id: uid(), width: DEFAULT_COL_WIDTH, label: `Column ${n}` };
      sheetData.columns.push(col);
      sheetData.rows.forEach((row) => { row.cells[col.id] = ''; });
    }
  }

  function applyPasteGrid(startRowIdx, startColIdx, grid) {
    grid.forEach((row, rowOffset) => {
      const sheetRow = sheetData.rows[startRowIdx + rowOffset];
      if (!sheetRow) return;
      row.forEach((value, colOffset) => {
        const col = sheetData.columns[startColIdx + colOffset];
        if (!col) return;
        sheetRow.cells[col.id] = String(value ?? '');
        dirtyCells.add(cellKey(sheetRow.id, col.id));
      });
    });
  }

  function onCellPaste(e) {
    const ta = e.target.closest('.cell-input');
    if (!ta || !e.clipboardData) return;

    const grid = parsePasteGrid(e.clipboardData);
    if (!grid) return;

    e.preventDefault();

    const startRowIdx = sheetData.rows.findIndex((row) => row.id === ta.dataset.rowId);
    const startColIdx = sheetData.columns.findIndex((col) => col.id === ta.dataset.colId);
    if (startRowIdx < 0 || startColIdx < 0) return;

    const gridCols = Math.max(...grid.map((row) => row.length), 1);
    ensureCapacityForPaste(startRowIdx, startColIdx, grid.length, gridCols);
    applyPasteGrid(startRowIdx, startColIdx, grid);
    render();
    scheduleAutosave();
  }

  function cellValueForExport(text) {
    return htmlToPlain(text);
  }

  function cellForTsvExport(text) {
    const value = cellValueForExport(text);
    if (/[\t\r\n"]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  function cellForHtmlExport(text) {
    const html = sanitizeCellHtml(text);
    if (!html) return '';
    if (/<[a-z][\s\S]*>/i.test(html)) return html;
    return escapeHtml(htmlToPlain(html)).replace(/\n/g, '<br>');
  }

  function wrapHtmlDoc(fragment) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><!--StartFragment-->${fragment}<!--EndFragment--></body></html>`;
  }

  const TABLE_CELL_STYLE = 'border:1px solid #ccc;background:transparent;background-color:transparent;';
  const TABLE_HEAD_STYLE = `${TABLE_CELL_STYLE}font-weight:600;`;

  function buildCleanTableHtml(headers, rows, options = {}) {
    const includeHeader = options.includeHeader !== false && headers.length > 0;
    const bodyRows = rows
      .map((row) => {
        const tds = row
          .map((cell) => `<td style="${TABLE_CELL_STYLE}">${cellForHtmlExport(cell)}</td>`)
          .join('');
        return `<tr>${tds}</tr>`;
      })
      .join('');
    const thead = includeHeader
      ? `<thead><tr>${headers
          .map((h) => `<th style="${TABLE_HEAD_STYLE}">${cellForHtmlExport(h)}</th>`)
          .join('')}</tr></thead>`
      : '';
    return `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;background:transparent;">`
      + `${thead}<tbody>${bodyRows}</tbody></table>`;
  }

  async function copyPlainTextToClipboard(plain) {
    try {
      await navigator.clipboard.writeText(plain);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = plain;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }
  }

  async function copyRichContentToClipboard(plain, tableHtml) {
    const htmlDoc = wrapHtmlDoc(tableHtml);
    if (navigator.clipboard?.write && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plain], { type: 'text/plain' }),
            'text/html': new Blob([htmlDoc], { type: 'text/html' }),
          }),
        ]);
        return true;
      } catch {
        /* try fallbacks */
      }
    }

    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.innerHTML = tableHtml;
    div.style.position = 'fixed';
    div.style.left = '-9999px';
    document.body.appendChild(div);
    const range = document.createRange();
    range.selectNodeContents(div);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    document.body.removeChild(div);
    if (ok) return true;
    return copyPlainTextToClipboard(plain);
  }

  function buildColumnCopyPayload(colId) {
    collectData();
    const colIndex = sheetData.columns.findIndex((c) => c.id === colId);
    const col = sheetData.columns[colIndex];
    if (!col) return null;

    const header = cellValueForExport(col.label || defaultColumnLabel(colIndex));
    const values = sheetData.rows.map((row) => cellValueForExport(row.cells[col.id]));
    const plain = [header, ...values].join('\n');
    const tableHtml = buildCleanTableHtml(
      [header],
      values.map((value) => [value]),
    );
    return { plain, tableHtml };
  }

  function buildRowCopyPayload(rowId) {
    collectData();
    const row = sheetData.rows.find((r) => r.id === rowId);
    if (!row) return null;

    const values = sheetData.columns.map((col, i) =>
      cellValueForExport(row.cells[col.id] ?? ''),
    );
    const plain = values.map(cellForTsvExport).join('\t');
    const tableHtml = buildCleanTableHtml([], [values], { includeHeader: false });
    return { plain, tableHtml };
  }

  async function copySheetFragment(payload) {
    if (!payload) return;
    prepareTableCopy();
    const ok = await copyRichContentToClipboard(payload.plain, payload.tableHtml);
    if (ok) showCopiedFeedback();
  }

  function copyColumn(colId) {
    copySheetFragment(buildColumnCopyPayload(colId));
  }

  function copyRow(rowId) {
    copySheetFragment(buildRowCopyPayload(rowId));
  }

  function cellLineWidth(text) {
    const normalized = normalizeCellText(text);
    if (!normalized) return 0;
    return Math.max(...normalized.split('\n').map((line) => line.length));
  }

  function cellForMarkdownExport(text) {
    return normalizeCellText(text).replace(/\n/g, '<br>');
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildTableExportData() {
    prepareTableCopy();
    collectData();
    const title = titleInput?.value?.trim() || 'Untitled table';
    const headers = sheetData.columns.map((col, i) =>
      cellValueForExport(col.label || `Column ${i + 1}`),
    );
    const rows = sheetData.rows.map((row) =>
      sheetData.columns.map((col) => cellValueForExport(row.cells[col.id])),
    );

    const tsvHeader = headers.map(cellForTsvExport).join('\t');
    const tsvRows = rows.map((row) => row.map(cellForTsvExport).join('\t'));
    const plain = [title, '', tsvHeader, ...tsvRows].join('\n');
    const tableHtml = buildCleanTableHtml(headers, rows);

    return { plain, tableHtml };
  }

  function showCopiedFeedback() {
    if (!statusTextEl) return;
    const prev = statusTextEl.textContent;
    const prevState = statusEl.dataset.state;
    statusTextEl.textContent = 'Copied!';
    statusEl.dataset.state = 'saved';
    setTimeout(() => {
      statusTextEl.textContent = prev;
      statusEl.dataset.state = prevState;
    }, 1500);
  }

  async function copyToClipboard() {
    prepareTableCopy();
    const { plain, tableHtml } = buildTableExportData();
    const ok = await copyRichContentToClipboard(plain, tableHtml);
    if (ok) showCopiedFeedback();
  }

  document.getElementById('btnCopyTable')?.addEventListener('click', copyToClipboard);

  // ── Excel Export ────────────────────────────────────────────────
  function exportToExcel() {
    if (typeof XLSX === 'undefined') {
      AppModal?.alert({ title: 'Error', message: 'Excel library not loaded. Please refresh and try again.' });
      return;
    }
    collectData();
    const title = (titleInput?.value?.trim() || 'Untitled table').replace(/[\\/*?[\]:]/g, '_').slice(0, 31);

    const headers = sheetData.columns.map((col, i) =>
      col.label || `Column ${i + 1}`,
    );
    const rows = sheetData.rows.map((row) =>
      sheetData.columns.map((col) => row.cells[col.id] ?? ''),
    );

    const aoaData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoaData);

    // Apply column widths (wch = width in characters)
    ws['!cols'] = sheetData.columns.map((col) => ({
      wch: Math.max(10, Math.round(col.width / 8)),
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title);
    XLSX.writeFile(wb, `${title}.xlsx`);

    showCopiedFeedback();
    if (statusTextEl) statusTextEl.textContent = 'Exported!';
  }

  document.getElementById('btnExportExcel')?.addEventListener('click', exportToExcel);

  // ── Excel Import ────────────────────────────────────────────────
  const excelFileInput = document.getElementById('excelFileInput');

  document.getElementById('btnImportExcel')?.addEventListener('click', () => {
    if (!excelFileInput) return;
    excelFileInput.value = '';
    excelFileInput.click();
  });

  async function processImportedFile(file) {
    if (typeof XLSX === 'undefined') {
      AppModal?.alert({ title: 'Error', message: 'Excel library not loaded. Please refresh and try again.' });
      return;
    }

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        AppModal?.alert({ title: 'Import error', message: 'No sheets found in the file.' });
        return;
      }
      const ws = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      if (!aoa.length) {
        AppModal?.alert({ title: 'Import error', message: 'The file appears to be empty.' });
        return;
      }

      // Ask user whether to replace or append
      const hasExistingData = sheetData.rows.some((row) =>
        sheetData.columns.some((col) => (row.cells[col.id] || '').trim() !== ''),
      );

      let mode = 'replace';
      if (hasExistingData && window.AppModal) {
        const action = await new Promise((resolve) => {
          const backdrop = document.createElement('div');
          backdrop.className = 'modal-backdrop';
          const modal = document.createElement('div');
          modal.className = 'modal-container';
          modal.innerHTML = `
            <div class="modal-content" style="max-width: 420px;">
              <h2 class="modal-title">Import Excel</h2>
              <p class="modal-message">
                <strong>${file.name}</strong> contains ${aoa.length} rows.
                <br>How would you like to import?
              </p>
              <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
                <button type="button" class="btn btn-default" data-action="cancel">Cancel</button>
                <button type="button" class="btn btn-default" data-action="append">Append rows</button>
                <button type="button" class="btn btn-primary" data-action="replace">Replace all</button>
              </div>
            </div>
          `;
          backdrop.appendChild(modal);
          document.body.appendChild(backdrop);

          backdrop.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn && e.target !== backdrop) return;
            const act = btn ? btn.dataset.action : 'cancel';
            backdrop.remove();
            resolve(act);
          });
        });

        if (action === 'cancel') return;
        mode = action;
      }

      recordHistoryNow();
      collectData();

      if (mode === 'replace') {
        // First row as headers, rest as data
        const headerRow = aoa[0] || [];
        const dataRows = aoa.slice(1);

        sheetData.columns = headerRow.map((label, i) => ({
          id: uid(),
          width: DEFAULT_COL_WIDTH,
          label: String(label || `Column ${i + 1}`),
        }));

        sheetData.rows = dataRows.length
          ? dataRows.map((row) => {
              const cells = {};
              sheetData.columns.forEach((col, colIdx) => {
                cells[col.id] = String(row[colIdx] ?? '');
              });
              return { id: uid(), cells };
            })
          : [(() => {
              const cells = {};
              sheetData.columns.forEach((col) => { cells[col.id] = ''; });
              return { id: uid(), cells };
            })()];
      } else {
        // Append mode: add rows, grow columns if needed
        const maxCols = Math.max(...aoa.map((r) => r.length), 0);
        const colsNeeded = maxCols - sheetData.columns.length;
        for (let i = 0; i < colsNeeded; i++) {
          const n = sheetData.columns.length + 1;
          const col = { id: uid(), width: DEFAULT_COL_WIDTH, label: `Column ${n}` };
          sheetData.columns.push(col);
          sheetData.rows.forEach((row) => { row.cells[col.id] = ''; });
        }

        aoa.forEach((row) => {
          const cells = {};
          sheetData.columns.forEach((col, colIdx) => {
            cells[col.id] = String(row[colIdx] ?? '');
          });
          sheetData.rows.push({ id: uid(), cells });
        });
      }

      ensureStructure();
      render();
      scheduleAutosave(true);

      if (statusTextEl) {
        const prev = statusTextEl.textContent;
        const prevState = statusEl?.dataset.state;
        statusTextEl.textContent = 'Imported!';
        if (statusEl) statusEl.dataset.state = 'saved';
        setTimeout(() => {
          statusTextEl.textContent = prev;
          if (statusEl) statusEl.dataset.state = prevState;
        }, 2000);
      }
    } catch (err) {
      console.error('Excel import error:', err);
      AppModal?.alert({ title: 'Import error', message: 'Could not read the file. Make sure it is a valid Excel or CSV file.' });
    }
  }

  excelFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) processImportedFile(file);
  });


  document.getElementById('btnDuplicateTable')?.addEventListener('click', async () => {
    if (!cfg.duplicateUrl) return;
    clearTimeout(saveTimer);
    await runAutosave();
    if (window.routerNavigate) window.routerNavigate(cfg.duplicateUrl);
    else window.location.href = cfg.duplicateUrl;
  });

  document.getElementById('btnDeleteTable')?.addEventListener('click', async () => {
    if (!window.AppModal) return;
    const ok = await AppModal.confirm({
      title: 'Delete table',
      message: 'Are you sure you want to delete this table? This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true,
    });
    if (ok) document.getElementById('deleteTableForm')?.submit();
  });

  ensureStructure();
  sheetData.columns.forEach((col, i) => {
    if (!col.label) col.label = `Column ${i + 1}`;
  });

  render();
  requestAnimationFrame(updateTableLayout);

  if (!canEdit && titleInput) titleInput.readOnly = true;

  history.reset(getFullState());
  setStatus('saved');

  function flushSave() {
    clearTimeout(saveTimer);
    if (!cfg.autosaveUrl) return;
    fetch(cfg.autosaveUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': cfg.csrfToken,
      },
      body: JSON.stringify(getSavePayload()),
      keepalive: true,
    }).catch(() => {});
  }

  const destroySheetTabs = window.initEditorSheetTabs?.({
    onBeforeNavigate: async () => {
      clearTimeout(saveTimer);
      await runAutosave();
    },
  });

  // Register cleanup for the router so listeners/timers are removed on navigate
  if (window.__routerCleanup) {
    window.__routerCleanup.push(() => {
      flushSave();
      destroySheetTabs?.();
      document.removeEventListener('keydown', onDocKeydown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onDocumentMouseUp);
      clearDragPendingCursors();
      document.removeEventListener('click', onSheetContextMenuDismiss);
      document.removeEventListener('click', onDocumentColorClick);
      document.removeEventListener('scroll', hideSheetContextMenu, true);
      container.removeEventListener('paste', onCellPaste);
      hideSheetContextMenu();
      hideCellTooltip();
      hideTextTooltip();
      cellTooltip?.remove();
      textTooltip?.remove();
      clearTimeout(saveTimer);
      clearTimeout(historyTimer);
      clearColDragState();
      clearRowDragState();
      clearSelection();
    });
  }
  
  const btnMoreOptions = document.getElementById('btnMoreOptions');
  const moreOptionsMenu = document.getElementById('moreOptionsMenu');
  if (btnMoreOptions && moreOptionsMenu) {
    btnMoreOptions.addEventListener('click', (e) => {
      e.stopPropagation();
      moreOptionsMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!moreOptionsMenu.contains(e.target) && e.target !== btnMoreOptions && !btnMoreOptions.contains(e.target)) {
        moreOptionsMenu.classList.add('hidden');
      }
    });
  }
})();
