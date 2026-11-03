// @ts-check
// "Show Vyre how": the recorder in the page and its step bar (prototype "Show it once"). The worker injects this file into a tab only while a recording is running, so a page
// that is not being recorded never has it. It sees clicks, what is typed into a field once the person leaves it, a choice in a list and the Enter key, and tells the worker what
// the thing was by its role and name (never a selector, an address of the page's own, or the page's text).
//
// A password, a one-time code or a card field is never read: for those fields this file does not touch .value at all, it only says "a secret field was used". The worker turns
// that into the step "Sign in with Vault". The bar is in a closed shadow root, so the page can neither read nor restyle it.
(function () {
  /** @type {any} */
  const g = globalThis;
  const ns = (g.__vyreExt = g.__vyreExt || {});
  if (ns.recInstalled) { if (ns.rec) ns.rec.hello(); return; }
  ns.recInstalled = true;
  const doc = g.document;
  const isTop = g.top === g;
  let paused = false;
  let count = 0;
  let sawSecret = false;
  /** @type {any} */
  let host = null;
  /** @type {any} */
  let refs = null;

  const send = (/** @type {any} */ m) => new Promise((resolve) => {
    try { g.chrome.runtime.sendMessage(m, (/** @type {any} */ r) => { void g.chrome.runtime.lastError; resolve(r); }); } catch { resolve(null); }
  });

  // ---------- what a control is

  const SECRET_NAME = /pass(word|code|wd)?\b|\bpwd\b|\bpin\b|cvc|cvv|card.?num|security.?code|\botp\b|one.?time|totp|2fa|mfa|verification.?code|\bssn\b/i;
  /** Whether a field holds something that must never be recorded, judged only from its attributes. Returns "password", "code", "card" or "". @param {any} el */
  function secretKind(el) {
    if (!el || !el.getAttribute) return "";
    const type = String(el.getAttribute("type") || "").toLowerCase();
    const auto = String(el.getAttribute("autocomplete") || "").toLowerCase();
    if (type === "password" || auto.includes("password")) return "password";
    if (auto === "one-time-code") return "code";
    if (/^cc-/.test(auto)) return "card";
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const words = `${el.getAttribute("name") || ""} ${el.id || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("placeholder") || ""}`;
      if (type !== "email" && type !== "search" && SECRET_NAME.test(words)) return /otp|one.?time|totp|2fa|mfa|verification/i.test(words) ? "code" : /card|cvc|cvv|security/i.test(words) ? "card" : "password";
    }
    return "";
  }

  const clip = (/** @type {string} */ s, /** @type {number} */ n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

  /** The name a person would call a control: its label, then what it says. @param {any} el */
  function nameOf(el) {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return clip(aria, 80);
    const by = el.getAttribute && el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((/** @type {string} */ id) => { const e = doc.getElementById(id); return e ? e.textContent : ""; }).join(" ");
      if (clip(t, 80)) return clip(t, 80);
    }
    if (el.labels && el.labels.length) { const t = clip(el.labels[0].textContent, 80); if (t) return t; }
    const lab = el.closest && el.closest("label");
    if (lab) { const t = clip(lab.textContent, 80); if (t) return t; }
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      const t = clip(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "", 80);
      if (t) return t;
      if (tag === "INPUT" && /^(submit|button|reset)$/i.test(el.type)) return clip(el.value, 80);
    }
    if (tag === "IMG") return clip(el.getAttribute("alt"), 80);
    const title = el.getAttribute && el.getAttribute("title");
    const text = clip(el.innerText || el.textContent, 80);
    return text || clip(title, 80) || clip(el.querySelector && el.querySelector("img[alt]") ? el.querySelector("img[alt]").getAttribute("alt") : "", 80);
  }

  /** @param {any} el */
  function roleOf(el) {
    const r = el.getAttribute && el.getAttribute("role");
    if (r) return r;
    const tag = el.tagName;
    if (tag === "A" && el.hasAttribute("href")) return "link";
    if (tag === "BUTTON" || tag === "SUMMARY") return "button";
    if (tag === "SELECT") return "combobox";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "INPUT") {
      const t = String(el.type || "text").toLowerCase();
      if (/^(submit|button|reset|image)$/.test(t)) return "button";
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      return "textbox";
    }
    return "generic";
  }

  const CLICKABLE = 'a[href], button, summary, select, [role=button], [role=link], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], [role=treeitem], [role=option], [role=checkbox], [role=radio], [role=switch], input[type=submit], input[type=button], input[type=reset], input[type=image], input[type=checkbox], input[type=radio], label[for], [onclick]';
  /** The control a click was meant for. @param {any} el */
  function controlOf(el) {
    let n = el;
    while (n && n.nodeType === 1 && n !== doc.documentElement) {
      if (n.matches && n.matches(CLICKABLE)) return n;
      n = n.parentElement;
    }
    return el && el.nodeType === 1 ? el : null;
  }
  const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=file]):not([type=hidden]), textarea, select, [contenteditable=""], [contenteditable=true]';

  /** @param {any} el */
  const targetOf = (el) => ({ role: roleOf(el), name: nameOf(el), tag: String(el.tagName || "").toLowerCase(), ...(el.type && el.tagName === "INPUT" ? { type: String(el.type).toLowerCase() } : {}) });

  /** Whether the event happened on the step bar itself. @param {any} e */
  const onBar = (e) => Boolean(host && e.composedPath && e.composedPath().includes(host));

  /** @param {any} m */
  function step(m) {
    if (paused) return;
    send({ type: "vyre.rec.step", url: g.location.href, top: isTop, ...m });
  }

  // ---------- what the person does

  doc.addEventListener("click", (/** @type {any} */ e) => {
    if (!e.isTrusted || onBar(e) || paused) return;
    const el = controlOf(e.target);
    if (!el) return;
    const secret = secretKind(el);
    if (secret) { step({ kind: "secret", what: secret, target: targetOf(el) }); return; }
    if (el.matches && el.matches(FIELD)) return; // focusing a field is not a step; typing in it is
    const t = targetOf(el);
    if (!t.name && t.role === "generic") return;
    step({ kind: "click", target: t, submit: Boolean(el.type && /^(submit|image)$/i.test(el.type)) || (el.tagName === "BUTTON" && (!el.type || el.type === "submit")) });
  }, true);

  doc.addEventListener("change", (/** @type {any} */ e) => {
    if (!e.isTrusted || onBar(e) || paused) return;
    const el = e.target;
    if (!el || !el.matches || !el.matches(FIELD)) return;
    const secret = secretKind(el);
    if (secret) { step({ kind: "secret", what: secret, target: targetOf(el) }); return; } // .value is never read for these
    if (el.tagName === "SELECT") {
      const opt = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      step({ kind: "select", target: targetOf(el), value: clip(opt ? opt.textContent : "", 200) });
      return;
    }
    step({ kind: "type", target: targetOf(el), value: String(el.value !== undefined ? el.value : el.textContent || "").slice(0, 2000) });
  }, true);

  doc.addEventListener("keydown", (/** @type {any} */ e) => {
    if (!e.isTrusted || onBar(e) || paused || e.key !== "Enter" || e.isComposing) return;
    const el = e.target;
    if (!el || !el.matches) return;
    if (secretKind(el)) { step({ kind: "secret", what: secretKind(el), enter: true, target: targetOf(el) }); return; }
    if (el.matches("input, select") && !el.matches("[type=submit],[type=button]")) {
      // the typed value is recorded when the field is left; Enter right after it submits
      g.setTimeout(() => step({ kind: "press", value: "Enter" }), 60);
    }
  }, true);

  // ---------- the step bar

  function build() {
    host = doc.createElement("div");
    host.setAttribute("data-vyre-recbar", "");
    host.style.cssText = "all:initial;position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    const dark = g.matchMedia && g.matchMedia("(prefers-color-scheme: dark)").matches;
    const st = doc.createElement("style");
    st.textContent = `.b{display:flex;align-items:center;gap:10px;padding:6px 6px 6px 12px;border-radius:12px;white-space:nowrap;font:500 12.5px/1 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
      background:${dark ? "#201E29" : "#fff"};color:${dark ? "#F2F0F7" : "#17141F"};box-shadow:0 0 0 1px ${dark ? "rgba(255,255,255,.1)" : "rgba(23,20,31,.08)"},0 10px 24px -8px rgba(23,20,31,.25),0 2px 6px rgba(23,20,31,.08)}
      .d{width:9px;height:9px;border-radius:50%;background:${dark ? "#FF8A66" : "#EE5A38"};flex:none;animation:p 1.4s ease-in-out infinite}.pz .d{animation:none;background:${dark ? "#928DA2" : "#A29DAF"}}
      @keyframes p{50%{opacity:.35}}@media (prefers-reduced-motion:reduce){.d{animation:none}}
      .n{color:${dark ? "#928DA2" : "#6A6578"};font-weight:400}.w{display:none;align-items:center;gap:5px;font-size:11.5px;font-weight:400;color:${dark ? "#5AD6A2" : "#16805A"}}.w.on{display:flex}
      button{all:unset;box-sizing:border-box;height:28px;padding:0 10px;border-radius:8px;display:flex;align-items:center;gap:6px;cursor:pointer;font:500 12.5px/1 inherit;font-family:inherit;box-shadow:inset 0 0 0 1px ${dark ? "rgba(255,255,255,.14)" : "rgba(23,20,31,.13)"}}
      button:hover{background:${dark ? "rgba(255,255,255,.06)" : "rgba(23,20,31,.045)"}}button:focus-visible{outline:2px solid rgba(90,63,240,.45)}
      button.s{background:${dark ? "#F2F0F7" : "#17141F"};color:${dark ? "#120E24" : "#fff"};box-shadow:none}svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}`;
    const NS = "http://www.w3.org/2000/svg";
    const icon = (/** @type {string[]} */ paths) => { const s = doc.createElementNS(NS, "svg"); s.setAttribute("viewBox", "0 0 16 16"); s.setAttribute("aria-hidden", "true"); for (const d of paths) { const p = doc.createElementNS(NS, "path"); p.setAttribute("d", d); s.append(p); } return s; };
    const box = doc.createElement("div");
    box.className = "b";
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Vyre is recording");
    const dot = doc.createElement("span"); dot.className = "d";
    const label = doc.createElement("span"); label.className = "l";
    const state = doc.createElement("b"); state.textContent = "Recording";
    const num = doc.createElement("span"); num.className = "n";
    label.append(state, num);
    const warn = doc.createElement("span"); warn.className = "w"; warn.append(icon(["M4 7.5V6a4 4 0 018 0v1.5", "M3.5 7.5h9v6h-9z"]), doc.createTextNode("Password not recorded"));
    const pause = doc.createElement("button"); pause.dataset["k"] = "pause";
    const stop = doc.createElement("button"); stop.className = "s"; stop.dataset["k"] = "stop"; stop.append(icon(["M4.5 4.5h7v7h-7z"]), doc.createTextNode("Stop"));
    box.append(dot, label, warn, pause, stop);
    box.addEventListener("click", (/** @type {any} */ e) => {
      const b = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!b || !e.isTrusted) return;
      e.stopPropagation();
      send({ type: "vyre.rec.ctl", op: b.dataset["k"] });
    });
    root.append(st, box);
    doc.documentElement.append(host);
    refs = { box, state, num, warn, pause, icon };
    paint();
  }

  function paint() {
    if (!refs) return;
    refs.box.className = paused ? "b pz" : "b";
    refs.state.textContent = paused ? "Paused" : "Recording";
    refs.num.textContent = ` · ${count} step${count === 1 ? "" : "s"}`;
    refs.warn.className = sawSecret ? "w on" : "w";
    refs.pause.replaceChildren(refs.icon(paused ? ["M5 3.5l7 4.5-7 4.5z"] : ["M6 4v8", "M10 4v8"]), doc.createTextNode(paused ? "Resume" : "Pause"));
  }

  /** @param {{ paused?: boolean, count?: number, secret?: boolean, done?: boolean }} s */
  function apply(s) {
    if (s.done) { if (host) host.remove(); host = null; refs = null; ns.recInstalled = false; ns.rec = null; return; }
    paused = Boolean(s.paused);
    count = Number(s.count || 0);
    if (s.secret) sawSecret = true;
    if (isTop) { if (!host) build(); else paint(); }
  }

  function hello() { send({ type: "vyre.rec.hello" }).then((/** @type {any} */ r) => { if (r && r.data) apply(r.data); }); }

  g.chrome.runtime.onMessage.addListener((/** @type {any} */ m) => { if (m && m.type === "vyre.rec.state") apply(m); });
  ns.rec = { hello, apply };
  hello();
})();
