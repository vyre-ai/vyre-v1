// Code that runs inside the page for the click-through gate (scripts/click/dead-buttons.mjs). Each export is a self-contained function: Playwright sends it as text, so it may not use anything from this module.

/** Installed before the app starts: records what a click changes. A dead button is one that changes none of it. */
export function install() {
  if (window.__dbg) return;
  const dbg = { fx: [], added: [], lastMut: Date.now(), ev: [] };
  window.__dbg = dbg;
  const tag = (n) => (n && n.nodeType === 1 ? n : n && n.parentElement);
  const mo = new MutationObserver((list) => {
    dbg.lastMut = Date.now();
    const tgt = document.querySelector("[data-dbg-t]");
    for (const m of list) {
      const t = tag(m.target);
      if (!t) continue;
      const inOv = !!(t.closest && t.closest("[data-dbg-ov]"));
      if (m.type === "childList") {
        for (const r of m.removedNodes) {
          if (r.nodeType !== 1) continue;
          if (r.hasAttribute("data-dbg-ov") || (r.querySelector && r.querySelector("[data-dbg-ov]"))) dbg.fx.push("ovclose");
          else if (!inOv) dbg.fx.push("rm");
        }
        for (const a of m.addedNodes) {
          if (a.nodeType === 1) { dbg.fx.push("add"); dbg.added.push(a); }
          else if (a.nodeType === 3 && a.data.trim() && !inOv) dbg.fx.push("text");
        }
        if (!m.addedNodes.length && !m.removedNodes.length) continue;
      } else if (m.type === "characterData") {
        if (!inOv) dbg.fx.push("text");
      } else if (m.type === "attributes") {
        const n = m.attributeName || "";
        if (n.startsWith("data-dbg")) continue;
        if (n.startsWith("aria-") || n === "open" || n === "hidden" || n === "checked" || n === "disabled" || n === "value") { dbg.fx.push("aria"); continue; }
        if (inOv) continue;
        if (tgt && (t === tgt || tgt.contains(t) || t.contains(tgt))) continue;   // a pressed or hover look on the button or its wrappers is not an effect
        dbg.fx.push("style");
      }
    }
  });
  const start = () => mo.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-expanded", "aria-checked", "aria-selected", "aria-pressed", "aria-hidden", "aria-current", "aria-disabled", "hidden", "open", "disabled", "checked", "value", "style", "class"] });
  start();
  const orig = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText.bind(navigator.clipboard) : null;
  if (orig) { try { navigator.clipboard.writeText = (...a) => { dbg.fx.push("clipboard"); return orig(...a).catch(() => undefined); }; } catch { /* read-only in this engine */ } }
  const ed = document.execCommand ? document.execCommand.bind(document) : null;
  if (ed) document.execCommand = (...a) => { if (a[0] === "copy") dbg.fx.push("clipboard"); return ed(...a); };
  const wo = window.open;
  window.open = (...a) => { dbg.fx.push("open"); try { return wo.apply(window, a); } catch { return null; } };
  window.addEventListener("hashchange", () => dbg.fx.push("url"));
  window.addEventListener("popstate", () => dbg.fx.push("url"));
  window.addEventListener("error", (e) => dbg.ev.push(`error ${String(e.message).slice(0, 200)}`));
  window.addEventListener("unhandledrejection", (e) => dbg.ev.push(`unhandled rejection ${String((e.reason && e.reason.message) || e.reason).slice(0, 200)}`));
  document.addEventListener("securitypolicyviolation", (e) => dbg.ev.push(`csp ${e.violatedDirective} ${String(e.blockedURI).slice(0, 60)}`));
}

/** The interactive things on screen, tagged data-dbg-i in document order. `scopeSel` limits to the overlay roots a click added. Inputs are not buttons and are left out. */
export function enumerate(scopeSel) {
  const SEL = 'button,[role=button],a[href],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=option],[role=link],summary,[tabindex="0"]';
  const roots = scopeSel ? [...document.querySelectorAll(scopeSel)] : [document.body];
  const seen = new Set();
  const out = [];
  const all = [];
  for (const r of roots) { if (scopeSel && r.matches(SEL)) all.push(r); for (const e of r.querySelectorAll(SEL)) all.push(e); }
  const matched = new Set(all);
  const shortLabel = (e) => {
    const l = e.getAttribute("aria-label") || e.getAttribute("title") || (e.innerText || "").replace(/\s+/g, " ").trim() || e.getAttribute("data-testid") || e.getAttribute("placeholder") || e.getAttribute("alt") || "";
    return l.slice(0, 48);
  };
  const structural = (e) => {
    const parts = [];
    for (let n = e, d = 0; n && n.nodeType === 1 && n !== document.body && d < 7; n = n.parentElement, d++) {
      const tid = n.getAttribute("data-testid");
      const role = n.getAttribute("role");
      parts.unshift(`${n.tagName.toLowerCase()}${role ? `[role=${role}]` : ""}${tid ? `[data-testid=${tid}]` : ""}`);
      if (tid && d > 0) break;
    }
    return parts.join(" > ");
  };
  let i = 0;
  document.querySelectorAll("[data-dbg-i]").forEach((n) => n.removeAttribute("data-dbg-i"));
  for (const e of all) {
    if (seen.has(e)) continue;
    seen.add(e);
    const tn = e.tagName;
    if (tn === "INPUT" || tn === "TEXTAREA" || tn === "SELECT") continue;
    if (e.closest("[aria-hidden=true],[inert]") && !e.closest("[data-dbg-ov]")) continue;
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const disabled = e.disabled === true || e.getAttribute("aria-disabled") === "true" || e.hasAttribute("disabled");
    const noop = e.closest("[data-noop-ok]");
    const selected = e.getAttribute("aria-selected") === "true" || e.getAttribute("aria-current") === "page" || e.getAttribute("aria-current") === "true";
    e.setAttribute("data-dbg-i", String(i));
    const href = e.getAttribute("href");
    out.push({ i: i++, label: shortLabel(e), tag: tn.toLowerCase(), role: e.getAttribute("role") || "", testid: e.getAttribute("data-testid") || "", sel: structural(e), disabled, selected, noop: noop ? noop.getAttribute("data-noop-ok") || "marked" : "", href: href || "", target: e.getAttribute("target") || "", rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], hasKids: [...e.querySelectorAll(SEL)].some((k) => matched.has(k)) });
  }
  return out;
}

