importScripts("config.js");

const API_BASE = "https://feedback-api-production-ed54.up.railway.app";

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

  if (message.type === "SPF_DELETE_NOTE") {
    api(`/api/notes/${message.id}`, { method: "DELETE" })
      .then(() => sendResponse({ ok: true }))
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
});

const MAX_SCREENSHOT_DIMENSION = 900;

async function captureElement(windowId, rect, dpr) {
  const fullDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const blob = await (await fetch(fullDataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  const scale = dpr || 1;
  const sx = Math.max(0, rect.x * scale);
  const sy = Math.max(0, rect.y * scale);
  const sw = Math.min(rect.width * scale, bitmap.width - sx);
  const sh = Math.min(rect.height * scale, bitmap.height - sy);
  if (sw <= 0 || sh <= 0) return null;

  const shrink = Math.min(1, MAX_SCREENSHOT_DIMENSION / Math.max(sw, sh));
  const outW = Math.round(sw * shrink);
  const outH = Math.round(sh * shrink);

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);

  const croppedBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(croppedBlob);
  });
}
