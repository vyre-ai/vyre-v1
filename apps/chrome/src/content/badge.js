// @ts-check
// The Vyre badge in a sign-in field and the account picker it opens (V1-SPEC 3.12, "Sign in with Vault"). A classic content script, like prompt.js: it adds nothing to the page's
// own DOM except one host element whose closed shadow root holds the badge and the picker, so the page can read and style neither. The badge shows when a sign-in or card field has
// focus; a click (a real one: a page cannot press it) asks the worker for the accounts that fit this address, names only; picking one asks the worker to fill it. No value passes here.
(function () {
  /** @type {any} */
  const g = globalThis;
  const ns = (g.__vyreExt = g.__vyreExt || {});
  const SIZE = 20;

  const css = `
    :host { all: initial; }
    .badge { position: fixed; z-index: 2147483646; width: ${SIZE}px; height: ${SIZE}px; box-sizing: border-box; border-radius: 6px; border: 0; padding: 0; background: #4338ca; color: #fff;
      font: 700 12px/${SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: center; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
    .badge:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 2px; }
    .pick { position: fixed; z-index: 2147483647; min-width: 220px; max-width: 320px; box-sizing: border-box; padding: 6px; border-radius: 12px; background: #fff; color: #1c1c1e;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.08); }
    @media (prefers-color-scheme: dark) { .pick { background: #2c2c2e; color: #f2f2f7; box-shadow: 0 8px 30px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.1); } }
    .head { padding: 4px 8px 6px; font-size: 11px; opacity: .65; }
    .row { display: flex; width: 100%; gap: 8px; align-items: center; padding: 7px 8px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .row:hover, .row:focus-visible { background: rgba(67,56,202,.14); outline: none; }
    .note { padding: 8px; opacity: .75; }
  `;

  /** @type {null | { host: any, root: any, badge: any, pick: any, field: any, off: () => void }} */
  let ui = null;

  /** @param {any} el */
  function wanted(el) {
    if (!el || el.tagName !== "INPUT" || !ns.finder) return null;
    if (ns.finder.classify(el)) return "login";
    const card = ns.finder.findCardFields(g.document);
    return card.number === el ? "card" : null;
  }

  function hide() {
    if (!ui) return;
    ui.off();
    ui.host.remove();
    ui = null;
  }

  /** @param {any} field */
  function place(field) {
    if (!ui) return;
    const r = field.getBoundingClientRect();
    if (r.width < 60 || r.height < 18) { hide(); return; }
    ui.badge.style.left = Math.round(r.right - SIZE - 6) + "px";
    ui.badge.style.top = Math.round(r.top + (r.height - SIZE) / 2) + "px";
    if (ui.pick.isConnected) { ui.pick.style.left = Math.max(8, Math.round(r.right - 240)) + "px"; ui.pick.style.top = Math.round(r.bottom + 6) + "px"; }
  }

  /** @param {any} field @param {"login"|"card"} kind */
  function show(field, kind) {
    if (ui && ui.field === field) { place(field); return; }
    hide();
    const d = g.document;
    const host = d.createElement("div");
    const root = host.attachShadow({ mode: "closed" });
    const style = d.createElement("style");
    style.textContent = css;
    const badge = d.createElement("button");
    badge.type = "button";
    badge.className = "badge";
    badge.textContent = "V";
    badge.setAttribute("aria-label", kind === "card" ? "Fill a card from Vyre" : "Sign in with Vyre");
    const pick = d.createElement("div");
    pick.className = "pick";
    pick.setAttribute("role", "menu");
    root.append(style, badge);
    (d.documentElement || d.body).appendChild(host);
    const onMove = () => place(field);
    g.addEventListener("scroll", onMove, true);
    g.addEventListener("resize", onMove);
    const off = () => { g.removeEventListener("scroll", onMove, true); g.removeEventListener("resize", onMove); };
    ui = { host, root, badge, pick, field, off };
    place(field);

    badge.addEventListener("mousedown", (/** @type {any} */ e) => e.preventDefault()); // keep the field focused
    badge.addEventListener("click", (/** @type {any} */ e) => {
      if (!e.isTrusted) return;
      if (pick.isConnected) { pick.remove(); return; }
      pick.textContent = "";
      const note = d.createElement("div");
      note.className = "note";
      note.textContent = "Looking in your Vault";
      pick.append(note);
      root.append(pick);
      place(field);
      try {
        g.chrome.runtime.sendMessage({ type: "vyre.accounts", kind }, (/** @type {any} */ r) => {
          pick.textContent = "";
          const rows = r && r.data ? r.data.rows : [];
          const head = d.createElement("div");
          head.className = "head";
          head.textContent = kind === "card" ? "Cards in your Vault" : "Sign in with Vault";
          pick.append(head);
          if (!r || !r.data) { note.textContent = r && r.error ? r.error.message : "Vyre did not answer."; pick.append(note); return; }
          if (r.data.blocked) { note.textContent = "Filling is turned off for this site."; pick.append(note); return; }
          if (!rows.length) { note.textContent = kind === "card" ? "No saved card." : "No saved login for this site."; pick.append(note); return; }
          for (const row of rows) {
            const b = d.createElement("button");
            b.type = "button";
            b.className = "row";
            b.setAttribute("role", "menuitem");
            b.textContent = row.name;
            b.addEventListener("click", (/** @type {any} */ ev) => {
              if (!ev.isTrusted) return;
              try { g.chrome.runtime.sendMessage({ type: "vyre.fill", itemId: row.id, kind: row.kind === "card" ? "card" : row.kind === "totp" ? "otp" : "login", usernameField: row.usernameField }); } catch { /* reloaded */ }
              hide();
            });
            pick.append(b);
          }
          if (pick.firstChild && pick.children && pick.children[1]) pick.children[1].focus?.();
        });
      } catch { note.textContent = "Vyre did not answer."; }
    });
    pick.addEventListener("keydown", (/** @type {any} */ e) => { if (e.key === "Escape") { pick.remove(); field.focus?.(); } });
  }

  g.document.addEventListener("focusin", (/** @type {any} */ e) => {
    const kind = wanted(e.target);
    if (kind) show(e.target, /** @type {"login"|"card"} */ (kind)); else if (ui && !(ui.host === e.target)) hide();
  }, true);
  g.document.addEventListener("focusout", () => {
    g.setTimeout(() => {
      const a = g.document.activeElement;
      if (ui && a !== ui.field && a !== ui.host) hide();
    }, 150);
  }, true);

  ns.badge = { hide };
})();