/** Where a person's pointer lands on the element: a point whose topmost element is the element itself (or inside it, and not a different button). Null when something else always covers it. */
export function pointFor(idx) {
  const e = document.querySelector(`[data-dbg-i="${idx}"]`);
  if (!e) return { gone: true };
  e.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = e.getBoundingClientRect();
  const SEL = 'button,[role=button],a[href],[role=menuitem],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=option],[role=link],summary,[tabindex="0"]';
  const own = (hit) => { if (!hit) return false; if (hit === e) return true; if (!e.contains(hit)) return false; const inner = hit.closest(SEL); return inner === e || !inner || !e.contains(inner); };
  const xs = [0.5, 0.25, 0.75, 0.1, 0.9], ys = [0.5, 0.25, 0.75, 0.1, 0.9];
  let cover = "";
  for (const fy of ys) for (const fx of xs) {
    const x = Math.min(innerWidth - 1, Math.max(0, r.x + r.width * fx)), y = Math.min(innerHeight - 1, Math.max(0, r.y + r.height * fy));
    const hit = document.elementFromPoint(x, y);
    if (own(hit)) return { x, y };
    if (!cover && hit) cover = `${hit.tagName.toLowerCase()}${hit.getAttribute("data-testid") ? `[data-testid=${hit.getAttribute("data-testid")}]` : ""} ${(hit.innerText || "").replace(/\s+/g, " ").slice(0, 30)}`;
  }
  const kids = [...e.querySelectorAll(SEL)].length > 0;
  return { x: null, y: null, cover, kids };
}

/** Marks the element under test and clears the record, so the next poll is only what the click did. */
export function arm([idx, ovSel]) {
  const d = window.__dbg;
  document.querySelectorAll("[data-dbg-t]").forEach((n) => n.removeAttribute("data-dbg-t"));
  document.querySelectorAll("[data-dbg-ov]").forEach((n) => n.removeAttribute("data-dbg-ov"));
  if (ovSel) document.querySelectorAll(ovSel).forEach((n) => n.setAttribute("data-dbg-ov", "1"));
  const e = document.querySelector(`[data-dbg-i="${idx}"]`);
  if (e) e.setAttribute("data-dbg-t", "1");
  d.fx.length = 0; d.added.length = 0; d.ev.length = 0;
  d.href = location.href;
  d.active = document.activeElement;
  return !!e;
}

export function poll() {
  const d = window.__dbg;
  const fx = new Set(d.fx);
  if (location.href !== d.href) fx.add("url");
  const a = document.activeElement;
  if (a && a !== d.active && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) fx.add("focus");
  return { fx: [...fx], href: location.href, ev: d.ev.slice(0, 5), lastMut: d.lastMut, now: Date.now() };
}

/** Elements this click added that hold something to click: a menu, a dialog, a popover, a sheet. They get a marker so the next step can look inside them. */
export function markAdded() {
  const d = window.__dbg;
  const SEL = 'button,[role=button],a[href],[role=menuitem],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=option],[role=link],summary,[tabindex="0"]';
  const roots = [];
  for (const n of d.added) {
    if (!n.isConnected) continue;
    if (!(n.matches(SEL) || n.querySelector(SEL))) continue;
    // A menu, popover, dialog or sheet floats over the page; a list or pane that a click swapped in place is a new screen state, not a layer, and the crawl does not open it as one.
    let over = false;
    for (let a = n; a && a !== document.body && !over; a = a.parentElement) {
      const role = a.getAttribute("role") || "";
      const cs = getComputedStyle(a);
      if (/^(menu|dialog|alertdialog|listbox|tooltip|tree)$/.test(role) || a.getAttribute("aria-modal") === "true" || a.getAttribute("aria-haspopup") || cs.position === "fixed" || (cs.position === "absolute" && Number(cs.zIndex) >= 10) || a.parentElement === document.body) over = true;
    }
    if (over) roots.push(n);
  }
  if (!roots.length) return 0;
  document.querySelectorAll("[data-dbg-added]").forEach((n) => n.removeAttribute("data-dbg-added"));
  for (const n of roots) { const up = n.parentElement && n.parentElement.closest("[data-dbg-added]"); if (!up) n.setAttribute("data-dbg-added", "1"); }
  return roots.length;
}

/** In an overlay: the text inputs a person would fill, filled, and which buttons are still disabled afterwards. */
export function fillOverlay() {
  const out = { filled: 0 };
  for (const r of document.querySelectorAll("[data-dbg-added]")) {
    for (const inp of r.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]),textarea")) {
      if (inp.value) continue;
      const proto = inp.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const set = Object.getOwnPropertyDescriptor(proto, "value").set;
      set.call(inp, inp.type === "email" ? "test@example.com" : inp.type === "url" ? "https://example.com" : inp.type === "number" ? "1" : "Test");
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      out.filled++;
    }
  }
  return out;
}

export function clearMarks() {
  document.querySelectorAll("[data-dbg-added]").forEach((n) => n.removeAttribute("data-dbg-added"));
}

export function snapshotText() {
  return (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300);
}
