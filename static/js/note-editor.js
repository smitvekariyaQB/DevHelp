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

  function getPayload() {
    const colorInput = document.querySelector('#colorOptions input[name="color"]:checked');
    return {
      title: titleInput ? titleInput.value : 'Untitled',
      content: quill ? quill.root.innerHTML : '',
      color: colorInput ? colorInput.value : undefined,
    };
  }

  function getFullState() {
    return getPayload();
  }

  function applyNoteColor(hex) {
    if (form && hex) form.style.setProperty('--note-color', hex);
  }

  function restoreState(state) {
    isRestoring = true;
    if (titleInput) titleInput.value = state.title;
    if (quill) quill.root.innerHTML = state.content || '';
    applyNoteColor(state.color);
    const colorInput = document.querySelector(`#colorOptions input[value="${state.color}"]`);
    if (colorInput) colorInput.checked = true;
    isRestoring = false;
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
    if (!ready) return;
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

  function initColorPicker() {
    document.querySelectorAll('#colorOptions input[name="color"]').forEach((input) => {
      const pick = () => {
        recordHistoryNow();
        applyNoteColor(input.value);
        scheduleAutosave(true);
      };
      input.addEventListener('change', pick);
      input.addEventListener('click', pick);
    });
  }

  initColorPicker();

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

  async function copyNoteToClipboard() {
    const title = titleInput?.value?.trim() || 'Untitled';
    const body = quill ? quill.root.innerText.trim() : '';
    const plain = body ? `${title}\n\n${body}` : title;
    let ok = false;
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

  if (initial) quill.root.innerHTML = initial;

  if (titleInput) {
    titleInput.addEventListener('input', () => {
      scheduleHistoryCapture();
      scheduleAutosave();
    });
  }

  quill.on('text-change', () => {
    scheduleHistoryCapture();
    scheduleAutosave();
  });

  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      doUndo();
    }
    if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
      e.preventDefault();
      doRedo();
    }
  });

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
})();
