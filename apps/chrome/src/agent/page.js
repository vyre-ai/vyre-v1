// @ts-check
// The functions the extension runs inside a page through the DevTools protocol (Runtime.evaluate). Each is self-contained: the browser gets its source text
// (callExpression), so it cannot see this module, and it holds nothing between calls except what it keeps on globalThis under a Symbol: the elements of the
// latest snapshot (`els`, so a ref names an element, not a position) and the set of elements a Vault handle was filled into (`secret`, so their values are
// masked in snapshots and blurred in screenshots and scrubbed from anything that is read back).
// Ported from the 0.6 hands-chrome snapshot EXPRESSION; the page script is a real function here instead of a string.

/**
 * The source of `fn` called with `args`, as one expression for Runtime.evaluate.
 * @param {Function} fn @param {...unknown} args
 */
export function callExpression(fn, ...args) {
  return `(${fn.toString()})(${args.map((a) => JSON.stringify(a === undefined ? null : a)).join(",")})`;
}

/**
 * Read the page: every actionable control with what makes it findable again, the headings and landmarks around them, and the visible text.
 * @param {string | null} rootSelector @param {number} max most controls to list
 */
export function collectPage(rootSelector, max) {
  const g = /** @type {any} */ (globalThis);
  const secrets = g[Symbol.for("vyre.agent.secret")] || (g[Symbol.for("vyre.agent.secret")] = new WeakSet());
  const ACTIONABLE = ["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "switch", "slider", "spinbutton", "treeitem"];
  const IMPLICIT = { A: "link", BUTTON: "button", SUMMARY: "button", INPUT: "textbox", SELECT: "combobox", TEXTAREA: "textbox", OPTION: "option" };
  const INPUT_ROLE = { button: "button", submit: "button", reset: "button", image: "button", checkbox: "checkbox", radio: "radio", range: "slider", search: "searchbox", number: "spinbutton" };
  const GROUPS = "form,dialog,main,nav,aside,header,footer,[role=dialog],[role=alertdialog],[role=region],[role=navigation],[role=main],[role=form],[role=search]";
  const doc = g.document;
  const root = rootSelector ? doc.querySelector(rootSelector) : doc.documentElement;
  if (!root) return { error: "no_element" };

  /** @param {any} el */
  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    if (el.tagName === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "hidden") return null;
      return /** @type {any} */ (INPUT_ROLE)[t] || "textbox";
    }
    return /** @type {any} */ (IMPLICIT)[el.tagName] || null;
  }
  /** @param {any} el */
  function nameOf(el) {
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const text = by.split(/\s+/).map((/** @type {string} */ id) => { const t = doc.getElementById(id); return t ? t.textContent : ""; }).join(" ").trim();
      if (text) return text.replace(/\s+/g, " ").slice(0, 120);
    }
    const label = el.getAttribute("aria-label");
    if (label && label.trim()) return label.trim().slice(0, 120);
    if (el.labels && el.labels.length) { const t = [...el.labels].map((/** @type {any} */ l) => l.textContent).join(" ").replace(/\s+/g, " ").trim(); if (t) return t.slice(0, 120); }
    if (el.tagName === "INPUT" && el.placeholder) return String(el.placeholder).trim().slice(0, 120);
    if (el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.type) && el.value) return String(el.value).trim().slice(0, 120);
    const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    if (text) return text.slice(0, 120);
    const img = el.querySelector && el.querySelector("img[alt]");
    if (img && img.alt.trim()) return img.alt.trim().slice(0, 120);
    const title = el.getAttribute("title");
    return title && title.trim() ? title.trim().slice(0, 120) : "";
  }
  /** @param {any} el */
  function pathOf(el) {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 8) {
      const parent = n.parentElement;
      parts.unshift(`${n.tagName.toLowerCase()}[${parent ? [...parent.children].indexOf(n) : 0}]`);
      n = parent;
    }
    return parts.join(">");
  }
  /** @param {any} el */
  function containerOf(el) {
    const c = el.closest("form[id],form[name],[role=dialog],[role=region][aria-label],[aria-labelledby]");
    return c ? (c.getAttribute("aria-label") || c.id || c.getAttribute("name") || undefined) : undefined;
  }
  /** @param {any} el */
  function visible(el) {
    const style = g.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }
  /** @param {any} el */
  function depthOf(el) {
    let d = 0;
    let p = el.parentElement;
    while (p && p !== root) { if (p.matches(GROUPS)) d++; p = p.parentElement; }
    return d;
  }

  const els = [];
  const nodes = [];
  const seenGroups = new Set();
  let truncated = false;
  const all = root.querySelectorAll("*");
  for (const el of all) {
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") continue;
    if (el.matches(GROUPS) && !seenGroups.has(el) && visible(el)) {
      seenGroups.add(el);
      const gname = el.getAttribute("aria-label") || el.getAttribute("name") || el.id || "";
      nodes.push({ k: "g", role: el.getAttribute("role") || tag.toLowerCase(), name: String(gname).slice(0, 80), depth: depthOf(el) });
      continue;
    }
    if (/^H[1-6]$/.test(tag) && visible(el)) { nodes.push({ k: "h", level: Number(tag[1]), name: nameOf(el), depth: depthOf(el) }); continue; }
    const role = roleOf(el);
    if (!role || !ACTIONABLE.includes(role)) continue;
    const r = visible(el);
    if (!r) continue;
    if (els.length >= max) { truncated = true; break; }
    const type = (el.getAttribute("type") || "").toLowerCase();
    const ac = String(el.getAttribute("autocomplete") || "");
    const secret = type === "password" || /one-time-code|cc-number|cc-csc|cc-exp/.test(ac) || secrets.has(el);
    const c = /** @type {any} */ ({ k: "c", idx: els.length, depth: depthOf(el), role, path: pathOf(el), enabled: !(el.disabled === true || el.getAttribute("aria-disabled") === "true"), frame: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
    const name = nameOf(el);
    if (name) c.name = name; else c.nameless = true;
    const identifier = el.id || el.getAttribute("data-testid") || el.getAttribute("data-test-id");
    if (identifier) c.identifier = identifier;
    const container = containerOf(el);
    if (container) c.container = container;
    if (role === "checkbox" || role === "radio" || role === "switch" || role === "menuitemcheckbox") c.checked = el.checked === true || el.getAttribute("aria-checked") === "true";
    if (secret) c.secret = true;
    const form = el.form;
    const formGets = form && String(form.method || "get").toLowerCase() === "get";
    if ((tag === "BUTTON" && (type === "submit" || (type === "" && form))) || (tag === "INPUT" && (type === "submit" || type === "image"))) { if (form && !formGets) c.submit = true; }
    if (form && !formGets && role !== "button" && role !== "link") {
      const sub = form.querySelector("button[type=submit],button:not([type]),input[type=submit],input[type=image]");
      const subName = sub ? nameOf(sub) : "";
      if (subName) c.formSubmit = subName;
    }
    if (tag === "A" && el.href) c.href = String(el.href).slice(0, 300);
    if (g.document.activeElement === el) c.focused = true;
    if (tag === "SELECT") { const o = el.selectedOptions && el.selectedOptions[0]; if (o) c.value = String(o.textContent || "").trim().slice(0, 120); }
    else if ("value" in el && el.value !== undefined && el.value !== null && el.value !== "" && role !== "checkbox" && role !== "radio" && role !== "button") {
      if (secret) c.length = String(el.value).length; else c.value = String(el.value).slice(0, 300);
    }
    if (r.bottom < 0 || r.top > g.innerHeight || r.right < 0 || r.left > g.innerWidth) c.offscreen = true;
    els.push(el);
    nodes.push(c);
  }
  g[Symbol.for("vyre.agent.els")] = els;
  return { title: doc.title, url: g.location.href, viewport: { w: g.innerWidth, h: g.innerHeight }, text: String((rootSelector ? root.innerText : doc.body && doc.body.innerText) || "").slice(0, 20000), nodes, truncated };
}

/**
 * Bring one snapshot element into view and say where it is. `covered` names what is on top of its centre when that is not the element or part of it.
 * @param {number} idx
 */
export function revealElement(idx) {
  const g = /** @type {any} */ (globalThis);
  const els = g[Symbol.for("vyre.agent.els")];
  const el = els && els[idx];
  if (!el || !el.isConnected) return null;
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  const cx = Math.round(r.x + r.width / 2);
  const cy = Math.round(r.y + r.height / 2);
  const top = g.document.elementFromPoint(cx, cy);
  let covered = "";
  if (top && top !== el && !el.contains(top) && !top.contains(el)) {
    const lab = el.closest("label");
    const related = (lab && lab.contains(top)) || (top.closest && top.closest("label") && top.closest("label").control === el);
    if (!related) covered = String(top.getAttribute("aria-label") || top.innerText || top.tagName).trim().replace(/\s+/g, " ").slice(0, 60);
  }
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx, cy, covered, vw: g.innerWidth, vh: g.innerHeight, sx: g.scrollX, sy: g.scrollY };
}

