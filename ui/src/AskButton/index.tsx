// ui/AskButton: the one Ask control (owner requirement). A split button: the face of the agent that will answer plus "Ask", and a chevron that opens
// a picker of every agent this person can ask. Pressing Ask starts a NEW thread about the current item with that agent; with no agent tied to the item
// the press opens the picker first. The shape follows the prototype's VyreUI.ask.
// Which agent shows: the one picked for this same item, else the suggested one, else the last pick in this place, else the Space assistant.
// Keys: Cmd-J (Ctrl-J) opens the nearest visible Ask; in the picker type to search, arrows move, Enter picks, Escape closes.
// Right-click (or the menu key, or a long press): Change Agent, Open the agent's page. Lists use the shared Row; menus use the shared Menu.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { MenuIcon, menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { Row } from "../Row/index.tsx";
import {
  agentIndices,
  clampPanel,
  hasDefault,
  isAskShortcut,
  layeredStorage,
  mainLabel,
  modesFor,
  movePicker,
  offersChoice,
  pickerEntries,
  pushRecent,
  readRecents,
  rememberPick,
  resolveAgent,
  webStorage,
} from "./logic.ts";
import type { PickerKey } from "./logic.ts";
import type { AskAgent, AskButtonProps, AskMode, AskStorage } from "./types.ts";

export type { AskAccess, AskAgent, AskButtonProps, AskContext, AskMode, AskStorage, PickerEntry } from "./types.ts";
export * from "./logic.ts";

/* ---------- icons (svg strings the shared Menu icon slot draws) ---------- */

const SVG_OPEN = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';
export const ASK_ICONS = {
  spark: `${SVG_OPEN}<path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2"/></svg>`,
  chat: `${SVG_OPEN}<path d="M3 4.5A2 2 0 015 2.5h6a2 2 0 012 2v4.5a2 2 0 01-2 2H7l-3 2.5V11a2 2 0 01-1-1.7z"/></svg>`,
  swap: `${SVG_OPEN}<path d="M3 5.5h9M9.5 3l2.5 2.5L9.5 8M13 10.5H4M6.5 8L4 10.5 6.5 13"/></svg>`,
  open: `${SVG_OPEN}<path d="M9.5 2.5h4v4M13.5 2.5L8 8"/><path d="M12 9.5V12a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 12V5.5A1.5 1.5 0 014 4h2.5"/></svg>`,
} as const;

/* ---------- web-only props without a ts-ignore ---------- */

interface KeyEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

function webProps(props: Record<string, unknown>): Record<string, unknown> {
  return Platform.OS === "web" ? props : {};
}

const FIXED = (Platform.OS === "web" ? "fixed" : "absolute") as unknown as ViewStyle["position"];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Measurable {
  getBoundingClientRect?: () => { left: number; top: number; width: number; height: number };
  measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
}

function measure(node: unknown, done: (rect: Rect) => void): void {
  const target = node as Measurable | null;
  if (target === null || typeof target !== "object") return;
  if (Platform.OS === "web" && typeof target.getBoundingClientRect === "function") {
    const r = target.getBoundingClientRect();
    done({ x: r.left, y: r.top, w: r.width, h: r.height });
    return;
  }
  if (typeof target.measureInWindow === "function") target.measureInWindow((x, y, w, h) => done({ x, y, w, h }));
}

/* ---------- the face of an agent ---------- */

