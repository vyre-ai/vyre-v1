// ui/Terminal: one terminal for three hosts, the agent computer, the Space server and this computer (spec 2.7, ARCH 7.2).
// A session is a tmux session on the host. The module attaches with tmux control mode and relays output as live frames
// (terminal.attach returns a replay of the scrollback, then frames arrive in order). This file turns that stream into a screen:
// TerminalBuffer is a small VT engine (carriage return, backspace, tab, colours, clear, erase line, scrollback), TerminalFeed orders
// the frames, and keyToData turns a key press into the bytes terminal.input expects. The TerminalEngine interface is the part of
// xterm.js the view uses, so a host that bundles xterm passes its own engine and the same view, keys, copy and menus work on it.
// The server shell stays locked until server.services is granted: a locked state with Ask for access, never a disabled prompt.
// Select text and it is copied; Cmd-K clears; Ctrl-C interrupts. Colours are skin tokens (CSS variables on web).

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ViewStyle } from "react-native";
import { MenuIcon, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { TERMINAL_HOSTS, terminalLabel } from "./props.ts";
import type { TerminalHost, TerminalProps, TerminalSessionState } from "./props.ts";

export type { Density, TerminalHost, TerminalProps, TerminalSessionState } from "./props.ts";
export { TERMINAL_HOSTS, terminalLabel } from "./props.ts";

/* ---------- contract mapping ---------- */

export const TERMINAL_INPUT_CAPABILITY = "terminal.input" as const;
export const TERMINAL_INTERRUPT_CAPABILITY = "terminal.interrupt" as const;
export const TERMINAL_RESIZE_CAPABILITY = "terminal.resize" as const;
export const TERMINAL_ATTACH_CAPABILITY = "terminal.attach" as const;

/** Input of terminal.input: keystrokes for a session. Output returns as live frames. */
export function inputPayload(terminalId: string, data: string): { terminalId: string; data: string } {
  return { terminalId, data };
}

/** Input of terminal.resize. The manifest accepts 20 to 500 columns and 5 to 200 rows. */
export function resizePayload(terminalId: string, cols: number, rows: number): { terminalId: string; cols: number; rows: number } {
  return { terminalId, cols: Math.min(500, Math.max(20, Math.floor(cols))), rows: Math.min(200, Math.max(5, Math.floor(rows))) };
}

export const HOST_NAMES: Readonly<Record<TerminalHost, string>> = { agent: "Agent computer", server: "Space server", device: "This computer" };

/** Characters per row and rows that fit a pane at the terminal font (12.5 px mono, 20 px line). */
export function gridSize(width: number, height: number, charWidth = 7.6, lineHeight = 20): { cols: number; rows: number } {
  return { cols: Math.max(20, Math.floor((width - 32) / charWidth)), rows: Math.max(5, Math.floor((height - 28) / lineHeight)) };
}

/* ---------- the VT engine ---------- */

export interface TermStyle {
  /** A skin token: ok, danger, warn, accent, ink-3, or a base ink. */
  fg?: string;
  bold?: boolean;
  dim?: boolean;
}

export interface TermSpan {
  text: string;
  style: TermStyle;
}

export type TermLine = readonly TermSpan[];

/** The part of xterm.js the view uses. TerminalBuffer is the built-in engine. */
export interface TerminalEngine {
  write(data: string): void;
  clear(): void;
  lines(): readonly TermLine[];
  /** Plain text of the whole scrollback. */
  text(): string;
}

interface Cell {
  ch: string;
  style: TermStyle;
}

const SGR_COLORS: Readonly<Record<number, string>> = {
  30: "ink-3", 31: "danger", 32: "ok", 33: "warn", 34: "accent", 35: "accent", 36: "accent", 37: "ink",
  90: "ink-3", 91: "danger", 92: "ok", 93: "warn", 94: "accent", 95: "accent", 96: "accent", 97: "ink",
};

export const SCROLLBACK_LINES = 2000;

function sameStyle(a: TermStyle, b: TermStyle): boolean {
  return a.fg === b.fg && a.bold === b.bold && a.dim === b.dim;
}

function toLine(cells: readonly Cell[]): TermLine {
  const spans: TermSpan[] = [];
  for (const cell of cells) {
    const last = spans[spans.length - 1];
    if (last !== undefined && sameStyle(last.style, cell.style)) last.text += cell.ch;
    else spans.push({ text: cell.ch, style: cell.style });
  }
  return spans;
}

/** A small terminal screen: rows of cells, a cursor, SGR colours, scrollback. Escape sequences split across writes are kept until they finish. */
export class TerminalBuffer implements TerminalEngine {
  private rows: Cell[][] = [[]];
  private col = 0;
  private style: TermStyle = {};
  private pending = "";
  private readonly cap: number;

  constructor(cap = SCROLLBACK_LINES) {
    this.cap = cap;
  }

  write(data: string): void {
    const input = this.pending + data;
    this.pending = "";
    let i = 0;
    while (i < input.length) {
      const ch = input.charAt(i);
      if (ch === "\x1b") {
        const end = this.escapeEnd(input, i);
        if (end < 0) { this.pending = input.slice(i); return; }
        this.escape(input.slice(i, end));
        i = end;
        continue;
      }
      i += 1;
      if (ch === "\n") this.newline();
      else if (ch === "\r") this.col = 0;
      else if (ch === "\b") this.col = Math.max(0, this.col - 1);
      else if (ch === "\t") this.put(" ".repeat(8 - (this.col % 8)));
      else if (ch === "\x07" || ch < " ") continue;
      else this.put(ch);
    }
  }

  clear(): void {
    this.rows = [[]];
    this.col = 0;
    this.style = {};
    this.pending = "";
  }

  lines(): readonly TermLine[] {
    const out: TermLine[] = [];
    for (const row of this.rows) out.push(toLine(row));
    return out;
  }

  text(): string {
    const out: string[] = [];
    for (const row of this.rows) {
      let line = "";
      for (const cell of row) line += cell.ch;
      out.push(line.replace(/\s+$/, ""));
    }
    return out.join("\n");
  }

  /** Column of the cursor on the last row, for drawing it. */
  cursor(): number {
    return this.col;
  }

  private current(): Cell[] {
    return this.rows[this.rows.length - 1] ?? [];
  }

  private put(text: string): void {
    for (const ch of text) {
      const row = this.current();
      while (row.length < this.col) row.push({ ch: " ", style: {} });
      row[this.col] = { ch, style: this.style };
      this.col += 1;
    }
  }

  private newline(): void {
    this.rows.push([]);
    this.col = 0;
    if (this.rows.length > this.cap) this.rows.splice(0, this.rows.length - this.cap);
  }

  /** Index just after the escape sequence that starts at `from`, or -1 when it is not complete yet. */
  private escapeEnd(s: string, from: number): number {
    const next = s.charAt(from + 1);
    if (next === "") return -1;
    if (next === "[") {
      for (let j = from + 2; j < s.length; j++) {
        const c = s.charCodeAt(j);
        if (c >= 0x40 && c <= 0x7e) return j + 1;
      }
      return -1;
    }
    if (next === "]") {
      for (let j = from + 2; j < s.length; j++) {
        if (s.charAt(j) === "\x07") return j + 1;
        if (s.charAt(j) === "\x1b" && s.charAt(j + 1) === "\\") return j + 2;
      }
      return -1;
    }
    return from + 2;
  }

  private escape(seq: string): void {
    if (!seq.startsWith("\x1b[")) return;
    const final = seq.charAt(seq.length - 1);
    const args: number[] = [];
    for (const a of seq.slice(2, -1).split(";")) args.push(a === "" ? 0 : Number.parseInt(a, 10));
    const first = args[0] ?? 0;
    switch (final) {
      case "m": this.sgr(args); break;
      case "J": if (first === 2 || first === 3) { this.rows = [[]]; this.col = 0; } break;
      case "K": {
        const row = this.current();
        if (first === 2) row.length = 0;
        else if (first === 0) row.length = Math.min(row.length, this.col);
        else for (let c = 0; c < Math.min(this.col, row.length); c++) row[c] = { ch: " ", style: {} };
        break;
      }
      case "H": case "f": this.col = Math.max(0, (args[1] ?? 1) - 1); break;
      case "G": this.col = Math.max(0, first - 1); break;
      case "C": this.col += Math.max(1, first); break;
      case "D": this.col = Math.max(0, this.col - Math.max(1, first)); break;
      default: break;
    }
  }

  private sgr(args: readonly number[]): void {
    for (const a of args) {
      if (a === 0) this.style = {};
      else if (a === 1) this.style = { ...this.style, bold: true };
      else if (a === 2) this.style = { ...this.style, dim: true };
      else if (a === 22) { const { bold: _b, dim: _d, ...rest } = this.style; this.style = rest; }
      else if (a === 39) { const { fg: _f, ...rest } = this.style; this.style = rest; }
      else if (SGR_COLORS[a] !== undefined) this.style = { ...this.style, fg: SGR_COLORS[a] as string };
    }
  }
}

/* ---------- live frames ---------- */

export interface TerminalFrame {
  seq: number;
  data: string;
}

/** Something that delivers frames of one attached session in order. terminal.attach gives the replay and a ticket for the stream. */
export interface TerminalSource {
  subscribe(onFrame: (frame: TerminalFrame) => void): () => void;
}

export type PushResult = "ok" | "duplicate" | "gap";

/** Orders frames: the replay first, then each frame once. A gap asks the caller to re-attach from the next sequence it needs. */
export class TerminalFeed {
  readonly engine: TerminalEngine;
  private last: number;

  constructor(replay = "", engine: TerminalEngine = new TerminalBuffer(), replaySeq = 0) {
    this.engine = engine;
    this.last = replaySeq;
    if (replay.length > 0) engine.write(replay);
  }

  push(frame: TerminalFrame): PushResult {
    if (frame.seq <= this.last) return "duplicate";
    if (frame.seq !== this.last + 1) return "gap";
    this.last = frame.seq;
    this.engine.write(frame.data);
    return "ok";
  }

  next(): number {
    return this.last + 1;
  }
}

/* ---------- keys and copy ---------- */

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const KEY_BYTES: Readonly<Record<string, string>> = {
  Enter: "\r", Backspace: "\x7f", Tab: "\t", Escape: "\x1b", ArrowUp: "\x1b[A", ArrowDown: "\x1b[B", ArrowRight: "\x1b[C", ArrowLeft: "\x1b[D", Home: "\x1b[H", End: "\x1b[F", Delete: "\x1b[3~", PageUp: "\x1b[5~", PageDown: "\x1b[6~",
};

/** What the shell sees for a key press, or null when the key is not for the shell (Cmd shortcuts, bare modifiers). */
export function keyToData(e: KeyLike): string | null {
  if (e.metaKey === true) return null;
  if (e.ctrlKey === true) {
    const k = e.key.toLowerCase();
    if (k.length === 1 && k >= "a" && k <= "z") return String.fromCharCode(k.charCodeAt(0) - 96);
    return null;
  }
  const mapped = KEY_BYTES[e.key];
  if (mapped !== undefined) return e.altKey === true && e.key === "Backspace" ? "\x1b\x7f" : mapped;
  if (e.key.length === 1) return e.altKey === true ? `\x1b${e.key}` : e.key;
  return null;
}

/** Cmd-K or Ctrl-L clears the screen; the shell's own clear still works. */
export function isClearKey(e: KeyLike): boolean {
  const k = e.key.toLowerCase();
  return (e.metaKey === true && k === "k") || (e.ctrlKey === true && k === "l");
}

/** Cmd-D or Ctrl-D stars a session that can be starred. */
export function isStarKey(e: KeyLike): boolean {
  return (e.metaKey === true || e.ctrlKey === true) && e.key.toLowerCase() === "d" && e.shiftKey !== true;
}

/** What a selection copies: the text with trailing spaces trimmed from each line, or null for an empty selection. */
export function selectionToCopy(selection: string): string | null {
  const trimmed: string[] = [];
  for (const line of selection.split("\n")) trimmed.push(line.replace(/\s+$/, ""));
  const text = trimmed.join("\n").replace(/^\n+|\n+$/g, "");
  return text.length > 0 ? text : null;
}

/** Copy on select: writes the selection with the given writer. Returns the copied text, or null when nothing was selected. */
export async function copySelection(selection: string, write: (text: string) => Promise<void> | void): Promise<string | null> {
  const text = selectionToCopy(selection);
  if (text === null) return null;
  await write(text);
  return text;
}

/** The host switcher menu. The server entry says locked until server.services is granted, and still opens so the locked state can ask. */
export function hostMenu(current: TerminalHost, serverLocked: boolean, onHost: (host: TerminalHost) => void): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const h of TERMINAL_HOSTS) out.push({ label: `${HOST_NAMES[h]}${h === "server" && serverLocked ? " (locked)" : ""}`, checked: h === current, onSelect: () => onHost(h) });
  return out;
}

