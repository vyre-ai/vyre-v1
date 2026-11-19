// The terminal screen drawn by xterm.js (lead go, 19 Nov): the same tmux capture the DOM screen draws, painted by a real terminal renderer (true cell grid, wide characters, selection, the colours a
// program asked for). Loaded on its own, only after a person has opened a terminal (TmuxScreen asks for it with import()); the first-paint bundle never holds it. It draws and nothing else: keys, paste,
// the take-over and every number stay in TmuxScreen, and the DOM screen stays on screen until this one is ready and again if it cannot start.
import { createElement, useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Terminal } from "@xterm/xterm";

import { frameOf } from "./xterm-frame.ts";
import type { XShot } from "./xterm-frame.ts";

/** The rules xterm.js needs to lay out (from @xterm/xterm/css/xterm.css, MIT, the ones the DOM renderer uses). Put in the page when the first terminal opens, so the page's own stylesheet never carries them. */
const XTERM_CSS = `.xterm{cursor:text;position:relative;user-select:none;-webkit-user-select:none}.xterm.focus,.xterm:focus{outline:none}.xterm .xterm-helpers{position:absolute;top:0;z-index:5}.xterm .xterm-helper-textarea{padding:0;border:0;margin:0;position:absolute;opacity:0;left:-9999em;top:0;width:0;height:0;z-index:-5;white-space:nowrap;overflow:hidden;resize:none}.xterm .composition-view{background:#000;color:#fff;display:none;position:absolute;white-space:nowrap;z-index:1}.xterm .composition-view.active{display:block}.xterm .xterm-viewport{overflow-y:scroll;cursor:default;position:absolute;right:0;left:0;top:0;bottom:0}.xterm .xterm-screen{position:relative}.xterm .xterm-screen canvas{position:absolute;left:0;top:0}.xterm-char-measure-element{display:inline-block;visibility:hidden;position:absolute;top:0;left:-9999em;line-height:normal}.xterm.enable-mouse-events{cursor:default}.xterm .xterm-accessibility:not(.debug),.xterm .xterm-message{position:absolute;left:0;top:0;bottom:0;right:0;z-index:10;color:transparent;pointer-events:none}.xterm .live-region{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.xterm-dim{opacity:1!important}.xterm-underline-1{text-decoration:underline}.xterm-underline-2{text-decoration:double underline}.xterm-underline-3{text-decoration:wavy underline}.xterm-underline-4{text-decoration:dotted underline}.xterm-underline-5{text-decoration:dashed underline}.xterm-overline{text-decoration:overline}.xterm-strikethrough{text-decoration:line-through}.xterm-screen .xterm-decoration-container .xterm-decoration{z-index:6;position:absolute}`;
function ensureStyle(): void {
  try {
    if (document.getElementById("vyre-xterm-css")) return;
    const el = document.createElement("style");
    el.id = "vyre-xterm-css";
    el.textContent = XTERM_CSS;
    document.head.appendChild(el);
  } catch {
    // no document (a test): nothing to lay out
  }
}

const BASIC = ["#1f2430", "#e06c75", "#7fbf7a", "#d9b45a", "#6a9fe8", "#c07fe0", "#5fbfc0", "#c9cdd6"];
const BRIGHT = ["#5c6370", "#ff8b94", "#9be39a", "#f2d27a", "#8cb8ff", "#dca0f5", "#82dcdc", "#ffffff"];

