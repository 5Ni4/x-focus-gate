(() => {
  "use strict";

  const X_URL_PATTERNS = ["https://x.com/*", "https://twitter.com/*"];
  let lastFocusedWindowId = null;

  if (
    !chrome.windows?.onFocusChanged ||
    !chrome.windows?.getLastFocused ||
    !chrome.tabs?.query ||
    !chrome.tabs?.remove
  ) return;

  const focusReady = chrome.windows
    .getLastFocused({ populate: false })
    .then((window) => {
      lastFocusedWindowId = window?.id ?? null;
    })
    .catch(() => undefined);

  chrome.windows.onFocusChanged.addListener((windowId) => {
    void handleFocusChanged(windowId);
  });

  async function handleFocusChanged(windowId) {
    await focusReady;
    const previousWindowId = lastFocusedWindowId;

    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      lastFocusedWindowId = null;
      if (previousWindowId !== null) await closeXTabs(previousWindowId);
      return;
    }

    lastFocusedWindowId = windowId;
    if (previousWindowId !== null && previousWindowId !== windowId) {
      await closeXTabs(previousWindowId);
    }
  }

  async function closeXTabs(windowId) {
    try {
      const settings = await chrome.storage.local.get({ enabled: true });
      if (settings.enabled === false) return;

      const tabs = await chrome.tabs.query({ windowId, url: X_URL_PATTERNS });
      const tabIds = tabs
        .map((tab) => tab.id)
        .filter((tabId) => Number.isInteger(tabId));

      if (tabIds.length > 0) await chrome.tabs.remove(tabIds);
    } catch (_error) {
      // The window may have closed between the focus event and the query.
    }
  }
})();
