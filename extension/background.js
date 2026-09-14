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

  if (message.type === "SPF_UPDATE_STATUS") {
    api(`/api/notes/${message.id}`, { method: "PATCH", body: JSON.stringify({ status: message.status }) })
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
});
