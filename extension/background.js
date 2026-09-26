importScripts("config.js");

const API_BASE = "https://feedback-api-production-8bc5.up.railway.app";

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SPF_GET_NOTES") {
    api(`/api/notes?url=${encodeURIComponent(message.url)}`)
      .then((notes) => sendResponse({ notes }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "SPF_GET_ALL_NOTES") {
    api("/api/notes")
      .then((notes) => sendResponse({ notes }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "SPF_ADD_NOTE") {
    api("/api/notes", { method: "POST", body: JSON.stringify(message.note) })
      .then((note) => sendResponse({ note }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "SPF_UPDATE_STATUS") {
    api(`/api/notes/${message.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: message.status, completedBy: message.completedBy }),
    })
      .then((note) => sendResponse({ note }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "SPF_DELETE_NOTE") {
    api(`/api/notes/${message.id}`, { method: "DELETE" })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "SPF_ASSIGN_NOTE") {
    api(`/api/notes/${message.id}`, { method: "PATCH", body: JSON.stringify({ assignedTo: message.assignedTo }) })
      .then((note) => sendResponse({ note }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "SPF_GET_TEAM_MEMBERS") {
    api("/api/team-members")
      .then((members) => sendResponse({ members }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "SPF_ADD_TEAM_MEMBER") {
    api("/api/team-members", { method: "POST", body: JSON.stringify({ name: message.name }) })
      .then((member) => sendResponse({ member }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "SPF_CAPTURE_ELEMENT") {
    const windowId = sender.tab?.windowId;
    captureElement(windowId, message.rect, message.dpr)
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "SPF_OPEN_DASHBOARD") {
    openOrFocusDashboard();
    return;
  }

  if (message.type === "SPF_START_RECORDING") {
    const tabId = sender.tab?.id;
    startRecording(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "SPF_STOP_RECORDING") {
    stopRecordingAndUpload()
      .then((videoKey) => sendResponse({ videoKey }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

const COMPLETION_CHECK_ALARM = "spfCheckCompletions";
const COMPLETION_CHECK_MINUTES = 2;

chrome.alarms.create(COMPLETION_CHECK_ALARM, { periodInMinutes: COMPLETION_CHECK_MINUTES });

chrome.runtime.onInstalled.addListener(async () => {
  const { spfLastCheckedAt } = await chrome.storage.local.get(["spfLastCheckedAt"]);
  if (!spfLastCheckedAt) {
    // Don't notify for everything already completed before the extension was installed.
    await chrome.storage.local.set({ spfLastCheckedAt: new Date().toISOString() });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === COMPLETION_CHECK_ALARM) checkForUpdates();
});

async function ensureOffscreenDocument() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK", "USER_MEDIA"],
    justification: "Play a notification sound and record tab video for feedback notes",
  });
}

async function startRecording(tabId) {
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ type: "SPF_BEGIN_RECORD", streamId });
  if (response?.error) throw new Error(response.error);
}

async function stopRecordingAndUpload() {
  const response = await chrome.runtime.sendMessage({ type: "SPF_END_RECORD" });
  if (response?.error) throw new Error(response.error);

  const binary = atob(response.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const uploadRes = await fetch(`${API_BASE}/api/videos`, {
    method: "POST",
    headers: { "Content-Type": "video/webm", "x-api-key": API_KEY },
    body: bytes,
  });
  if (!uploadRes.ok) throw new Error(`Video upload failed: ${uploadRes.status}`);
  const { key } = await uploadRes.json();
  return key;
}

async function playNotificationSound() {
  try {
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({ type: "SPF_PLAY_SOUND" });
  } catch {
    // Offscreen audio is best-effort - the visual notification still shows either way.
  }
}

function notify(id, options) {
  chrome.notifications.create(id, { type: "basic", iconUrl: "icon128.png", ...options });
}

async function checkForUpdates() {
  const { spfLastCheckedAt } = await chrome.storage.local.get(["spfLastCheckedAt"]);
  const since = spfLastCheckedAt ? new Date(spfLastCheckedAt) : new Date(0);
  const checkedAt = new Date().toISOString();

  let notes;
  try {
    notes = await api("/api/notes");
  } catch {
    return;
  }

  const { spfMyName } = await chrome.storage.local.get(["spfMyName"]);
  const myName = (spfMyName || "").trim().toLowerCase();

  const newlyCompleted = notes.filter(
    (n) => n.status === "done" && n.completed_at && new Date(n.completed_at) > since
  );

  let firedAny = false;

  for (const note of newlyCompleted) {
    const iAmAuthor = myName && (note.author || "").trim().toLowerCase() === myName;
    if (iAmAuthor) {
      notify(`spf-complete-${note.id}`, {
        title: `Your "${note.category}" note was completed`,
        message: `${note.completed_by || "Someone"} resolved it: ${note.text || "(no note)"}`,
        contextMessage: note.page_title || note.url,
      });
    } else {
      notify(`spf-complete-${note.id}`, {
        title: `${note.completed_by || "Someone"} completed a "${note.category}" note`,
        message: note.text || "(no note)",
        contextMessage: note.page_title || note.url,
      });
    }
    firedAny = true;
  }

  const newlyAssigned = myName
    ? notes.filter(
        (n) =>
          n.assigned_to &&
          n.assigned_at &&
          new Date(n.assigned_at) > since &&
          n.assigned_to.trim().toLowerCase() === myName
      )
    : [];

  for (const note of newlyAssigned) {
    notify(`spf-assign-${note.id}`, {
      title: `You were assigned a "${note.category}" note`,
      message: note.text || "(no note)",
      contextMessage: note.page_title || note.url,
    });
    firedAny = true;
  }

  if (firedAny) playNotificationSound();

  await chrome.storage.local.set({ spfLastCheckedAt: checkedAt });
}

async function openOrFocusDashboard() {
  const dashboardUrl = chrome.runtime.getURL("dashboard.html");
  const [existing] = await chrome.tabs.query({ url: dashboardUrl });
  if (existing) {
    chrome.tabs.update(existing.id, { active: true });
    chrome.windows.update(existing.windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: dashboardUrl });
  }
}

chrome.notifications.onClicked.addListener(openOrFocusDashboard);

chrome.commands.onCommand.addListener((command) => {
  if (command === "open_dashboard") openOrFocusDashboard();
});

const MAX_SCREENSHOT_DIMENSION = 1000;

// Captures the whole visible page (not just the clicked element) and marks
// the chosen spot with a shaded overlay + border, so whoever picks up the
// note sees the full context and doesn't have to hunt for where it was.
async function captureElement(windowId, rect, dpr) {
  const fullDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const blob = await (await fetch(fullDataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  const scale = dpr || 1;
  const shrink = Math.min(1, MAX_SCREENSHOT_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const outW = Math.round(bitmap.width * shrink);
  const outH = Math.round(bitmap.height * shrink);

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, outW, outH);

  const markScale = shrink * scale;
  const markX = rect.x * markScale;
  const markY = rect.y * markScale;
  const markW = Math.max(rect.width * markScale, 4);
  const markH = Math.max(rect.height * markScale, 4);

  ctx.fillStyle = "rgba(255, 60, 0, 0.3)";
  ctx.fillRect(markX, markY, markW, markH);
  ctx.strokeStyle = "#ff3c00";
  ctx.lineWidth = 3;
  ctx.strokeRect(markX, markY, markW, markH);

  const outputBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.78 });
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(outputBlob);
  });
}
