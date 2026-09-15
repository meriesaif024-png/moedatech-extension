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

const MAX_SCREENSHOT_DIMENSION = 1400;

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

  const outputBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(outputBlob);
  });
}