/* ---------- web glue ---------- */

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {}) as Record<string, unknown>;

interface DomGlobals {
  getSelection?: () => { toString(): string } | null;
  navigator?: { clipboard?: { writeText(t: string): Promise<void> } };
}

const dom = (): DomGlobals => globalThis as unknown as DomGlobals;

async function writeClipboard(text: string): Promise<void> {
  await dom().navigator?.clipboard?.writeText(text);
}

/* ---------- icons ---------- */

const ICON = {
  terminal: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 6.5l2 1.8-2 1.8M8.8 10.2H11"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.8"/><path d="M5.5 7V5.3a2.5 2.5 0 015 0V7"/>',
  agent: '<rect x="3" y="5" width="10" height="7.500" rx="2"/><path d="M8 5V3M6 8.500v.5M10 8.500v.5"/>',
  server: '<rect x="2.500" y="3" width="11" height="4" rx="1.200"/><rect x="2.500" y="9" width="11" height="4" rx="1.200"/><path d="M5 5h.01M5 11h.01"/>',
  device: '<rect x="3" y="4" width="10" height="6.500" rx="1.200"/><path d="M1.800 12.500h12.400"/>',
} as const;

function Icon({ name, size = 13, color }: { name: keyof typeof ICON; size?: number; color?: string }): ReactElement {
  return <MenuIcon icon={`<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`} size={size} {...(color === undefined ? {} : { color })} />;
}

