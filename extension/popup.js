const noteListEl = document.getElementById("noteList");
const statusEl = document.getElementById("status");

let activeTabId = null;
let activeTabUrl = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function renderNotes(notes) {
  noteListEl.innerHTML = "";
  if (!notes.length) {
    noteListEl.innerHTML = '<li class="empty">No feedback notes on this page yet.</li>';
    return;
  }
  const sorted = [...notes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  for (const note of sorted) {
    const li = document.createElement("li");
    const screenshotHtml = note.screenshot
      ? `<img src="${note.screenshot}" data-action="open-image" style="max-width:100%;border-radius:4px;margin-top:4px;cursor:pointer;" title="Click to view full size" />`
      : "";
    li.innerHTML = `
      <span class="badge ${note.category}">${note.category}</span>
      <span class="noteText">${note.text ? escapeHtml(note.text) : '<em style="color:#999;">(no note)</em>'}</span>
      ${screenshotHtml}
      <span class="noteMeta">${escapeHtml(note.author || "Anonymous")} &middot; ${new Date(note.created_at).toLocaleString()}</span>
      <div class="noteActions">
        <button data-action="delete" data-id="${note.id}">Delete</button>
      </div>
    `;
    noteListEl.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

async function loadNotes() {
  if (!activeTabUrl) return;
  const response = await sendMessage({ type: "SPF_GET_NOTES", url: activeTabUrl });
  if (response?.error) {
    statusEl.textContent = `Error: ${response.error}`;
    return;
  }
  renderNotes(response?.notes || []);
}

noteListEl.addEventListener("click", async (e) => {
  if (e.target.dataset.action === "open-image") {
    chrome.tabs.create({ url: e.target.src });
    return;
  }

  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === "delete") {
    await sendMessage({ type: "SPF_DELETE_NOTE", id });
    loadNotes();
  }
});

document.getElementById("addNote").addEventListener("click", async () => {
  if (activeTabId == null) return;
  try {
    await chrome.tabs.sendMessage(activeTabId, { type: "SPF_START_ANNOTATE" });
    window.close();
  } catch (err) {
    statusEl.textContent = "Can't annotate this page - reload the page (F5) and try again.";
  }
});

document.getElementById("viewAll").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

(async function init() {
  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;
  activeTabUrl = tab?.url ?? null;
  await loadNotes();
})();
