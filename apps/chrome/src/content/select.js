// @ts-check
// The selection bubble and the Selected chip's feed (prototype "Save from Chrome", side panel "Selected"). When the person highlights text with the mouse, a small bubble
// shows above it: Save to Notes, Ask, and a close. The highlighted text also goes to the worker (debounced), which hands it to the side panel as the Selected chip.
// Text inside password fields and editable fields is never sent. The worker decides per site: on a site that is never sent, or in incognito, it answers "off" and
// the bubble stays hidden for the rest of the page's life. The bubble lives in a closed shadow root, so the page can neither read nor restyle it.
(function () {
  /** @type {any} */
  const g = globalThis;
  const ns = (g.__vyreExt = g.__vyreExt || {});
  if (ns.selectInstalled || g.top !== g) return; // the top frame only
  ns.selectInstalled = true;
  const doc = g.document;
  let off = false;
  let hidden = false; // the person closed the bubble on this page
  /** @type {any} */
  let host = null;
  /** @type {any} */
  let bubble = null;
  let lastSent = "";
  /** @type {any} */
  let timer = null;

  const send = (/** @type {any} */ m) => new Promise((resolve) => {
    try { g.chrome.runtime.sendMessage(m, (/** @type {any} */ r) => { void g.chrome.runtime.lastError; resolve(r); }); } catch { resolve(null); }
  });

  /** The selection's text, or "" when it sits in a field. */
  function selectedText() {
    const a = doc.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return "";
    const s = g.getSelection ? g.getSelection() : null;
    if (!s || s.isCollapsed || s.rangeCount === 0) return "";
    return String(s.toString() || "").trim().slice(0, 4000);
  }

  function build() {
    host = doc.createElement("div");
    host.setAttribute("data-vyre-bubble", "");
    host.style.cssText = "all:initial;position:absolute;left:0;top:0;z-index:2147483646;";
    const root = host.attachShadow({ mode: "closed" });
    const dark = g.matchMedia && g.matchMedia("(prefers-color-scheme: dark)").matches;
    const st = doc.createElement("style");
    st.textContent = `.b{display:flex;align-items:center;gap:2px;padding:3px;border-radius:9px;white-space:nowrap;font:500 12.5px/1 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
      background:${dark ? "#201E29" : "#fff"};color:${dark ? "#F2F0F7" : "#17141F"};box-shadow:0 0 0 1px ${dark ? "rgba(255,255,255,.08)" : "rgba(23,20,31,.07)"},0 10px 24px -8px rgba(23,20,31,.2),0 2px 6px rgba(23,20,31,.06)}
      button{all:unset;height:26px;padding:0 8px;border-radius:6px;display:flex;align-items:center;gap:6px;cursor:pointer}button:hover{background:${dark ? "rgba(255,255,255,.05)" : "rgba(23,20,31,.045)"}}
      button:focus-visible{outline:2px solid rgba(90,63,240,.4)}.s{width:1px;height:16px;background:${dark ? "rgba(255,255,255,.12)" : "rgba(23,20,31,.13)"};margin:0 2px}
      svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.m{display:block;margin:0 3px}`;
    bubble = doc.createElement("div");
    bubble.className = "b";
    bubble.setAttribute("role", "toolbar");
    bubble.setAttribute("aria-label", "Vyre");
    // Built node by node (no innerHTML), so pages that enforce Trusted Types cannot refuse it.
    const NS = "http://www.w3.org/2000/svg";
    const icon = (/** @type {string[]} */ paths, /** @type {string} */ cls = "", /** @type {string} */ stroke = "") => {
      const s = doc.createElementNS(NS, "svg");
      s.setAttribute("viewBox", "0 0 16 16");
      s.setAttribute("aria-hidden", "true");
      if (cls) s.setAttribute("class", cls);
      for (const d of paths) { const p = doc.createElementNS(NS, "path"); p.setAttribute("d", d); if (stroke) { p.setAttribute("stroke", stroke); p.setAttribute("stroke-width", "2"); } s.append(p); }
      return s;
    };
    const button = (/** @type {string} */ k, /** @type {any} */ ic, /** @type {string} */ label, /** @type {string} */ aria = "") => {
      const b = doc.createElement("button");
      b.dataset.k = k;
      b.append(ic);
      if (label) b.append(doc.createTextNode(label));
      if (aria) b.setAttribute("aria-label", aria);
      return b;
    };
    const sep = doc.createElement("span");
    sep.className = "s";
    bubble.append(
      icon(["M3.5 4.3l4.2 7.4 3.3-5.7"], "m", "#5A3FF0"),
      button("save", icon(["M4 2.5h6l2.5 2.5v8.5h-8.5z", "M6 6.5h4", "M6 9h4"]), "Save to Notes"),
      button("ask", icon(["M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3z"]), "Ask"),
      sep,
      button("x", icon(["M4.5 4.5l7 7", "M11.5 4.5l-7 7"]), "", "Hide"),
    );
    bubble.addEventListener("mousedown", (/** @type {any} */ e) => e.preventDefault()); // keep the selection
    bubble.addEventListener("click", async (/** @type {any} */ e) => {
      const b = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!b || !e.isTrusted) return;
      const text = selectedText();
      hide();
      if (b.dataset.k === "x") { hidden = true; return; }
      if (!text) return;
      await send({ type: b.dataset.k === "save" ? "vyre.clip" : "vyre.ask", selection: text });
    });
    root.append(st, bubble);
    doc.documentElement.append(host);
  }

  function hide() { if (host) host.style.display = "none"; }

  function place() {
    const s = g.getSelection();
    if (!s || s.rangeCount === 0) return;
    const r = s.getRangeAt(0).getBoundingClientRect();
    if (!host) build();
    host.style.display = "block";
    const w = bubble.offsetWidth || 220;
    const left = Math.max(8, Math.min(g.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + g.scrollX;
    const top = (r.top > 44 ? r.top - 40 : r.bottom + 8) + g.scrollY;
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
  }

  /** Tell the worker what is selected now; it answers whether Vyre may read this site. */
  async function report() {
    const text = selectedText();
    if (text === lastSent) return;
    lastSent = text;
    const r = await send({ type: "vyre.selection", text });
    if (r && r.data && r.data.off) { off = true; hide(); }
  }

  doc.addEventListener("mouseup", (/** @type {any} */ e) => {
    if (off || !e.isTrusted || (host && e.composedPath && e.composedPath().includes(host))) return;
    g.setTimeout(async () => {
      const text = selectedText();
      if (!text) { hide(); return; }
      await report();
      if (!off && !hidden) place();
    }, 0);
  }, true);
  doc.addEventListener("selectionchange", () => {
    if (off) return;
    if (!selectedText()) hide();
    g.clearTimeout(timer);
    timer = g.setTimeout(() => { void report(); }, 250);
  });
  doc.addEventListener("keydown", (/** @type {any} */ e) => { if (e.key === "Escape") hide(); }, true);
  g.addEventListener("scroll", () => hide(), { passive: true, capture: true });

  ns.select = { selectedText, hide, get off() { return off; } };
})();
