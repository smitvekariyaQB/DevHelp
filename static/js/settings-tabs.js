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

  const HASH_TO_TAB = {
    password: 'password-tab',
    preferences: 'preferences-tab',
  };

  const TAB_TO_HASH = {
    'profile-tab': '',
    'password-tab': 'password',
    'preferences-tab': 'preferences',
  };

  function getRoot(root) {
    return root && root.querySelector ? root : document;
  }

  function activateSettingsTab(targetId, root) {
    const scope = getRoot(root);
    if (!SETTINGS_TABS[targetId]) return false;
    if (!scope.querySelector('.settings-tab-content')) return false;

    scope.querySelectorAll('.settings-nav-item[data-settings-tab]').forEach((link) => {
      link.classList.toggle('active', link.dataset.settingsTab === targetId);
    });
    scope.querySelectorAll('.settings-tab-content').forEach((panel) => {
      panel.classList.toggle('hidden', panel.id !== targetId);
    });

    const meta = SETTINGS_TABS[targetId];
    const titleEl = scope.querySelector('#settings-page-title');
    const subEl = scope.querySelector('#settings-page-subtitle');
    if (titleEl && subEl) {
      titleEl.textContent = meta.title;
      subEl.textContent = meta.subtitle;
    }

    const app = scope.querySelector('.settings-app')
      || (scope.classList?.contains('settings-app') ? scope : null)
      || scope.closest?.('.settings-app');
    if (app) app.setAttribute('data-tabs-ready', '');

    if (targetId === 'preferences-tab') {
      window.AppPreferences?.initSettingsPage();
    }

    return true;
  }

  function tabIdFromHash(hash) {
    const key = String(hash || '').replace(/^#/, '');
    return HASH_TO_TAB[key] || 'profile-tab';
  }

  function activateFromHash(hash, root) {
    return activateSettingsTab(tabIdFromHash(hash), root);
  }

  window.SettingsTabs = {
    SETTINGS_TABS,
    TAB_TO_HASH,
    activateSettingsTab,
    activateFromHash,
    tabIdFromHash,
  };
})();
