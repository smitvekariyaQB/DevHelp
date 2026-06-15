(function () {
  const DISMISS_MS = 5000;
  const FADE_MS = 300;

  function dismissToast(toast) {
    if (!toast || toast.dataset.dismissing === '1') return;
    toast.dataset.dismissing = '1';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(12px)';
    window.setTimeout(function () {
      const stack = toast.closest('.toast-stack');
      toast.remove();
      if (stack && !stack.querySelector('.toast')) {
        stack.remove();
      }
    }, FADE_MS);
  }

  function ensureToastCloseButton(toast) {
    if (toast.querySelector('.toast-close')) return;

    if (!toast.querySelector('.toast-message')) {
      const message = document.createElement('span');
      message.className = 'toast-message';
      message.textContent = toast.textContent.trim();
      toast.textContent = '';
      toast.appendChild(message);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.innerHTML = '&times;';
    toast.appendChild(closeBtn);
  }

  function scheduleToastDismiss(toast) {
    if (!toast || toast.dataset.dismissScheduled === '1') return;
    toast.dataset.dismissScheduled = '1';

    ensureToastCloseButton(toast);

    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        dismissToast(toast);
      });
    }

    window.setTimeout(function () {
      dismissToast(toast);
    }, DISMISS_MS);
  }

  function initToastAutoDismiss(root) {
    const scope = root || document;
    scope.querySelectorAll('.toast-stack .toast').forEach(scheduleToastDismiss);
  }

  window.initToastAutoDismiss = initToastAutoDismiss;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initToastAutoDismiss();
    });
  } else {
    initToastAutoDismiss();
  }
})();
