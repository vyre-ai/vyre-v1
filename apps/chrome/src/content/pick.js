// @ts-check
// "A part of the page" on the Watch sheet (prototype "Pick on the page"): while this runs the page shows a bar, "Click the part of the page to watch", and outlines the thing under
// the pointer. A click names it (a label a person would use and a selector to find it again); Esc cancels. Injected by the worker only when the person asks to pick, then gone.
// It reads the text of the part the person clicked, never a field's value, and its overlay is in a closed shadow root.
(function () {
  /** @type {any} */
  const g = globalThis;
  const doc = g.document;
  const ns = (g.__vyreExt = g.__vyreExt || {});
  if (ns.picking) return;
  ns.picking = true;

  const send = (/** @type {any} */ m) => { try { g.chrome.runtime.sendMessage(m, () => { void g.chrome.runtime.lastError; }); } catch { /* reloaded */ } };
  const clip = (/** @type {string} */ s, /** @type {number} */ n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

  const host = doc.createElement("div");
  host.setAttribute("data-vyre-pick", "");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });
  const dark = g.matchMedia && g.matchMedia("(prefers-color-scheme: dark)").matches;
  const st = doc.createElement("style");
  st.textContent = `.o{position:fixed;border-radius:4px;box-shadow:0 0 0 2px ${dark ? "#A092FF" : "#5A3FF0"},0 0 0 5px ${dark ? "rgba(160,146,255,.25)" : "rgba(90,63,240,.2)"};background:${dark ? "rgba(160,146,255,.12)" : "rgba(90,63,240,.08)"};pointer-events:none;display:none}
    .t{position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:9px 12px 9px 14px;border-radius:12px;font:500 12.5px/1 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
      background:${dark ? "#201E29" : "#17141F"};color:${dark ? "#F2F0F7" : "#fff"};box-shadow:0 10px 24px -8px rgba(23,20,31,.35);pointer-events:auto}
    kbd{font:500 11px/1 ui-monospace,Menlo,monospace;padding:3px 6px;border-radius:4px;background:rgba(255,255,255,.14)}`;
  const box = doc.createElement("div"); box.className = "o";
  const bar = doc.createElement("div"); bar.className = "t"; bar.setAttribute("role", "status");
  bar.append(doc.createTextNode("Click the part of the page to watch"));
  const esc = doc.createElement("kbd"); esc.textContent = "Esc"; bar.append(esc);
  root.append(st, box, bar);
  doc.documentElement.append(host);

  /** @type {any} */
  let over = null;
  const skip = (/** @type {any} */ el) => !el || el === doc.documentElement || el === doc.body || el === host;
  function move(/** @type {any} */ e) {
    const el = doc.elementFromPoint(e.clientX, e.clientY);
    if (skip(el) || el === over) return;
    over = el;
    const r = el.getBoundingClientRect();
    box.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  }

  /** A selector that finds the element again: its id, a test id, or a short path of tag and position. @param {any} el */
  function selectorFor(el) {
    const esc = (/** @type {string} */ s) => (g.CSS && g.CSS.escape ? g.CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&"));
    const unique = (/** @type {string} */ sel) => { try { return doc.querySelectorAll(sel).length === 1; } catch { return false; } };
    if (el.id && unique(`#${esc(el.id)}`) && !/\d{4,}/.test(el.id)) return `#${esc(el.id)}`;
    for (const a of ["data-testid", "data-test", "data-qa", "aria-label", "name"]) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && unique(`${el.tagName.toLowerCase()}[${a}="${v.replace(/"/g, '\\"')}"]`)) return `${el.tagName.toLowerCase()}[${a}="${v.replace(/"/g, '\\"')}"]`;
    }
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== doc.body && parts.length < 7) {
      if (n.id && unique(`#${esc(n.id)}`) && !/\d{4,}/.test(n.id)) { parts.unshift(`#${esc(n.id)}`); break; }
      const tag = n.tagName.toLowerCase();
      const same = n.parentElement ? [...n.parentElement.children].filter((/** @type {any} */ c) => c.tagName === n.tagName) : [n];
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(n) + 1})` : tag);
      n = n.parentElement;
    }
    return parts.join(" > ");
  }

  /** What a person would call it: a label on it, a heading above it, or the first words in it. @param {any} el */
  function labelFor(el) {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return clip(aria, 60);
    const own = clip(el.innerText || el.textContent, 70);
    let n = el;
    for (let i = 0; i < 4 && n; i++, n = n.parentElement) {
      let prev = n.previousElementSibling;
      while (prev) {
        if (/^H[1-6]$/.test(prev.tagName) || prev.tagName === "LABEL" || prev.tagName === "DT") { const t = clip(prev.textContent, 50); if (t) return t; }
        prev = prev.previousElementSibling;
      }
    }
    return own || clip(el.tagName.toLowerCase(), 20);
  }

  function finish(/** @type {any} */ region) {
    doc.removeEventListener("mousemove", move, true);
    doc.removeEventListener("click", click, true);
    doc.removeEventListener("keydown", key, true);
    doc.removeEventListener("mousedown", swallow, true);
    host.remove();
    ns.picking = false;
    send({ type: "vyre.pick", region });
  }
  function swallow(/** @type {any} */ e) { if (e.isTrusted) { e.preventDefault(); e.stopPropagation(); } }
  function click(/** @type {any} */ e) {
    if (!e.isTrusted) return;
    e.preventDefault(); e.stopPropagation();
    const el = doc.elementFromPoint(e.clientX, e.clientY);
    if (skip(el)) { finish(null); return; }
    const tag = String(el.tagName || "");
    const text = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ? "" : clip(el.innerText || el.textContent, 300);
    finish({ selector: selectorFor(el), label: labelFor(el), text });
  }
  function key(/** @type {any} */ e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); } }

  doc.addEventListener("mousemove", move, true);
  doc.addEventListener("mousedown", swallow, true);
  doc.addEventListener("click", click, true);
  doc.addEventListener("keydown", key, true);
})();
