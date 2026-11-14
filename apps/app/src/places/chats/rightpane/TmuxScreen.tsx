// The full-screen terminal's screen (lead ruling, 14 Nov): tmux's own capture with its colours, refreshed by a short poll, and, while a person holds the keyboard, their keys sent raw through tmux send-keys: named keys
// for Enter, Tab, arrows, Ctrl-C and the like, literal text for letters, a paste as one write. So a command-line sign-in (gh auth login, ssh, a pasted code, a hidden prompt) works as it does in any terminal.
// What is typed is sent and forgotten here: nothing keeps it, and a hidden prompt does not print it, so no screen draws it.
import { createElement, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, View } from "react-native";

type Call = (cap: string, input: unknown) => Promise<unknown>;
export type KeyPress = { text: string } | { key: string } | { paste: string };
export interface Capture {
  text: string;
  cols: number;
  rows: number;
  cursor: { x: number; y: number } | null;
  history: number;
  hidden: boolean;
}

// ---- keys

const NAMED: Readonly<Record<string, string>> = {
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "BSpace",
  Escape: "Escape",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Delete: "DC",
  Insert: "IC",
  " ": "Space",
};
export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}
/** What a key press sends, or null when it is not for the terminal (a browser shortcut with Cmd, a lone modifier, a key tmux has no name for). */
export function keyToPress(e: KeyLike): KeyPress | null {
  if (e.metaKey) return null;
  const k = e.key;
  if (k === "Shift" || k === "Control" || k === "Alt" || k === "Meta" || k === "CapsLock" || k === "Dead") return null;
  if (e.shiftKey && k === "Tab") return { key: "BTab" };
  if (/^F([1-9]|1[0-2])$/.test(k)) return { key: k };
  if (e.ctrlKey && /^[a-zA-Z]$/.test(k)) return { key: `C-${k.toLowerCase()}` };
  if (e.altKey && k.length === 1 && /^[A-Za-z0-9]$/.test(k)) return { key: `M-${k}` };
  const named = NAMED[k];
  if (named !== undefined && !(k === " " && !e.ctrlKey && !e.altKey)) return { key: named };
  if (k === " ") return { text: " " };
  if (k.length === 1 || [...k].length === 1) return { text: k };
  return null;
}

/**
 * Keys go one request at a time, in order. Everything pressed while a request is in flight waits and goes as one call when it lands (letters join into one text), so a fast typist or a paste of a long line is a few
 * requests, not one per key, and the screen never lags behind the hands.
 */
export function keyBatcher(send: (keys: KeyPress[]) => Promise<unknown>): { push(k: KeyPress): void } {
  let pending: KeyPress[] = [];
  let inflight = false;
  const flush = (): void => {
    if (inflight || pending.length === 0) return;
    const batch = pending;
    pending = [];
    inflight = true;
    void send(batch)
      .catch(() => undefined)
      .finally(() => {
        inflight = false;
        flush();
      });
  };
  return {
    push(k) {
      const last = pending[pending.length - 1];
      if (last && "text" in last && "text" in k) pending[pending.length - 1] = { text: last.text + k.text };
      else pending.push(k);
      // the first key of a burst waits one microtask, so keys pressed in the same tick go together
      queueMicrotask(flush);
    },
  };
}

// ---- colours

