(function () {
  'use strict';

  const SETTINGS_TABS = {
    'profile-tab': {
      title: 'Profile',
      subtitle: 'Manage your account details',
    },
    'password-tab': {
      title: 'Change password',
      subtitle: 'Update your security credentials',
    },
    'preferences-tab': {
      title: 'Preferences',
      subtitle: 'Customize appearance and layout defaults',
    },
  };

  function activateSettingsTab(targetId) {
    document.querySelectorAll('.settings-nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tabTarget === targetId);
    });
    document.querySelectorAll('.settings-tab-content').forEach((panel) => {
      panel.classList.toggle('hidden', panel.id !== targetId);
    });
    const meta = SETTINGS_TABS[targetId];
    const titleEl = document.getElementById('settings-page-title');
    const subEl = document.getElementById('settings-page-subtitle');
    if (meta && titleEl && subEl) {
      titleEl.textContent = meta.title;
      subEl.textContent = meta.subtitle;
    }
    if (targetId === 'preferences-tab') {
      window.AppPreferences?.initSettingsPage();
    }
  }

  const settingsApp = document.querySelector('.settings-app');
  if (!settingsApp) return;

  settingsApp.addEventListener('click', (e) => {
    const btn = e.target.closest('.settings-nav-item');
    if (!btn || !settingsApp.contains(btn)) return;
    activateSettingsTab(btn.dataset.tabTarget);
  });

  const hashTab = {
    password: 'password-tab',
    preferences: 'preferences-tab',
  }[window.location.hash.replace('#', '')];
  if (hashTab) activateSettingsTab(hashTab);

  window.AppPreferences?.initSettingsPage();
})();
