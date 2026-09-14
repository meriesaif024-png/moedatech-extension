const MAX_ISSUES_PER_TAB = 300;

const tabIssues = new Map();

function ensureTab(tabId) {
  if (!tabIssues.has(tabId)) tabIssues.set(tabId, []);
  return tabIssues.get(tabId);
}

function addIssue(tabId, issue) {
  if (tabId == null || tabId < 0) return;
  const list = ensureTab(tabId);
  list.push({ ...issue, timestamp: Date.now() });
  if (list.length > MAX_ISSUES_PER_TAB) list.shift();
  updateBadge(tabId);
}

function updateBadge(tabId) {
  const count = (tabIssues.get(tabId) || []).length;
  chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" });
}

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId < 0) return;
    addIssue(details.tabId, {
      type: "network-error",
      url: details.url,
      method: details.method,
      detail: details.error,
    });
  },
  { urls: ["https://ai.moedatech.net/*", "https://web-beta.moedatech.net/*"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (details.statusCode >= 400) {
      addIssue(details.tabId, {
        type: "http-error",
        url: details.url,
        method: details.method,
        detail: `HTTP ${details.statusCode}`,
      });
    }
  },
  { urls: ["https://ai.moedatech.net/*", "https://web-beta.moedatech.net/*"] }
);

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    tabIssues.set(details.tabId, []);
    updateBadge(details.tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabIssues.delete(tabId);
});

async function checkLink(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (res.status >= 400) {
      return { url, ok: false, detail: `HTTP ${res.status}` };
    }
    return { url, ok: true };
  } catch (err) {
    return { url, ok: false, detail: err.message || "request failed" };
  }
}

async function scanLinks(tabId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const targetTabId = tabId ?? tab?.id;
  if (targetTabId == null) return [];

  const linksResponse = await chrome.tabs.sendMessage(targetTabId, { type: "SPF_GET_LINKS" }).catch(() => null);
  const links = linksResponse?.links || [];

  const results = [];
  const concurrency = 6;
  let index = 0;
  async function worker() {
    while (index < links.length) {
      const current = links[index++];
      const result = await checkLink(current);
      if (!result.ok) results.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, links.length) }, worker));

  for (const broken of results) {
    addIssue(targetTabId, { type: "broken-link", url: broken.url, detail: broken.detail });
  }
  return results;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SPF_ISSUE") {
    const tabId = sender.tab?.id;
    addIssue(tabId, message.issue);
    return;
  }

  if (message.type === "SPF_GET_ISSUES") {
    sendResponse({ issues: tabIssues.get(message.tabId) || [] });
    return;
  }

  if (message.type === "SPF_CLEAR") {
    tabIssues.set(message.tabId, []);
    updateBadge(message.tabId);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "SPF_SCAN_LINKS") {
    scanLinks(message.tabId).then((results) => sendResponse({ results }));
    return true;
  }
});
