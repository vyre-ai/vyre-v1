// @ts-check
// The agent frame (V1-SPEC 3.12): while an agent drives a tab the tab wears an indigo frame, a bar that reads "<Agent> is using this tab" with a Stop button, and
// the agent's named cursor. The worker injects these functions with chrome.scripting.executeScript (each is self-contained, like page.js) and removes them the
// moment the agent is idle, stopped or paused, so the frame shows only while an agent drives. Stop and Esc reach the worker over a port named by the caller.
// Everything lives in a closed shadow root at the top of the page's stacking order; the page can cover nothing and the frame never takes a click except on Stop.

/**
 * Show or update the frame and bar. Returns true when drawn.
 * @param {{ name: string, goal?: string, paused?: boolean, waiting?: boolean, state?: "takeover" | "stopped", color?: string, port: string }} o
 */
export function overlayShow(o) {
  const g = /** @type {any} */ (globalThis);
  const KEY = Symbol.for("vyre.agent.overlay");
  const doc = g.document;
  if (!doc || !doc.documentElement) return false;
  let s = g[KEY];
  if (!s || !s.host.isConnected) {
    g.__vyreGen = (g.__vyreGen || 0) + 1;
    const gen = g.__vyreGen;
    const host = doc.createElement("div");
    host.setAttribute("data-vyre-agent-overlay", "");
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const root = host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    // Matches the approved prototype's in-Chrome bar (prototype/vyre-chrome.html .vov, .abar): a 2px inset frame in the agent's group colour, a bar 18px from the bottom with a dark 92% panel, 12px
    // corners, the agent's initial, bold name, 26px translucent buttons and an Esc key cap.
    style.textContent = [
      ".frame{position:fixed;inset:0;box-sizing:border-box;box-shadow:inset 0 0 0 2px var(--grp,#4f46e5);pointer-events:none}",
      ".frame.paused{box-shadow:none;border:2px dashed #6b7280}",
      ".bar{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);padding:6px 6px 6px 8px;background:rgba(23,20,31,.92);backdrop-filter:blur(8px);color:#F2F0F7;border-radius:12px;font:12.5px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28);pointer-events:auto;white-space:nowrap}",
      ".dot{flex:none;width:20px;height:20px;border-radius:50%;background:var(--grp,#4f46e5);color:#fff;font:600 11px/20px system-ui,-apple-system,Segoe UI,sans-serif;text-align:center}",
      ".paused .dot{background:#9ca3af}",
      ".t{overflow:hidden;text-overflow:ellipsis}",
      ".goal{color:#c9c5d6;overflow:hidden;text-overflow:ellipsis;max-width:36ch}",
      ".stop,.take,.open{flex:none;display:inline-flex;align-items:center;gap:6px;border:0;border-radius:8px;height:26px;padding:0 10px;background:rgba(255,255,255,.1);color:#fff;font:500 12.5px/1 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer}",
      ".stop:hover,.take:hover,.open:hover{background:rgba(255,255,255,.18)}.stop:focus-visible,.take:focus-visible,.open:focus-visible{outline:2px solid #a5b4fc;outline-offset:2px}",
      ".hint{background:rgba(255,255,255,.12);color:#ddd;border-radius:4px;padding:1px 5px;font-size:11px}",
      "@media (max-width:560px){.goal{display:none}.bar{gap:8px}}",
      ".cursor{position:fixed;left:0;top:0;display:none;pointer-events:none;will-change:transform}",
      "@media (prefers-reduced-motion:no-preference){.cursor.go{transition:transform .14s ease-out}}",
      ".chip{position:absolute;left:14px;top:16px;padding:2px 7px;border-radius:6px;background:var(--grp,#4f46e5);color:#fff;font:600 11px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;white-space:nowrap}",
    ].join("");
    const frame = doc.createElement("div");
    frame.className = "frame";
    const bar = doc.createElement("div");
    bar.className = "bar";
    bar.setAttribute("role", "status");
    const dot = doc.createElement("span");
    dot.className = "dot";
    dot.textContent = String(o.name || "?")
      .trim()
      .charAt(0)
      .toUpperCase();
    const text = doc.createElement("span");
    text.className = "t";
    const goal = doc.createElement("span");
    goal.className = "goal";
    const take = doc.createElement("button");
    take.className = "take";
    take.type = "button";
    const handNs = "http://www.w3.org/2000/svg";
    const hand = doc.createElementNS(handNs, "svg");
    for (const [k, v] of [
      ["width", "13"],
      ["height", "13"],
      ["viewBox", "0 0 16 16"],
      ["fill", "none"],
      ["stroke", "currentColor"],
      ["stroke-width", "1.4"],
      ["stroke-linecap", "round"],
      ["stroke-linejoin", "round"],
    ])
      hand.setAttribute(/** @type {string} */ (k), /** @type {string} */ (v));
    const hp = doc.createElementNS(handNs, "path");
    hp.setAttribute(
      "d",
      "M5.5 8.5V3.8a1 1 0 012 0V7m0-3.4a1 1 0 012 0V7m0-2.4a1 1 0 012 0V9m0-3.2a1 1 0 012 0v3.4c0 2.6-1.700 4.300-4 4.300-1.800 0-2.800-.8-3.800-2.300L3 9.800a1 1 0 011.500-1.200z",
    );
    hand.append(hp);
    take.append(hand, " Take over");
    const stop = doc.createElement("button");
    stop.className = "stop";
    stop.type = "button";
    stop.append("Stop ");
    const hint = doc.createElement("kbd");
    hint.className = "hint";
    hint.textContent = "Esc";
    stop.append(hint);
    const open = doc.createElement("button");
    open.className = "open";
    open.type = "button";
    open.textContent = "Open in Vyre";
    const give = doc.createElement("button");
    give.className = "open";
    give.type = "button";
    give.textContent = "Give back";
    const resume = doc.createElement("button");
    resume.className = "open";
    resume.type = "button";
    resume.textContent = "Resume";
    const end = doc.createElement("button");
    end.className = "open";
    end.type = "button";
    end.textContent = "End task";
    bar.append(dot, text, goal, take, stop, open, give, resume, end);
    const cursor = doc.createElement("div");
    cursor.className = "cursor";
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = doc.createElementNS(svgNs, "svg");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("viewBox", "0 0 18 18");
    const arrow = doc.createElementNS(svgNs, "path");
    arrow.setAttribute("d", "M2 1l13 7-5.5 1.6L7 15z");
    arrow.setAttribute("fill", "#4f46e5");
    arrow.setAttribute("stroke", "#fff");
    arrow.setAttribute("stroke-width", "1.2");
    arrow.setAttribute("stroke-linejoin", "round");
    svg.append(arrow);
    const chip = doc.createElement("span");
    chip.className = "chip";
    cursor.append(svg, chip);
    root.append(style, frame, bar, cursor);
    doc.documentElement.append(host);

    const port =
      g.chrome && g.chrome.runtime && g.chrome.runtime.connect ? g.chrome.runtime.connect({ name: o.port }) : null;
    // A button on the bar acts when it is pressed, not when it is let go: the bar is drawn again as the agent works (its line grows, it moves) and a release that lands somewhere else
    // is no click, so a person's press on Stop or Take over, the one moment it matters, would be lost. The click that follows a press is ignored; a click with no press (the keyboard) acts.
    // End and Open Vyre are the exceptions: End cannot be undone and Open Vyre opens a tab, and neither is urgent, so they act when the button is let go on it and a person can slide off to cancel.
    // Each message says where the press was (rounded), so the worker can tell the agent's own click on the bar from a person's hand and ignore it.
    // every listener on the page's window is taken off again when the overlay goes (overlayHide), so they do not pile up across tasks
    /** @type {Array<() => void>} */
    const cleanup = [];
    const listen = (/** @type {string} */ type, /** @type {any} */ f) => {
      g.addEventListener(type, f, true);
      cleanup.push(() => g.removeEventListener(type, f, true));
    };
    /** @param {any} btn @param {(at: { x?: number, y?: number, key?: boolean }) => void} fn @param {boolean} [onRelease] */
    const onPress = (btn, fn, onRelease = false) => {
      let pressed = false;
      // where the press was, rounded; a keyboard click (detail 0) has no place
      const where = (/** @type {any} */ e, keyboardTest = false) =>
        e && !(keyboardTest && e.detail === 0) && Number.isFinite(e.clientX)
          ? { x: Math.round(e.clientX), y: Math.round(e.clientY) }
          : {};
      if (!onRelease) {
        btn.addEventListener("pointerdown", (/** @type {any} */ e) => {
          if (!e.isTrusted || (e.button !== undefined && e.button !== 0)) return;
          e.preventDefault();
          e.stopPropagation();
          pressed = true;
          fn(where(e));
        });
        // the gesture is over when the pointer goes up or is cancelled: a press let go elsewhere must not swallow a later keyboard click
        for (const t of ["pointerup", "pointercancel"]) listen(t, () => void setTimeout(() => (pressed = false), 0));
      }
      btn.addEventListener("click", (/** @type {any} */ e) => {
        e.preventDefault();
        e.stopPropagation();
        // a click a script made (element.click(), dispatchEvent) is never a person's: only the browser's own click, from a hand or a key, acts
        if (!e.isTrusted) return;
        if (pressed) {
          pressed = false;
          return;
        }
        // a click with no pointer (detail 0) came from the keyboard: say so, so the worker can tell a person's Enter from the agent's
        fn({ ...where(e, true), ...(e.detail === 0 ? { key: true } : {}) });
      });
    };
    onPress(stop, (at) => port && port.postMessage({ agent: o.agent, type: "stop", gen, tr: true, ...at }));
    onPress(open, (at) => port && port.postMessage({ agent: o.agent, type: "openvyre", ...at }), true);
    onPress(give, (at) => port && port.postMessage({ agent: o.agent, type: "giveback", ...at }));
    onPress(resume, (at) => port && port.postMessage({ agent: o.agent, type: "giveback", ...at }));
    onPress(end, (at) => port && port.postMessage({ agent: o.agent, type: "endtask", ...at }), true);
    onPress(take, (at) => port && port.postMessage({ agent: o.agent, type: "takeover", gen, tr: true, ...at }));
    // The person's own hand on the page: a real click, key, scroll or touch tells the worker, which hands the tab to the person unless the agent is acting in it at that moment
    // (the agent's own clicks arrive as real events too). Nothing about the event leaves the page, only that it happened; the bar's own buttons are not touches.
    let lastTouch = 0;
    const onTouch = (/** @type {any} */ e) => {
      if (!e.isTrusted || !port || s.paused) return;
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      if (path.includes(host)) return;
      // only what the worker needs to tell the person's hand from the agent's own input: the kind of event, for a pointer where, for a key its physical key code (on a normal layout that names the character). It goes to the extension's own worker only, which matches it and keeps nothing; none of it is stored or leaves the extension
      const kind = e.type === "keydown" ? "key" : e.type === "wheel" ? "wheel" : "pointer";
      const at = e.touches && e.touches[0] ? e.touches[0] : e;
      const t = Date.now();
      // a scroll comes in a flood, so it is one touch; every click and every key counts, and the worker matches each against what the agent sent
      if (kind === "wheel") {
        if (t - lastTouch < 500) return;
        lastTouch = t;
      }
      port.postMessage({
        type: "touch",
        kind,
        x: Math.round(Number(at.clientX) || 0),
        y: Math.round(Number(at.clientY) || 0),
        ...(kind === "key" ? { code: String(e.code || "").slice(0, 20) } : {}),
      });
    };
    for (const type of ["pointerdown", "wheel", "touchstart"]) listen(type, onTouch);
    const onKey = (/** @type {any} */ e) => {
      if (e.key === "Escape" && !s.paused && port) port.postMessage({ type: "esc" });
      else onTouch(e);
    };
    listen("keydown", onKey);
    s = {
      host,
      frame,
      bar,
      text,
      goal,
      stop,
      take,
      hint,
      open,
      give,
      resume,
      end,
      cursor,
      chip,
      port,
      onKey,
      cleanup: () => {
        for (const f of cleanup.splice(0)) f();
      },
      paused: false,
      moved: false,
    };
    g[KEY] = s;
  }
  s.paused = Boolean(o.paused);
  const state = o.state === "takeover" || o.state === "stopped" ? o.state : "";
  const waiting = !s.paused && !state && Boolean(o.waiting);
  s.frame.className = s.paused ? "frame paused" : "frame";
  if (o.color) s.host.style.setProperty("--grp", String(o.color));
  s.bar.className = s.paused ? "bar paused" : waiting ? "bar waiting" : "bar";
  s.text.textContent =
    state === "takeover"
      ? `You're in control. ${o.name} waits.`
      : state === "stopped"
        ? `Stopped. ${o.name} does nothing until you choose.`
        : s.paused
          ? `${o.name} is paused`
          : waiting
            ? "Waiting for you in Vyre"
            : `${o.name} is using this tab`;
  s.frame.style.display = state ? "none" : "";
  const live = !s.paused && !state;
  s.take.style.display = live && !waiting ? "" : "none";
  s.stop.style.display = live ? "" : "none";
  s.open.style.display = waiting ? "" : "none";
  s.give.style.display = state === "takeover" ? "" : "none";
  s.resume.style.display = state === "stopped" ? "" : "none";
  s.end.style.display = state === "stopped" ? "" : "none";
  s.goal.textContent = o.goal ? String(o.goal).slice(0, 80) : "";
  s.goal.style.display = o.goal ? "" : "none";
  s.chip.textContent = o.name;
  return true;
}

