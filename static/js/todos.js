(function () {
  const cfg = window.TODO_CONFIG;
  if (!cfg) return;

  const csrf = cfg.csrfToken;
  const undoStack = [];
  const redoStack = [];
  const HISTORY_LIMIT = 50;
  let findMatches = [];
  let findIndex = -1;

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrf,
      },
      body: JSON.stringify(body || {}),
    }).then((r) => r.json());
  }

  function formatDate() {
    const el = document.getElementById('tasksDate');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function createTaskEl(task) {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.is_completed ? ' completed' : '');
    li.dataset.taskId = task.id;
    if (task.list_id != null) li.dataset.listId = task.list_id;
    if (task.in_my_day) li.dataset.inMyDay = '1';
    li.innerHTML = `
      <button type="button" class="task-check${task.is_completed ? ' checked' : ''}" data-action="toggle" aria-label="Toggle"></button>
      <div class="task-body">
        <span class="task-title">${escapeHtml(task.title)}</span>
        ${task.due_date ? `<span class="task-due">${task.due_date}</span>` : ''}
      </div>
      <button type="button" class="task-star${task.is_important ? ' starred' : ''}" data-action="star" aria-label="Important">★</button>
      <button type="button" class="task-delete" data-action="delete" aria-label="Delete">×</button>
    `;
    return li;
  }

  function ensureStarButton(item, starred) {
    let star = item.querySelector('.task-star');
    if (!star) {
      star = document.createElement('button');
      star.type = 'button';
      star.className = 'task-star';
      star.dataset.action = 'star';
      star.setAttribute('aria-label', 'Important');
      star.textContent = '★';
      const del = item.querySelector('.task-delete');
      if (del) item.insertBefore(star, del);
      else item.appendChild(star);
    }
    star.classList.toggle('starred', !!starred);
  }

  function removeEmptyState() {
    const empty = document.querySelector('#activeTasks .task-empty');
    if (empty) empty.remove();
  }

  function taskLeavesSmartView(task) {
    if (!task || !cfg.smartListType) return false;
    if (cfg.smartListType === 'important') return !task.is_important;
    if (cfg.smartListType === 'my_day') return !task.in_my_day;
    return false;
  }

  function removeTaskFromSmartView(item) {
    const wasActive = !item.classList.contains('completed');
    item.remove();
    updateCompletedCount();
    if (wasActive) {
      if (cfg.smartListType === 'important' && cfg.importantListId != null) {
        updateListCount(cfg.importantListId, -1);
      }
      if (cfg.smartListType === 'my_day' && cfg.myDayListId != null) {
        updateListCount(cfg.myDayListId, -1);
      }
      showEmptyStateIfNeeded();
    }
  }

  function insertTaskIntoView(task) {
    const list = task.is_completed
      ? document.getElementById('completedTasks')
      : document.getElementById('activeTasks');
    insertTask(task, list);
    if (!task.is_completed) {
      removeEmptyState();
      if (cfg.smartListType === 'important' && cfg.importantListId != null) {
        updateListCount(cfg.importantListId, 1);
      }
      if (cfg.smartListType === 'my_day' && cfg.myDayListId != null) {
        updateListCount(cfg.myDayListId, 1);
      }
    }
    updateCompletedCount();
  }

  function showEmptyStateIfNeeded() {
    const activeList = document.getElementById('activeTasks');
    if (!activeList) return;
    const hasTasks = activeList.querySelector('.task-item');
    if (hasTasks) return;
    if (activeList.querySelector('.task-empty')) return;
    const li = document.createElement('li');
    li.className = 'task-empty';
    li.textContent = 'No tasks yet. Add one above.';
    activeList.appendChild(li);
  }

  function getCompletedSection() {
    return document.getElementById('completedSection');
  }

  function updateCompletedCount() {
    const count = document.querySelectorAll('#completedTasks .task-item').length;
    const el = document.getElementById('completedCount');
    if (el) el.textContent = count;
    const section = getCompletedSection();
    if (section) section.classList.toggle('hidden', count === 0);
  }

  function updateListCount(listId, delta) {
    if (listId == null || !delta) return;
    const link = document.querySelector(`.todo-list-item[data-list-id="${listId}"]`);
    if (!link) return;
    let badge = link.querySelector('.list-count');
    let n = badge ? parseInt(badge.textContent, 10) || 0 : 0;
    n = Math.max(0, n + delta);
    if (n === 0) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'list-count';
      link.appendChild(badge);
    }
    badge.textContent = n;
  }

  function pushCountChange(changes, listId, delta) {
    if (listId == null || !delta) return;
    const key = String(listId);
    const existing = changes.find((c) => String(c.listId) === key);
    if (existing) existing.delta += delta;
    else changes.push({ listId, delta });
  }

  /** Match server get_active_tasks() per sidebar list. */
  function countChangesForTask(task, delta) {
    const changes = [];
    if (!task || !delta) return changes;

    if (task.is_important && cfg.importantListId != null) {
      pushCountChange(changes, cfg.importantListId, delta);
    }
    if (task.list_id != null && cfg.tasksListId != null && String(task.list_id) === String(cfg.tasksListId)) {
      pushCountChange(changes, cfg.tasksListId, delta);
    }
    if (task.in_my_day && cfg.myDayListId != null) {
      pushCountChange(changes, cfg.myDayListId, delta);
    }
    if (
      task.list_id != null &&
      task.list_id !== cfg.tasksListId &&
      task.list_id !== cfg.importantListId &&
      task.list_id !== cfg.myDayListId
    ) {
      pushCountChange(changes, task.list_id, delta);
    }
    return changes;
  }

  function applyCountChanges(changes) {
    changes.forEach(({ listId, delta }) => updateListCount(listId, delta));
  }

  function syncActiveCountsForTask(task, delta) {
    applyCountChanges(countChangesForTask(task, delta));
  }

  function moveTaskDom(item, isCompleted) {
    const activeList = document.getElementById('activeTasks');
    const completedList = document.getElementById('completedTasks');
    const check = item.querySelector('.task-check');

    item.classList.toggle('completed', isCompleted);
    check?.classList.toggle('checked', isCompleted);

    if (isCompleted) {
      item.querySelector('.task-star')?.remove();
      completedList?.appendChild(item);
    } else {
      const starred = item.dataset.wasStarred === '1';
      ensureStarButton(item, starred);
      delete item.dataset.wasStarred;
      activeList?.appendChild(item);
      removeEmptyState();
    }
    updateCompletedCount();
  }

  function captureTaskSnapshot(item) {
    const titleEl = item.querySelector('.task-title');
    const dueEl = item.querySelector('.task-due');
    const listId = item.dataset.listId ? parseInt(item.dataset.listId, 10) : cfg.tasksListId;
    return {
      title: titleEl?.textContent?.trim() || '',
      due_date: dueEl?.textContent?.trim() || null,
      is_completed: item.classList.contains('completed'),
      is_important: item.querySelector('.task-star')?.classList.contains('starred') || false,
      in_my_day: item.dataset.inMyDay === '1',
      list_id: listId,
    };
  }

  function taskFromItem(item) {
    return {
      is_important: item.querySelector('.task-star')?.classList.contains('starred') || false,
      in_my_day: item.dataset.inMyDay === '1',
      list_id: item.dataset.listId ? parseInt(item.dataset.listId, 10) : cfg.tasksListId,
    };
  }

  function pushHistory(entry) {
    undoStack.push(entry);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const undoBtn = document.getElementById('btnUndo');
    const redoBtn = document.getElementById('btnRedo');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function applyToggle(item, task, recordHistory) {
    const wasCompleted = !task.is_completed;
    if (recordHistory) {
      pushHistory({
        type: 'toggle',
        taskId: String(task.id),
        undo: () => toggleTaskById(String(task.id)),
        redo: () => toggleTaskById(String(task.id)),
      });
    }
    if (wasCompleted) {
      const star = item.querySelector('.task-star');
      item.dataset.wasStarred = star?.classList.contains('starred') ? '1' : '0';
    }
    moveTaskDom(item, task.is_completed);
    const countTask = {
      is_important: task.is_important,
      in_my_day: task.in_my_day,
      list_id: task.list_id,
    };
    syncActiveCountsForTask(countTask, task.is_completed ? -1 : 1);
  }

  function toggleTaskById(id) {
    return post(cfg.urls.taskToggle(id), {}).then((data) => {
      const item = document.querySelector(`.task-item[data-task-id="${id}"]`);
      if (!item || !data.task) return null;
      applyToggle(item, data.task, false);
      return data.task;
    });
  }

  function insertTask(task, listEl) {
    const el = createTaskEl(task);
    listEl.appendChild(el);
    return el;
  }

  function restoreDeletedTask(snapshot) {
    return post(cfg.urls.taskCreate, {
      title: snapshot.title,
      list_id: snapshot.list_id,
      is_completed: snapshot.is_completed,
      is_important: snapshot.is_important,
      in_my_day: snapshot.in_my_day,
    }).then((data) => {
      if (data.error) return null;
      const task = data.task;
      const list = task.is_completed
        ? document.getElementById('completedTasks')
        : document.getElementById('activeTasks');
      if (!task.is_completed) removeEmptyState();
      insertTask(task, list);
      if (!task.is_completed) syncActiveCountsForTask(task, 1);
      updateCompletedCount();
      return task;
    });
  }

  function bindTaskActions(container) {
    if (!container) return;
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const item = btn.closest('.task-item');
      if (!item) return;
      const id = item.dataset.taskId;
      const action = btn.dataset.action;

      if (action === 'toggle') {
        post(cfg.urls.taskToggle(id), {}).then((data) => {
          if (!data.task) return;
          applyToggle(item, data.task, true);
        });
      }

      if (action === 'star') {
        const wasStarred = btn.classList.contains('starred');
        const starred = !wasStarred;
        btn.classList.toggle('starred', starred);
        post(cfg.urls.taskUpdate(id), { is_important: starred }).then((data) => {
          if (!data.task) return;
          const task = data.task;

          if (taskLeavesSmartView(task)) {
            removeTaskFromSmartView(item);
            pushHistory({
              type: 'star',
              undo: () =>
                post(cfg.urls.taskUpdate(id), { is_important: true }).then((res) => {
                  if (res.task) insertTaskIntoView(res.task);
                }),
              redo: () =>
                post(cfg.urls.taskUpdate(id), { is_important: false }).then((res) => {
                  if (!res.task) return;
                  const el = document.querySelector(`.task-item[data-task-id="${id}"]`);
                  if (el) removeTaskFromSmartView(el);
                }),
            });
            return;
          }

          if (!item.classList.contains('completed') && cfg.importantListId != null) {
            updateListCount(cfg.importantListId, starred ? 1 : -1);
          }
          pushHistory({
            type: 'star',
            undo: () => {
              btn.classList.toggle('starred', wasStarred);
              if (!item.classList.contains('completed') && cfg.importantListId != null) {
                updateListCount(cfg.importantListId, wasStarred ? 1 : -1);
              }
              return post(cfg.urls.taskUpdate(id), { is_important: wasStarred });
            },
            redo: () => {
              btn.classList.toggle('starred', starred);
              if (!item.classList.contains('completed') && cfg.importantListId != null) {
                updateListCount(cfg.importantListId, starred ? 1 : -1);
              }
              return post(cfg.urls.taskUpdate(id), { is_important: starred });
            },
          });
        });
      }

      if (action === 'delete') {
        const snapshot = captureTaskSnapshot(item);
        const wasActive = !snapshot.is_completed;
        const taskId = id;

        post(cfg.urls.taskDelete(id), {}).then(() => {
          item.remove();
          updateCompletedCount();
          if (wasActive) {
            syncActiveCountsForTask(snapshot, -1);
            showEmptyStateIfNeeded();
          }

          let restoredId = null;
          pushHistory({
            type: 'delete',
            undo: () =>
              restoreDeletedTask(snapshot).then((task) => {
                if (task) restoredId = String(task.id);
              }),
            redo: () => deleteTaskById(restoredId || taskId, snapshot),
          });
        });
      }
    });
  }

  function deleteTaskById(id, snapshotOrWasActive) {
    const snapshot =
      typeof snapshotOrWasActive === 'object'
        ? snapshotOrWasActive
        : null;
    const wasActive = snapshot ? !snapshot.is_completed : !!snapshotOrWasActive;

    return post(cfg.urls.taskDelete(id), {}).then(() => {
      const item = document.querySelector(`.task-item[data-task-id="${id}"]`);
      const taskMeta = snapshot || (item ? taskFromItem(item) : null);
      item?.remove();
      updateCompletedCount();
      if (wasActive && taskMeta) {
        syncActiveCountsForTask(taskMeta, -1);
        showEmptyStateIfNeeded();
      }
    });
  }

  function runUndo() {
    const entry = undoStack.pop();
    if (!entry) return;
    redoStack.push(entry);
    updateUndoRedoButtons();
    entry.undo();
  }

  function runRedo() {
    const entry = redoStack.pop();
    if (!entry) return;
    undoStack.push(entry);
    updateUndoRedoButtons();
    entry.redo();
  }

  function initSearch() {
    const btnSearch = document.getElementById('btnTodoSearch');
    const findBar = document.getElementById('todoFindBar');
    const findInput = document.getElementById('todoFindInput');
    const findCount = document.getElementById('todoFindCount');
    const btnPrev = document.getElementById('btnTodoFindPrev');
    const btnNext = document.getElementById('btnTodoFindNext');
    const btnClose = document.getElementById('btnTodoFindClose');

    function allTaskItems() {
      return document.querySelectorAll('#activeTasks .task-item, #completedTasks .task-item');
    }

    function clearSearchUi() {
      allTaskItems().forEach((item) => {
        item.classList.remove('task-search-match', 'task-search-hidden');
      });
      findMatches = [];
      findIndex = -1;
      if (findCount) findCount.textContent = '';
    }

    function runFind() {
      const q = findInput?.value.trim().toLowerCase() || '';
      clearSearchUi();
      if (!q) return;

      findMatches = [];
      allTaskItems().forEach((item) => {
        const title = item.querySelector('.task-title')?.textContent?.toLowerCase() || '';
        const match = title.includes(q);
        item.classList.toggle('task-search-hidden', !match);
        if (match) findMatches.push(item);
      });

      if (findMatches.length) {
        findIndex = 0;
        highlightMatch(0);
      } else if (findCount) {
        findCount.textContent = 'No matches';
      }
    }

    function highlightMatch(index) {
      allTaskItems().forEach((item) => item.classList.remove('task-search-match'));
      if (!findMatches.length) return;
      findIndex = ((index % findMatches.length) + findMatches.length) % findMatches.length;
      const item = findMatches[findIndex];
      item.classList.add('task-search-match');
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (findCount) {
        findCount.textContent = `${findIndex + 1} of ${findMatches.length}`;
      }
    }

    function openFind() {
      findBar?.classList.remove('hidden');
      findInput?.focus();
      findInput?.select();
    }

    function closeFind() {
      findBar?.classList.add('hidden');
      if (findInput) findInput.value = '';
      clearSearchUi();
    }

    btnSearch?.addEventListener('click', openFind);
    btnClose?.addEventListener('click', closeFind);
    findInput?.addEventListener('input', runFind);
    btnPrev?.addEventListener('click', () => {
      if (!findMatches.length) runFind();
      else highlightMatch(findIndex - 1);
    });
    btnNext?.addEventListener('click', () => {
      if (!findMatches.length) runFind();
      else highlightMatch(findIndex + 1);
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openFind();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        runUndo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        runRedo();
      }
    });
  }

  const newInput = document.getElementById('newTaskInput');
  if (newInput) {
    newInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const title = newInput.value.trim();
      if (!title) return;

      post(cfg.urls.taskCreate, {
        title,
        list_id: parseInt(newInput.dataset.listId, 10),
      }).then((data) => {
        if (data.error) return;
        removeEmptyState();
        const list = document.getElementById('activeTasks');
        const el = insertTask(data.task, list);
        newInput.value = '';
        syncActiveCountsForTask(data.task, 1);

        const createSnapshot = {
          title: data.task.title,
          list_id: data.task.list_id || cfg.tasksListId,
          is_completed: false,
          is_important: !!data.task.is_important,
          in_my_day: !!data.task.in_my_day,
        };
        let restoredId = String(data.task.id);
        pushHistory({
          type: 'create',
          undo: () =>
            deleteTaskById(restoredId, createSnapshot).then(() => {
              restoredId = null;
            }),
          redo: () =>
            restoreDeletedTask(createSnapshot).then((task) => {
              if (task) restoredId = String(task.id);
            }),
        });
      });
    });
  }

  document.getElementById('btnUndo')?.addEventListener('click', runUndo);
  document.getElementById('btnRedo')?.addEventListener('click', runRedo);

  const btnDeleteList = document.getElementById('btnDeleteList');
  if (btnDeleteList) {
    btnDeleteList.addEventListener('click', () => {
      const listId = btnDeleteList.dataset.listId;
      const listTitle = btnDeleteList.dataset.listTitle || 'this list';
      const run = async () => {
        const ok = await AppModal.confirm({
          title: 'Delete list',
          message: `Delete "${listTitle}"? All tasks in this list will be permanently removed.`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          danger: true,
        });
        if (!ok) return;

        post(cfg.urls.listDelete(listId), {}).then((data) => {
          if (data.error) {
            AppModal.alert({ title: 'Error', message: data.error });
            return;
          }
          if (window.routerNavigate) window.routerNavigate('/todos/');
          else window.location.href = '/todos/';
        });
      };
      run();
    });
  }

  const btnNewList = document.getElementById('btnNewList');
  if (btnNewList) {
    btnNewList.addEventListener('click', async () => {
      const title = await AppModal.prompt({
        title: 'New list',
        message: 'Enter a name for your list:',
        placeholder: 'List name',
        defaultValue: 'New list',
        confirmText: 'Create',
        cancelText: 'Cancel',
      });
      if (!title) return;
      post(cfg.urls.listCreate, { title }).then((data) => {
        const ul = document.getElementById('todoLists');
        const li = document.createElement('li');
        const lst = data.list;
        li.innerHTML = `
          <a href="?list=${lst.id}" class="todo-list-item" data-list-id="${lst.id}" style="--list-color: ${lst.color}">
            <span class="list-dot"></span>
            <span class="list-title">${escapeHtml(lst.title)}</span>
          </a>
        `;
        ul.appendChild(li);
        if (window.routerNavigate) window.routerNavigate(`/todos/?list=${lst.id}`);
        else window.location.href = `?list=${lst.id}`;
      });
    });
  }

  bindTaskActions(document.getElementById('activeTasks'));
  bindTaskActions(document.getElementById('completedTasks'));
  initSearch();
  updateCompletedCount();
  updateUndoRedoButtons();
  formatDate();
})();