const hostIcon = (h: TerminalHost): keyof typeof ICON => (h === "agent" ? "agent" : h === "server" ? "server" : "device");

/* ---------- the view ---------- */

export interface TerminalViewProps extends TerminalProps {
  /** Live frames of the attached session. Without it the view shows `output` as it is. */
  source?: TerminalSource;
  /** The engine to draw. Default: the built-in TerminalBuffer. Pass an xterm-backed engine to use xterm. */
  engine?: TerminalEngine;
  /** Sequence of the last frame the replay in `output` already contains. */
  replaySeq?: number;
  /** Who to ask for access, for the locked state: "Ask Maya Chen for access". */
  owner?: string;
  asked?: boolean;
  /** The agent whose computer opens instead of the locked server shell. */
  fallbackLabel?: string;
  /** A short confirmation shown at the right of the bar, for example "Copied". */
  note?: string;
  onInput?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onInterrupt?: () => void;
  onClear?: () => void;
  onCopy?: (text: string) => void;
  /** The frames had a gap: attach again from this sequence. */
  onGap?: (fromSeq: number) => void;
  onBack?: () => void;
  testID?: string;
}

const TOKEN: Readonly<Record<string, string>> = { ok: "var(--ok)", danger: "var(--danger)", warn: "var(--warn)", accent: "var(--accent)", "ink-3": "var(--ink-3)", ink: "var(--ink)" };

