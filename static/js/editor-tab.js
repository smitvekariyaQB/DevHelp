window.bindEditorTabKey = function (el, onInput) {
  if (!el) return;

  const TAB_INSERT = '  ';

  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;

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
      onInput?.();
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

    onInput?.();
  });
};
