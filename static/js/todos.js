(function () {
  const cfg = window.TODO_CONFIG;
  if (!cfg) return;

  const csrf = cfg.csrfToken;

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

  function createTaskEl(task) {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.is_completed ? ' completed' : '');
    li.dataset.taskId = task.id;
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

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function removeEmptyState() {
    const empty = document.querySelector('#activeTasks .task-empty');
    if (empty) empty.remove();
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
          const task = data.task;
          item.classList.toggle('completed', task.is_completed);
          btn.classList.toggle('checked', task.is_completed);
          const activeList = document.getElementById('activeTasks');
          const completedList = document.getElementById('completedTasks');
          const section = document.getElementById('completedSection');

          if (task.is_completed) {
            item.querySelector('.task-star')?.remove();
            completedList.appendChild(item);
            section?.classList.remove('hidden');
            updateCompletedCount();
          } else {
            activeList.appendChild(item);
          }
        });
      }

      if (action === 'star') {
        const starred = btn.classList.toggle('starred');
        post(cfg.urls.taskUpdate(id), { is_important: starred });
      }

      if (action === 'delete') {
        post(cfg.urls.taskDelete(id), {}).then(() => {
          item.remove();
          updateCompletedCount();
        });
      }
    });
  }

  function updateCompletedCount() {
    const count = document.querySelectorAll('#completedTasks .task-item').length;
    const el = document.getElementById('completedCount');
    if (el) el.textContent = count;
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
        list.appendChild(createTaskEl(data.task));
        newInput.value = '';
      });
    });
  }

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
  formatDate();
})();