/** Put keyboard focus on a snapshot element. @param {number} idx */
export function focusElement(idx) {
  const els = /** @type {any} */ (globalThis)[Symbol.for("vyre.agent.els")];
  const el = els && els[idx];
  if (!el || !el.isConnected || typeof el.focus !== "function") return false;
  el.focus({ preventScroll: false });
  return true;
}

/** Choose an option of a native select by its value or its label, the way a person would. @param {number} idx @param {string} wanted */
export function selectOption(idx, wanted) {
  const g = /** @type {any} */ (globalThis);
  const els = g[Symbol.for("vyre.agent.els")];
  const el = els && els[idx];
  if (!el || el.tagName !== "SELECT") return { ok: false, why: "not a native select: click it and click the option" };
  const w = String(wanted).trim().toLowerCase();
  const opts = [...el.options];
  const hit = opts.find((/** @type {any} */ o) => o.value.toLowerCase() === w) || opts.find((/** @type {any} */ o) => String(o.textContent).trim().toLowerCase() === w);
  if (!hit) return { ok: false, why: `no option called ${JSON.stringify(wanted)}`, options: opts.slice(0, 30).map((/** @type {any} */ o) => String(o.textContent).trim()) };
  el.value = hit.value;
  el.dispatchEvent(new g.Event("input", { bubbles: true }));
  el.dispatchEvent(new g.Event("change", { bubbles: true }));
  return { ok: true, label: String(hit.textContent).trim() };
}

