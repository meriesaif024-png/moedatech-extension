const groupsEl = document.getElementById("groups");
const personFilterEl = document.getElementById("personFilter");

let allNotes = [];

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
  allNotes = response?.notes || [];
  populatePersonFilter(allNotes);
  renderFiltered();
}

const ADD_PERSON_VALUE = "__add_person__";

function assigneeOptionsHtml(members, selected) {
  const options = ['<option value="">Unassigned</option>'];
  for (const m of members) {
    options.push(`<option value="${escapeHtml(m.name)}" ${m.name === selected ? "selected" : ""}>${escapeHtml(m.name)}</option>`);
  }
  options.push(`<option value="${ADD_PERSON_VALUE}">+ Add new person&hellip;</option>`);
  return options.join("");
}

async function wireAssigneeSelect(select, currentValue, onAssign) {
  const membersResponse = await sendMessage({ type: "SPF_GET_TEAM_MEMBERS" });
  const members = membersResponse?.members || [];
  select.innerHTML = assigneeOptionsHtml(members, currentValue);
  select.addEventListener("change", async () => {
    if (select.value === ADD_PERSON_VALUE) {
      const name = window.prompt("Add a new team member:");
      if (!name || !name.trim()) {
        select.value = currentValue || "";
        return;
      }
      const trimmed = name.trim();
      await sendMessage({ type: "SPF_ADD_TEAM_MEMBER", name: trimmed });
      const refreshed = await sendMessage({ type: "SPF_GET_TEAM_MEMBERS" });
      select.innerHTML = assigneeOptionsHtml(refreshed?.members || [], trimmed);
      onAssign(trimmed);
      return;
    }
    onAssign(select.value || null);
  });
}

function populatePersonFilter(notes) {
  const people = new Set();
  for (const note of notes) {
    if (note.author) people.add(note.author);
    if (note.completed_by) people.add(note.completed_by);
    if (note.assigned_to) people.add(note.assigned_to);
  }
  const sorted = Array.from(people).sort((a, b) => a.localeCompare(b));
  const previous = personFilterEl.value;

  personFilterEl.innerHTML = '<option value="">All people</option>';
  for (const name of sorted) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    personFilterEl.appendChild(opt);
  }
  if (sorted.includes(previous)) personFilterEl.value = previous;
}

function renderFiltered() {
  const person = personFilterEl.value;
  const filtered = person
    ? allNotes.filter((n) => n.author === person || n.completed_by === person || n.assigned_to === person)
    : allNotes;
  render(filtered);
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
      const videoHtml = note.video_url
        ? `<video src="${note.video_url}" controls style="max-width:280px;border-radius:4px;display:block;margin-top:4px;"></video>`
        : "";
      const completedHtml =
        note.status === "done"
          ? `<span class="noteMeta">&#10003; Completed by <span style="color:#188038;font-size:15px;font-weight:700;">${escapeHtml(note.completed_by || "Anonymous")}</span> &middot; ${new Date(note.completed_at).toLocaleString()}</span>`
          : "";
      const referenceHtml = note.reference
        ? `<span class="noteMeta">&#128222; Reference: <strong>${escapeHtml(note.reference)}</strong></span>`
        : "";
      div.innerHTML = `
        <span class="badge ${note.category}">${note.category}</span>
        <span class="noteMeta">${escapeHtml(note.author || "Anonymous")} &middot; ${new Date(note.created_at).toLocaleString()}</span>
        <span class="noteText">${note.text ? escapeHtml(note.text) : '<em style="color:#999;">(no note)</em>'}</span>
        ${screenshotHtml}
        ${videoHtml}
        ${referenceHtml}
        ${completedHtml}
        <label style="display:block;font-size:11px;color:#666;margin-top:4px;">Assigned to:</label>
        <select class="assigneeSelect" data-id="${note.id}" style="padding:3px;font-size:12px;margin:2px 0 6px;">
          <option>Loading&hellip;</option>
        </select>
        <div class="noteActions">
          <button data-action="toggle" data-id="${note.id}" data-status="${note.status}">${note.status === "done" ? "Reopen" : "Mark complete"}</button>
          <button data-action="delete" data-id="${note.id}">Delete</button>
        </div>
      `;
      group.appendChild(div);

      wireAssigneeSelect(div.querySelector(".assigneeSelect"), note.assigned_to, (assignedTo) => {
        sendMessage({ type: "SPF_ASSIGN_NOTE", id: note.id, assignedTo });
      });
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
  const { spfMyName, spfCompleterName } = await chrome.storage.local.get(["spfMyName", "spfCompleterName"]);
  const name = window.prompt(
    "Your name (so the team knows who resolved this):",
    spfMyName || spfCompleterName || ""
  );
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
personFilterEl.addEventListener("change", renderFiltered);

load();
