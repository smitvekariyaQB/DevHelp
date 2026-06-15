(function () {
  const form = document.getElementById('noteForm');
  const editorEl = document.getElementById('noteEditor');
  const titleInput = document.getElementById('noteTitleInput');
  const statusEl = document.getElementById('autosaveStatus');
  const statusTextEl = statusEl?.querySelector('.autosave-badge-text');
  const btnSave = document.getElementById('btnManualSave');
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  const cfg = window.NOTE_EDITOR_CONFIG || {};
  const canEdit = cfg.canEditContent !== false;

  const AUTOSAVE_DELAY = 800;
  const HISTORY_DELAY = 900;

  let quill;
  let saveTimer;
  let historyTimer;
  let historyCapture = null;
  let saving = false;
  let pending = false;
  let ready = false;
  let isRestoring = false;
  let findMatches = [];
  let findIndex = -1;
  let findBarOpen = false;

  const FIND_MATCH_BG = 'rgba(255, 214, 0, 0.45)';
  const FIND_ACTIVE_BG = 'rgba(255, 149, 0, 0.55)';

  const history = window.createEditorHistory(60);

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

  function clearFindHighlights() {
    if (!quill) return;
    const len = Math.max(0, quill.getLength() - 1);
    if (len > 0) quill.formatText(0, len, { background: false }, 'silent');
  }

  function getPayload() {
    clearFindHighlights();
    const colorInput = document.querySelector('#colorOptions input[name="color"]:checked');
    const payload = {
      title: titleInput ? titleInput.value : 'Untitled',
      content: quill ? (quill.getSemanticHTML?.() ?? quill.root.innerHTML) : '',
      color: colorInput ? colorInput.value : undefined,
    };
    if (findBarOpen) requestAnimationFrame(() => syncNoteFindHighlight());
    return payload;
  }

  function getFullState() {
    return getPayload();
  }

  function applyNoteColor(hex) {
    if (form && hex) form.style.setProperty('--note-color', hex);
    const dot = document.querySelector('.color-picker-dot');
    if (dot && hex) dot.style.background = hex;
  }

  function restoreState(state) {
    isRestoring = true;
    if (titleInput) titleInput.value = state.title;
    if (quill) {
      quill.setContents(quill.clipboard.convert({ html: state.content || '' }), 'silent');
    }
    applyNoteColor(state.color);
    const colorInput = document.querySelector(`#colorOptions input[value="${state.color}"]`);
    if (colorInput) colorInput.checked = true;
    isRestoring = false;
    if (findBarOpen) runFind();
    scheduleAutosave(true);
  }

  function recordHistoryNow() {
    if (isRestoring || !ready) return;
    history.push(getFullState());
  }

  function scheduleHistoryCapture() {
    if (isRestoring || !ready) return;
    if (!historyCapture) historyCapture = getFullState();
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      if (historyCapture) {
        history.push(historyCapture);
        historyCapture = null;
      }
    }, HISTORY_DELAY);
  }

  async function runAutosave() {
    if (!cfg.autosaveUrl || !ready) return;
    if (saving) {
      pending = true;
      return;
    }
    saving = true;
    setStatus('saving');
    try {
      const res = await fetch(cfg.autosaveUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': cfg.csrfToken,
        },
        body: JSON.stringify(getPayload()),
      });
      if (!res.ok) throw new Error('save failed');
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
    if (!ready || !canEdit) return;
    setStatus('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(runAutosave, immediate ? 0 : AUTOSAVE_DELAY);
  }

  function doUndo() {
    const prev = history.undo(getFullState());
    if (prev) restoreState(prev);
  }

  function doRedo() {
    const next = history.redo(getFullState());
    if (next) restoreState(next);
  }

  function closeColorPopover() {
    const popover = document.getElementById('colorPickerPopover');
    const pickerBtn = document.getElementById('btnColorPicker');
    if (popover) popover.hidden = true;
    if (pickerBtn) pickerBtn.setAttribute('aria-expanded', 'false');
  }

  function initColorPicker() {
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
        applyNoteColor(input.value);
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

  btnSave?.addEventListener('click', () => {
    clearTimeout(saveTimer);
    runAutosave();
  });

  btnUndo?.addEventListener('click', doUndo);
  btnRedo?.addEventListener('click', doRedo);

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

  function getNoteBodyPlainText() {
    if (!quill) return '';
    const lines = [];
    if (typeof quill.getLines === 'function') {
      quill.getLines().forEach((line) => {
        const node = line.domNode;
        const text = (node.textContent || '').replace(/\n$/, '');
        const li = node.tagName === 'LI' ? node : node.closest('li');
        if (li) {
          const list = li.closest('ol, ul');
          if (list?.tagName === 'OL') {
            const items = Array.from(list.children).filter((el) => el.tagName === 'LI');
            const idx = items.indexOf(li) + 1;
            lines.push(`${idx}. ${text.trim()}`);
          } else {
            lines.push(`• ${text.trim()}`);
          }
        } else {
          lines.push(text.trimEnd());
        }
      });
    } else {
      let text = quill.getText();
      if (text.endsWith('\n')) text = text.slice(0, -1);
      lines.push(...text.split('\n').map((line) => line.trimEnd()));
    }
    return lines
      .join('\n')
      .replace(/^\n+|\n+$/g, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  function buildNoteCopyPayload() {
    clearFindHighlights();
    const htmlContent = quill.root.innerHTML;
    const plain = getNoteBodyPlainText();
    const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><!--StartFragment-->${htmlContent}<!--EndFragment--></body></html>`;
    if (findBarOpen) requestAnimationFrame(() => syncNoteFindHighlight());
    return { plain, htmlDoc, htmlContent };
  }

  async function copyRichHtml(htmlContent) {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.innerHTML = htmlContent;
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

  async function copyNoteToClipboard() {
    if (!quill) return;
    const { plain, htmlDoc, htmlContent } = buildNoteCopyPayload();
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

    if (!ok) ok = await copyRichHtml(htmlContent);

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

  if (!editorEl || typeof Quill === 'undefined') return;

  const initialEl = document.getElementById('note-initial-content');
  const initial = initialEl ? JSON.parse(initialEl.textContent) : '';

  quill = new Quill('#noteEditor', {
    theme: 'snow',
    placeholder: 'Start writing…',
    modules: {
      toolbar: [
        ['bold', 'italic', 'underline', 'strike'],
        [{ header: [1, 2, 3, false] }],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['blockquote', 'link'],
        ['clean'],
      ],
      history: { delay: 500, maxStack: 100, userOnly: true },
    },
  });

  if (initial) {
    quill.setContents(quill.clipboard.convert({ html: initial }), 'silent');
  }

  if (!canEdit) {
    quill.enable(false);
    if (titleInput) titleInput.readOnly = true;
  }

  function noteBodyText() {
    if (!quill) return '';
    let text = quill.getText();
    if (text.endsWith('\n')) text = text.slice(0, -1);
    return text;
  }

  function syncNoteFindHighlight() {
    if (!quill) return;
    clearFindHighlights();
    const findInput = document.getElementById('noteFindInput');
    const query = findInput?.value || '';
    if (!query || !findMatches.length) return;
    const len = query.length;
    findMatches.forEach((start, i) => {
      const bg = i === findIndex ? FIND_ACTIVE_BG : FIND_MATCH_BG;
      quill.formatText(start, len, { background: bg }, 'silent');
    });
  }

  function scrollNoteMatchIntoView(start, length) {
    if (!quill) return;
    quill.setSelection(start, length, 'api');
    if (typeof quill.scrollSelectionIntoView === 'function') {
      quill.scrollSelectionIntoView();
    } else {
      const bounds = quill.getBounds(start, length);
      if (bounds && typeof quill.scrollRectIntoView === 'function') {
        quill.scrollRectIntoView(bounds);
      }
    }
  }

  function runFind() {
    const findInput = document.getElementById('noteFindInput');
    const findCount = document.getElementById('noteFindCount');
    if (!quill || !findInput) return;

    const query = findInput.value;
    findMatches = [];
    findIndex = -1;

    if (!query) {
      if (findCount) findCount.textContent = '';
      syncNoteFindHighlight();
      return;
    }

    const lowerText = noteBodyText().toLowerCase();
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
    syncNoteFindHighlight();
  }

  function goToFindMatch(index, updateCount = true) {
    const findInput = document.getElementById('noteFindInput');
    const findCount = document.getElementById('noteFindCount');
    if (!quill || !findInput || !findMatches.length) return;

    findIndex = ((index % findMatches.length) + findMatches.length) % findMatches.length;
    const start = findMatches[findIndex];
    const end = start + findInput.value.length;

    syncNoteFindHighlight();

    const revealMatch = () => {
      scrollNoteMatchIntoView(start, end - start);
      findInput.focus({ preventScroll: true });
    };

    requestAnimationFrame(revealMatch);

    if (updateCount && findCount) {
      findCount.textContent = `${findIndex + 1} of ${findMatches.length}`;
    }
  }

  function findNextMatch() {
    const findInput = document.getElementById('noteFindInput');
    if (!findInput?.value.trim()) return;
    if (!findMatches.length) runFind();
    if (!findMatches.length) return;
    goToFindMatch(findIndex === -1 ? 0 : findIndex + 1);
  }

  function findPrevMatch() {
    if (!findMatches.length) return;
    goToFindMatch(findIndex === -1 ? findMatches.length - 1 : findIndex - 1);
  }

  function initNoteSearch() {
    const btnSearch = document.getElementById('btnNoteSearch');
    const findBar = document.getElementById('noteFindBar');
    const findInput = document.getElementById('noteFindInput');
    const btnPrev = document.getElementById('btnNoteFindPrev');
    const btnNext = document.getElementById('btnNoteFindNext');
    const btnClose = document.getElementById('btnNoteFindClose');

    function openFindBar() {
      findBar?.classList.remove('hidden');
      findBarOpen = true;
      findInput?.focus();
      findInput?.select();
      runFind();
    }

    function closeFindBar() {
      findBar?.classList.add('hidden');
      if (findInput) findInput.value = '';
      findBarOpen = false;
      findMatches = [];
      findIndex = -1;
      clearFindHighlights();
      quill?.focus();
    }

    btnSearch?.addEventListener('click', openFindBar);
    btnClose?.addEventListener('click', closeFindBar);
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
    btnPrev?.addEventListener('click', findPrevMatch);
    btnNext?.addEventListener('click', findNextMatch);

    return { openFindBar, closeFindBar, runFind, isOpen: () => findBarOpen };
  }

  if (titleInput) {
    titleInput.addEventListener('input', () => {
      scheduleHistoryCapture();
      scheduleAutosave();
    });
  }

  quill.on('text-change', (_delta, _old, source) => {
    if (source === 'silent') return;
    scheduleHistoryCapture();
    scheduleAutosave();
    if (findBarOpen) runFind();
  });

  let noteSearch = null;

  function onKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      noteSearch?.openFindBar();
      return;
    }
    if (e.key === 'Escape' && noteSearch?.isOpen()) {
      e.preventDefault();
      noteSearch.closeFindBar();
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
  document.addEventListener('keydown', onKeydown);

  noteSearch = initNoteSearch();

  ready = true;
  history.reset(getFullState());
  setStatus('saved');

  document.getElementById('btnCopyNote')?.addEventListener('click', copyNoteToClipboard);

  const btnDeleteNote = document.getElementById('btnDeleteNote');
  const deleteForm = document.getElementById('deleteNoteForm');
  if (btnDeleteNote && deleteForm) {
    btnDeleteNote.addEventListener('click', async () => {
      if (!window.AppModal) return;
      const ok = await AppModal.confirm({
        title: 'Delete note',
        message: 'Are you sure you want to delete this note? This cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true,
      });
      if (ok) deleteForm.submit();
    });
  }

  // Register cleanup for the router so listeners/timers are removed on navigate
  if (window.__routerCleanup) {
    window.__routerCleanup.push(() => {
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('click', onDocumentColorClick);
      closeColorPopover();
      noteSearch?.closeFindBar();
      clearFindHighlights();
      clearTimeout(saveTimer);
      clearTimeout(historyTimer);
      ready = false;
      noteSearch = null;
    });
  }
})();