function spanStyle(style: TermStyle): { color?: string; fontWeight?: "600"; opacity?: number } {
  const out: { color?: string; fontWeight?: "600"; opacity?: number } = {};
  if (style.fg !== undefined) out.color = TOKEN[style.fg] ?? "var(--ink)";
  if (style.bold === true) out.fontWeight = "600";
  if (style.dim === true) out.opacity = 0.65;
  return out;
}

function Lines({ lines, cursor }: { lines: readonly TermLine[]; cursor: boolean }): ReactElement {
  const nodes: ReactElement[] = [];
  const from = Math.max(0, lines.length - 600);
  for (let i = from; i < lines.length; i++) {
    const line = lines[i] ?? [];
    const spans: ReactElement[] = [];
    for (const [j, span] of line.entries()) spans.push(<Text key={j} style={spanStyle(span.style)}>{span.text}</Text>);
    const last = i === lines.length - 1;
    nodes.push(
      <Text key={i} selectable style={styles.ln}>
        {spans}
        {last && cursor ? <Text style={styles.cursor} testID="terminal-cursor">{" "}</Text> : null}
        {spans.length === 0 && !(last && cursor) ? " " : null}
      </Text>,
    );
  }
  return <View>{nodes}</View>;
}

export function Terminal(props: TerminalViewProps): ReactElement {
  const menu = useMenu();
  const scroller = useRef<ScrollView | null>(null);
  const [, setVersion] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const exited = props.state === "exited";
  const session = props.state !== undefined;
  const locked = props.locked === true;
  const interactive = !locked && props.readonly !== true && !exited;

  const feed = useMemo(() => new TerminalFeed(props.output ?? "", props.engine ?? new TerminalBuffer(), props.replaySeq ?? 0), [props.output, props.engine, props.replaySeq]);

  useEffect(() => {
    if (props.source === undefined || locked) return undefined;
    const stop = props.source.subscribe((frame) => {
      const result = feed.push(frame);
      if (result === "ok") setVersion((v) => v + 1);
      else if (result === "gap") props.onGap?.(feed.next());
    });
    return stop;
  }, [props.source, feed, locked, props.onGap]);

  useEffect(() => {
    if (copied === null) return undefined;
    const id = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const clear = (): void => {
    feed.engine.clear();
    setVersion((v) => v + 1);
    props.onClear?.();
  };

  const onKey = (e: KeyLike & { preventDefault?: () => void; stopPropagation?: () => void }): void => {
    if (isClearKey(e)) { e.preventDefault?.(); e.stopPropagation?.(); clear(); return; }
    if (isStarKey(e) && session && props.onStar !== undefined) { e.preventDefault?.(); e.stopPropagation?.(); props.onStar(props.sessionId); return; }
    if (!interactive) return;
    const data = keyToData(e);
    if (data === null) return;
    e.preventDefault?.();
    e.stopPropagation?.();
    if (data === "\x03") props.onInterrupt?.();
    props.onInput?.(data);
  };

  const onMouseUp = (): void => {
    const selected = dom().getSelection?.()?.toString() ?? "";
    void copySelection(selected, writeClipboard).then((text) => {
      if (text === null) return;
      setCopied("Copied");
      props.onCopy?.(text);
    });
  };

  const lines = feed.engine.lines();
  const text = props.note ?? copied ?? "";
  const hostChip = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Host: ${props.hostLabel}`}
      onPress={(e: { nativeEvent?: { pageX?: number; pageY?: number } }) => menu.show(hostMenu(props.host, locked && props.host === "server", (h) => props.onHost?.(h)), e.nativeEvent?.pageX ?? 0, e.nativeEvent?.pageY ?? 0, "context", { label: "Terminal host" })}
      testID="terminal-host"
      style={({ hovered }: { hovered?: boolean }) => [styles.chip, hovered === true && styles.chipHover]}
    >
      <View style={[styles.statusDot, locked && styles.statusLocked]} />
      <Icon name={hostIcon(props.host)} color="var(--ink-3)" />
      <Text style={styles.chipText} numberOfLines={1}>{props.hostLabel}</Text>
      <Text style={styles.chev}>{"▾"}</Text>
    </Pressable>
  );
  const sessionChip = (
    <View style={styles.chip} testID="terminal-state">
      <View style={[styles.statusDot, exited && styles.statusExited]} />
      <Text style={styles.chipText} numberOfLines={1}>{terminalLabel(props)}</Text>
    </View>
  );
  const sub = session
    ? `${props.hostLabel} · ${exited ? "exited" : "running"}${props.readonly === true ? " · read-only, you do not have access" : ""}`
    : "";

  return (
    <View
      accessibilityLabel={`Terminal ${terminalLabel(props)}`}
      testID={props.testID ?? `terminal-${props.sessionId}`}
      style={styles.root}
      {...webProps({ role: "region", dataSet: { host: props.host, state: props.state ?? "" } })}
    >
      <View style={styles.bar}>
        {session ? sessionChip : hostChip}
        {session ? <Text style={styles.sub} numberOfLines={1} testID="terminal-sub">{sub}</Text> : null}
        <View style={styles.grow} />
        {text.length > 0 ? <Text style={styles.note} testID="terminal-note">{text}</Text> : null}
        {session && props.onStar !== undefined ? (
          <Pressable accessibilityRole="button" accessibilityLabel={props.starred === true ? "Remove star" : "Star"} accessibilityState={{ selected: props.starred === true }} onPress={() => props.onStar?.(props.sessionId)} testID="terminal-star" {...webProps({ title: "Star  ⌘D" })} style={({ hovered }: { hovered?: boolean }) => [styles.btn, hovered === true && styles.btnHover]}>
            <MenuIcon icon="star" size={14} color={props.starred === true ? "var(--warn)" : "var(--ink-3)"} />
          </Pressable>
        ) : null}
        {!locked ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={clear} testID="terminal-clear" {...webProps({ title: "Clear  ⌘K" })} style={({ hovered }: { hovered?: boolean }) => [styles.btn, styles.btnWide, hovered === true && styles.btnHover]}>
            <Text style={styles.btnText}>Clear</Text>
            <Text style={styles.kbd}>{"⌘K"}</Text>
          </Pressable>
        ) : null}
      </View>
      {locked ? (
        <View style={styles.lock} testID="terminal-locked">
          <View style={styles.lockIn}>
            <View style={styles.lockIcon}><Icon name="lock" size={18} color="var(--ink-3)" /></View>
            <Text style={styles.lockTitle}>The server shell is locked</Text>
            <Text style={styles.lockText}>{"It needs the server.services permission. Owners and Developers have it."}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={props.owner !== undefined ? `Ask ${props.owner} for access` : "Ask for access"} accessibilityState={{ disabled: props.asked === true }} disabled={props.asked === true} onPress={props.onAskAccess} testID="terminal-ask" style={({ hovered }: { hovered?: boolean }) => [styles.go, props.asked === true && styles.goOff, hovered === true && styles.goHover]}>
              <Text style={[styles.goText, props.asked === true && styles.goTextOff]}>{props.asked === true ? (props.owner !== undefined ? `Asked ${props.owner}` : "Asked") : props.owner !== undefined ? `Ask ${props.owner} for access` : "Ask for access"}</Text>
            </Pressable>
            {props.fallbackLabel !== undefined ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${props.fallbackLabel} instead`} onPress={props.onBack} testID="terminal-back" style={({ hovered }: { hovered?: boolean }) => [styles.back, hovered === true && styles.btnHover]}>
                <Text style={styles.backText}>{`Open ${props.fallbackLabel} instead`}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={[styles.scroll, NO_OUTLINE]} testID="terminal-screen" {...webProps({ tabIndex: 0, onKeyDown: onKey, onMouseUp })}>
          <ScrollView
            ref={scroller}
            testID="terminal-scroll"
            accessibilityLabel={`Output on ${props.hostLabel}`}
            style={styles.scroll}
            contentContainerStyle={styles.scrollIn}
            onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
            onLayout={(e: { nativeEvent?: { layout?: { width: number; height: number } } }) => {
              const box = e.nativeEvent?.layout;
              if (box !== undefined && props.onResize !== undefined) { const g = gridSize(box.width, box.height); props.onResize(g.cols, g.rows); }
            }}
          >
            <Lines lines={lines} cursor={interactive} />
            {Platform.OS !== "web" && interactive ? (
              <TextInput accessibilityLabel={`Terminal input on ${props.hostLabel}`} autoCapitalize="none" autoCorrect={false} onSubmitEditing={(e: { nativeEvent: { text: string } }) => props.onInput?.(`${e.nativeEvent.text}\r`)} style={styles.nativeIn} testID="terminal-input" />
            ) : null}
          </ScrollView>
        </View>
      )}
      {menu.element}
    </View>
  );
}

