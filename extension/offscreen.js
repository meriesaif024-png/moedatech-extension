let mediaRecorder = null;
let recordedChunks = [];
let currentStream = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SPF_PLAY_SOUND") {
    const audio = document.getElementById("ding");
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }

  if (message.type === "SPF_BEGIN_RECORD") {
    (async () => {
      try {
        currentStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: message.streamId,
            },
          },
        });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(currentStream, { mimeType: "video/webm;codecs=vp9" });
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.start(1000);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "SPF_END_RECORD") {
    (async () => {
      if (!mediaRecorder) {
        sendResponse({ error: "Not currently recording" });
        return;
      }
      const stopped = new Promise((resolve) => {
        mediaRecorder.onstop = resolve;
      });
      mediaRecorder.stop();
      currentStream?.getTracks().forEach((t) => t.stop());
      await stopped;

      const blob = new Blob(recordedChunks, { type: "video/webm" });
      const arrayBuffer = await blob.arrayBuffer();
      mediaRecorder = null;
      recordedChunks = [];
      currentStream = null;

      // chrome.runtime messages are JSON-serialized, which mangles a
      // Uint8Array into a plain object (and then into garbage if used
      // directly as a fetch body) - base64 survives the trip intact.
      sendResponse({ ok: true, base64: arrayBufferToBase64(arrayBuffer) });
    })();
    return true;
  }
});

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
