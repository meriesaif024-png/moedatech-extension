chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SPF_PLAY_SOUND") {
    const audio = document.getElementById("ding");
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }
});
