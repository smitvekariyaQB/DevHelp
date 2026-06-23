window.createEditorHistory = function (maxSize, options) {
  const opts = options || {};
  const limit = maxSize || 50;
  const undoStack = [];
  const redoStack = [];
  let lastSerialized = '';
  const undoButtonId = opts.undoButtonId !== undefined ? opts.undoButtonId : 'btnUndo';
  const redoButtonId = opts.redoButtonId !== undefined ? opts.redoButtonId : 'btnRedo';
  const manageButtons = opts.manageButtons === true;

  function snapshot(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function serialize(state) {
    return JSON.stringify(state);
  }

  function updateButtons() {
    if (!manageButtons) return;
    const undoBtn = undoButtonId ? document.getElementById(undoButtonId) : null;
    const redoBtn = redoButtonId ? document.getElementById(redoButtonId) : null;
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  return {
    push(state) {
      const key = serialize(state);
      if (key === lastSerialized) return;
      undoStack.push(snapshot(state));
      if (undoStack.length > limit) undoStack.shift();
      redoStack.length = 0;
      lastSerialized = key;
      updateButtons();
    },

    undo(currentState) {
      if (!undoStack.length) return null;
      redoStack.push(snapshot(currentState));
      const prev = undoStack.pop();
      lastSerialized = serialize(prev);
      updateButtons();
      return prev;
    },

    redo(currentState) {
      if (!redoStack.length) return null;
      undoStack.push(snapshot(currentState));
      const next = redoStack.pop();
      lastSerialized = serialize(next);
      updateButtons();
      return next;
    },

    reset(state) {
      undoStack.length = 0;
      redoStack.length = 0;
      lastSerialized = serialize(state);
      updateButtons();
    },

    canUndo() {
      return undoStack.length > 0;
    },

    canRedo() {
      return redoStack.length > 0;
    },

    /** Allow the same snapshot to be pushed again (e.g. after undo). */
    clearDedup() {
      lastSerialized = undefined;
    },

    updateButtons,
  };
};
