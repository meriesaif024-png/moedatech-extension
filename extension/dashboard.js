const groupsEl = document.getElementById("groups");

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

async function load() {
  const response = await sendMessage({ type: "SPF_GET_ALL_NOTES" });
  if (response?.error) {
    groupsEl.innerHTML = `<div class="empty">Error loading notes: ${escapeHtml(response.error)}</div>`;
    return;
  }
  render(response?.notes || []);
}

function render(notes) {
  if (!notes.length) {
    groupsEl.innerHTML = '<div class="empty">No feedback notes yet.</div>';
    return;
  }

  const byUrl = new Map();
  for (const note of notes) {
    if (!byUrl.has(note.url)) byUrl.set(note.url, []);
    byUrl.get(note.url).push(note);
  }

  groupsEl.innerHTML = "";
  for (const [url, notes] of byUrl) {
    const group = document.createElement("div");
    group.className = "group";
    const title = notes[0].page_title || url;
    group.innerHTML = `<h2>${escapeHtml(title)} &mdash; <a href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</a></h2>`;

    for (const note of notes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))) {
      const div = document.createElement("div");
      div.className = "note" + (note.status === "done" ? " done" : "");
      const screenshotHtml = note.screenshot
        ? `<img src="${note.screenshot}" data-action="open-image" style="max-width:280px;border-radius:4px;display:block;margin-top:4px;cursor:pointer;" title="Click to view full size" />`
        : "";
      const completedHtml =
        note.status === "done"
          ? `<span class="noteMeta">&#10003; Completed by <span style="color:#188038;font-size:15px;font-weight:700;">${escapeHtml(note.completed_by || "Anonymous")}</span> &middot; ${new Date(note.completed_at).toLocaleString()}</span>`
          : "";
      div.innerHTML = `
        <span class="badge ${note.category}">${note.category}</span>
        <span class="noteMeta">${escapeHtml(note.author || "Anonymous")} &middot; ${new Date(note.created_at).toLocaleString()}</span>
        <span class="noteText">${note.text ? escapeHtml(note.text) : '<em style="color:#999;">(no note)</em>'}</span>
        ${screenshotHtml}
        ${completedHtml}
        <div class="noteActions">
          <button data-action="toggle" data-id="${note.id}" data-status="${note.status}">${note.status === "done" ? "Reopen" : "Mark complete"}</button>
          <button data-action="delete" data-id="${note.id}">Delete</button>
        </div>
      `;
      group.appendChild(div);
    }
    groupsEl.appendChild(group);
  }
}

function openLightbox(src) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;pointer-events:none;";
  overlay.innerHTML = `<img src="${src}" style="max-width:92vw;max-height:92vh;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,0.5);cursor:zoom-out;pointer-events:auto;" />`;
  overlay.querySelector("img").addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
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

groupsEl.addEventListener("click", async (e) => {
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
      load();
    } else {
      if (await markComplete(id)) load();
    }
  }

  if (btn.dataset.action === "delete") {
    await sendMessage({ type: "SPF_DELETE_NOTE", id });
    load();
  }
});

document.getElementById("refresh").addEventListener("click", load);

load();
