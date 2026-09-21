const noteListEl = document.getElementById("noteList");
const statusEl = document.getElementById("status");
const myNameInput = document.getElementById("myName");
const meSavedEl = document.getElementById("meSaved");

let activeTabId = null;
let activeTabUrl = null;
let activeTabTitle = null;

const CATEGORY_COLORS = {
  bug: "#d93025",
  remove: "#e37400",
  add: "#188038",
  change: "#1a73e8",
  other: "#5f6368",
};

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
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
    const referenceHtml = note.reference
      ? `<span class="noteMeta">&#128222; Reference: <strong>${escapeHtml(note.reference)}</strong></span>`
      : "";
    li.innerHTML = `
      <span class="badge ${note.category}">${note.category}</span>
      <span class="noteText">${note.text ? escapeHtml(note.text) : '<em style="color:#999;">(no note)</em>'}</span>
      ${screenshotHtml}
      <span class="noteMeta">${escapeHtml(note.author || "Anonymous")} &middot; ${new Date(note.created_at).toLocaleString()}</span>
      ${referenceHtml}
      ${completedHtml}
      <label style="display:block;font-size:11px;color:#666;margin-top:4px;">Assigned to:</label>
      <select class="assigneeSelect" data-id="${note.id}" style="width:100%;padding:3px;font-size:12px;margin-top:2px;">
        <option>Loading&hellip;</option>
      </select>
      <div class="noteActions">
        <button data-action="toggle" data-id="${note.id}" data-status="${note.status}">${note.status === "done" ? "Reopen" : "Mark complete"}</button>
        <button data-action="delete" data-id="${note.id}">Delete</button>
      </div>
    `;
    noteListEl.appendChild(li);

    wireAssigneeSelect(li.querySelector(".assigneeSelect"), note.assigned_to, (assignedTo) => {
      sendMessage({ type: "SPF_ASSIGN_NOTE", id: note.id, assignedTo });
    });
  }
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

const quickNoteFormEl = document.getElementById("quickNoteForm");
const CATEGORIES = [
  { key: "bug", label: "Bug" },
  { key: "remove", label: "Remove" },
  { key: "add", label: "Add" },
  { key: "change", label: "Change" },
];

function renderQuickNoteForm() {
  let selectedCategory = "bug";

  const categoryButtonsHtml = CATEGORIES.map(
    (c) =>
      `<button type="button" data-category="${c.key}" class="qn-cat-btn" style="border:1px solid ${CATEGORY_COLORS[c.key]};background:${c.key === selectedCategory ? CATEGORY_COLORS[c.key] : "white"};color:${c.key === selectedCategory ? "white" : CATEGORY_COLORS[c.key]};">${c.label}</button>`
  ).join("");

  quickNoteFormEl.innerHTML = `
    <div class="catRow">${categoryButtonsHtml}</div>
    <textarea id="qn-text" placeholder="What's the note? (no page selection needed)"></textarea>
    <input type="text" id="qn-reference" placeholder="Reference (e.g. phone number)" style="width:100%;padding:4px;font-size:12px;margin-bottom:6px;box-sizing:border-box;" />
    <select id="qn-assignee"><option>Loading&hellip;</option></select>
    <div class="formActions">
      <button id="qn-save">Save</button>
      <button id="qn-cancel">Cancel</button>
    </div>
  `;

  quickNoteFormEl.querySelectorAll(".qn-cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedCategory = btn.dataset.category;
      quickNoteFormEl.querySelectorAll(".qn-cat-btn").forEach((b) => {
        const color = CATEGORY_COLORS[b.dataset.category];
        const active = b.dataset.category === selectedCategory;
        b.style.background = active ? color : "white";
        b.style.color = active ? "white" : color;
      });
    });
  });

  let selectedAssignee = null;
  wireAssigneeSelect(quickNoteFormEl.querySelector("#qn-assignee"), null, (assignedTo) => {
    selectedAssignee = assignedTo;
  });

  quickNoteFormEl.querySelector("#qn-cancel").addEventListener("click", () => {
    quickNoteFormEl.hidden = true;
  });

  quickNoteFormEl.querySelector("#qn-save").addEventListener("click", async () => {
    const text = quickNoteFormEl.querySelector("#qn-text").value.trim();
    const reference = quickNoteFormEl.querySelector("#qn-reference").value.trim();
    const { spfMyName } = await chrome.storage.local.get(["spfMyName"]);

    await sendMessage({
      type: "SPF_ADD_NOTE",
      note: {
        url: activeTabUrl,
        pageTitle: activeTabTitle,
        category: selectedCategory,
        text,
        reference,
        author: spfMyName || "Anonymous",
        assignedTo: selectedAssignee,
      },
    });

    quickNoteFormEl.hidden = true;
    loadNotes();
  });
}

document.getElementById("quickNote").addEventListener("click", () => {
  if (quickNoteFormEl.hidden) {
    renderQuickNoteForm();
    quickNoteFormEl.hidden = false;
  } else {
    quickNoteFormEl.hidden = true;
  }
});

document.getElementById("addNote").addEventListener("click", async () => {
  if (activeTabId == null) return;

  try {
    await chrome.tabs.sendMessage(activeTabId, { type: "SPF_START_ANNOTATE" });
    window.close();
    return;
  } catch (err) {
    // The content script probably isn't injected yet - e.g. the page was
    // open before the extension was installed/reloaded. Inject it now and
    // retry once instead of making the user manually refresh the page.
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ["content.js"] });
    await chrome.tabs.sendMessage(activeTabId, { type: "SPF_START_ANNOTATE" });
    window.close();
  } catch (err) {
    statusEl.textContent = "Can't annotate this page - it may not be a supported site.";
  }
});

document.getElementById("viewAll").addEventListener("click", (e) => {
  e.preventDefault();
  sendMessage({ type: "SPF_OPEN_DASHBOARD" });
  window.close();
});

myNameInput.addEventListener("change", async () => {
  const trimmed = myNameInput.value.trim();
  await chrome.storage.local.set({ spfMyName: trimmed });
  meSavedEl.textContent = trimmed ? "Saved" : "";
  setTimeout(() => (meSavedEl.textContent = ""), 2000);
});

(async function init() {
  const { spfMyName } = await chrome.storage.local.get(["spfMyName"]);
  myNameInput.value = spfMyName || "";

  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;
  activeTabUrl = tab?.url ?? null;
  activeTabTitle = tab?.title ?? null;
  await loadNotes();
})();
