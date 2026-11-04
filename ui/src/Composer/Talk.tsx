// Talk in the composer: the hook that puts words in the field, and the mic. Press to start and press to stop, or hold and let go. Esc cancels and takes back only what Talk added. It never sends.
// The mic holds one fixed slot, so nothing moves when it listens. The level is four thin bars set directly on the nodes, so listening re-renders nothing. The refused-mic and network lines float above the box.
// Pointer events, not onPressIn: the press has to start the mic on the way down, and Talk runs only on the web. A click with no pointer behind it is the keyboard: Enter toggles.
// The shell gives a TalkPort through context, so every composer has the mic with no wiring per place. No port means no mic: a native app has no web microphone, and Talk there waits for its own capture.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { I } from "./parts.tsx";
import { Glyph } from "./shared.tsx";
import { LINE, openWebMic, startTalk } from "./talk.ts";
import type { TalkDeps, TalkRun, TalkSession } from "./talk.ts";

export interface TalkPort {
  /** False hides the mic: the person turned Talk off. */
  on: boolean;
  session(): Promise<TalkSession>;
  /** The first-press sheet, or Settings' own key. True when a key is saved: from the composer, listening starts at once. */
  setup(only?: "mine" | "space"): Promise<boolean>;
  /** Set in a team Space when nothing covers this person (no own key, no Space key): the mic then says so on a press instead of asking for a key, with a link for an admin who can add one. */
  unset?: { admin: boolean; open(): void };
  /** Read what covers this person again, after Settings changed it. */
  refresh?(): Promise<void>;
  /** Tell the shell Talk turned out to be off. */
  noteOff(): void;
  /** Tests give a fake mic and socket. */
  deps?: Partial<TalkDeps>;
}
export const TalkContext = createContext<TalkPort | null>(null);

const HOLD_MS = 260;
const LINE_MS = 12_000;
const BARS = [0.62, 1, 0.78, 0.5] as const;
const web = Platform.OS === "web";

type Anchor = { before: string; after: string; skip: number };
const wordsAfter = (all: string, skip: number): string => all.split(/\s+/).filter(Boolean).slice(skip).join(" ");

/** The field with the words in place: at the cursor, spaced from what is around them. */
export function placed(a: { before: string; after: string }, words: string): { text: string; cursor: number } {
  if (words === "") return { text: a.before + a.after, cursor: a.before.length };
  const head = a.before + (a.before !== "" && !/\s$/.test(a.before) ? " " : "") + words;
  return { text: head + (a.after !== "" && !/^\s/.test(a.after) ? " " : "") + a.after, cursor: head.length };
}

export interface TalkControl {
  port: TalkPort | null;
  phase: "idle" | "starting" | "listening";
  line: string | null;
  /** The link under the line (for an admin): where the Space key is added. */
  link: { label: string; open(): void } | null;
  pressIn(): void;
  pressOut(e?: { pointerType?: string }): void;
  /** The click a pointer press also makes is spent; a click with no pointer is the keyboard, which toggles. */
  tapped(): void;
  /** The person typed while it listens: what is there stays, and the words carry on from the new end. */
  edited(text: string, cursor: number): void;
  /** Send was pressed: stop here, keep what is in the field. */
  finish(): void;
  bars(i: number): (node: unknown) => void;
}

