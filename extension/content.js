(function () {
  function report(issue) {
    chrome.runtime.sendMessage({ type: "SPF_ISSUE", issue }).catch(() => {});
  }

  // Capture phase catches resource load failures (img/script/link 404s) too,
  // since those don't bubble but do fire on window during capture.
  window.addEventListener(
    "error",
    (event) => {
      if (event.target && event.target !== window && event.target.nodeName) {
        report({
          type: "resource-error",
          detail: `Failed to load ${event.target.nodeName.toLowerCase()}`,
          url: event.target.src || event.target.href || location.href,
        });
        return;
      }
      report({
        type: "js-error",
        detail: event.message || "Uncaught error",
        url: event.filename || location.href,
        line: event.lineno,
        col: event.colno,
        stack: event.error?.stack,
      });
    },
    true
  );

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    report({
      type: "unhandled-rejection",
      detail: (reason && (reason.message || String(reason))) || "Unhandled promise rejection",
      url: location.href,
      stack: reason?.stack,
    });
  });

  // console object is shared with the page realm, so this override also
  // catches console.error calls made by the page's own scripts.
  const originalError = console.error;
  console.error = function (...args) {
    report({
      type: "console-error",
      detail: args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" "),
      url: location.href,
    });
    return originalError.apply(console, args);
  };

  function safeStringify(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SPF_GET_LINKS") {
      const links = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.href)
        .filter((href) => href.startsWith("http"));
      const unique = Array.from(new Set(links)).slice(0, 200);
      sendResponse({ links: unique });
    }
  });
})();
