const groupsEl = document.getElementById("groups");
const hideDoneEl = document.getElementById("hideDone");

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
  const hideDone = hideDoneEl.checked;
  const filtered = hideDone ? notes.filter((n) => n.status !== "done") : notes;

  if (!filtered.length) {
    groupsEl.innerHTML = '<div class="empty">No feedback notes yet.</div>';
    return;
  }

  const byUrl = new Map();
  for (const note of filtered) {
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
        ? `<img src="${note.screenshot}" style="max-width:280px;border-radius:4px;display:block;margin-top:4px;" />`
        : "";
      div.innerHTML = `
        <span class="badge ${note.category}">${note.category}</span>
        <span class="noteMeta">${escapeHtml(note.author || "Anonymous")} &middot; ${new Date(note.created_at).toLocaleString()}</span>
        <span class="noteText">${note.text ? escapeHtml(note.text) : '<em style="color:#999;">(no note)</em>'}</span>
        ${screenshotHtml}
        <div class="noteActions">
          <button data-action="toggle" data-id="${note.id}" data-status="${note.status}">${note.status === "done" ? "Reopen" : "Mark done"}</button>
          <button data-action="delete" data-id="${note.id}">Delete</button>
        </div>
      `;
      group.appendChild(div);
    }
    groupsEl.appendChild(group);
  }
}

groupsEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === "toggle") {
    const newStatus = btn.dataset.status === "done" ? "open" : "done";
    await sendMessage({ type: "SPF_UPDATE_STATUS", id, status: newStatus });
    load();
  }

  if (btn.dataset.action === "delete") {
    await sendMessage({ type: "SPF_DELETE_NOTE", id });
    load();
  }
});

document.getElementById("refresh").addEventListener("click", load);
hideDoneEl.addEventListener("change", load);

load();
