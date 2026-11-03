// @ts-check
// The save-a-login card (V1-SPEC 3.12): the person signed in with a password Vyre does not know, so this card offers to keep it.
// Drawn in a closed shadow root so the page cannot read or restyle it. The password is shown masked, with a Peek that shows it for
// 5 seconds. The worker hands us the password once, in `show`; it stays in this closure until Save, Not now, Never or 60 seconds pass,
// and is cleared in every one of those cases. Buttons report back with chrome.runtime.sendMessage; nothing is written to storage.
(function () {
  /** @type {any} */
  const g = globalThis;
  const ns = (g.__vyreExt = g.__vyreExt || {});
  const PEEK_MS = 5000;
  const LIFE_MS = 60000;
  /** @type {null | (() => void)} */
  let close = null;

  const css = `
    :host { all: initial; }
    .card { position: fixed; top: 16px; right: 16px; z-index: 2147483647; width: 320px; box-sizing: border-box; padding: 14px; border-radius: 12px;
      background: #ffffff; color: #1c1c1e; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.08); }
    @media (prefers-color-scheme: dark) { .card { background: #2c2c2e; color: #f2f2f7; box-shadow: 0 8px 30px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.1); } input[type=text] { background: #1c1c1e; color: #f2f2f7; } }
    h1 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
    label { display: block; margin: 8px 0 3px; font-size: 11px; opacity: .65; }
    input[type=text] { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid rgba(128,128,128,.4); border-radius: 6px; font: inherit; background: #f2f2f7; color: inherit; }
    .pw { display: flex; gap: 6px; align-items: center; }
    .pw output { flex: 1; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); font: 13px ui-monospace, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    button { font: inherit; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; padding: 6px 10px; cursor: pointer; }
    button.primary { background: #4338ca; border-color: #4338ca; color: #fff; }
    button:focus-visible { outline: 2px solid #4338ca; outline-offset: 2px; }
    .share { display: flex; gap: 6px; align-items: center; margin-top: 10px; }
    .seg { display: flex; margin-top: 10px; border: 1px solid rgba(128,128,128,.4); border-radius: 8px; overflow: hidden; }
    .seg button { flex: 1; border: 0; border-radius: 0; }
    .seg button[aria-pressed=true] { background: #4338ca; color: #fff; }
    select { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid rgba(128,128,128,.4); border-radius: 6px; font: inherit; background: #f2f2f7; color: inherit; }
    .who { margin-top: 6px; display: grid; gap: 4px; }
    .who label { display: flex; gap: 6px; align-items: center; margin: 0; opacity: 1; font-size: 13px; }
    .note { margin-top: 6px; font-size: 11px; opacity: .7; }
    .row { display: flex; gap: 8px; margin-top: 12px; }
    .row .grow { flex: 1; }
    .never { margin-top: 8px; width: 100%; opacity: .75; border-style: dashed; }
  `;

  /**
   * @param {{ host: string, username: string, password: string, mode: "save"|"update", name: string, agent: { id: string, name: string } | null }} p
   */
  function show(p) {
    if (close) close();
    let secret = p.password;
    p = { ...p, password: "" };
    const d = g.document;
    const host = d.createElement("div");
    const root = host.attachShadow({ mode: "closed" });
    const style = d.createElement("style");
    style.textContent = css;
    const card = d.createElement("div");
    card.className = "card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Save this login in Vyre");

    const h = d.createElement("h1");
    h.textContent = p.mode === "update" ? "Update this login in Vyre?" : "Save to Vault?";
    const nameLabel = d.createElement("label");
    nameLabel.textContent = "Name";
    const nameInput = d.createElement("input");
    nameInput.type = "text";
    nameInput.value = p.name || p.host;
    const userLabel = d.createElement("label");
    userLabel.textContent = "Username";
    const userInput = d.createElement("input");
    userInput.type = "text";
    userInput.value = p.username;
    const pwLabel = d.createElement("label");
    pwLabel.textContent = "Password";
    const pw = d.createElement("div");
    pw.className = "pw";
    const out = d.createElement("output");
    const MASK = "•".repeat(Math.min(Math.max(secret.length, 8), 16));
    out.textContent = MASK;
    const peek = d.createElement("button");
    peek.type = "button";
    peek.textContent = "Peek";
    /** @type {any} */
    let peekTimer = null;
    peek.addEventListener("click", () => {
      out.textContent = secret;
      if (peekTimer) g.clearTimeout(peekTimer);
      peekTimer = g.setTimeout(() => { out.textContent = MASK; peekTimer = null; }, PEEK_MS);
    });
    pw.append(out, peek);

    // Mine is the default and stays private. Shared opens a folder picker and an allow list of agents, filled by the worker from the Space (names and ids only).
    const cardId = Array.from(g.crypto.getRandomValues(new Uint8Array(8)), (/** @type {number} */ b) => b.toString(16).padStart(2, "0")).join("");
    let scope = "mine";
    /** @type {{ id: string, name: string }[]} */
    let folders = [];
    /** @type {any[]} */
    const agentBoxes = [];
    const seg = d.createElement("div");
    seg.className = "seg";
    const mineBtn = d.createElement("button");
    mineBtn.type = "button";
    mineBtn.textContent = "Mine";
    const sharedBtn = d.createElement("button");
    sharedBtn.type = "button";
    sharedBtn.textContent = "Shared";
    seg.append(mineBtn, sharedBtn);
    const sharedBox = d.createElement("div");
    sharedBox.style.display = "none";
    const folderLabel = d.createElement("label");
    folderLabel.textContent = "Folder";
    const folderSel = d.createElement("select");
    const who = d.createElement("div");
    who.className = "who";
    const whoLabel = d.createElement("label");
    whoLabel.textContent = "Agents that can use it";
    const note = d.createElement("div");
    note.className = "note";
    sharedBox.append(folderLabel, folderSel, whoLabel, who, note);
    const paint = () => {
      mineBtn.setAttribute("aria-pressed", String(scope === "mine"));
      sharedBtn.setAttribute("aria-pressed", String(scope === "shared"));
      sharedBox.style.display = scope === "shared" ? "" : "none";
      note.textContent = scope === "shared" && !folders.length ? "There is no shared folder you can add to. Ask a manager, or keep it in Mine." : "";
    };
    mineBtn.addEventListener("click", () => { scope = "mine"; paint(); });
    sharedBtn.addEventListener("click", () => {
      scope = "shared";
      paint();
      if (folderSel.options.length || who.childNodes.length) return;
      try {
        g.chrome.runtime.sendMessage({ type: "vyre.choices" }, (/** @type {any} */ r) => {
          const data = r && r.data;
          if (!data) { note.textContent = "Vyre could not list your shared folders. Keep it in Mine, or try again."; return; }
          folders = data.folders;
          for (const f of folders) { const o = d.createElement("option"); o.value = f.id; o.textContent = f.name; folderSel.append(o); }
          for (const a of data.agents) {
            const l = d.createElement("label");
            const c = d.createElement("input");
            c.type = "checkbox";
            c.value = a.id;
            c.checked = Boolean(a.suggested);
            agentBoxes.push(c);
            l.append(c, d.createTextNode(a.name));
            who.append(l);
          }
          paint();
        });
      } catch { note.textContent = "Vyre could not list your shared folders."; }
    });
    paint();

    const row = d.createElement("div");
    row.className = "row";
    const save = d.createElement("button");
    save.type = "button";
    save.className = "primary grow";
    save.textContent = p.mode === "update" ? "Update" : "Save";
    const later = d.createElement("button");
    later.type = "button";
    later.className = "grow";
    later.textContent = "Not now";
    row.append(save, later);
    const never = d.createElement("button");
    never.type = "button";
    never.className = "never";
    never.textContent = "Never for this site";

    card.append(h, nameLabel, nameInput, userLabel, userInput, pwLabel, pw);
    if (p.mode !== "update") card.append(seg, sharedBox);
    card.append(row, never);
    root.append(style, card);
    (d.documentElement || d.body).appendChild(host);
    save.focus();

    /** @type {any} */
    let life = null;
    function done() {
      secret = "";
      if (peekTimer) g.clearTimeout(peekTimer);
      if (life) g.clearTimeout(life);
      host.remove();
      close = null;
    }
    close = done;
    /** @param {string} type @param {Record<string, any>} [extra] */
    function tell(type, extra) {
      try { g.chrome.runtime.sendMessage({ type, ...extra }); } catch { /* extension reloaded */ }
    }
    save.addEventListener("click", () => {
      const agentIds = agentBoxes.filter((c) => c.checked).map((c) => c.value);
      tell("vyre.save", { name: nameInput.value, username: userInput.value, password: secret, scope, folderId: scope === "shared" ? folderSel.value : undefined, agentIds: scope === "shared" ? agentIds : [], cardId, mode: p.mode });
      done();
    });
    later.addEventListener("click", () => { tell("vyre.dismiss", { never: false }); done(); });
    never.addEventListener("click", () => { tell("vyre.dismiss", { never: true }); done(); });
    card.addEventListener("keydown", (/** @type {any} */ e) => {
      if (e.key === "Escape") { tell("vyre.dismiss", { never: false }); done(); }
      else if (e.key === "Enter" && e.target !== never && e.target !== later && e.target !== peek) save.click();
    });
    life = g.setTimeout(() => { tell("vyre.dismiss", { never: false }); done(); }, LIFE_MS);
    return true;
  }

  ns.prompt = { show, hide: () => { if (close) close(); } };
})();