/**
 * Move the named cursor to a point (viewport pixels), with a ring when it clicks. The first move places it without gliding from the corner.
 * @param {number} x @param {number} y @param {boolean} [click]
 */
export function overlayCursor(x, y, click) {
  const g = /** @type {any} */ (globalThis);
  const s = g[Symbol.for("vyre.agent.overlay")];
  if (!s || !s.host.isConnected) return false;
  s.cursor.style.display = "block";
  if (s.moved) s.cursor.classList.add("go");
  s.cursor.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  s.moved = true;
  if (
    click &&
    typeof s.cursor.animate === "function" &&
    !(g.matchMedia && g.matchMedia("(prefers-reduced-motion: reduce)").matches)
  ) {
    const ring = g.document.createElement("span");
    ring.style.cssText =
      "position:absolute;left:-6px;top:-6px;width:12px;height:12px;border-radius:50%;border:2px solid #4f46e5;pointer-events:none";
    s.cursor.append(ring);
    const a = ring.animate(
      [
        { transform: "scale(.6)", opacity: 1 },
        { transform: "scale(2.6)", opacity: 0 },
      ],
      { duration: 380, easing: "ease-out" },
    );
    a.onfinish = () => ring.remove();
  }
  return true;
}

/** Take the frame, bar and cursor off the page and give the keys back. Returns true when something was removed. */
export function overlayHide() {
  const g = /** @type {any} */ (globalThis);
  const KEY = Symbol.for("vyre.agent.overlay");
  const s = g[KEY];
  if (!s) return false;
  if (typeof s.cleanup === "function") s.cleanup();
  else g.removeEventListener("keydown", s.onKey, true);
  try {
    if (s.port) s.port.disconnect();
  } catch {
    /* already closed */
  }
  s.host.remove();
  delete g[KEY];
  return true;
}