/** Scroll the page, or one element, by a step or to an end. @param {number | null} idx @param {string} how "up" "down" "top" "bottom" or a number of pixels */
export function scrollTo(idx, how) {
  const g = /** @type {any} */ (globalThis);
  const els = g[Symbol.for("vyre.agent.els")];
  const el = idx === null ? null : els && els[idx];
  if (idx !== null && (!el || !el.isConnected)) return null;
  const box = el && el.scrollHeight > el.clientHeight + 1 ? el : null;
  const page = g.document.scrollingElement || g.document.documentElement;
  const t = box || page;
  const step = Math.round((box ? box.clientHeight : g.innerHeight) * 0.8);
  const px = /^-?\d+$/.test(how) ? Number(how) : null;
  const before = t.scrollTop;
  if (how === "top") t.scrollTop = 0;
  else if (how === "bottom") t.scrollTop = t.scrollHeight;
  else if (how === "up") t.scrollTop = before - step;
  else if (how === "down") t.scrollTop = before + step;
  else if (px !== null) t.scrollTop = before + px;
  else if (el) el.scrollIntoView({ block: "center", behavior: "instant" });
  return { top: Math.round(t.scrollTop), moved: Math.round(t.scrollTop) !== Math.round(before), atEnd: t.scrollTop + t.clientHeight >= t.scrollHeight - 1 };
}

/** What one snapshot element is: tag, role, attributes (a secret field's value is never among them), its text and box. @param {number} idx */
export function describeElement(idx) {
  const g = /** @type {any} */ (globalThis);
  const els = g[Symbol.for("vyre.agent.els")];
  const el = els && els[idx];
  if (!el || !el.isConnected) return null;
  const secrets = g[Symbol.for("vyre.agent.secret")];
  const hidden = (el.getAttribute("type") || "").toLowerCase() === "password" || (secrets && secrets.has(el));
  const attributes = /** @type {Record<string, string>} */ ({});
  for (const a of el.attributes) attributes[a.name] = a.name === "value" && hidden ? "••••" : String(a.value).slice(0, 200);
  const r = el.getBoundingClientRect();
  const s = g.getComputedStyle(el);
  return { tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || null, attributes, text: hidden ? "" : String(el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 500), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, visible: s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0, disabled: el.disabled === true, display: s.display, color: s.color, background: s.backgroundColor };
}