function hash(text: string): number {
  let h = 7;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

const HUES = [250, 160, 28, 205, 330, 95, 12, 280] as const;

/** The default avatar: the Vyre mark for the assistant, a letter tile with a stable hue for every other agent. */
export function AskFace({ agent, size = 20 }: { agent: AskAgent; size?: number }): ReactElement {
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.3), alignItems: "center", justifyContent: "center" } as const;
  if (agent.assistant === true || agent.name === "Assistant") {
    const mark = Math.round(size * 0.78);
    return (
      <View aria-hidden testID={`ask-face-${agent.id}`} style={[box, styles.assistantTile]}>
        {Platform.OS === "web"
          ? createElement("svg", { width: mark, height: mark, viewBox: "0 0 24 24", "aria-hidden": true, style: { color: "var(--ink)" } },
            createElement("path", { d: "M5.2 6.4l6.3 11.2 4.9-8.6", fill: "none", stroke: "currentColor", strokeWidth: 3.1, strokeLinecap: "round", strokeLinejoin: "round" }),
            createElement("circle", { cx: 18.6, cy: 5.6, r: 2.7, fill: "var(--beacon, #8B7CF6)" }))
          : <Text style={{ color: "var(--ink)" as string, fontSize: Math.round(size * 0.5), fontWeight: "700" }}>V</Text>}
      </View>
    );
  }
  const hue = HUES[hash(agent.name) % HUES.length] ?? 250;
  return (
    <View aria-hidden testID={`ask-face-${agent.id}`} style={[box, { backgroundColor: `hsl(${hue} 45% 88%)` as string }]}>
      <Text style={{ color: `hsl(${hue} 38% 32%)` as string, fontSize: Math.max(9, Math.round(size * 0.48)), fontWeight: "600" }}>{agent.name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

/* ---------- Cmd-J: the nearest visible Ask ---------- */

interface Mounted {
  open: () => void;
  node: () => unknown;
}

const mounted = new Set<Mounted>();
let listening = false;

function visible(node: unknown): boolean {
  const target = node as { getClientRects?: () => { length: number }; isConnected?: boolean } | null;
  if (target === null || typeof target !== "object") return false;
  if (target.isConnected === false) return false;
  return typeof target.getClientRects === "function" ? target.getClientRects().length > 0 : true;
}

/** The Ask that Cmd-J opens: the last one mounted that is on screen. */
export function nearestAsk(): Mounted | null {
  const live = [...mounted].filter((entry) => visible(entry.node()));
  return live[live.length - 1] ?? null;
}

function onShortcut(event: KeyEventLike): void {
  if (!isAskShortcut(event)) return;
  const target = nearestAsk();
  if (target === null) return;
  event.preventDefault?.();
  event.stopPropagation?.();
  target.open();
}

function listen(): void {
  if (listening || Platform.OS !== "web") return;
  const host = globalThis as { addEventListener?: (type: string, fn: (event: KeyEventLike) => void, capture: boolean) => void };
  if (typeof host.addEventListener !== "function") return;
  host.addEventListener("keydown", onShortcut, true);
  listening = true;
}

/* ---------- the picker ---------- */

const PANEL_W = 280;
const PANEL_H = 340;

export interface PickerProps {
  entries: ReturnType<typeof pickerEntries>;
  query: string;
  onQuery: (text: string) => void;
  active: number;
  onActive: (index: number) => void;
  onChoose: (agent: AskAgent) => void;
  onClose: () => void;
  anchor: Rect;
  renderFace: (agent: AskAgent, size: number) => ReactNode;
}

export function AskPicker(props: PickerProps): ReactElement {
  const { entries, query, onQuery, active, onActive, onChoose, onClose, anchor, renderFace } = props;
  const window = useWindowDimensions();
  const { left, top } = clampPanel(anchor.x, anchor.y + anchor.h + 4, PANEL_W, PANEL_H, window.width, window.height);

  const onKeyDown = (event: KeyEventLike): void => {
    const { key } = event;
    if (key === "Escape") {
      event.preventDefault?.();
      event.stopPropagation?.();
      onClose();
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault?.();
      onActive(movePicker(entries, active, key as PickerKey));
      return;
    }
    if (key === "Tab") {
      event.preventDefault?.();
      onActive(movePicker(entries, active, event.shiftKey === true ? "ArrowUp" : "ArrowDown"));
      return;
    }
    if (key === "Enter") {
      event.preventDefault?.();
      const lit = entries[active];
      const first = entries[agentIndices(entries)[0] ?? -1];
      const hit = lit !== undefined && lit.agent !== undefined ? lit : first;
      if (hit !== undefined && hit.agent !== undefined) onChoose(hit.agent);
    }
  };

  const rows: ReactNode[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === "head") {
      rows.push(<Text key={`h${index}`} style={styles.head} role="heading" aria-level={3}>{entry.label}</Text>);
      return;
    }
    const agent = entry.agent;
    if (agent === undefined) return;
    rows.push(
      <Row
        key={`a${agent.id}`}
        id={`ask-agent-${agent.id}`}
        title={agent.name}
        {...(entry.note !== undefined && entry.note !== "" ? { note: entry.note } : {})}
        hovered={index === active}
        leading={<View style={styles.faceSlot}>{renderFace(agent, 22)}</View>}
        {...(entry.current === true ? { trailing: <MenuIcon icon="check" color="var(--ink-3)" size={14} /> } : {})}
        onPress={() => onChoose(agent)}
      />,
    );
  });

  return (
    <View style={styles.layer} testID="ask-layer" pointerEvents="box-none">
      <Pressable
        accessibilityLabel="Close"
        style={styles.backdrop}
        onPress={onClose}
        {...menuTrigger(() => onClose())}
        {...webProps({ tabIndex: -1 })}
      />
      <View role="dialog" aria-label="Choose the agent" testID="ask-picker" style={[styles.panel, { left, top, width: PANEL_W }]} {...webProps({ onKeyDown })}>
        <TextInput
          autoFocus
          accessibilityLabel="Find an agent"
          placeholder="Find an agent"
          placeholderTextColor="var(--ink-4)"
          value={query}
          onChangeText={onQuery}
          testID="ask-find"
          style={styles.find}
        />
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {rows.length > 0 ? rows : <Text style={styles.none}>No agent matches.</Text>}
        </ScrollView>
      </View>
    </View>
  );
}

