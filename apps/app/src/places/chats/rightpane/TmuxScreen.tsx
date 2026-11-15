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

/** The screen to draw after an answer: the last good one stays when the answer is not a screen (a failed capture, a terminal that ended), and an identical one changes nothing. */
export function nextShot(was: Capture | null, r: unknown): Capture | null {
  const c = r as Partial<Capture> | null | undefined;
  if (c === null || c === undefined || typeof c !== "object" || typeof c.text !== "string") return was;
  const n = c as Capture;
  return was &&
    was.text === n.text &&
    was.hidden === n.hidden &&
    was.cursor?.x === n.cursor?.x &&
    was.cursor?.y === n.cursor?.y
    ? was
    : n;
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
const LOST_KEYS = "Those keys may not have arrived.";
const KEYBOARD_GONE = "The keyboard is no longer yours.";

/** What the screen needs of the take-over it types under. */
export interface Seat {
  get(): Promise<{ lease: string; seq: number } | null>;
  advance(seq: number): void;
  reset(): void;
}

/**
 * One batch of keys to the server. The batch gets ONE key and ONE number, and a retry sends exactly those, so the server types it once however many times it arrives. A batch the server answered, with a yes or a
 * no, is never sent again. A failure the server recorded (internal.*) may have typed part of it and is not sent again either. A batch whose answer was lost is sent again with the same key until it is answered; the
 * loop stops when the keyboard is no longer ours (handed back, lost, the take refused). After anything but a yes the count is asked again before the next batch (`seat.reset`).
 */
export async function sendKeys(
  d: {
    call: (cap: string, input: unknown) => Promise<unknown>;
    terminalId: string;
    seat: Seat | undefined;
    newKey: (() => string) | undefined;
    holding: () => boolean;
    sleep: (ms: number) => Promise<void>;
  },
  ks: KeyPress[],
): Promise<{ screen?: Capture; sent: boolean; said?: string }> {
  const st = d.seat;
  const mine = st === undefined ? null : await st.get().catch(() => null);
  if (st === undefined || mine === null) return { sent: false, said: LOST_KEYS };
  const batchKey = d.newKey?.() ?? `kb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const r = (await d.call("terminal.keys", {
        terminalId: d.terminalId,
        lease: mine.lease,
        seq: mine.seq,
        idempotencyKey: batchKey,
        keys: ks,
        capture: true,
      })) as { screen?: Capture };
      st.advance(mine.seq);
      return { ...(r.screen ? { screen: r.screen } : {}), sent: true };
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      const reason = (e as { details?: { reason?: unknown } } | null)?.details?.reason;
      if (reason !== "in_flight" && typeof code === "string" && /^(validation|permission|internal)\./.test(code)) {
        st.reset();
        // the server's own plain sentence ("Your take-over of this terminal is over...", "Those keys may not have arrived.")
        const words = (e as { message?: unknown } | null)?.message;
        return { sent: false, said: typeof words === "string" && words !== "" ? words : LOST_KEYS };
      }
      if (!d.holding()) {
        st.reset();
        return { sent: false, said: KEYBOARD_GONE };
      }
      await d.sleep(120 * (attempt + 1));
    }
  }
  st.reset();
  return { sent: false, said: LOST_KEYS };
}

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
  seat,
  newKey,
  onSaid,
  onHidden,
  onUnsupported,
}: {
  call: Call;
  terminalId: string;
  /** a person holds the keyboard: keys and pastes go to the terminal */
  keys: boolean;
  /** Take over was just pressed and the server has not answered: keys pressed now are kept and sent, in order, the moment the keyboard is yours (dropped if the take fails) */
  taking?: { current: boolean } | undefined;
  /** The take-over's lease and the number of the next batch (the sheet keeps them): `get` answers them, asking the server where the count stands when it does not know; `advance` after a batch was answered; `reset` after anything that leaves the count unknown */
  seat?: Seat | undefined;
  /** a key for one batch of keys: the same key goes with every retry of that batch, never with another */
  newKey?: (() => string) | undefined;
  /** one plain line when keys did not arrive (the bar shows it); null when keys arrive again */
  onSaid?(line: string | null): void;
  onHidden?(hidden: boolean): void;
  onUnsupported?(): void;
}): ReactElement | null {
  const [shot, setShot] = useState<Capture | null>(null);
  const el = useRef<HTMLElement | null>(null);
  const stuck = useRef(true);
  // one batcher for the life of the screen: a new one per render would send batches side by side and out of order
  const lastKeyAt = useRef(0);
  // every screen read is numbered when it is asked; an answer older than the newest one already drawn is dropped, so a slow poll never puts an old screen over a newer one
  const asked = useRef(0);
  const drawn = useRef(0);
  const apply = (r: Capture): void => {
    if (nextShot(null, r) === null) return;
    setShot((was) => nextShot(was, r));
    onHiddenRef.current?.(r.hidden);
  };
  const latest = useRef({ call, terminalId, show: apply });
  latest.current = { call, terminalId, show: apply };
  const onHiddenRef = useRef(onHidden);
  onHiddenRef.current = onHidden;
  // when the answer to the keys has no screen, or fails, the screen is read at once instead of at the next tick
  const kick = useRef<() => void>(() => undefined);
  const batcher = useRef<ReturnType<typeof keyBatcher> | null>(null);
  const holding = useRef(keys);
  holding.current = keys || taking?.current === true;
  const onSaidRef = useRef(onSaid);
  onSaidRef.current = onSaid;
  const seatRef = useRef(seat);
  seatRef.current = seat;
  const keyOf = useRef(newKey);
  keyOf.current = newKey;
  if (batcher.current === null)
    batcher.current = keyBatcher(async (ks) => {
      // the keys and the screen they made come back in one answer: a key shows in one round trip, no wait for the next poll
      lastKeyAt.current = Date.now();
      const n = ++asked.current;
      const out = await sendKeys(
        {
          call: (cap, input) => latest.current.call(cap, input),
          terminalId: latest.current.terminalId,
          seat: seatRef.current,
          newKey: keyOf.current,
          holding: () => holding.current,
          sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
        },
        ks,
      );
      onSaidRef.current?.(out.said ?? null);
      if (out.screen && n > drawn.current) {
        drawn.current = n;
        latest.current.show(out.screen);
      } else if (!out.screen) kick.current();
    });
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let again = false;
    let startedAt = 0;
    const pull = async (): Promise<void> => {
      busy = true;
      startedAt = Date.now();
      const n = ++asked.current;
      try {
        const r = (await call("terminal.capture", { terminalId, lines: 2000 })) as Capture;
        if (!live) return;
        if (n > drawn.current) {
          drawn.current = n;
          latest.current.show(r);
        }
      } catch (e) {
        const code = (e as { code?: unknown } | null)?.code;
        if (live && typeof code === "string" && code.endsWith("precondition_failed")) {
          onUnsupported?.();
          return;
        }
        // the terminal ended: the last screen stays as it was and is not read again
        if (live && code === "validation.not_found") return;
      }
      busy = false;
      if (live && again) {
        again = false;
        void pull();
        return;
      }
      // while keys are being pressed the screen is read often (a program that answers a moment later shows at once); at rest, four times a second
      if (live) timer = setTimeout(() => void pull(), Date.now() - lastKeyAt.current < 2000 ? 70 : SCREEN_POLL_MS);
    };
    kick.current = () => {
      if (!live) return;
      // a read still out after 2 seconds does not hold the next one back
      if (busy && Date.now() - startedAt < 2000) {
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
  // kept keys older than 5 seconds belong to a take that failed: they are dropped, never sent later
  const early = useRef<Array<{ k: KeyPress; at: number }>>([]);
  /** Keys kept while the take was in flight go first, in the order they were pressed, before anything pressed since; older than 5 seconds they belong to a take that failed and are dropped. */
  const drainEarly = (): void => {
    const now = Date.now();
    const kept = early.current;
    early.current = [];
    for (const e of kept) if (now - e.at < 5000) batcher.current?.push(e.k);
  };
  useEffect(() => {
    if (keys) drainEarly();
    else early.current = [];
    // drainEarly reads only refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
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
  const press = (k: KeyPress): void => {
    if (keys) {
      drainEarly();
      batcher.current?.push(k);
    } else if (taking?.current === true) early.current.push({ k, at: Date.now() });
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
