(function () {
  const cfg = window.TABLE_EDITOR_CONFIG;
  const container = document.getElementById('spreadsheetContainer');
  const panel = document.getElementById('tableEditorPanel');
  const titleInput = document.getElementById('tableTitle');
  const statusEl = document.getElementById('tableAutosaveStatus');
  const statusTextEl = statusEl?.querySelector('.autosave-badge-text');
  const btnSave = document.getElementById('btnManualSave');
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  if (!cfg || !container) return;

  const ROW_HEADER_WIDTH = 48;
  const ADD_COL_WIDTH = 48;
  const AUTOSAVE_DELAY = 800;
  const HISTORY_DELAY = 900;

  const MIN_COL_WIDTH = 80;

  const ICONS = {
    plus: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  };

  let sheetData = JSON.parse(JSON.stringify(cfg.initialData || { columns: [], rows: [] }));
  let saveTimer;
  let historyTimer;
  let historyCapture = null;
  let saving = false;
  let pending = false;
  let resizing = null;
  let colgroupEl = null;
  let isRestoring = false;

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

  function getColor() {
    const el = document.querySelector('#colorOptions input:checked');
    return el ? el.value : cfg.initialColor;
  }

  function applySheetColor(hex) {
    if (panel && hex) panel.style.setProperty('--sheet-color', hex);
    const dot = document.querySelector('.color-picker-dot');
    if (dot && hex) dot.style.background = hex;
  }

  function getFullState() {
    return {
      title: titleInput ? titleInput.value : '',
      color: getColor(),
      data: JSON.parse(JSON.stringify(collectData())),
    };
  }

  function restoreState(state) {
    isRestoring = true;
    if (titleInput) titleInput.value = state.title;
    applySheetColor(state.color);
    const colorInput = document.querySelector(`#colorOptions input[value="${state.color}"]`);
    if (colorInput) colorInput.checked = true;
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
          width: MIN_COL_WIDTH,
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

  function getSpreadsheetWidth() {
    const scroll = container.closest('.spreadsheet-scroll');
    return Math.max(scroll ? scroll.clientWidth : 0, 400);
  }

  function fitColumnsToWidth() {
    if (!sheetData.columns.length) return;
    const available = Math.max(240, getSpreadsheetWidth() - ROW_HEADER_WIDTH);
    const perCol = Math.max(MIN_COL_WIDTH, Math.floor(available / sheetData.columns.length));
    sheetData.columns.forEach((col) => { col.width = perCol; });
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

    const table = container.querySelector('.spreadsheet');
    if (table) {
      const tableWidth = ROW_HEADER_WIDTH
        + sheetData.columns.reduce((sum, col) => sum + col.width, 0);
      const scrollWidth = getSpreadsheetWidth();
      table.style.width = `${Math.max(tableWidth, scrollWidth)}px`;
      table.style.minWidth = `${scrollWidth}px`;
    }
  }

  function updateTableLayout() {
    fitColumnsToWidth();
    applyColumnWidths();
  }

  let resizeTimer;
  function scheduleLayoutFit() {
    if (resizing) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      collectData();
      fitColumnsToWidth();
      updateTableLayout();
    }, 100);
  }

  function collectData() {
    container.querySelectorAll('.cell-input').forEach((ta) => {
      const row = sheetData.rows.find((r) => r.id === ta.dataset.rowId);
      if (row) row.cells[ta.dataset.colId] = ta.value;
    });
    container.querySelectorAll('.col-header-input').forEach((inp) => {
      const col = sheetData.columns.find((c) => c.id === inp.dataset.colId);
      if (col) col.label = inp.value;
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

  function makeIconButton(className, title, icon, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.title = title;
    btn.innerHTML = icon;
    btn.addEventListener('click', onClick);
    return btn;
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

  function addColumn() {
    recordHistoryNow();
    collectData();
    const n = sheetData.columns.length + 1;
    const col = { id: uid(), width: MIN_COL_WIDTH, label: `Column ${n}` };
    sheetData.columns.push(col);
    sheetData.rows.forEach((row) => { row.cells[col.id] = ''; });
    fitColumnsToWidth();
    render();
    scheduleAutosave(true);
  }

  function addRow() {
    recordHistoryNow();
    collectData();
    const cells = {};
    sheetData.columns.forEach((col) => { cells[col.id] = ''; });
    sheetData.rows.push({ id: uid(), cells });
    render();
    scheduleAutosave(true);
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
    fitColumnsToWidth();
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
      const tableWidth = ROW_HEADER_WIDTH
        + sheetData.columns.reduce((sum, c) => sum + c.width, 0);
      const scrollWidth = getSpreadsheetWidth();
      table.style.width = `${Math.max(tableWidth, scrollWidth)}px`;
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
    fitColumnsToWidth();

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

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'col-header-input';
      labelInput.dataset.colId = col.id;
      labelInput.value = col.label || `Column ${index + 1}`;
      labelInput.placeholder = `Column ${index + 1}`;
      labelInput.addEventListener('input', () => {
        scheduleHistoryCapture();
        scheduleAutosave();
      });

      const delCol = makeIconButton(
        'sheet-icon-btn sheet-del-col',
        'Delete column',
        ICONS.close,
        (e) => {
          e.stopPropagation();
          deleteColumn(col.id);
        },
      );

      headInner.appendChild(labelInput);
      headInner.appendChild(delCol);

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

      const delRow = makeIconButton(
        'sheet-icon-btn sheet-del-row',
        'Delete row',
        ICONS.close,
        (e) => {
          e.stopPropagation();
          deleteRow(row.id);
        },
      );

      rowInner.appendChild(rowNum);
      rowInner.appendChild(delRow);
      rowLabel.appendChild(rowInner);
      tr.appendChild(rowLabel);

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
        });
        td.appendChild(ta);
        tr.appendChild(td);
        requestAnimationFrame(() => autoResizeTextarea(ta));
      });

      tbody.appendChild(tr);
    });

    const addRowTr = document.createElement('tr');
    addRowTr.className = 'spreadsheet-add-row';
    addRowTr.dataset.action = 'add-row';
    addRowTr.title = 'Add row';

    const addRowLabel = document.createElement('td');
    addRowLabel.className = 'spreadsheet-row-label spreadsheet-add-row-label';
    const addRowIcon = document.createElement('span');
    addRowIcon.className = 'sheet-add-row-icon';
    addRowIcon.innerHTML = ICONS.plus;
    addRowLabel.appendChild(addRowIcon);
    addRowTr.appendChild(addRowLabel);

    sheetData.columns.forEach(() => {
      const td = document.createElement('td');
      td.className = 'spreadsheet-add-row-cell';
      addRowTr.appendChild(td);
    });

    tbody.appendChild(addRowTr);

    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);

    container.querySelectorAll('.col-resize-handle').forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        recordHistoryNow();
        startResize(e, handle.dataset.colId);
      });
    });

    container.querySelector('[data-action="add-row"]')?.addEventListener('click', addRow);

    applyColumnWidths();
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

  function onDocKeydown(e) {
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

  let onColorPickerPanelClick;
  let onColorPickerChange;
  let onDocumentColorClick;

  function closeColorPopover() {
    const popover = document.getElementById('colorPickerPopover');
    const pickerBtn = document.getElementById('btnColorPicker');
    if (popover) popover.hidden = true;
    if (pickerBtn) pickerBtn.setAttribute('aria-expanded', 'false');
  }

  function initColorPicker() {
    const panel = document.getElementById('tableEditorPanel');
    if (!panel?.querySelector('.color-picker-wrap')) return;

    onColorPickerPanelClick = (e) => {
      const pickerBtn = e.target.closest('#btnColorPicker');
      if (pickerBtn && panel.contains(pickerBtn)) {
        e.stopPropagation();
        const popover = document.getElementById('colorPickerPopover');
        if (!popover) return;
        const open = popover.hidden;
        popover.hidden = !open;
        pickerBtn.setAttribute('aria-expanded', String(open));
      }
    };

    onColorPickerChange = (e) => {
      const input = e.target.closest('#colorOptions input[name="color"]');
      if (!input || !panel.contains(input)) return;
      recordHistoryNow();
      applySheetColor(input.value);
      scheduleAutosave(true);
      closeColorPopover();
    };

    onDocumentColorClick = (e) => {
      if (e.target.closest('.color-picker-wrap')) return;
      closeColorPopover();
    };

    panel.addEventListener('click', onColorPickerPanelClick);
    panel.addEventListener('change', onColorPickerChange);
    document.addEventListener('click', onDocumentColorClick);
  }

  btnSave?.addEventListener('click', () => {
    clearTimeout(saveTimer);
    runAutosave();
  });

  function cellForExport(text) {
    return String(text || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
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
    const headers = sheetData.columns.map((col, i) => cellForExport(col.label || `Column ${i + 1}`));
    const rows = sheetData.rows.map((row) =>
      sheetData.columns.map((col) => cellForExport(row.cells[col.id])),
    );

    const widths = headers.map((h, i) => {
      const colMax = rows.reduce((max, r) => Math.max(max, (r[i] || '').length), 0);
      return Math.max(h.length, colMax, 3);
    });

    const padCell = (text, width) => String(text).padEnd(width, ' ');

    const mdHeader = `| ${headers.map((h, i) => padCell(h, widths[i])).join(' | ')} |`;
    const mdDivider = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
    const mdRows = rows.map((r) => `| ${r.map((c, i) => padCell(c, widths[i])).join(' | ')} |`);
    const plain = [title, '', mdHeader, mdDivider, ...mdRows].join('\n');

    const thCells = headers
      .map((h) => `<th style="border:1px solid #333;background:#f5f5f5;padding:8px 12px;font-weight:600;">${escapeHtml(h)}</th>`)
      .join('');
    const bodyRows = rows
      .map((r) => {
        const tds = r
          .map((c) => `<td style="border:1px solid #333;padding:8px 12px;">${escapeHtml(c)}</td>`)
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

  const addColRail = document.getElementById('sheetAddColRail');
  if (addColRail) {
    addColRail.innerHTML = `<span class="sheet-add-col-rail-icon">${ICONS.plus}</span>`;
    addColRail.addEventListener('click', addColumn);
  }

  render();
  requestAnimationFrame(() => {
    updateTableLayout();
  });

  let scrollResizeObserver;
  const scrollEl = container.closest('.spreadsheet-scroll');
  if (scrollEl && window.ResizeObserver) {
    scrollResizeObserver = new ResizeObserver(scheduleLayoutFit);
    scrollResizeObserver.observe(scrollEl);
  } else {
    window.addEventListener('resize', scheduleLayoutFit);
  }

  history.reset(getFullState());
  setStatus('saved');

  initColorPicker();
  applySheetColor(cfg.initialColor);

  // Register cleanup for the router so listeners/timers are removed on navigate
  if (window.__routerCleanup) {
    window.__routerCleanup.push(() => {
      const panel = document.getElementById('tableEditorPanel');
      if (panel && onColorPickerPanelClick) {
        panel.removeEventListener('click', onColorPickerPanelClick);
      }
      if (panel && onColorPickerChange) {
        panel.removeEventListener('change', onColorPickerChange);
      }
      if (onDocumentColorClick) {
        document.removeEventListener('click', onDocumentColorClick);
      }
      closeColorPopover();
      document.removeEventListener('keydown', onDocKeydown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stopResize);
      clearTimeout(saveTimer);
      clearTimeout(historyTimer);
      clearTimeout(resizeTimer);
      scrollResizeObserver?.disconnect();
    });
  }
})();
