(function () {
  const cfg = window.TABLE_EDITOR_CONFIG;
  const container = document.getElementById('spreadsheetContainer');
  const titleInput = document.getElementById('tableTitle');
  const statusEl = document.getElementById('tableAutosaveStatus');
  const statusTextEl = statusEl?.querySelector('.autosave-badge-text');
  const btnSave = document.getElementById('btnManualSave');
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  const btnAddColumn = document.getElementById('btnAddColumn');
  const btnAddRow = document.getElementById('btnAddRow');
  if (!cfg || !container) return;

  const ROW_HEADER_WIDTH = 48;
  const AUTOSAVE_DELAY = 800;
  const HISTORY_DELAY = 900;

  const MIN_COL_WIDTH = 80;
  const DEFAULT_COL_WIDTH = 160;

  let sheetData = JSON.parse(JSON.stringify(cfg.initialData || { columns: [], rows: [] }));
  let saveTimer;
  let historyTimer;
  let historyCapture = null;
  let saving = false;
  let pending = false;
  let resizing = null;
  let colgroupEl = null;
  let isRestoring = false;
  let dragColId = null;
  let dragRowId = null;

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

  function restoreState(state) {
    isRestoring = true;
    if (titleInput) titleInput.value = state.title;
    sheetData = JSON.parse(JSON.stringify(state.data));
    render();
    isRestoring = false;
    scheduleAutosave(true);
  }

  function recordHistoryNow() {
    if (isRestoring) return;
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
  }

  function updateTableLayout() {
    applyColumnWidths();
  }

  function collectData() {
    container.querySelectorAll('.cell-input').forEach((ta) => {
      const row = sheetData.rows.find((r) => r.id === ta.dataset.rowId);
      if (row) row.cells[ta.dataset.colId] = ta.value;
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
    try {
      const res = await fetch(cfg.autosaveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': cfg.csrfToken },
        body: JSON.stringify(getFullState()),
      });
      if (!res.ok) throw new Error();
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
    setStatus('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(runAutosave, immediate ? 0 : AUTOSAVE_DELAY);
  }

  function autoResizeTextarea(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(44, ta.scrollHeight)}px`;
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

  function insertColumnAt(index) {
    recordHistoryNow();
    collectData();
    const n = sheetData.columns.length + 1;
    const col = { id: uid(), width: DEFAULT_COL_WIDTH, label: `Column ${n}` };
    const at = Math.max(0, Math.min(index, sheetData.columns.length));
    sheetData.columns.splice(at, 0, col);
    sheetData.rows.forEach((row) => { row.cells[col.id] = ''; });
    render();
    scheduleAutosave(true);
    return col;
  }

  function addColumn() {
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
    headInner.title = 'Drag to reorder column';

    headInner.addEventListener('dragstart', (e) => {
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
    rowLabel.title = 'Drag to reorder row';

    rowLabel.addEventListener('dragstart', (e) => {
      dragRowId = row.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.id);
      tr.classList.add('row-drag-source');
      document.body.classList.add('row-dragging');
    });

    rowLabel.addEventListener('dragend', () => {
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
  }

  function stopResize() {
    if (!resizing) return;
    resizing = null;
    document.body.classList.remove('col-resizing');
    scheduleAutosave(true);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', stopResize);

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

      sheetData.columns.forEach((col) => {
        const td = document.createElement('td');
        td.className = 'spreadsheet-cell';
        td.dataset.colId = col.id;

        const ta = document.createElement('textarea');
        ta.className = 'cell-input';
        ta.dataset.rowId = row.id;
        ta.dataset.colId = col.id;
        ta.value = row.cells[col.id] || '';
        ta.rows = 1;
        ta.addEventListener('input', () => {
          autoResizeTextarea(ta);
          scheduleHistoryCapture();
          scheduleAutosave();
          if (findBar && !findBar.classList.contains('hidden') && findInput?.value) runFind();
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
    refreshFindAfterRender();
  }

  function doUndo() {
    const prev = history.undo(getFullState());
    if (prev) restoreState(prev);
  }

  function doRedo() {
    const next = history.redo(getFullState());
    if (next) restoreState(next);
  }

  btnUndo?.addEventListener('click', doUndo);
  btnRedo?.addEventListener('click', doRedo);
  btnAddColumn?.addEventListener('click', addColumn);
  btnAddRow?.addEventListener('click', addRow);

  let sheetContextMenu = null;
  let sheetContextTarget = null;

  function hideSheetContextMenu() {
    sheetContextMenu?.classList.add('hidden');
    sheetContextTarget = null;
  }

  function ensureSheetContextMenu() {
    if (sheetContextMenu) return;
    sheetContextMenu = document.createElement('div');
    sheetContextMenu.className = 'sheet-context-menu hidden';
    sheetContextMenu.innerHTML = `
      <button type="button" data-action="delete" class="danger">Delete</button>
      <button type="button" data-action="insert-right">Add right</button>
      <button type="button" data-action="insert-left">Add left</button>
    `;
    document.body.appendChild(sheetContextMenu);

    sheetContextMenu.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || !sheetContextTarget) return;
      const { kind, id } = sheetContextTarget;
      const action = btn.dataset.action;
      hideSheetContextMenu();

      if (kind === 'column') {
        if (action === 'delete') await deleteColumn(id);
        else if (action === 'insert-left') insertColumnRelative(id, 'left');
        else if (action === 'insert-right') insertColumnRelative(id, 'right');
      } else if (kind === 'row') {
        if (action === 'delete') await deleteRow(id);
        else if (action === 'insert-left') insertRowRelative(id, 'above');
        else if (action === 'insert-right') insertRowRelative(id, 'below');
      }
    });
  }

  function updateSheetContextMenuLabels(kind) {
    if (!sheetContextMenu) return;
    const leftBtn = sheetContextMenu.querySelector('[data-action="insert-left"]');
    const rightBtn = sheetContextMenu.querySelector('[data-action="insert-right"]');
    if (kind === 'column') {
      leftBtn.textContent = 'Add column left';
      rightBtn.textContent = 'Add column right';
    } else {
      leftBtn.textContent = 'Add row above';
      rightBtn.textContent = 'Add row below';
    }
  }

  function showSheetContextMenu(x, y, kind, id) {
    ensureSheetContextMenu();
    sheetContextTarget = { kind, id };
    updateSheetContextMenuLabels(kind);
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
    container.querySelectorAll('.table-find-active').forEach((el) => {
      el.classList.remove('table-find-active');
    });
  }

  function getSearchableText(el) {
    if (el.matches?.('.col-header-label')) return el.textContent || '';
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

  function runFind() {
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

    if (findCount) {
      if (!findMatches.length) {
        findCount.textContent = 'No matches';
      } else {
        findCount.textContent = `${findMatches.length} match${findMatches.length === 1 ? '' : 'es'}`;
      }
    }
  }

  function scrollElementIntoView(el) {
    const scrollEl = container.closest('.spreadsheet-scroll');
    if (!scrollEl || !el) return;
    const scrollRect = scrollEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top < scrollRect.top + 40) {
      scrollEl.scrollTop += elRect.top - scrollRect.top - 40;
    } else if (elRect.bottom > scrollRect.bottom - 40) {
      scrollEl.scrollTop += elRect.bottom - scrollRect.bottom + 40;
    }
    if (elRect.left < scrollRect.left + 20) {
      scrollEl.scrollLeft += elRect.left - scrollRect.left - 20;
    } else if (elRect.right > scrollRect.right - 20) {
      scrollEl.scrollLeft += elRect.right - scrollRect.right + 20;
    }
  }

  function goToFindMatch(index, updateCount = true) {
    if (!findInput || !findMatches.length) return;
    findIndex = ((index % findMatches.length) + findMatches.length) % findMatches.length;
    const match = findMatches[findIndex];
    clearFindHighlight();

    const parent = match.type === 'header'
      ? match.element.closest('.spreadsheet-col-head')
      : match.element.closest('.spreadsheet-cell');
    parent?.classList.add('table-find-active');

    setTimeout(() => {
      scrollElementIntoView(match.element);
      if (match.type === 'header' && match.element.matches('.col-header-label')) {
        match.element.tabIndex = -1;
        match.element.focus({ preventScroll: true });
      } else {
        match.element.focus({ preventScroll: true });
        if (typeof match.element.setSelectionRange === 'function') {
          match.element.setSelectionRange(match.start, match.end);
        }
      }
      findInput?.focus();
    }, 0);

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
    runFind();
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
  document.addEventListener('keydown', onDocKeydown);

  if (titleInput) {
    titleInput.addEventListener('input', () => {
      scheduleHistoryCapture();
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

  function normalizeCellText(text) {
    return String(text || '')
      .replace(/\t/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
  }

  function cellLineWidth(text) {
    const normalized = normalizeCellText(text);
    if (!normalized) return 0;
    return Math.max(...normalized.split('\n').map((line) => line.length));
  }

  function cellForMarkdownExport(text) {
    return normalizeCellText(text).replace(/\n/g, '<br>');
  }

  function cellForHtmlExport(text) {
    return escapeHtml(normalizeCellText(text)).replace(/\n/g, '<br>');
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildTableExportData() {
    collectData();
    const title = titleInput?.value?.trim() || 'Untitled table';
    const headers = sheetData.columns.map((col, i) =>
      cellForMarkdownExport(col.label || `Column ${i + 1}`),
    );
    const rows = sheetData.rows.map((row) =>
      sheetData.columns.map((col) => cellForMarkdownExport(row.cells[col.id])),
    );

    const widths = sheetData.columns.map((col, i) => {
      const headerWidth = cellLineWidth(col.label || `Column ${i + 1}`);
      const colMax = sheetData.rows.reduce(
        (max, row) => Math.max(max, cellLineWidth(row.cells[col.id])),
        0,
      );
      return Math.max(headerWidth, colMax, 3);
    });

    const padCell = (text, width) => String(text).padEnd(width, ' ');

    const mdHeader = `| ${headers.map((h, i) => padCell(h, widths[i])).join(' | ')} |`;
    const mdDivider = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
    const mdRows = rows.map((r) => `| ${r.map((c, i) => padCell(c, widths[i])).join(' | ')} |`);
    const plain = [title, '', mdHeader, mdDivider, ...mdRows].join('\n');

    const thCells = sheetData.columns
      .map((col, i) => {
        const label = col.label || `Column ${i + 1}`;
        return `<th style="border:1px solid #333;background:#f5f5f5;padding:8px 12px;font-weight:600;">${cellForHtmlExport(label)}</th>`;
      })
      .join('');
    const bodyRows = sheetData.rows
      .map((row) => {
        const tds = sheetData.columns
          .map((col) => {
            const value = row.cells[col.id] || '';
            return `<td style="border:1px solid #333;padding:8px 12px;">${cellForHtmlExport(value)}</td>`;
          })
          .join('');
        return `<tr>${tds}</tr>`;
      })
      .join('');

    const tableHtml = `<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #333;font-family:Arial,sans-serif;font-size:14px;"><thead><tr>${thCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><!--StartFragment-->${tableHtml}<!--EndFragment--></body></html>`;

    return { plain, htmlDoc, tableHtml };
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

  async function copyRichHtml(tableHtml) {
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
    return ok;
  }

  async function copyToClipboard() {
    const { plain, htmlDoc, tableHtml } = buildTableExportData();
    let ok = false;

    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([htmlDoc], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
        ok = true;
      } catch {
        /* try fallbacks */
      }
    }

    if (!ok) {
      ok = await copyRichHtml(tableHtml);
    }

    if (!ok) {
      try {
        await navigator.clipboard.writeText(plain);
        ok = true;
      } catch {
        const ta = document.createElement('textarea');
        ta.value = plain;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      }
    }

    if (ok) showCopiedFeedback();
  }

  document.getElementById('btnCopyTable')?.addEventListener('click', copyToClipboard);

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
      body: JSON.stringify(getFullState()),
      keepalive: true,
    }).catch(() => {});
  }

  // Register cleanup for the router so listeners/timers are removed on navigate
  if (window.__routerCleanup) {
    window.__routerCleanup.push(() => {
      flushSave();
      document.removeEventListener('keydown', onDocKeydown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stopResize);
      document.removeEventListener('click', onSheetContextMenuDismiss);
      document.removeEventListener('scroll', hideSheetContextMenu, true);
      hideSheetContextMenu();
      clearTimeout(saveTimer);
      clearTimeout(historyTimer);
      clearColDragState();
      clearRowDragState();
    });
  }
})();
