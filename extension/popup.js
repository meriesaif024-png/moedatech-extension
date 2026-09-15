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
    if (note.status === "done") li.classList.add("done");
    const screenshotHtml = note.screenshot
      ? `<img src="${note.screenshot}" data-action="open-image" style="max-width:100%;border-radius:4px;margin-top:4px;cursor:pointer;" title="Click to view full size" />`
      : "";
    const completedHtml =
      note.status === "done"
        ? `<span class="noteMeta">&#10003; Completed by <span style="color:#188038;font-size:15px;font-weight:700;">${escapeHtml(note.completed_by || "Anonymous")}</span> &middot; ${new Date(note.completed_at).toLocaleString()}</span>`
        : "";
    li.innerHTML = `
      <span class="badge ${note.category}">${note.category}</span>
      <span class="noteText">${note.text ? escapeHtml(note.text) : '<em style="color:#999;">(no note)</em>'}</span>
      ${screenshotHtml}
      <span class="noteMeta">${escapeHtml(note.author || "Anonymous")} &middot; ${new Date(note.created_at).toLocaleString()}</span>
      ${completedHtml}
      <div class="noteActions">
        <button data-action="toggle" data-id="${note.id}" data-status="${note.status}">${note.status === "done" ? "Reopen" : "Mark complete"}</button>
        <button data-action="delete" data-id="${note.id}">Delete</button>
      </div>
    `;
    noteListEl.appendChild(li);
  }
}

async function markComplete(id) {
  const { spfCompleterName } = await chrome.storage.local.get(["spfCompleterName"]);
  const name = window.prompt("Your name (so the team knows who resolved this):", spfCompleterName || "");
  if (name === null) return false;
  const trimmed = name.trim() || "Anonymous";
  await chrome.storage.local.set({ spfCompleterName: trimmed });
  await sendMessage({ type: "SPF_UPDATE_STATUS", id, status: "done", completedBy: trimmed });
  return true;
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

function openLightbox(src) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;pointer-events:none;";
  overlay.innerHTML = `<img src="${src}" style="max-width:94%;max-height:94%;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,0.5);cursor:zoom-out;pointer-events:auto;" />`;
  overlay.querySelector("img").addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

noteListEl.addEventListener("click", async (e) => {
  if (e.target.dataset.action === "open-image") {
    openLightbox(e.target.src);
    return;
  }

  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === "toggle") {
    if (btn.dataset.status === "done") {
      await sendMessage({ type: "SPF_UPDATE_STATUS", id, status: "open" });
      loadNotes();
    } else {
      if (await markComplete(id)) loadNotes();
    }
  }

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
