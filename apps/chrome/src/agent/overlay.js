// @ts-check
// The agent frame (V1-SPEC 3.12): while an agent drives a tab the tab wears an indigo frame, a bar that reads "<Agent> is using this tab" with a Stop button, and
// the agent's named cursor. The worker injects these functions with chrome.scripting.executeScript (each is self-contained, like page.js) and removes them the
// moment the agent is idle, stopped or paused, so the frame shows only while an agent drives. Stop and Esc reach the worker over a port named by the caller.
// Everything lives in a closed shadow root at the top of the page's stacking order; the page can cover nothing and the frame never takes a click except on Stop.

/**
 * Show or update the frame and bar. Returns true when drawn.
 * @param {{ name: string, goal?: string, paused?: boolean, waiting?: boolean, color?: string, port: string }} o
 */
export function overlayShow(o) {
  const g = /** @type {any} */ (globalThis);
  const KEY = Symbol.for("vyre.agent.overlay");
  const doc = g.document;
  if (!doc || !doc.documentElement) return false;
  let s = g[KEY];
  if (!s || !s.host.isConnected) {
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
    dot.textContent = String(o.name || "?").trim().charAt(0).toUpperCase();
    const text = doc.createElement("span");
    text.className = "t";
    const goal = doc.createElement("span");
    goal.className = "goal";
    const take = doc.createElement("button");
    take.className = "take";
    take.type = "button";
    take.textContent = "Take over";
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
    bar.append(dot, text, goal, take, stop, open);
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

    const port = g.chrome && g.chrome.runtime && g.chrome.runtime.connect ? g.chrome.runtime.connect({ name: o.port }) : null;
    stop.addEventListener("click", (/** @type {any} */ e) => { e.preventDefault(); e.stopPropagation(); if (port) port.postMessage({ type: "stop" }); });
    open.addEventListener("click", (/** @type {any} */ e) => { e.preventDefault(); e.stopPropagation(); if (port) port.postMessage({ type: "openvyre" }); });
    take.addEventListener("click", (/** @type {any} */ e) => { e.preventDefault(); e.stopPropagation(); if (port) port.postMessage({ type: "takeover" }); });
    const onKey = (/** @type {any} */ e) => { if (e.key === "Escape" && !s.paused && port) port.postMessage({ type: "esc" }); };
    g.addEventListener("keydown", onKey, true);
    s = { host, frame, bar, text, goal, stop, take, hint, open, cursor, chip, port, onKey, paused: false, moved: false };
    g[KEY] = s;
  }
  s.paused = Boolean(o.paused);
  const waiting = !s.paused && Boolean(o.waiting);
  s.frame.className = s.paused ? "frame paused" : "frame";
  if (o.color) s.host.style.setProperty("--grp", String(o.color));
  s.bar.className = s.paused ? "bar paused" : waiting ? "bar waiting" : "bar";
  s.text.textContent = s.paused ? `${o.name} is paused` : waiting ? "Waiting for you in Vyre" : `${o.name} is using this tab`;
  s.take.style.display = s.paused || waiting ? "none" : "";
  s.stop.style.display = s.paused ? "none" : "";
  s.open.style.display = waiting ? "" : "none";
  s.goal.textContent = o.goal ? String(o.goal).slice(0, 80) : "";
  s.goal.style.display = o.goal ? "" : "none";
  s.stop.style.display = s.paused ? "none" : "";
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
  if (click && typeof s.cursor.animate === "function" && !(g.matchMedia && g.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    const ring = g.document.createElement("span");
    ring.style.cssText = "position:absolute;left:-6px;top:-6px;width:12px;height:12px;border-radius:50%;border:2px solid #4f46e5;pointer-events:none";
    s.cursor.append(ring);
    const a = ring.animate([{ transform: "scale(.6)", opacity: 1 }, { transform: "scale(2.6)", opacity: 0 }], { duration: 380, easing: "ease-out" });
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
  g.removeEventListener("keydown", s.onKey, true);
  try { if (s.port) s.port.disconnect(); } catch { /* already closed */ }
  s.host.remove();
  delete g[KEY];
  return true;
}
