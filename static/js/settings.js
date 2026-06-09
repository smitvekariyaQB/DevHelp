(function () {
  'use strict';

  const settingsApp = document.querySelector('.settings-app');
  if (!settingsApp) return;

  const hasTabPanels = Boolean(document.querySelector('.settings-tab-content'));
  if (!hasTabPanels) return;

  const { activateSettingsTab, activateFromHash, TAB_TO_HASH } = window.SettingsTabs;

  function initFromHash() {
    activateFromHash(window.location.hash, document);
  }

  settingsApp.addEventListener('click', (e) => {
    const link = e.target.closest('.settings-nav-item[data-settings-tab]');
    if (!link || !settingsApp.contains(link)) return;

    const targetId = link.dataset.settingsTab;
    if (!targetId) return;

    e.preventDefault();
    e.stopPropagation();

    activateSettingsTab(targetId, document);

    const hash = TAB_TO_HASH[targetId];
    const profileLink = settingsApp.querySelector('[data-settings-tab="profile-tab"]');
    const profileUrl = new URL(profileLink?.href || window.location.href, window.location.origin);
    profileUrl.hash = hash ? `#${hash}` : '';
    history.pushState({ routerUrl: profileUrl.href }, '', profileUrl.href);
  });

  initFromHash();

  if (window.__settingsHashChange) {
    window.removeEventListener('hashchange', window.__settingsHashChange);
  }
  window.__settingsHashChange = initFromHash;
  window.addEventListener('hashchange', window.__settingsHashChange);
})();