/* ---------- styles ---------- */

const MONO = "var(--mono, ui-monospace, Menlo, monospace)";
const NO_OUTLINE = { outlineStyle: "none" } as unknown as ViewStyle;

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 220, minWidth: 0, backgroundColor: "var(--sunk)" as string },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, height: 38, paddingLeft: 12, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  grow: { flex: 1 },
  chip: { flexDirection: "row", alignItems: "center", gap: 7, height: 26, paddingLeft: 9, paddingRight: 8, borderRadius: 6 },
  chipHover: { backgroundColor: "var(--hover)" as string },
  chipText: { color: "var(--ink)" as string, fontSize: 12.5, fontWeight: "500" },
  chev: { color: "var(--ink-3)" as string, fontSize: 10 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--ok)" as string },
  statusLocked: { backgroundColor: "var(--ink-4)" as string },
  statusExited: { backgroundColor: "var(--ink-4)" as string },
  sub: { flexShrink: 1, color: "var(--ink-3)" as string, fontSize: 12 },
  note: { color: "var(--ok)" as string, fontSize: 12 },
  btn: { height: 26, minWidth: 26, paddingHorizontal: 6, borderRadius: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  btnWide: { paddingHorizontal: 8 },
  btnHover: { backgroundColor: "var(--hover)" as string },
  btnText: { color: "var(--ink-3)" as string, fontSize: 12.5 },
  kbd: { color: "var(--ink-3)" as string, fontSize: 11, paddingHorizontal: 4, borderRadius: 4, borderWidth: 1, borderColor: "var(--line-2)" as string },
  scroll: { flex: 1, minHeight: 0 },
  scrollIn: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 16 },
  ln: { color: "var(--ink)" as string, fontFamily: MONO, fontSize: 12.5, lineHeight: 20, minHeight: 20 },
  cursor: { backgroundColor: "var(--accent)" as string, color: "var(--accent)" as string },
  nativeIn: { height: 36, marginTop: 8, color: "var(--ink)" as string, fontFamily: MONO, fontSize: 12.5 },
  lock: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  lockIn: { maxWidth: 340, alignItems: "center" },
  lockIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 12, backgroundColor: "var(--win)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  lockTitle: { color: "var(--ink)" as string, fontSize: 14, fontWeight: "600", marginBottom: 4, textAlign: "center" },
  lockText: { color: "var(--ink-3)" as string, fontSize: 13, lineHeight: 19, textAlign: "center", marginBottom: 14 },
  go: { height: 32, paddingHorizontal: 14, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  goOff: { backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string },
  goHover: { opacity: 0.92 },
  goText: { color: "var(--accent-ink)" as string, fontSize: 13, fontWeight: "500" },
  goTextOff: { color: "var(--ink-3)" as string },
  back: { marginTop: 10, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6 },
  backText: { color: "var(--ink-3)" as string, fontSize: 12.5 },
});

export type { TerminalSessionState as TerminalState };
export const TERMINAL_VIEW_STATES: readonly TerminalSessionState[] = ["running", "exited"];
