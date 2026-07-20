(function () {
  function nextNonWhitespace(text, from) {
    for (let i = from; i < text.length; i += 1) {
      if (!/\s/.test(text[i])) return i;
    }
    return -1;
  }

  function formatJsonLoose(text, spaces) {
    const indent = spaces > 0 ? ' '.repeat(spaces) : '';
    let out = '';
    let depth = 0;
    let inString = false;
    let stringQuote = '';
    let escape = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];

      if (inString) {
        out += ch;
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === stringQuote) {
          inString = false;
          stringQuote = '';
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        stringQuote = ch;
        out += ch;
        continue;
      }

      if (/\s/.test(ch)) continue;

      if (ch === '{' || ch === '[') {
        out += ch;
        if (spaces > 0) {
          const close = ch === '{' ? '}' : ']';
          const next = nextNonWhitespace(text, i + 1);
          if (next !== -1 && text[next] !== close) {
            depth += 1;
            out += `\n${indent.repeat(depth)}`;
          }
        }
      } else if (ch === '}' || ch === ']') {
        if (spaces > 0) {
          depth = Math.max(0, depth - 1);
          if (out.length && !out.endsWith('\n')) {
            out += `\n${indent.repeat(depth)}`;
          }
        }
        out += ch;
      } else if (ch === ',') {
        out += ch;
        if (spaces > 0) {
          const next = nextNonWhitespace(text, i + 1);
          if (next !== -1 && text[next] !== '}' && text[next] !== ']') {
            out += `\n${indent.repeat(depth)}`;
          }
        }
      } else if (ch === ':') {
        out += spaces > 0 ? ': ' : ':';
      } else {
        out += ch;
      }
    }
    return out;
  }

  function formatJsonText(text, spaces) {
    if (!text.trim()) return null;
    try {
      return JSON.stringify(JSON.parse(text), null, spaces || undefined);
    } catch {
      return formatJsonLoose(text, spaces);
    }
  }

  window.formatJsonText = formatJsonText;
})();
