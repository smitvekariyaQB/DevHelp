(function () {
  function initEditorSheetTabs(options) {
    const sheetTabsTrack = document.getElementById('tableSheetTabsTrack');
    const sheetTabsList = document.getElementById('tableSheetTabsList');
    const btnSheetTabsLeft = document.getElementById('btnSheetTabsLeft');
    const btnSheetTabsRight = document.getElementById('btnSheetTabsRight');
    if (!sheetTabsTrack || !sheetTabsList) return null;

    const onBeforeNavigate = options?.onBeforeNavigate;

    function updateSheetTabScrollButtons() {
      if (!btnSheetTabsLeft || !btnSheetTabsRight) return;
      const maxScroll = Math.max(0, sheetTabsTrack.scrollWidth - sheetTabsTrack.clientWidth);
      btnSheetTabsLeft.disabled = sheetTabsTrack.scrollLeft <= 1;
      btnSheetTabsRight.disabled = sheetTabsTrack.scrollLeft >= maxScroll - 1;
    }

    function scrollSheetTabs(delta) {
      sheetTabsTrack.scrollBy({ left: delta, behavior: 'smooth' });
    }

    async function navigateToSheet(url) {
      if (!url) return;
      if (onBeforeNavigate) await onBeforeNavigate();
      if (window.routerNavigate) window.routerNavigate(url);
      else window.location.href = url;
    }

    function onTabClick(e) {
      const tab = e.target.closest('.table-sheet-tab');
      if (!tab || tab.classList.contains('is-active')) return;
      e.preventDefault();
      navigateToSheet(tab.getAttribute('href'));
    }

    function onScroll() {
      updateSheetTabScrollButtons();
    }

    const onResize = () => updateSheetTabScrollButtons();

    function onScrollLeft() {
      scrollSheetTabs(-180);
    }

    function onScrollRight() {
      scrollSheetTabs(180);
    }

    sheetTabsList.addEventListener('click', onTabClick);
    btnSheetTabsLeft?.addEventListener('click', onScrollLeft);
    btnSheetTabsRight?.addEventListener('click', onScrollRight);
    sheetTabsTrack.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    const activeSheetTab = sheetTabsList.querySelector('.table-sheet-tab.is-active');
    if (activeSheetTab) {
      requestAnimationFrame(() => {
        const tabLeft = activeSheetTab.offsetLeft;
        const tabRight = tabLeft + activeSheetTab.offsetWidth;
        const viewLeft = sheetTabsTrack.scrollLeft;
        const viewRight = viewLeft + sheetTabsTrack.clientWidth;
        if (tabLeft < viewLeft) {
          sheetTabsTrack.scrollLeft = tabLeft;
        } else if (tabRight > viewRight) {
          sheetTabsTrack.scrollLeft = tabRight - sheetTabsTrack.clientWidth;
        }
        updateSheetTabScrollButtons();
      });
    } else {
      updateSheetTabScrollButtons();
    }

    return () => {
      sheetTabsList.removeEventListener('click', onTabClick);
      btnSheetTabsLeft?.removeEventListener('click', onScrollLeft);
      btnSheetTabsRight?.removeEventListener('click', onScrollRight);
      sheetTabsTrack.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }

  window.initEditorSheetTabs = initEditorSheetTabs;
})();