export interface Span {
  text: string;
  cursor?: boolean;
  color?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
  inverse?: boolean;
}
const BASIC = ["#1f2430", "#e06c75", "#7fbf7a", "#d9b45a", "#6a9fe8", "#c07fe0", "#5fbfc0", "#c9cdd6"];
const BRIGHT = ["#5c6370", "#ff8b94", "#9be39a", "#f2d27a", "#8cb8ff", "#dca0f5", "#82dcdc", "#ffffff"];
function color256(n: number): string {
  if (n < 8) return BASIC[n]!;
  if (n < 16) return BRIGHT[n - 8]!;
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const i = n - 16;
  const c = (x: number): number => (x === 0 ? 0 : 55 + x * 40);
  return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`;
}
/** One line of tmux's capture (SGR escape sequences kept) as styled runs; every other escape is dropped. */
export function parseLine(line: string): Span[] {
  const out: Span[] = [];
  let st: Omit<Span, "text"> = {};
  const re = /\x1b\[([0-9;:?<=>! ]*)([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[^[\]]|([^\x1b]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m[3] !== undefined) {
      out.push({ ...st, text: m[3] });
      continue;
    }
    if (m[2] === undefined) continue;
    if (m[2] !== "m") continue;
    const p = (m[1] ?? "").split(/[;:]/).map((x) => (x === "" ? 0 : Number(x)));
    for (let i = 0; i < p.length; i++) {
      const c = p[i]!;
      if (c === 0) st = {};
      else if (c === 1) st = { ...st, bold: true };
      else if (c === 2) st = { ...st, dim: true };
      else if (c === 4) st = { ...st, underline: true };
      else if (c === 7) st = { ...st, inverse: true };
      else if (c === 22) {
        const { bold: _b, dim: _d, ...r } = st;
        st = r;
      } else if (c === 24) {
        const { underline: _u, ...r } = st;
        st = r;
      } else if (c === 27) {
        const { inverse: _i, ...r } = st;
        st = r;
      } else if (c >= 30 && c <= 37) st = { ...st, color: BASIC[c - 30]! };
      else if (c >= 90 && c <= 97) st = { ...st, color: BRIGHT[c - 90]! };
      else if (c >= 40 && c <= 47) st = { ...st, background: BASIC[c - 40]! };
      else if (c >= 100 && c <= 107) st = { ...st, background: BRIGHT[c - 100]! };
      else if (c === 39) {
        const { color: _c, ...r } = st;
        st = r;
      } else if (c === 49) {
        const { background: _g, ...r } = st;
        st = r;
      } else if ((c === 38 || c === 48) && p[i + 1] === 5) {
        const col = color256(p[i + 2] ?? 0);
        st = c === 38 ? { ...st, color: col } : { ...st, background: col };
        i += 2;
      } else if ((c === 38 || c === 48) && p[i + 1] === 2) {
        const col = `rgb(${p[i + 2] ?? 0},${p[i + 3] ?? 0},${p[i + 4] ?? 0})`;
        st = c === 38 ? { ...st, color: col } : { ...st, background: col };
        i += 4;
      }
    }
  }
  return out;
}

/** The runs of a line with the character under the cursor marked; past the end of the line the cursor stands on a space. */
export function withCursor(spans: readonly Span[], x: number): Span[] {
  const out: Span[] = [];
  let at = 0;
  let done = false;
  for (const sp of spans) {
    const len = [...sp.text].length;
    if (!done && x >= at && x < at + len) {
      const cs = [...sp.text];
      const k = x - at;
      if (k > 0) out.push({ ...sp, text: cs.slice(0, k).join("") });
      out.push({ ...sp, text: cs[k]!, cursor: true });
      if (k + 1 < cs.length) out.push({ ...sp, text: cs.slice(k + 1).join("") });
      done = true;
    } else out.push(sp);
    at += len;
  }
  if (!done) {
    if (x > at) out.push({ text: " ".repeat(x - at) });
    out.push({ text: " ", cursor: true });
  }
  return out;
}

// ---- the screen

export const SCREEN_POLL_MS = 250;

export function TmuxScreen({
  call,
  terminalId,
  keys,
  taking,
  onHidden,
  onUnsupported,
}: {
  call: Call;
  terminalId: string;
  /** a person holds the keyboard: keys and pastes go to the terminal */
  keys: boolean;
  /** Take over was just pressed and the server has not answered: keys pressed now are kept and sent, in order, the moment the keyboard is yours (dropped if the take fails) */
  taking?: { current: boolean } | undefined;
  onHidden?(hidden: boolean): void;
  onUnsupported?(): void;
}): ReactElement | null {
  const [shot, setShot] = useState<Capture | null>(null);
  const el = useRef<HTMLElement | null>(null);
  const stuck = useRef(true);
  // one batcher for the life of the screen: a new one per render would send batches side by side and out of order
  const latest = useRef({ call, terminalId });
  latest.current = { call, terminalId };
  // after keys land the screen is read at once, not at the next tick of the poll: the key shows as soon as tmux has drawn it
  const kick = useRef<() => void>(() => undefined);
  const batcher = useRef<ReturnType<typeof keyBatcher> | null>(null);
  if (batcher.current === null)
    batcher.current = keyBatcher((ks) =>
      latest.current
        .call("terminal.keys", { terminalId: latest.current.terminalId, keys: ks })
        .finally(() => kick.current()),
    );
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let again = false;
    const pull = async (): Promise<void> => {
      busy = true;
      try {
        const r = (await call("terminal.capture", { terminalId, lines: 2000 })) as Capture;
        if (!live) return;
        setShot((was) =>
          was &&
          was.text === r.text &&
          was.hidden === r.hidden &&
          was.cursor?.x === r.cursor?.x &&
          was.cursor?.y === r.cursor?.y
            ? was
            : r,
        );
        onHidden?.(r.hidden);
      } catch (e) {
        const code = (e as { code?: unknown } | null)?.code;
        if (live && typeof code === "string" && code.endsWith("precondition_failed")) {
          onUnsupported?.();
          return;
        }
      }
      busy = false;
      if (live && again) {
        again = false;
        void pull();
        return;
      }
      if (live) timer = setTimeout(() => void pull(), SCREEN_POLL_MS);
    };
    kick.current = () => {
      if (!live) return;
      if (busy) {
        again = true;
        return;
      }
      if (timer) clearTimeout(timer);
      void pull();
    };
    void pull();
    return () => {
      live = false;
      kick.current = () => undefined;
      if (timer) clearTimeout(timer);
    };
    // the callbacks are read when called
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, terminalId]);
  // stay on the last line unless the person scrolled up to read
  useEffect(() => {
    const e = el.current;
    if (e && stuck.current) e.scrollTop = e.scrollHeight;
  }, [shot]);
  if (Platform.OS !== "web") return null;
  const lines = (shot?.text ?? "").split("\n");
  const cur = shot?.cursor ?? null;
  const top = Math.max(0, lines.length - (shot?.rows ?? lines.length));
  const rows = lines.map((l, i) => {
    const here = cur !== null && i === top + cur.y;
    const spans = here ? withCursor(parseLine(l), cur.x) : parseLine(l);
    return createElement(
      "div",
      { key: i, style: { whiteSpace: "pre", minHeight: "1.35em" } },
      spans.length === 0 ? "\u00a0" : null,
      ...spans.map((sp, j) =>
        createElement(
          "span",
          {
            key: j,
            ...(sp.cursor ? { "data-testid": "terminal-cursor" } : {}),
            style: {
              color: sp.cursor ? "var(--accent-ink, #fff)" : sp.inverse ? (sp.background ?? "var(--sunk)") : sp.color,
              backgroundColor: sp.cursor ? "var(--accent)" : sp.inverse ? (sp.color ?? "var(--ink)") : sp.background,
              fontWeight: sp.bold ? 600 : undefined,
              opacity: sp.dim ? 0.65 : undefined,
              textDecoration: sp.underline ? "underline" : undefined,
            },
          },
          sp.text,
        ),
      ),
    );
  });
  // kept keys older than 5 seconds belong to a take that failed: they are dropped, never sent later
  const early = useRef<Array<{ k: KeyPress; at: number }>>([]);
  useEffect(() => {
    if (keys) {
      const now = Date.now();
      for (const e of early.current) if (now - e.at < 5000) batcher.current?.push(e.k);
    }
    early.current = [];
  }, [keys]);
  const press = (k: KeyPress): void => {
    if (keys) batcher.current?.push(k);
    else if (taking?.current === true) early.current.push({ k, at: Date.now() });
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!keys && taking?.current !== true) return;
    const k = keyToPress(e);
    if (k === null) return;
    e.preventDefault();
    e.stopPropagation();
    press(k);
  };
  const onPaste = (e: ClipboardEvent): void => {
    if (!keys && taking?.current !== true) return;
    const text = e.clipboardData?.getData("text") ?? "";
    if (text === "") return;
    e.preventDefault();
    press({ paste: text });
  };
  return (
    <View testID="terminal-popup-screen-inner" style={st.fill}>
      {createElement(
        "div",
        {
          ref: el,
          tabIndex: 0,
          "data-testid": "terminal-screen",
          "data-hidden": shot?.hidden === true ? "1" : "0",
          onKeyDown,
          onPaste,
          onScroll: (e: { currentTarget: HTMLElement }) => {
            const d = e.currentTarget;
            stuck.current = d.scrollHeight - d.scrollTop - d.clientHeight < 40;
          },
          style: {
            position: "absolute",
            inset: 0,
            overflow: "auto",
            padding: "12px 16px",
            outline: "none",
            fontFamily: "var(--mono, ui-monospace, Menlo, monospace)",
            fontSize: 13,
            lineHeight: 1.35,
            color: "var(--ink)",
            background: "var(--sunk)",
            border: keys ? "2px solid var(--accent)" : "2px solid transparent",
            boxSizing: "border-box",
          },
        },
        ...rows,
      )}
    </View>
  );
}

const st = StyleSheet.create({ fill: { flex: 1, minHeight: 0 } });
