(function () {
  const CATEGORY_COLORS = {
    bug: "#d93025",
    remove: "#e37400",
    add: "#188038",
    change: "#1a73e8",
    other: "#5f6368",
  };

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

  function fetchTeamMembers() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "SPF_GET_TEAM_MEMBERS" }, (response) => {
        resolve(response?.members || []);
      });
    });
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

  // Populates a <select> with the shared team list and handles the
  // "+ Add new person" option by prompting for a name and saving it to the
  // shared backend so it shows up for everyone from then on.
  async function wireAssigneeSelect(select, currentValue, onAssign) {
    select.addEventListener("click", (e) => e.stopPropagation());
    const members = await fetchTeamMembers();
    select.innerHTML = assigneeOptionsHtml(members, currentValue);
    select.addEventListener("change", async () => {
      if (select.value === ADD_PERSON_VALUE) {
        const name = window.prompt("Add a new team member:");
        if (!name || !name.trim()) {
          select.value = currentValue || "";
          return;
        }
        const trimmed = name.trim();
        await new Promise((resolve) =>
          chrome.runtime.sendMessage({ type: "SPF_ADD_TEAM_MEMBER", name: trimmed }, resolve)
        );
        const refreshed = await fetchTeamMembers();
        select.innerHTML = assigneeOptionsHtml(refreshed, trimmed);
        onAssign(trimmed);
        return;
      }
      onAssign(select.value || null);
    });
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

    // The cursor never shows up in a captureVisibleTab screenshot (it's an OS
    // overlay, not part of the page), so this is safe visual feedback during
    // the capture window while the note-creation form itself is kept off
    // screen.
    document.body.style.cursor = "wait";

    const captureResponse = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "SPF_CAPTURE_ELEMENT",
          rect: { x: targetRect.left, y: targetRect.top, width: targetRect.width, height: targetRect.height },
          dpr: window.devicePixelRatio || 1,
        },
        resolve
      );
    });

    document.body.style.cursor = "";

    showAnnotationForm(e.clientX, e.clientY, { selector, xPercent, yPercent }, captureResponse);
  }

  const CATEGORIES = [
    { key: "bug", label: "Bug" },
    { key: "remove", label: "Remove" },
    { key: "add", label: "Add" },
    { key: "change", label: "Change" },
  ];

  async function showAnnotationForm(clientX, clientY, position, captureResponse) {
    let selectedCategory = "bug";
    const screenshotDataUrl = captureResponse?.dataUrl || null;

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

    const previewHtml = screenshotDataUrl
      ? `<img src="${screenshotDataUrl}" style="max-width:100%;border-radius:4px;border:1px solid #eee;" />`
      : `<div style="font-size:11px;color:#888;">Screenshot unavailable${captureResponse?.error ? ": " + captureResponse.error : ""}</div>`;

    form.innerHTML = `
      <div style="display:flex;gap:4px;margin-bottom:6px;">${categoryButtonsHtml}</div>
      <div id="spf-shot-preview" style="margin-bottom:6px;">${previewHtml}</div>
      <textarea id="spf-text" placeholder="What's the note?" style="width:100%;height:60px;margin-bottom:6px;padding:4px;font-size:12px;"></textarea>
      <select id="spf-assignee" style="width:100%;margin-bottom:6px;padding:4px;font-size:12px;">
        <option>Loading&hellip;</option>
      </select>
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

    let selectedAssignee = null;
    wireAssigneeSelect(form.querySelector("#spf-assignee"), null, (assignedTo) => {
      selectedAssignee = assignedTo;
    });

    const saveBtn = form.querySelector("#spf-save");

    form.querySelector("#spf-cancel").addEventListener("click", () => form.remove());

    saveBtn.addEventListener("click", async () => {
      const text = form.querySelector("#spf-text").value.trim();
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
            assignedTo: selectedAssignee,
          },
        },
        () => {
          form.remove();
        }
      );
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "SPF_START_ANNOTATE") {
      startAnnotate();
    }
  });
})();
