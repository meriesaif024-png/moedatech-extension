(function () {
  const CATEGORY_COLORS = {
    bug: "#d93025",
    remove: "#e37400",
    add: "#188038",
    change: "#1a73e8",
    other: "#5f6368",
  };

  let currentNotes = [];
  let pinsRoot = null;
  let annotating = false;
  let hoverBox = null;
  let shadowRoot = null;

  // The host page's own CSS (direction, fonts, button/textarea resets, z-index
  // stacking) can otherwise bleed into anything we inject. A shadow root with
  // `:host{all:initial}` cuts that inheritance so our UI always renders and
  // behaves the same regardless of the page it's running on.
  function getRoot() {
    if (shadowRoot) return shadowRoot;
    const host = document.createElement("div");
    host.id = "spf-shadow-host";
    document.documentElement.appendChild(host);
    shadowRoot = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; direction: ltr; font-family: system-ui, sans-serif; }
      button { cursor: pointer; font-family: inherit; }
    `;
    shadowRoot.appendChild(style);
    return shadowRoot;
  }

  function buildSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      let part = node.tagName.toLowerCase();
      if (node.classList.length) {
        part += "." + Array.from(node.classList).slice(0, 2).map((c) => CSS.escape(c)).join(".");
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      if (node.id) {
        parts[0] = `#${CSS.escape(node.id)}`;
        break;
      }
      node = node.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }

  function getAuthor() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["spfAuthorName"], (result) => resolve(result.spfAuthorName || "Anonymous"));
    });
  }

  function fetchNotes() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "SPF_GET_NOTES", url: location.href }, (response) => {
        resolve(response?.notes || []);
      });
    });
  }

  function ensurePinsRoot() {
    if (pinsRoot) return pinsRoot;
    pinsRoot = document.createElement("div");
    pinsRoot.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000;";
    getRoot().appendChild(pinsRoot);
    return pinsRoot;
  }

  function positionForNote(note) {
    if (note.selector) {
      const el = document.querySelector(note.selector);
      if (el) {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + window.scrollX, y: rect.top + window.scrollY };
      }
    }
    const docEl = document.documentElement;
    return {
      x: ((note.x_percent || 0) / 100) * docEl.scrollWidth,
      y: ((note.y_percent || 0) / 100) * docEl.scrollHeight,
    };
  }

  function renderPins(notes) {
    currentNotes = notes;
    const root = ensurePinsRoot();
    root.innerHTML = "";

    notes.forEach((note) => {
      const pos = positionForNote(note);
      const pin = document.createElement("div");
      const color = CATEGORY_COLORS[note.category] || CATEGORY_COLORS.other;
      const doneStyle = note.status === "done" ? "opacity:0.4;" : "";
      pin.style.cssText = `
        position:absolute;left:${pos.x}px;top:${pos.y}px;
        width:22px;height:22px;border-radius:50% 50% 50% 0;
        transform:translate(-50%,-100%) rotate(45deg);
        background:${color};border:2px solid white;
        box-shadow:0 1px 4px rgba(0,0,0,0.4);cursor:pointer;
        pointer-events:auto;${doneStyle}
      `;
      pin.title = note.text;

      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        togglePopover(pin, note);
      });

      root.appendChild(pin);
    });
  }

  let openPopover = null;

  function togglePopover(pin, note) {
    if (openPopover) {
      openPopover.remove();
      openPopover = null;
    }

    const rect = pin.getBoundingClientRect();
    const card = document.createElement("div");
    card.style.cssText = `
      position:fixed;left:${Math.min(rect.left, window.innerWidth - 260)}px;top:${rect.bottom + 6}px;
      width:240px;background:white;color:#1f1f1f;border-radius:8px;
      box-shadow:0 4px 16px rgba(0,0,0,0.25);padding:10px;
      font-size:12px;z-index:2147483647;
    `;

    const statusLabel = note.status === "done" ? "Done" : "Open";
    const screenshotHtml = note.screenshot
      ? `<img src="${note.screenshot}" style="max-width:100%;border-radius:4px;border:1px solid #eee;margin-bottom:6px;" />`
      : "";
    card.innerHTML = `
      <div style="font-weight:600;text-transform:capitalize;margin-bottom:4px;">${note.category} &middot; ${statusLabel}</div>
      ${screenshotHtml}
      <div style="margin-bottom:6px;white-space:pre-wrap;">${escapeHtml(note.text)}</div>
      <div style="color:#666;font-size:11px;margin-bottom:8px;">${escapeHtml(note.author || "Anonymous")} &middot; ${new Date(note.created_at).toLocaleString()}</div>
      <div style="display:flex;gap:6px;">
        <button data-action="toggle" style="flex:1;">${note.status === "done" ? "Reopen" : "Mark done"}</button>
        <button data-action="delete" style="flex:1;">Delete</button>
      </div>
    `;

    card.querySelector('[data-action="toggle"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      const newStatus = note.status === "done" ? "open" : "done";
      chrome.runtime.sendMessage({ type: "SPF_UPDATE_STATUS", id: note.id, status: newStatus }, async () => {
        card.remove();
        openPopover = null;
        renderPins(await fetchNotes());
      });
    });

    card.querySelector('[data-action="delete"]').addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: "SPF_DELETE_NOTE", id: note.id }, async () => {
        card.remove();
        openPopover = null;
        renderPins(await fetchNotes());
      });
    });

    getRoot().appendChild(card);
    openPopover = card;

    setTimeout(() => {
      document.addEventListener(
        "click",
        function closeOnce() {
          card.remove();
          if (openPopover === card) openPopover = null;
          document.removeEventListener("click", closeOnce);
        },
        { once: true }
      );
    }, 0);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  let dragStart = null;
  let dragging = false;
  let annotateHint = null;

  function startAnnotate() {
    if (annotating) return;
    annotating = true;
    document.body.style.cursor = "crosshair";

    hoverBox = document.createElement("div");
    hoverBox.style.cssText =
      "position:fixed;pointer-events:none;border:2px solid #1a73e8;background:rgba(26,115,232,0.12);z-index:2147483646;display:none;";
    getRoot().appendChild(hoverBox);

    annotateHint = document.createElement("div");
    annotateHint.style.cssText =
      "position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#1f1f1f;color:white;padding:6px 12px;border-radius:6px;font-size:12px;z-index:2147483647;pointer-events:none;";
    annotateHint.textContent = "Click an element, or drag to select a custom area — Esc to cancel";
    getRoot().appendChild(annotateHint);

    document.addEventListener("mousedown", onAnnotateMouseDown, true);
    document.addEventListener("mousemove", onAnnotateMouseMove, true);
    document.addEventListener("mouseup", onAnnotateMouseUp, true);
    document.addEventListener("click", onAnnotateClickBlock, true);
    document.addEventListener("keydown", onAnnotateKeydown, true);
  }

  function showHoverBox(rect) {
    hoverBox.style.display = "block";
    hoverBox.style.left = rect.left + "px";
    hoverBox.style.top = rect.top + "px";
    hoverBox.style.width = rect.width + "px";
    hoverBox.style.height = rect.height + "px";
  }

  function rectFromPoints(p1, p2) {
    return {
      left: Math.min(p1.x, p2.x),
      top: Math.min(p1.y, p2.y),
      width: Math.abs(p2.x - p1.x),
      height: Math.abs(p2.y - p1.y),
    };
  }

  function onAnnotateMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    dragStart = { x: e.clientX, y: e.clientY };
    dragging = true;
  }

  function onAnnotateMouseMove(e) {
    if (dragging && dragStart) {
      showHoverBox(rectFromPoints(dragStart, { x: e.clientX, y: e.clientY }));
    } else {
      showHoverBox(e.target.getBoundingClientRect());
    }
  }

  function onAnnotateClickBlock(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onAnnotateKeydown(e) {
    if (e.key === "Escape") stopAnnotate();
  }

  function stopAnnotate() {
    annotating = false;
    dragging = false;
    dragStart = null;
    document.body.style.cursor = "";
    hoverBox?.remove();
    hoverBox = null;
    annotateHint?.remove();
    annotateHint = null;
    document.removeEventListener("mousedown", onAnnotateMouseDown, true);
    document.removeEventListener("mousemove", onAnnotateMouseMove, true);
    document.removeEventListener("mouseup", onAnnotateMouseUp, true);
    document.removeEventListener("click", onAnnotateClickBlock, true);
    document.removeEventListener("keydown", onAnnotateKeydown, true);
  }

  const DRAG_THRESHOLD = 6;

  async function onAnnotateMouseUp(e) {
    if (!dragging) return;
    dragging = false;
    e.preventDefault();
    e.stopPropagation();

    const dragRect = rectFromPoints(dragStart, { x: e.clientX, y: e.clientY });
    dragStart = null;
    const isDrag = dragRect.width > DRAG_THRESHOLD || dragRect.height > DRAG_THRESHOLD;

    let selector = null;
    let targetRect = dragRect;

    if (!isDrag) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) {
        selector = buildSelector(el);
        targetRect = el.getBoundingClientRect();
      }
    }

    const docEl = document.documentElement;
    const xPercent = ((targetRect.left + window.scrollX) / docEl.scrollWidth) * 100;
    const yPercent = ((targetRect.top + window.scrollY) / docEl.scrollHeight) * 100;

    stopAnnotate();
    showAnnotationForm(e.clientX, e.clientY, { selector, xPercent, yPercent }, targetRect);
  }

  const CATEGORIES = [
    { key: "bug", label: "Bug" },
    { key: "remove", label: "Remove" },
    { key: "add", label: "Add" },
    { key: "change", label: "Change" },
  ];

  async function showAnnotationForm(clientX, clientY, position, targetRect) {
    let selectedCategory = "bug";
    let screenshotDataUrl = null;

    const form = document.createElement("div");
    form.style.cssText = `
      position:fixed;left:${Math.min(clientX, window.innerWidth - 260)}px;top:${Math.min(clientY, window.innerHeight - 300)}px;
      width:240px;background:white;color:#1f1f1f;border-radius:8px;
      box-shadow:0 4px 16px rgba(0,0,0,0.3);padding:10px;
      font-size:12px;z-index:2147483647;
    `;

    const categoryButtonsHtml = CATEGORIES.map(
      (c) => `<button type="button" data-category="${c.key}" class="spf-cat-btn" style="flex:1;padding:5px 0;border:1px solid ${CATEGORY_COLORS[c.key]};background:${c.key === selectedCategory ? CATEGORY_COLORS[c.key] : "white"};color:${c.key === selectedCategory ? "white" : CATEGORY_COLORS[c.key]};border-radius:4px;">${c.label}</button>`
    ).join("");

    form.innerHTML = `
      <div style="display:flex;gap:4px;margin-bottom:6px;">${categoryButtonsHtml}</div>
      <div id="spf-shot-preview" style="margin-bottom:6px;font-size:11px;color:#888;">Capturing screenshot&hellip;</div>
      <textarea id="spf-text" placeholder="What's the note?" style="width:100%;height:60px;margin-bottom:6px;padding:4px;font-size:12px;"></textarea>
      <div style="display:flex;gap:6px;">
        <button id="spf-save" style="flex:1;padding:6px 0;">Save</button>
        <button id="spf-cancel" style="flex:1;padding:6px 0;">Cancel</button>
      </div>
    `;
    getRoot().appendChild(form);
    form.querySelector("#spf-text").focus();

    form.querySelectorAll(".spf-cat-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedCategory = btn.dataset.category;
        form.querySelectorAll(".spf-cat-btn").forEach((b) => {
          const color = CATEGORY_COLORS[b.dataset.category];
          const active = b.dataset.category === selectedCategory;
          b.style.background = active ? color : "white";
          b.style.color = active ? "white" : color;
        });
      });
    });

    chrome.runtime.sendMessage(
      {
        type: "SPF_CAPTURE_ELEMENT",
        rect: { x: targetRect.left, y: targetRect.top, width: targetRect.width, height: targetRect.height },
        dpr: window.devicePixelRatio || 1,
      },
      (response) => {
        const preview = form.querySelector("#spf-shot-preview");
        if (response?.dataUrl) {
          screenshotDataUrl = response.dataUrl;
          preview.innerHTML = `<img src="${response.dataUrl}" style="max-width:100%;border-radius:4px;border:1px solid #eee;" />`;
        } else {
          preview.textContent = `Screenshot unavailable${response?.error ? ": " + response.error : ""}`;
        }
      }
    );

    form.querySelector("#spf-cancel").addEventListener("click", () => form.remove());

    form.querySelector("#spf-save").addEventListener("click", async () => {
      const text = form.querySelector("#spf-text").value.trim();
      if (!text) return;
      const author = await getAuthor();

      chrome.runtime.sendMessage(
        {
          type: "SPF_ADD_NOTE",
          note: {
            url: location.href,
            pageTitle: document.title,
            selector: position.selector,
            xPercent: position.xPercent,
            yPercent: position.yPercent,
            category: selectedCategory,
            text,
            author,
            screenshot: screenshotDataUrl,
          },
        },
        async () => {
          form.remove();
          renderPins(await fetchNotes());
        }
      );
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "SPF_START_ANNOTATE") {
      startAnnotate();
    }
    if (message.type === "SPF_REFRESH_PINS") {
      fetchNotes().then(renderPins);
    }
  });

  window.addEventListener("resize", () => renderPins(currentNotes));

  fetchNotes().then(renderPins);
})();