/** The actionable control under a point, for a click by coordinates. @param {number} x @param {number} y */
export function pointInfo(x, y) {
  const g = /** @type {any} */ (globalThis);
  const el = g.document.elementFromPoint(x, y);
  if (!el) return null;
  const c = el.closest("a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=switch],[onclick]");
  if (!c) return { actionable: false };
  const type = (c.getAttribute("type") || "").toLowerCase();
  const form = c.form;
  const name = String(c.getAttribute("aria-label") || (c.tagName === "INPUT" && /^(button|submit|reset)$/.test(type) ? c.value : "") || c.innerText || c.textContent || c.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const role = c.getAttribute("role") || (c.tagName === "A" ? "link" : c.tagName === "INPUT" && !/^(button|submit|reset|image|checkbox|radio)$/.test(type) ? "textbox" : c.tagName === "SELECT" || c.tagName === "TEXTAREA" ? "textbox" : "button");
  const submit = Boolean(form && String(form.method || "get").toLowerCase() !== "get" && ((c.tagName === "BUTTON" && (type === "submit" || type === "")) || (c.tagName === "INPUT" && (type === "submit" || type === "image"))));
  return { actionable: true, name, nameless: !name, role, submit, href: c.tagName === "A" && c.href ? String(c.href).slice(0, 300) : undefined };
}

/** Wait probes: is the page loaded, does this text appear, does this selector match. @param {"load" | "text" | "selector"} kind @param {string} value */
export function probe(kind, value) {
  const g = /** @type {any} */ (globalThis);
  if (kind === "load") return g.document.readyState === "complete";
  if (kind === "text") return Boolean(g.document.body && g.document.body.innerText.includes(value));
  try { return Boolean(g.document.querySelector(value)); } catch { return false; }
}

/** Remember that a Vault handle was filled into this element: from now on its value is masked, blurred and scrubbed. @param {number} idx */
export function markSecret(idx) {
  const g = /** @type {any} */ (globalThis);
  const els = g[Symbol.for("vyre.agent.els")];
  const el = els && els[idx];
  if (!el) return false;
  (g[Symbol.for("vyre.agent.secret")] || (g[Symbol.for("vyre.agent.secret")] = new WeakSet())).add(el);
  return true;
}

/** Blur (or restore) every secret field, for a screenshot. @param {boolean} on */
export function blurSecrets(on) {
  const g = /** @type {any} */ (globalThis);
  const secrets = g[Symbol.for("vyre.agent.secret")];
  const els = g[Symbol.for("vyre.agent.els")] || [];
  const targets = new Set([...g.document.querySelectorAll("input[type=password],input[autocomplete*=one-time-code],input[autocomplete^=cc-]")]);
  if (secrets) for (const el of els) if (secrets.has(el)) targets.add(el);
  for (const el of targets) { if (on) el.style.setProperty("filter", "blur(9px)", "important"); else el.style.removeProperty("filter"); }
  return targets.size;
}

/** Replace every secret value the page holds (in its secret fields) inside a piece of text read back from it. @param {string} text */
export function scrubSecrets(text) {
  const g = /** @type {any} */ (globalThis);
  const secrets = g[Symbol.for("vyre.agent.secret")];
  const els = g[Symbol.for("vyre.agent.els")] || [];
  const values = new Set();
  for (const el of g.document.querySelectorAll("input[type=password]")) if (el.value) values.add(String(el.value));
  if (secrets) for (const el of els) if (secrets.has(el) && el.value) values.add(String(el.value));
  let out = String(text);
  for (const v of values) {
    if (/** @type {string} */ (v).length < 3) continue;
    /** @type {string[]} */
    const forms = [/** @type {string} */ (v), encodeURIComponent(/** @type {string} */ (v))];
    try { forms.push(g.btoa(/** @type {string} */ (v))); } catch { /* not latin1 */ }
    for (const f of forms) out = out.split(f).join("••••");
  }
  return out;
}

/** One request from inside the page, with the page's own cookies and origin. The page's fetch is the only network the extension uses, and only for chrome_api. @param {{ method: string, url: string, headers: Record<string, string>, body: string | null, max: number }} req */
export async function pageRequest(req) {
  const g = /** @type {any} */ (globalThis);
  const send = g["fetch"];
  const res = await send.call(g, req.url, { method: req.method, headers: req.headers, body: req.body, credentials: "include", redirect: "follow" });
  const text = await res.text();
  /** @type {Record<string, string>} */
  const headers = {};
  res.headers.forEach((/** @type {string} */ v, /** @type {string} */ k) => { headers[k] = v; });
  return { status: res.status, mime: res.headers.get("content-type") || "", headers, body: text.length > req.max ? text.slice(0, req.max) : text, truncated: text.length > req.max };
}
