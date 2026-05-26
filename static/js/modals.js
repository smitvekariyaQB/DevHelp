(function () {
  const modal = document.getElementById('appModal');
  if (!modal) return;

  const backdrop = modal.querySelector('[data-modal-close]');
  const titleEl = document.getElementById('appModalTitle');
  const messageEl = document.getElementById('appModalMessage');
  const inputEl = document.getElementById('appModalInput');
  const cancelBtn = document.getElementById('appModalCancel');
  const confirmBtn = document.getElementById('appModalConfirm');

  let resolver = null;
  let mode = 'confirm';

  function hideInput() {
    inputEl.classList.remove('is-visible');
    inputEl.value = '';
    inputEl.setAttribute('hidden', '');
  }

  function showInput(options) {
    inputEl.removeAttribute('hidden');
    inputEl.classList.add('is-visible');
    inputEl.value = options.defaultValue || '';
    inputEl.placeholder = options.placeholder || '';
  }

  function close(result) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    hideInput();
    confirmBtn.classList.remove('btn-danger');
    if (resolver) {
      const fn = resolver;
      resolver = null;
      fn(result);
    }
  }

  function open(options) {
    mode = options.mode || 'confirm';
    titleEl.textContent = options.title || '';
    messageEl.textContent = options.message || '';
    messageEl.hidden = !options.message;

    cancelBtn.textContent = options.cancelText || 'Cancel';
    confirmBtn.textContent = options.confirmText || 'OK';
    confirmBtn.classList.toggle('btn-danger', !!options.danger);

    if (mode === 'prompt') {
      showInput(options);
    } else {
      hideInput();
    }

    if (mode === 'alert') {
      cancelBtn.hidden = true;
    } else {
      cancelBtn.hidden = false;
    }

    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');

    if (mode === 'prompt') {
      setTimeout(() => inputEl.focus(), 50);
    } else {
      confirmBtn.focus();
    }

    return new Promise((resolve) => {
      resolver = resolve;
    });
  }

  cancelBtn.addEventListener('click', () => {
    close(mode === 'prompt' ? null : false);
  });

  confirmBtn.addEventListener('click', () => {
    if (mode === 'prompt') {
      const val = inputEl.value.trim();
      close(val || null);
    } else {
      close(mode === 'alert' ? true : true);
    }
  });

  backdrop.addEventListener('click', () => {
    close(mode === 'prompt' ? null : false);
  });

  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') {
      close(mode === 'prompt' ? null : false);
    }
    if (e.key === 'Enter' && mode === 'prompt' && document.activeElement === inputEl) {
      e.preventDefault();
      confirmBtn.click();
    }
  });

  window.AppModal = {
    confirm(opts) {
      return open({ ...opts, mode: 'confirm' }).then((r) => !!r);
    },
    prompt(opts) {
      return open({ ...opts, mode: 'prompt' });
    },
    alert(opts) {
      return open({ ...opts, mode: 'alert', cancelText: '' });
    },
  };
})();
