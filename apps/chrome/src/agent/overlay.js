// @ts-check
// The agent frame (V1-SPEC 3.12): while an agent drives a tab the tab wears an indigo frame, a bar that reads "<Agent> is using this tab" with a Stop button, and
// the agent's named cursor. The worker injects these functions with chrome.scripting.executeScript (each is self-contained, like page.js) and removes them the
// moment the agent is idle, stopped or paused, so the frame shows only while an agent drives. Stop and Esc reach the worker over a port named by the caller.
// Everything lives in a closed shadow root at the top of the page's stacking order; the page can cover nothing and the frame never takes a click except on Stop.

/**
 * Show or update the frame and bar. Returns true when drawn.
 * @param {{ name: string, goal?: string, paused?: boolean, port: string }} o
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
    style.textContent = [
      ".frame{position:fixed;inset:0;box-sizing:border-box;border:3px solid #4f46e5;box-shadow:inset 0 0 0 1px rgba(255,255,255,.4);pointer-events:none}",
      ".frame.paused{border:3px dashed #6b7280}",
      ".bar{position:fixed;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);padding:6px 6px 6px 12px;background:#1e1b4b;color:#fff;border-radius:999px;font:13px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 4px 18px rgba(30,27,75,.35);pointer-events:auto;white-space:nowrap}",
      ".dot{flex:none;width:8px;height:8px;border-radius:50%;background:#818cf8}",
      ".paused .dot{background:#9ca3af}",
      "@media (prefers-reduced-motion:no-preference){.dot{animation:pulse 1.6s ease-in-out infinite}.paused .dot{animation:none}}",
      "@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}",
      ".t{overflow:hidden;text-overflow:ellipsis}",
      ".goal{color:#c7d2fe;overflow:hidden;text-overflow:ellipsis;max-width:36ch}",
      ".stop{flex:none;border:0;border-radius:999px;padding:5px 13px;background:#fff;color:#1e1b4b;font:600 12px/1 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer}",
      ".stop:hover{background:#e0e7ff}.stop:focus-visible{outline:2px solid #a5b4fc;outline-offset:2px}",
      ".cursor{position:fixed;left:0;top:0;display:none;pointer-events:none;will-change:transform}",
      "@media (prefers-reduced-motion:no-preference){.cursor.go{transition:transform .14s ease-out}}",
      ".chip{position:absolute;left:14px;top:16px;padding:2px 7px;border-radius:6px;background:#4f46e5;color:#fff;font:600 11px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;white-space:nowrap}",
    ].join("");
    const frame = doc.createElement("div");
    frame.className = "frame";
    const bar = doc.createElement("div");
    bar.className = "bar";
    bar.setAttribute("role", "status");
    const dot = doc.createElement("span");
    dot.className = "dot";
    const text = doc.createElement("span");
    text.className = "t";
    const goal = doc.createElement("span");
    goal.className = "goal";
    const stop = doc.createElement("button");
    stop.className = "stop";
    stop.type = "button";
    stop.textContent = "Stop";
    bar.append(dot, text, goal, stop);
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
    const onKey = (/** @type {any} */ e) => { if (e.key === "Escape" && !s.paused && port) port.postMessage({ type: "esc" }); };
    g.addEventListener("keydown", onKey, true);
    s = { host, frame, bar, text, goal, stop, cursor, chip, port, onKey, paused: false, moved: false };
    g[KEY] = s;
  }
  s.paused = Boolean(o.paused);
  s.frame.className = s.paused ? "frame paused" : "frame";
  s.bar.className = s.paused ? "bar paused" : "bar";
  s.text.textContent = s.paused ? `${o.name} is paused` : `${o.name} is using this tab`;
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
