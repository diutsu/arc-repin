const protectedTabIds = new Set();
const allowCloseOnce = new Set();
// tabId -> original pinned URL from the stored set
const tabOriginMap = new Map();
const pendingToasts = new Map();

async function tagTab(tabId, originUrl, showBadge = true) {
  protectedTabIds.add(tabId);
  tabOriginMap.set(tabId, originUrl);

  if (showBadge) {
    try {
      await chrome.action.setBadgeText({ tabId, text: "AP" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#3b82f6" });
    } catch (e) {
      console.warn("tagTab badge failed", e);
    }
  }
}

async function clearTag(tabId) {
  protectedTabIds.delete(tabId);
  tabOriginMap.delete(tabId);
  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
  } catch {
    // ignore
  }
}

// Init storage and context menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["storedTabs", "autoTrackPinned"], (data) => {
    const initial = {};
    if (!data.storedTabs) {
      initial.storedTabs = {};
    }
    if (typeof data.autoTrackPinned !== "boolean") {
      initial.autoTrackPinned = false;
    }
    if (Object.keys(initial).length > 0) {
      chrome.storage.sync.set(initial);
    }
  });

  // Context menu on the extension icon
  chrome.contextMenus.create({
    id: "apply-stored-pinned",
    title: "Restore pinned tabs from storage",
    contexts: ["action"]
  });

  // These are page context menus (right-click in the page)
  chrome.contextMenus.create({
    id: "allow-close-once",
    title: "Allow closing once",
    contexts: ["page"]
  });

  chrome.contextMenus.create({
    id: "reset-managed-tab",
    title: "Reset this tab to original URL",
    contexts: ["page"]
  });
});


// Clicking the action applies stored layout to the current window
chrome.action.onClicked.addListener(() => {
  applyStoredPinnedToCurrentWindow();
});

// New normal windows: create stored pinned tabs in order
chrome.windows.onCreated.addListener((window) => {
  if (window.type !== "normal") return;

  (async () => {
    const { storedTabs = {} } = await chrome.storage.sync.get("storedTabs");
    const sortedUrls = Object.keys(storedTabs).sort(
      (a, b) => storedTabs[a] - storedTabs[b]
    );

    let targetIndex = 0;
    for (const url of sortedUrls) {
      const isInternal = /^chrome(|-untrusted|-extension):\/\//i.test(url);
      if (isInternal) {
        continue;
      }

      const tab = await chrome.tabs.create({
        windowId: window.id,
        url,
        pinned: true,
        active: false,
        index: targetIndex
      });

      await tagTab(tab.id, url, true);
      targetIndex++;
    }
  })().catch((e) => console.error("windows.onCreated failed", e));
});

// Apply stored pinned set to current window
async function applyStoredPinnedToCurrentWindow() {
  try {
    const win = await chrome.windows.getLastFocused({
      windowTypes: ["normal"]
    });

    const { storedTabs = {} } = await chrome.storage.sync.get("storedTabs");
    const sortedUrls = Object.keys(storedTabs).sort(
      (a, b) => storedTabs[a] - storedTabs[b]
    );

    if (sortedUrls.length === 0) {
      console.warn("No stored pinned tabs to apply.");
      return;
    }

    let tabs = await chrome.tabs.query({ windowId: win.id });

    // Unpin any pinned tabs that are not part of the stored set
    const toUnpin = tabs.filter(
      (t) => t.pinned && !sortedUrls.includes(t.url)
    );
    await Promise.all(
      toUnpin.map((t) => chrome.tabs.update(t.id, { pinned: false }))
    );

    tabs = await chrome.tabs.query({ windowId: win.id });

    const findTabByUrl = (url) =>
      tabs.find((t) => t.url === url && t.windowId === win.id);

    let targetIndex = 0;

    for (const url of sortedUrls) {
      const isInternal = /^chrome(|-untrusted|-extension):\/\//i.test(url);
      if (isInternal) {
        console.warn("Skipping internal URL:", url);
        continue;
      }

      let tab = findTabByUrl(url);

      if (!tab) {
        tab = await chrome.tabs.create({
          windowId: win.id,
          url,
          pinned: true,
          active: false,
          index: targetIndex
        });
        await tagTab(tab.id, url, true);
      } else {
        if (!tab.pinned) {
          await chrome.tabs.update(tab.id, { pinned: true });
        }
        await chrome.tabs.move(tab.id, { index: targetIndex });
        await tagTab(tab.id, url, false);
      }

      tabs = await chrome.tabs.query({ windowId: win.id });
      targetIndex++;
    }

    // Unpin duplicate pinned tabs with same URL beyond the first
    tabs = await chrome.tabs.query({ windowId: win.id });
    const seen = new Set();
    const dupPinned = tabs
      .filter((t) => t.pinned)
      .filter((t) => {
        if (seen.has(t.url)) return true;
        seen.add(t.url);
        return false;
      });

    await Promise.all(
      dupPinned.map((t) => chrome.tabs.update(t.id, { pinned: false }))
    );

    console.log("Applied stored pinned tabs to current window.");
  } catch (e) {
    console.error("Failed to apply stored pinned tabs:", e);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "apply-stored-pinned") {
    applyStoredPinnedToCurrentWindow();
    return;
  }

  if (!tab || typeof tab.id !== "number") {
    return;
  }

  if (info.menuItemId === "allow-close-once") {
    allowCloseOnce.add(tab.id);
    clearTag(tab.id);
    return;
  }

  if (info.menuItemId === "reset-managed-tab") {
    const origin = tabOriginMap.get(tab.id);
    if (!origin) {
      return;
    }

    chrome.tabs.update(tab.id, { url: origin }).catch?.(e => {
      // ignore
    });
  }
});