/** A colour the page's own tokens give at `from`, as the browser resolves it (rgb): a token can be a chain of other tokens, which xterm cannot read. */
function paint(prop: "color" | "backgroundColor", token: string, fallback: string, from?: Element | null): string {
  try {
    const host = from ?? document.body;
    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;${prop === "color" ? "color" : "background-color"}:var(${token}, ${fallback})`;
    host.appendChild(probe);
    const v = getComputedStyle(probe)[prop];
    host.removeChild(probe);
    return v === "" ? fallback : v;
  } catch {
    return fallback;
  }
}

function cssVar(name: string, fallback: string, from?: Element | null): string {
  try {
    const v = getComputedStyle(from ?? document.documentElement)
      .getPropertyValue(name)
      .trim();
    return v === "" ? fallback : v;
  } catch {
    return fallback;
  }
}

function themeNow(from?: Element | null): Record<string, string> {
  const t: Record<string, string> = {
    foreground: paint("color", "--ink", "#e6e8ee", from),
    background: paint("backgroundColor", "--sunk", "#14161c", from),
    cursor: paint("backgroundColor", "--accent", "#6a9fe8", from),
    cursorAccent: paint("color", "--accent-ink", "#ffffff", from),
    selectionBackground: "rgba(106,159,232,0.35)",
  };
  const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
  names.forEach((n, i) => {
    t[n] = BASIC[i]!;
    t[`bright${n[0]!.toUpperCase()}${n.slice(1)}`] = BRIGHT[i]!;
  });
  return t;
}

/** The terminal for one capture. `onReady` is told once the first frame is drawn, so the caller may take the DOM screen away; `onFail` when the terminal cannot start or draw, so the caller keeps the DOM screen. */
export function XTermView({
  shot,
  onReady,
  onFail,
  onPaste,
}: {
  shot: XShot;
  onReady?: () => void;
  onFail?: () => void;
  onPaste?: (text: string) => void;
}): ReactElement {
  const host = useRef<HTMLElement | null>(null);
  const term = useRef<Terminal | null>(null);
  const told = useRef(false);
  const last = useRef("");
  const lastTheme = useRef("");
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const pasteRef = useRef(onPaste);
  pasteRef.current = onPaste;
  useEffect(() => {
    ensureStyle();
    let t: Terminal;
    try {
      t = new Terminal({
        cols: Math.max(20, shot.cols),
        rows: Math.max(1, shot.text.split("\n").length),
        scrollback: 0,
        disableStdin: true,
        cursorBlink: false,
        cursorStyle: "block",
        cursorInactiveStyle: "block",
        fontFamily: cssVar("--mono", "ui-monospace, Menlo, monospace"),
        fontSize: 13,
        lineHeight: 1.35,
        allowProposedApi: false,
        theme: themeNow(host.current),
      });
      if (host.current) t.open(host.current);
    } catch {
      failRef.current?.();
      return;
    }
    term.current = t;
    // xterm takes no key itself: every key goes to the screen's owner (TmuxScreen), as on the plain screen
    t.attachCustomKeyEventHandler(() => false);
    // a paste into xterm's own hidden textarea is taken here, before xterm sees it (it would stop it from reaching the screen's owner): the text goes to the owner, the one place that sends it
    const el = host.current;
    const onPasteEvent = (ev: Event): void => {
      const text = (ev as ClipboardEvent).clipboardData?.getData("text") ?? "";
      ev.preventDefault();
      ev.stopPropagation();
      if (text !== "") pasteRef.current?.(text);
    };
    el?.addEventListener("paste", onPasteEvent, true);
    return () => {
      el?.removeEventListener("paste", onPasteEvent, true);
      term.current = null;
      t.dispose();
    };
    // one terminal for the life of the screen; every capture is written below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const t = term.current;
    if (!t) return;
    // a change of light or dark mode or of skin shows on the next frame
    const theme = themeNow(host.current);
    const themeKey = JSON.stringify(theme);
    if (themeKey !== lastTheme.current) {
      lastTheme.current = themeKey;
      t.options.theme = theme;
    }
    const lines = shot.text.split("\n").length;
    const frame = frameOf(shot);
    const key = `${shot.cols}x${lines}|${frame}`;
    if (key === last.current) return;
    last.current = key;
    if (t.cols !== Math.max(20, shot.cols) || t.rows !== Math.max(1, lines))
      t.resize(Math.max(20, shot.cols), Math.max(1, lines));
    try {
      t.write(frame, () => {
        if (!told.current) {
          told.current = true;
          readyRef.current?.();
        }
      });
    } catch {
      failRef.current?.();
    }
  }, [shot]);
  return createElement("div", {
    ref: host,
    "data-testid": "terminal-xterm",
    style: { display: "inline-block", minWidth: "100%" },
  });
}
