/**
 * ArcBook Client-Side Router (PJAX Pattern)
 *
 * Intercepts internal navigation clicks and swaps only the <main> content
 * instead of doing full-page reloads. Uses the Fetch API + History API
 * (the same pattern used by GitHub's pjax / Hotwire Turbo Drive).
 *
 * How it works:
 *   1. Intercepts clicks on internal links marked with [data-router-link]
 *      (sidebar nav items) and all internal links inside #main-content.
 *   2. Fetches the target URL, parses the response HTML.
 *   3. Swaps the <main id="main-content"> innerHTML.
 *   4. Updates <title>, sidebar active states, and head assets (CSS).
 *   5. Executes page-specific scripts from the new page.
 *   6. Pushes the new URL to browser history via pushState.
 *   7. Handles browser back/forward via the popstate event.
 */
(function () {
  'use strict';

  const MAIN_SELECTOR = '#main-content';
  const SIDEBAR_NAV_SELECTOR = '.sidebar-nav';
  const NAV_LINK_SELECTOR = '.nav-item';
  const PAGE_SCRIPTS_SELECTOR = '#page-scripts';

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Check if a URL is navigable by the router (same-origin, not a hash). */
  function isRoutable(url) {
    try {
      const u = new URL(url, location.origin);
      if (u.origin !== location.origin) return false;
      if (u.pathname === location.pathname && u.hash) return false;
      // Skip auth & admin pages
      if (u.pathname.startsWith('/admin/')) return false;
      if (u.pathname.startsWith('/accounts/log')) return false;
      if (u.pathname.startsWith('/accounts/register')) return false;
      if (u.pathname.startsWith('/accounts/verify-email')) return false;
      if (u.pathname.startsWith('/accounts/password-reset')) return false;
      if (u.pathname.startsWith('/accounts/reset/')) return false;
      return true;
    } catch {
      return false;
    }
  }

  /** Return true if the click should be handled normally (not by the router). */
  function shouldIgnoreClick(e) {
    return (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    );
  }

  /**
   * Parse an HTML string and return a temporary DOM document.
   * @param {string} html
   * @returns {Document}
   */
  function parseHTML(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  // ── Script Execution ────────────────────────────────────────────────

  /** Set of base script sources that should never be re-executed. */
  const BASE_SCRIPTS = new Set();

  /** Populate BASE_SCRIPTS with persistent app scripts only (not page-specific). */
  function captureBaseScripts() {
    document.querySelectorAll('script[src]').forEach((s) => {
      if (s.closest('#page-scripts')) return;
      if (s.closest(MAIN_SELECTOR)) return;
      BASE_SCRIPTS.add(s.getAttribute('src'));
    });
  }

  /**
   * Cleanup registry — page scripts can register teardown callbacks via
   * `window.__routerCleanup.push(fn)`. The router calls these before
   * swapping content.
   */
  window.__routerCleanup = [];

  function runCleanup() {
    while (window.__routerCleanup.length) {
      try {
        window.__routerCleanup.pop()();
      } catch (err) {
        console.warn('[Router] cleanup error:', err);
      }
    }
  }

  /**
   * Clone script elements from a parsed DOM fragment so the browser
   * actually executes them (innerHTML-inserted scripts are inert).
   * Handles both inline and external scripts. External scripts are
   * loaded sequentially to preserve dependency order.
   */
  async function executeScripts(container) {
    const scripts = container.querySelectorAll('script');
    for (const orig of scripts) {
      const src = orig.getAttribute('src');
      // Skip base scripts (modals.js, router.js, etc.)
      if (src && BASE_SCRIPTS.has(src)) continue;

      await new Promise((resolve) => {
        const el = document.createElement('script');
        // Copy all attributes
        for (const attr of orig.attributes) {
          el.setAttribute(attr.name, attr.value);
        }
        if (!src) {
          // Inline script — execute immediately
          el.textContent = orig.textContent;
          document.body.appendChild(el);
          resolve();
        } else {
          // External script — wait for load
          el.onload = resolve;
          el.onerror = resolve;
          document.body.appendChild(el);
        }
      });
    }
  }

  // ── Head Management (CSS) ───────────────────────────────────────────

  /** Track dynamically-added <link> tags so we can remove them on navigate. */
  let dynamicLinks = [];

  /**
   * Sync <head> assets: add new page-specific <link> stylesheets and
   * remove previously-added ones that are no longer needed.
   */
  function syncHeadLinks(newDoc) {
    const permanentHrefs = new Set();
    document.querySelectorAll('head link[rel="stylesheet"]:not([data-dynamic])').forEach((l) => {
      permanentHrefs.add(l.getAttribute('href'));
    });

    const newPageLinks = [];
    newDoc.querySelectorAll('head link[rel="stylesheet"]').forEach((l) => {
      const href = l.getAttribute('href');
      if (!permanentHrefs.has(href)) newPageLinks.push(l);
    });

    const pendingHrefs = new Set(newPageLinks.map((l) => l.getAttribute('href')));

    // Remove old dynamic links that are no longer needed
    dynamicLinks = dynamicLinks.filter((link) => {
      const href = link.getAttribute('href');
      if (pendingHrefs.has(href)) {
        pendingHrefs.delete(href);
        return true;
      }
      link.remove();
      return false;
    });

    // Add new dynamic links (preserve id and other attributes from the source page)
    newPageLinks.forEach((sourceLink) => {
      const href = sourceLink.getAttribute('href');
      if (!pendingHrefs.has(href)) return;

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-dynamic', '');
      const id = sourceLink.getAttribute('id');
      if (id) link.id = id;
      document.head.appendChild(link);
      dynamicLinks.push(link);
    });
  }

  // ── Sidebar Active State ───────────────────────────────────────────

  function updateSidebarActive(newDoc) {
    const nav = document.querySelector(SIDEBAR_NAV_SELECTOR);
    if (!nav) return;

    // Copy active classes from the new document's sidebar nav
    const newNav = newDoc.querySelector(SIDEBAR_NAV_SELECTOR);
    if (!newNav) return;

    nav.querySelectorAll(NAV_LINK_SELECTOR).forEach((link) => {
      link.classList.remove('active');
    });

    newNav.querySelectorAll(`${NAV_LINK_SELECTOR}.active`).forEach((newLink) => {
      const href = newLink.getAttribute('href');
      const match = nav.querySelector(`${NAV_LINK_SELECTOR}[href="${href}"]`);
      if (match) match.classList.add('active');
    });

    // Also update profile/user panel active states
    const oldProfileLink = document.querySelector('.user-panel-profile');
    const newProfileLink = newDoc.querySelector('.user-panel-profile');
    if (oldProfileLink && newProfileLink) {
      oldProfileLink.classList.toggle('active', newProfileLink.classList.contains('active'));
    }

    const oldProfileBtn = document.querySelector('.user-action-btn:not(.user-action-signout)');
    const newProfileBtn = newDoc.querySelector('.user-action-btn:not(.user-action-signout)');
    if (oldProfileBtn && newProfileBtn) {
      oldProfileBtn.classList.toggle('active', newProfileBtn.classList.contains('active'));
    }
  }

  // ── Toast Messages ─────────────────────────────────────────────────

  function showToasts(newDoc) {
    // Remove old toasts
    document.querySelectorAll('.toast-stack').forEach((el) => el.remove());
    // Insert new toasts from the response (if any)
    const newToasts = newDoc.querySelector('.toast-stack');
    if (newToasts) {
      document.body.insertAdjacentElement('afterbegin', newToasts);
      window.initToastAutoDismiss?.(document);
    }
  }

  // ── Core Navigation ────────────────────────────────────────────────

  let currentAbortController = null;
  let isNavigating = false;

  /**
   * Navigate to a URL using the router (no full-page reload).
   * @param {string} url — The target URL.
   * @param {object} opts
   * @param {boolean} opts.pushState — Whether to push a history entry.
   */
  async function navigate(url, { pushState = true } = {}) {
    if (isNavigating) {
      // Abort previous in-flight navigation
      currentAbortController?.abort();
    }

    isNavigating = true;
    currentAbortController = new AbortController();
    const { signal } = currentAbortController;

    // Show subtle loading state
    const main = document.querySelector(MAIN_SELECTOR);
    if (main) main.style.opacity = '0.6';

    try {
      const res = await fetch(url, {
        signal,
        headers: { 'X-Requested-With': 'ArcBookRouter' },
      });

      if (!res.ok) {
        // Fall back to a normal navigation on error
        window.location.href = url;
        return;
      }

      const html = await res.text();
      const newDoc = parseHTML(html);

      const newMain = newDoc.querySelector(MAIN_SELECTOR);
      if (!newMain) {
        // Target page doesn't have our expected structure — fall back
        window.location.href = url;
        return;
      }

      // 1. Run cleanup callbacks from the previous page
      runCleanup();

      // 2. Remove old page-specific scripts (they'll be re-added)
      document.querySelectorAll('script[data-page-script]').forEach((s) => s.remove());

      // 3. Swap main content
      main.innerHTML = newMain.innerHTML;

      // 4. Update document title
      const newTitle = newDoc.querySelector('title');
      if (newTitle) document.title = newTitle.textContent;

      // 5. Sync CSS (add/remove dynamic stylesheets)
      syncHeadLinks(newDoc);

      // 6. Update sidebar active states
      updateSidebarActive(newDoc);

      // 7. Show any Django messages/toasts
      showToasts(newDoc);

      // 8. Update browser history before page scripts so hash-based inits work
      if (pushState) {
        history.pushState({ routerUrl: url }, '', url);
      }

      // 8b. Activate settings tab synchronously (avoids profile-tab flash on SPA nav)
      const targetHash = new URL(url, location.origin).hash;
      window.SettingsTabs?.activateFromHash(targetHash, main);

      // 9. Execute page-specific scripts
      // First execute any scripts directly in the main content area (like inline config scripts)
      await executeScripts(main);

      // Then execute scripts from the dedicated page scripts block
      const newPageScripts = newDoc.querySelector(PAGE_SCRIPTS_SELECTOR);
      if (newPageScripts) {
        await executeScripts(newPageScripts);
      }

      // Re-sync code syntax theme/highlight after SPA navigation (CSS may load async).
      if (document.getElementById('codeApp')) {
        window.AppPreferences?.syncHighlightTheme?.();
        requestAnimationFrame(() => {
          window.__codeEditorSyncHighlight?.();
        });
      }

      // 10. Scroll to top
      main.scrollTop = 0;

      // 11. Restore opacity
      main.style.opacity = '';
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[Router] navigation failed:', err);
      window.location.href = url;
    } finally {
      isNavigating = false;
    }
  }

  // ── Global Navigation Helper ───────────────────────────────────────

  /**
   * Expose a global function so page scripts can navigate via the router
   * instead of using `window.location.href = ...`.
   *
   * Usage: window.routerNavigate('/todos/') or window.routerNavigate('/notes/3/')
   */
  window.routerNavigate = function (url) {
    if (isRoutable(url)) {
      navigate(url);
    } else {
      window.location.href = url;
    }
  };

  // ── Event Listeners ────────────────────────────────────────────────

  /** Intercept clicks on internal links. */
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    if (shouldIgnoreClick(e)) return;

    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    // Only intercept links that are:
    // 1. Sidebar nav items (always)
    // 2. Links inside the main content area that are internal
    const isSidebarLink = link.closest(SIDEBAR_NAV_SELECTOR) || link.closest('.user-panel');
    const isMainLink = link.closest(MAIN_SELECTOR);

    if (!isSidebarLink && !isMainLink) return;

    const url = link.href;
    if (!isRoutable(url)) return;

    e.preventDefault();
    navigate(url);
  });

  /** Handle browser back/forward buttons. */
  window.addEventListener('popstate', (e) => {
    // When the user presses back/forward, re-navigate without pushing state
    navigate(location.href, { pushState: false });
  });

  // ── Initialisation ─────────────────────────────────────────────────

  // Capture base script sources so we never re-execute them
  captureBaseScripts();

  // Replace the initial history entry so popstate works correctly
  history.replaceState({ routerUrl: location.href }, '', location.href);

  console.log('[Router] ArcBook client-side router initialised.');
})();