/* ---------- the control ---------- */

export function AskButton(props: AskButtonProps): ReactElement | null {
  const { place, context, agents, suggested, onAsk, onPick, onOpenAgent, renderFace, compact = false, startOpen = false, testID = "ask" } = props;
  const storage = useMemo<AskStorage>(() => props.storage ?? layeredStorage(webStorage()), [props.storage]);
  const [version, setVersion] = useState(0);
  const [picker, setPicker] = useState<{ anchor: Rect } | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [mainOver, setMainOver] = useState(false);
  const [chevOver, setChevOver] = useState(false);
  const [focus, setFocus] = useState<"main" | "chev" | null>(null);
  const wrap = useRef<View | null>(null);
  const { element: menuElement, show: showMenu } = useMenu();

  const input = useMemo(() => ({ agents, place, context, suggested, storage }), [agents, place, context, suggested, storage]);
  // version: a pick changes the stored key, so the resolution is read again
  const current = useMemo(() => resolveAgent(input), [input, version]);
  const suggestedAgent = useMemo(() => (suggested === undefined ? null : agents.find((a) => a.id === suggested) ?? null), [agents, suggested]);
  const modes = useMemo(() => modesFor(props.modes, context.access), [props.modes, context.access]);
  const face = useCallback((agent: AskAgent, size: number): ReactNode => (renderFace === undefined ? <AskFace agent={agent} size={size} /> : renderFace(agent, size)), [renderFace]);

  const entries = useMemo(
    () => pickerEntries({ agents, current, suggested: suggestedAgent, recents: readRecents(storage), query }),
    [agents, current, suggestedAgent, storage, query, version, picker],
  );

  const closePicker = useCallback(() => {
    setPicker(null);
    setQuery("");
  }, []);

  const withAnchor = useCallback((then: (rect: Rect) => void) => {
    measure(wrap.current, then);
  }, []);

  const openPicker = useCallback(() => {
    withAnchor((rect) => {
      setQuery("");
      setPicker({ anchor: rect });
    });
  }, [withAnchor]);

  useEffect(() => {
    setActive(movePicker(entries, -1, "Home"));
  }, [entries]);

  /** The new thread: one press for chat only, a small choice menu when Do it is offered as well. */
  const start = useCallback((agent: AskAgent) => {
    pushRecent(storage, agent.id);
    if (offersChoice(modes)) {
      withAnchor((rect) => {
        const items: MenuEntry[] = [
          { head: `Ask ${agent.name}` },
          { label: "Do it", icon: ASK_ICONS.spark, onSelect: () => onAsk(agent, "do", context) },
          { label: "Chat about it", icon: ASK_ICONS.chat, onSelect: () => onAsk(agent, "chat", context) },
        ];
        showMenu(items, rect.x, rect.y + rect.h + 4, "other", { label: `Ask ${agent.name}` });
      });
      return;
    }
    const mode: AskMode = modes[0] ?? "chat";
    onAsk(agent, mode, context);
  }, [storage, modes, withAnchor, showMenu, onAsk, context]);

  const choose = useCallback((agent: AskAgent) => {
    rememberPick(storage, place, context, agent);
    setVersion((v) => v + 1);
    closePicker();
    if (onPick) onPick(agent);
    start(agent);
  }, [storage, place, context, closePicker, onPick, start]);

  const press = useCallback(() => {
    if (current === null) return;
    if (!hasDefault(input)) {
      openPicker();
      return;
    }
    start(current);
  }, [current, input, openPicker, start]);

  const openMenu = useCallback((x: number, y: number) => {
    if (current === null) return;
    const items: MenuEntry[] = [
      { label: "Change Agent…", icon: ASK_ICONS.swap, onSelect: () => setTimeout(openPicker, 0) },
      ...(onOpenAgent === undefined ? [] : [{ label: `Open ${current.name}'s Page`, icon: ASK_ICONS.open, onSelect: () => onOpenAgent(current) }]),
    ];
    showMenu(items, x, y, "context", { label: "Ask" });
  }, [current, onOpenAgent, openPicker, showMenu]);

  // Cmd-J opens the nearest visible Ask: the picker when it only chats, the Do it or Chat choice otherwise.
  useEffect(() => {
    const entry: Mounted = {
      node: () => wrap.current,
      open: () => {
        if (offersChoice(modes) && current !== null) press();
        else openPicker();
      },
    };
    mounted.add(entry);
    listen();
    return () => {
      mounted.delete(entry);
    };
  }, [modes, current, press, openPicker]);

  useEffect(() => {
    if (startOpen) openPicker();
  }, [startOpen, openPicker]);

  if (current === null) return null;
  const label = mainLabel(current, context);
  const wash = "color-mix(in srgb, var(--accent) 16%, transparent)" as string;

  return (
    <View ref={wrap} style={styles.host} testID={testID}>
      <View style={styles.split}>
        <Pressable
          role="button"
          aria-label={label}
          aria-haspopup="menu"
          testID={`${testID}-main`}
          onPress={press}
          onHoverIn={() => setMainOver(true)}
          onHoverOut={() => setMainOver(false)}
          onFocus={() => setFocus("main")}
          onBlur={() => setFocus(null)}
          style={[styles.main, compact && styles.mainCompact, mainOver && { backgroundColor: wash }, focus === "main" && styles.focus]}
          {...menuTrigger(openMenu)}
          {...webProps({ title: `${label}  ⌘J` })}
        >
          {face(current, 20)}
          {compact ? null : <Text style={styles.ask}>Ask</Text>}
        </Pressable>
        <Pressable
          role="button"
          aria-label="Change agent"
          aria-haspopup="menu"
          aria-expanded={picker !== null}
          testID={`${testID}-chevron`}
          onPress={openPicker}
          onHoverIn={() => setChevOver(true)}
          onHoverOut={() => setChevOver(false)}
          onFocus={() => setFocus("chev")}
          onBlur={() => setFocus(null)}
          style={[styles.chev, chevOver && { backgroundColor: wash }, focus === "chev" && styles.focus]}
          {...menuTrigger(openMenu)}
          {...webProps({ title: "Change agent" })}
        >
          <MenuIcon icon={CHEVRON} color="var(--accent)" size={10} />
        </Pressable>
      </View>
      {picker === null ? null : (
        <AskPicker
          entries={entries}
          query={query}
          onQuery={setQuery}
          active={active}
          onActive={setActive}
          onChoose={choose}
          onClose={closePicker}
          anchor={picker.anchor}
          renderFace={face}
        />
      )}
      {menuElement}
    </View>
  );
}