export function useTalk(o: { read(): { text: string; cursor: number }; write(text: string, cursor: number): void; focus(): void }): TalkControl {
  const port = useContext(TalkContext);
  const [phase, setPhase] = useState<TalkControl["phase"]>("idle");
  const [line, setLine] = useState<string | null>(null);
  const [link, setLink] = useState<TalkControl["link"]>(null);
  const run = useRef<TalkRun | null>(null);
  const anchor = useRef<Anchor | null>(null);
  const heard = useRef("");
  const nodes = useRef<({ style?: { transform: string } } | null)[]>([]);
  const warm = useRef(false);
  const clicked = useRef(false);
  const pressed = useRef<{ at: number; started: boolean } | null>(null);
  const lineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(o);
  latest.current = o;

  const say = useCallback((text: string | null, withLink: TalkControl["link"] = null) => {
    if (lineTimer.current !== null) clearTimeout(lineTimer.current);
    setLine(text);
    setLink(text === null ? null : withLink);
    if (text !== null) lineTimer.current = setTimeout(() => { setLine(null); setLink(null); }, LINE_MS);
  }, []);
  const paint = useCallback((level: number) => {
    nodes.current.forEach((n, i) => { if (n?.style) n.style.transform = `scaleY(${Math.max(0.16, Math.min(1, level * (BARS[i] ?? 1))).toFixed(2)})`; });
  }, []);
  const over = useCallback(() => {
    run.current = null; anchor.current = null;
    setPhase("idle");
  }, []);

  const begin = useCallback(() => {
    const p = port;
    if (!p || run.current) return;
    say(null);
    const cur = latest.current.read();
    anchor.current = { before: cur.text.slice(0, cur.cursor), after: cur.text.slice(cur.cursor), skip: 0 };
    heard.current = "";
    setPhase("starting");
    const G = globalThis as { navigator?: { onLine?: boolean; platform?: string }; __TAURI__?: unknown; WebSocket?: new (url: string, protocols: string[]) => unknown };
    const deps: TalkDeps = {
      session: () => p.session(),
      openMic: (on) => openWebMic(on),
      openSocket: (url, protocols) => new (G.WebSocket as new (u: string, q: string[]) => never)(url, protocols),
      online: () => G.navigator?.onLine !== false,
      now: () => Date.now(),
      later: (fn, ms) => setTimeout(fn, ms),
      shell: !G.__TAURI__ ? "web" : /win/i.test(G.navigator?.platform ?? "") && !/darwin|mac/i.test(G.navigator?.platform ?? "") ? "windows" : "mac",
      ...p.deps,
    };
    run.current = startTalk(deps, {
      words(all) {
        const a = anchor.current;
        if (!a) return;
        heard.current = all;
        const at = placed(a, wordsAfter(all, a.skip));
        latest.current.write(at.text, at.cursor);
      },
      level: paint,
      listening() { warm.current = true; setPhase("listening"); },
      ended: over,
      failed(text) { over(); warm.current = false; say(text); },
      off(text) { over(); p.noteOff(); say(text); },
      needsKey() {
        over();
        // a team Space with nothing set: say so (an admin gets the way to add one); never ask a member for a key they cannot be given
        if (p.unset) { say(LINE.notSetUp, p.unset.admin ? { label: "Add a key in Console", open: p.unset.open } : null); return; }
        void p.setup().then((saved) => { if (saved) { warm.current = false; begin(); } }, () => say("Talk could not start. Try again."));
      },
    }, { warm: warm.current });
  }, [port, paint, over, say]);

  /** Esc: the field goes back to what it was, less only the words Talk added. */
  const cancel = useCallback(() => {
    const a = anchor.current;
    run.current?.cancel();
    if (a) { const at = placed(a, ""); latest.current.write(at.text, at.cursor); }
    over();
    latest.current.focus();
  }, [over]);

  const pressIn = useCallback(() => {
    if (run.current) { pressed.current = { at: Date.now(), started: false }; run.current.stop(); return; }
    pressed.current = { at: Date.now(), started: true };
    begin();
  }, [begin]);
  const pressOut = useCallback((e?: { pointerType?: string }) => {
    const p = pressed.current;
    pressed.current = null;
    clicked.current = p !== null;
    if (p?.started && Date.now() - p.at >= HOLD_MS) run.current?.stop();
    if (e?.pointerType !== "touch") latest.current.focus();   // on a phone the keyboard would rise and move everything
  }, []);
  const tapped = useCallback(() => {
    if (clicked.current) { clicked.current = false; return; }
    if (run.current) run.current.stop(); else begin();
  }, [begin]);
  const edited = useCallback((text: string, cursor: number) => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = { before: text.slice(0, cursor), after: text.slice(cursor), skip: heard.current.split(/\s+/).filter(Boolean).length };
  }, []);
  const finish = useCallback(() => {
    if (!run.current) return;
    run.current.cancel();
    over();
  }, [over]);
  const bars = useCallback((i: number) => (node: unknown) => { nodes.current[i] = node as { style?: { transform: string } } | null; }, []);

  useEffect(() => {
    if (phase === "idle" || !web) return undefined;
    type Key = { key: string; preventDefault(): void; stopPropagation(): void };
    const w = globalThis as unknown as { addEventListener(t: string, f: (e: Key) => void, c: boolean): void; removeEventListener(t: string, f: (e: Key) => void, c: boolean): void };
    const onKey = (e: Key): void => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); } };
    w.addEventListener("keydown", onKey, true);
    return () => w.removeEventListener("keydown", onKey, true);
  }, [phase, cancel]);
  useEffect(() => () => { run.current?.cancel(); run.current = null; if (lineTimer.current !== null) clearTimeout(lineTimer.current); }, []);

  return { port, phase, line, link, pressIn, pressOut, tapped, edited, finish, bars };
}