// Keyboard command
chrome.commands.onCommand.addListener((command) => {
  if (command === "apply-stored-pinned-to-current-window") {
    applyStoredPinnedToCurrentWindow();
  }
});

// Auto restore protected tabs when closed, unless allowed once or window is closing
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  (async () => {
    if (removeInfo.isWindowClosing) return;

    // user explicitly requested "close only this time" or "close and remove"
    if (allowCloseOnce.has(tabId)) {
      allowCloseOnce.delete(tabId);
      protectedTabIds.delete(tabId);
      tabOriginMap.delete(tabId);
      return;
    }

    if (!protectedTabIds.has(tabId)) return;

    const originUrl = tabOriginMap.get(tabId);
    if (!originUrl) {
      protectedTabIds.delete(tabId);
      tabOriginMap.delete(tabId);
      return;
    }

    try {
      const { storedTabs = {} } = await chrome.storage.sync.get("storedTabs");
      const order = storedTabs[originUrl];
      const index = typeof order === "number" ? Math.max(0, order - 1) : 0;

      const newTab = await chrome.tabs.create({
        windowId: removeInfo.windowId,
        url: originUrl,
        pinned: true,
        active: true,
        index
      });

      await tagTab(newTab.id, originUrl, true);

      pendingToasts.set(newTab.id, originUrl);
    } catch (e) {
      console.warn("Auto recreate failed", e);
    } finally {
      protectedTabIds.delete(tabId);
      tabOriginMap.delete(tabId);
    }
  })().catch(() => {});
});


// Carry protection across tab replacement events
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  (async () => {
    if (!protectedTabIds.has(removedTabId)) return;

    const originUrl = tabOriginMap.get(removedTabId);
    protectedTabIds.delete(removedTabId);
    tabOriginMap.delete(removedTabId);

    if (originUrl) {
      await tagTab(addedTabId, originUrl, true);
    }
  })().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // only care when the load is complete and we have a pending toast
  if (changeInfo.status !== "complete") return;
  if (!pendingToasts.has(tabId)) return;

  const originUrl = pendingToasts.get(tabId);
  pendingToasts.delete(tabId);

  const url = tab.url || originUrl;

  // only try on normal web/file pages
  const canToast =
    /^https?:\/\//.test(url) ||
    /^file:\/\//.test(url);

  if (!canToast) {
    return;
  }

  chrome.tabs
    .sendMessage(tabId, {
      type: "arc-repin-managed-tab-reopened",
      originUrl
    })
    .catch(() => {
      // content script might still not be there (edge cases); just ignore
    });
});


// Track pin changes for autoTrackPinned and clear protection on unpin
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  (async () => {
    if (!Object.prototype.hasOwnProperty.call(changeInfo, "pinned")) {
      return;
    }

    const { autoTrackPinned = false, storedTabs = {} } =
      await chrome.storage.sync.get(["autoTrackPinned", "storedTabs"]);

    if (autoTrackPinned) {
      if (changeInfo.pinned) {
        if (!(tab.url in storedTabs)) {
          const orders = Object.values(storedTabs);
          const maxOrder = orders.length ? Math.max(...orders) : 0;
          storedTabs[tab.url] = maxOrder + 1;
          await chrome.storage.sync.set({ storedTabs });
        }
      } else {
        if (tab.url in storedTabs) {
          delete storedTabs[tab.url];
          await chrome.storage.sync.set({ storedTabs });
        }
      }
    }

    if (changeInfo.pinned === false) {
      await clearTag(tabId);
    }
  })().catch((e) => console.error("tabs.onUpdated error", e));
});

// Sync manual drag reorder of pinned tabs into stored order (when autoTrackPinned is on)
chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  (async () => {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.pinned) return;

    const { autoTrackPinned = false, storedTabs = {} } =
      await chrome.storage.sync.get(["autoTrackPinned", "storedTabs"]);
    if (!autoTrackPinned) return;

    const storedUrls = Object.keys(storedTabs).sort(
      (a, b) => storedTabs[a] - storedTabs[b]
    );

    let tabs = await chrome.tabs.query({
      windowId: moveInfo.windowId,
      pinned: true
    });
    tabs.sort((a, b) => a.index - b.index);

    const windowUrls = [];
    const seen = new Set();
    for (const t of tabs) {
      if (!seen.has(t.url)) {
        seen.add(t.url);
        windowUrls.push(t.url);
      }
    }

    const remaining = storedUrls.filter((url) => !seen.has(url));
    const newUrlList = [...windowUrls, ...remaining];

    const newstoredTabs = {};
    newUrlList.forEach((url, idx) => {
      newstoredTabs[url] = idx + 1;
    });

    await chrome.storage.sync.set({ storedTabs: newstoredTabs });
  })().catch((e) => console.error("tabs.onMoved error", e));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return;

  if (message.type === "arc-repin-close-once") {
    allowCloseOnce.add(tabId);
    clearTag(tabId);
    chrome.tabs.remove(tabId);
    return;
  }

  if (message.type === "arc-repin-close-and-remove") {
    const originUrl = tabOriginMap.get(tabId);
    allowCloseOnce.add(tabId);
    clearTag(tabId);

    if (originUrl) {
      chrome.storage.sync.get("storedTabs", (stored) => {
        const storedTabs = stored.storedTabs || {};
        if (originUrl in storedTabs) {
          delete storedTabs[originUrl];

          const sortedUrls = Object.keys(storedTabs).sort(
            (a, b) => storedTabs[a] - storedTabs[b]
          );
          const normalized = {};
          sortedUrls.forEach((u, idx) => {
            normalized[u] = idx + 1;
          });

          chrome.storage.sync.set({ storedTabs: normalized });
        }
      });
    }

    chrome.tabs.remove(tabId);
  }
});

