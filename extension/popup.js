const issueListEl = document.getElementById("issueList");
const statusEl = document.getElementById("status");

let activeTabId = null;

const TYPE_LABELS = {
  "js-error": "JS Error",
  "unhandled-rejection": "Promise",
  "console-error": "Console",
  "http-error": "HTTP",
  "network-error": "Network",
  "resource-error": "Resource",
  "broken-link": "Link",
};

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderIssues(issues) {
  issueListEl.innerHTML = "";
  if (!issues.length) {
    issueListEl.innerHTML = '<li class="empty">No problems detected yet.</li>';
    return;
  }
  const sorted = [...issues].sort((a, b) => b.timestamp - a.timestamp);
  for (const issue of sorted) {
    const li = document.createElement("li");
    const label = TYPE_LABELS[issue.type] || issue.type;
    li.innerHTML = `
      <span class="badge ${issue.type}">${label}</span>
      <span class="detail">${escapeHtml(issue.detail || "")}</span>
      <span class="url">${escapeHtml(issue.url || "")}</span>
    `;
    issueListEl.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function loadIssues() {
  if (activeTabId == null) return;
  const response = await chrome.runtime.sendMessage({ type: "SPF_GET_ISSUES", tabId: activeTabId });
  renderIssues(response?.issues || []);
}

document.getElementById("clear").addEventListener("click", async () => {
  if (activeTabId == null) return;
  await chrome.runtime.sendMessage({ type: "SPF_CLEAR", tabId: activeTabId });
  loadIssues();
});

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const previewEl = document.getElementById("preview");

function showImageFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    statusEl.textContent = "That's not an image file.";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    previewEl.src = reader.result;
    previewEl.hidden = false;
    statusEl.textContent = `Loaded ${file.name}`;
  };
  reader.readAsDataURL(file);
}

dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) showImageFile(fileInput.files[0]);
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) showImageFile(file);
});

document.getElementById("scanLinks").addEventListener("click", async () => {
  if (activeTabId == null) return;
  statusEl.textContent = "Scanning links on this page...";
  const response = await chrome.runtime.sendMessage({ type: "SPF_SCAN_LINKS", tabId: activeTabId });
  const count = response?.results?.length ?? 0;
  statusEl.textContent = count ? `Found ${count} broken link(s).` : "No broken links found.";
  loadIssues();
});

(async function init() {
  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;
  await loadIssues();
})();