const WEB_PRESS = { userSelect: "none", touchAction: "none" } as unknown as ViewStyle;

/** The mic. One size in every state. */
export function TalkButton({ talk }: { talk: TalkControl }): ReactElement | null {
  if (!talk.port || !talk.port.on) return null;
  const live = talk.phase !== "idle";
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={live ? "Stop listening" : "Talk"} accessibilityState={{ selected: live }} testID="composer-talk"
      onPress={talk.tapped}
      {...(web ? {
        title: live ? "Listening. Press to stop, Esc to cancel" : talk.port?.unset ? LINE.notSetUp : "Talk",
        onPointerDown: (e: { pointerId?: number; currentTarget?: { setPointerCapture?: (id: number) => void } }) => { if (e.pointerId !== undefined) e.currentTarget?.setPointerCapture?.(e.pointerId); talk.pressIn(); },
        onPointerUp: talk.pressOut, onPointerCancel: talk.pressOut,
      } as object : {})}
      style={({ hovered }: { hovered?: boolean }) => [s.mic, WEB_PRESS, talk.port?.unset ? s.unset : null, hovered === true && s.hover]}
    >
      {live ? (
        <View style={s.bars} testID="composer-talk-level">
          {/* ui-rows-lint: not a list (four level bars) */}
          {BARS.map((_, i) => <View key={i} ref={talk.bars(i) as never} style={s.bar} />)}
        </View>
      ) : <Glyph icon={I.mic} native={"●"} size={18} color="var(--ink-3)" />}
    </Pressable>
  );
}

/** One plain line above the box. It floats, so the box does not move. */
export function TalkLine({ talk }: { talk: TalkControl }): ReactElement | null {
  if (talk.line === null) return null;
  return (
    <View style={s.line} testID="composer-talk-line-box">
      <Text style={s.lineText} testID="composer-talk-line" accessibilityRole="alert" accessibilityLiveRegion="polite">{talk.line}</Text>
      {talk.link ? <Text accessibilityRole="link" testID="composer-talk-link" onPress={talk.link.open} style={s.lineLink}>{talk.link.label}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  mic: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  hover: { backgroundColor: "var(--hover)" as string },
  bars: { flexDirection: "row", alignItems: "center", gap: 2.5, height: 16 },
  bar: { width: 2, height: 14, borderRadius: 1, backgroundColor: "var(--beacon)" as string, transform: [{ scaleY: 0.16 }], transitionProperty: "transform", transitionDuration: "110ms", transitionTimingFunction: "linear" } as object,
  line: { position: "absolute", left: 14, right: 14, bottom: "100%", marginBottom: 8, gap: 2 } as object,
  lineText: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  lineLink: { fontSize: 12.5, lineHeight: 18, color: "var(--accent)" as string, textDecorationLine: "underline" },
  unset: { opacity: 0.55 },
});
