window.createEditorDraftStore = function (appKey) {
  const prefix = `arcbook:${appKey}:draft:`;

  function storageKey(docId) {
    return `${prefix}${docId}`;
  }

  function save(docId, payload) {
    if (!docId) return;
    try {
      sessionStorage.setItem(
        storageKey(docId),
        JSON.stringify({
          title: payload.title ?? '',
          content: payload.content ?? '',
          savedAt: Date.now(),
        })
      );
    } catch (err) {
      console.warn(`[Draft:${appKey}] save failed:`, err);
    }
  }

  function load(docId) {
    if (!docId) return null;
    try {
      const raw = sessionStorage.getItem(storageKey(docId));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function clear(docId) {
    if (!docId) return;
    try {
      sessionStorage.removeItem(storageKey(docId));
    } catch (err) {
      console.warn(`[Draft:${appKey}] clear failed:`, err);
    }
  }

  return { save, load, clear };
};