const CHEVRON = '<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5l3 3 3-3"/></svg>';

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  host: { flexShrink: 0, alignSelf: "center" },
  split: { flexDirection: "row", height: 30, borderRadius: 8, backgroundColor: "var(--accent-wash)" as string, overflow: "hidden" },
  main: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 5, paddingRight: 11 },
  mainCompact: { paddingRight: 5 },
  chev: { alignItems: "center", justifyContent: "center", paddingHorizontal: 7, borderLeftWidth: 1, borderLeftColor: "color-mix(in srgb, var(--accent) 25%, transparent)" as string },
  ask: { color: "var(--accent)" as string, fontSize: 12.5, fontWeight: "600", lineHeight: 16 },
  focus: { outlineWidth: 2, outlineStyle: "solid", outlineColor: "var(--accent-line)" as string, outlineOffset: -2 },
  assistantTile: { backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  layer: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, zIndex: 2147482000 },
  backdrop: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "transparent" },
  panel: { position: FIXED, padding: 5, borderRadius: 10, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" as string, maxHeight: PANEL_H },
  find: { height: 28, marginBottom: 4, paddingHorizontal: 9, borderRadius: 6, backgroundColor: "var(--hover)" as string, color: "var(--ink)" as string, fontSize: 13, borderWidth: 0, outlineWidth: 0 },
  list: { flexGrow: 0 },
  head: { paddingTop: 6, paddingBottom: 4, paddingHorizontal: 9, fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  faceSlot: { width: 22, height: 22, marginRight: 9, alignItems: "center", justifyContent: "center" },
  none: { paddingVertical: 10, paddingHorizontal: 9, fontSize: 12.5, color: "var(--ink-3)" as string },
});
