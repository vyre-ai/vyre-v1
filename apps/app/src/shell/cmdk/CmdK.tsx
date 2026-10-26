// Cmd-K (spec 3.0; screens shell.cmdk and shell.new-tab). The sheet is the prototype palette: a veil, a 600 px card with one search field,
// quiet group headings, shared Rows (28 px, 44 px with a second line), a hint footer. The highlight is the quiet row wash, never a filled box.
// Type filters live in one header menu with checkmarks and counts (no pill row). Right-click on a result: Open, Open in New Tab, Copy Link.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AppIcon } from "../../../../../ui/src/AppIcon/index.tsx";
import { Avatar } from "../../../../../ui/src/Avatar/index.tsx";
import { Menu, MenuIcon, menuTrigger } from "../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { CmdKController } from "./controller.ts";
import type { CmdKData, CmdKOptions, CmdKState } from "./controller.ts";
import { filterEntries, filterLabels } from "./view.ts";
import { GROUPS } from "./model.ts";
import type { CmdAction, Hit, RowModel } from "./model.ts";
import { formatCombo } from "../keyboard/map.ts";
import type { Platform as KeyPlatform } from "../keyboard/map.ts";

const webOnly = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

/* ---------- icons by kind ---------- */

const SVG = (d: string): string => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const KIND_LABEL: ReadonlyMap<Hit["kind"], string> = new Map(GROUPS);
// The highlighted row takes the accent with white text (the prototype palette, ruling 82); the tokens the row reads are re-pointed inside it.
// A plain object, not StyleSheet.create, like the shared Row's own wash: it is written inline, so it is in the markup and not behind a generated class.
const LIT = { backgroundColor: "var(--accent)", borderRadius: 6, "--ink": "#FFFFFF", "--ink-2": "rgba(255,255,255,0.86)", "--ink-3": "rgba(255,255,255,0.74)" } as object;
const KIND_ICON: Partial<Record<Hit["kind"], string>> = {
  file: SVG('<path d="M4 2.500h5l3 3v8H4z"/><path d="M9 2.500v3h3"/>'),
  record: SVG('<rect x="2.500" y="3" width="11" height="10" rx="1.800"/><path d="M2.500 6.500h11M6.500 6.500v6.500"/>'),
  task: SVG('<circle cx="8" cy="8" r="5.500"/><path d="M5.500 8.200l1.700 1.700 3.300-3.600"/>'),
  inbox: SVG('<path d="M2.500 9.500l1.700-5.500h7.600l1.700 5.500v3h-11z"/><path d="M2.500 9.500h3l.8 1.500h3.400l.8-1.500h3"/>'),
  automation: SVG('<path d="M9 2L4 9h3.500L7 14l5-7H8.500z"/>'),
  app: SVG('<rect x="2.500" y="2.500" width="4.500" height="4.500" rx="1.200"/><rect x="9" y="2.500" width="4.500" height="4.500" rx="1.200"/><rect x="2.500" y="9" width="4.500" height="4.500" rx="1.200"/><rect x="9" y="9" width="4.500" height="4.500" rx="1.200"/>'),
  setting: SVG('<path d="M3 5h10M3 11h10"/><circle cx="6" cy="5" r="1.600"/><circle cx="10.500" cy="11" r="1.600"/>'),
  memory: SVG('<path d="M8 2.500a4.500 4.500 0 00-2 8.500v2h4v-2a4.500 4.500 0 00-2-8.500z"/>'),
  channel: SVG('<path d="M6.500 3L5.500 13M10.500 3l-1 10M3 6h10M3 10h10"/>'),
  chat: SVG('<path d="M3 4.500a1.500 1.500 0 011.500-1.500h7A1.500 1.500 0 0113 4.500v5a1.500 1.500 0 01-1.500 1.500H7l-3 2.500V11a1.500 1.500 0 01-1-1.400z"/>'),
};

/** The 20 px tile before a result: the shared face for people and agents, a line icon for everything else. */
export function Tile({ hit }: { hit: Hit }): ReactElement {
  const named = hit.kind === "person" || hit.kind === "agent";
  const icon = KIND_ICON[hit.kind];
  return (
    <View style={styles.tile}>
      {named ? <Avatar name={hit.title} seedId={hit.id} kind={hit.kind === "person" ? "person" : "agent"} size={20} /> : icon ? <MenuIcon icon={icon} color="var(--ink-3)" size={16} /> : <AppIcon brand={hit.title} name={hit.title} size={20} />}
    </View>
  );
}

function ActionTile({ action }: { action: CmdAction }): ReactElement {
  return <View style={styles.tile}><MenuIcon icon={action.icon} color="var(--ink-3)" size={16} /></View>;
}

/* ---------- the store hook ---------- */

export function useCmdK(data: CmdKData, options?: CmdKOptions, initial = ""): CmdKController {
  const ref = useRef<CmdKController | null>(null);
  if (ref.current === null) {
    ref.current = new CmdKController(data, options);
    if (initial) ref.current.setRaw(initial);
  }
  const ctl = ref.current;
  useEffect(() => () => ctl.dispose(), [ctl]);
  return ctl;
}

export function useCmdKState(ctl: CmdKController): CmdKState {
  return useSyncExternalStore(ctl.subscribe, ctl.getState, ctl.getState);
}

/* ---------- the body ---------- */

export interface CmdKBodyProps {
  controller: CmdKController;
  placeholder?: string;
  platform?: KeyPlatform;
  /** Inline in a tab (new-tab search) instead of a sheet: no veil, Enter fills the tab. */
  inline?: boolean;
  autoFocus?: boolean;
}

function scopeLine(state: CmdKState): string | null {
  const bits: string[] = [];
  if (state.parsed.prefix === "@") bits.push("People and agents");
  else if (state.parsed.prefix === "#") bits.push("Chats and records");
  else if (state.parsed.prefix === "/") bits.push("Files");
  else if (state.parsed.prefix === ">") bits.push("Actions");
  if (state.filter.length) bits.push(filterLabels(state.filter));
  const lead = bits.length ? `Searching ${bits.join(", ")}` : null;
  const note = state.scope === "device"
    ? "this device only: results are what it holds"
    : state.serverStatus === "offline" ? "offline: results are what this device holds"
    : state.serverStatus === "error" ? "server results did not load" : null;
  if (lead && note) return `${lead} (${note})`;
  return lead ?? (note ? note.charAt(0).toUpperCase() + note.slice(1) : null);
}

export function CmdKBody({ controller, placeholder = "Search agents, chats, people, records, files, actions…", platform = "mac", inline = false, autoFocus = true }: CmdKBodyProps): ReactElement {
  const state = useCmdKState(controller);
  const [menu, setMenu] = useState<{ items: MenuEntry[]; x: number; y: number } | null>(null);
  const input = useRef<unknown>(null);

  useEffect(() => {
    if (autoFocus && Platform.OS === "web") (input.current as { focus?: () => void } | null)?.focus?.();
  }, [autoFocus]);

  // Keep the highlighted row in view while arrowing.
  const activeKey = state.rows[state.active]?.key;
  useEffect(() => {
    if (Platform.OS !== "web" || !activeKey) return;
    const doc = (globalThis as { document?: { querySelector(s: string): { scrollIntoView?: (o: unknown) => void } | null } }).document;
    doc?.querySelector(`[data-testid="row-${activeKey}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeKey]);

  const onKey = (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; preventDefault?: () => void }): void => {
    const stop = (): void => e.preventDefault?.();
    if (e.key === "ArrowDown") { stop(); controller.move(1); }
    else if (e.key === "ArrowUp") { stop(); controller.move(-1); }
    else if (e.key === "Tab") { stop(); controller.move(e.shiftKey === true ? -1 : 1); }
    else if (e.key === "Enter") { stop(); controller.choose(state.active, e.metaKey === true || e.ctrlKey === true); }
    else if (e.key === "Escape") { stop(); controller.close(); }
  };

  const openFilters = (x: number, y: number): void => {
    const items: MenuEntry[] = [
      { head: "Show only" },
      ...filterEntries(state.counts, state.filter, (id) => controller.toggleFilter(id)),
      { separator: true },
      { label: "Show everything", onSelect: () => controller.clearFilter() },
    ];
    setMenu({ items, x, y });
  };

  const openRowMenu = (index: number, x: number, y: number): void => {
    controller.hover(index);
    setMenu({
      items: [
        { label: "Open", onSelect: () => controller.choose(index, false) },
        { label: "Open in New Tab", onSelect: () => controller.choose(index, true) },
        { label: "Copy Link", onSelect: () => controller.copyLink(index) },
      ],
      x, y,
    });
  };

  const rowNodes: ReactNode[] = [];
  for (let i = 0; i < state.rows.length; i++) rowNodes.push(renderRow(state.rows[i] as RowModel, i, state, controller, platform, openRowMenu));
  const line = scopeLine(state);
  // Sized by CSS on the web so it follows the window with no measuring; a fixed cap on native.
  const listMax = inline ? undefined : ((Platform.OS === "web" ? "min(380px, calc(100vh - 220px))" : 380) as unknown as number);
  return (
    <View testID="cmdk" style={[styles.card, inline ? styles.cardInline : null]} accessibilityLabel={inline ? "Open anything" : "Command palette"} {...webOnly({ role: inline ? "search" : "dialog" })}>
      <View style={styles.head}>
        <TextInput
          ref={input as never}
          testID="cmdk-input"
          accessibilityLabel="Search"
          value={state.raw}
          onChangeText={(t) => controller.setRaw(t)}
          placeholder={placeholder}
          placeholderTextColor="var(--ink-3)"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="go"
          onSubmitEditing={() => { if (Platform.OS !== "web") controller.choose(state.active, false); }}
          style={[styles.input, webOnly({ outlineStyle: "none", outlineWidth: 0 }) as object]}
          {...webOnly({ onKeyDown: onKey, role: "combobox", "aria-expanded": true, "aria-controls": "cmdk-list" })}
        />
        <Pressable
          testID="cmdk-filter"
          accessibilityRole="button"
          accessibilityLabel="Filter by type"
          onPress={(e) => {
            const n = e.nativeEvent as unknown as { pageX?: number; pageY?: number };
            openFilters((n.pageX ?? 0) - 90, (n.pageY ?? 0) + 14);
          }}
          style={({ hovered }: { hovered?: boolean }) => [styles.filterBtn, hovered === true ? { backgroundColor: "var(--hover)" } : null]}
        >
          <Text style={[styles.filterText, state.filter.length ? { color: "var(--accent)" } : null]}>{state.filter.length ? `Filter · ${state.filter.length}` : "Filter"}</Text>
        </Pressable>
      </View>
      {line ? <View testID="cmdk-scope" style={styles.scopes}><Text style={styles.scopesText} numberOfLines={2}>{line}</Text></View> : null}
      <ScrollView nativeID="cmdk-list" testID="cmdk-list" style={[styles.list, listMax ? { maxHeight: listMax } : null]} keyboardShouldPersistTaps="handled" {...webOnly({ role: "listbox" })}>
        {rowNodes}
      </ScrollView>
      {!inline && Platform.OS === "web" ? (
        <View style={styles.foot}>
          <Text style={styles.footText}>{"↑↓ to move"}</Text>
          <Text style={styles.footText}>{"⏎ to open"}</Text>
          <Text style={styles.footText}>{`${formatCombo("Cmd", platform)}⏎ new tab`}</Text>
          <Text style={styles.footText}>esc to close</Text>
        </View>
      ) : null}
      {menu ? <Menu items={menu.items} x={menu.x} y={menu.y} source="context" onClose={() => setMenu(null)} /> : null}
    </View>
  );
}

function renderRow(
  r: RowModel, i: number, state: CmdKState, ctl: CmdKController, platform: KeyPlatform,
  rowMenu: (index: number, x: number, y: number) => void,
): ReactNode {
  if (r.type === "head") return <Text key={r.key} style={styles.gh} role="heading" aria-level={3}>{r.title}</Text>;
  if (r.type === "empty") return <Text key={r.key} testID="cmdk-empty" style={styles.none}>{r.title}</Text>;
  const on = i === state.active;
  let row: ReactElement;
  if (r.type === "hit") {
    // One line, as the prototype draws it: the title, the grey meta after it, the kind right aligned.
    const meta = r.hit.snippet ?? r.hit.path;
    row = <Row id={r.key} title={r.hit.title} {...(meta ? { titleSuffix: meta } : {})} leading={<Tile hit={r.hit} />} trailing={<Text style={styles.kind}>{KIND_LABEL.get(r.hit.kind) ?? ""}</Text>} onPress={() => ctl.choose(i, false)} />;
  } else if (r.type === "action") {
    row = <Row id={r.key} title={r.action.title} leading={<ActionTile action={r.action} />} trailing={r.action.keys ? <Text style={styles.keys}>{formatCombo(r.action.keys, platform)}</Text> : undefined} onPress={() => ctl.choose(i, false)} />;
  } else {
    row = <Row id={r.key} title={r.name} leading={<View style={styles.tile}><View style={[styles.dot, { backgroundColor: r.swatch ?? "var(--accent)" }]} /></View>} trailing={r.current ? <Text style={styles.keys}>Current</Text> : undefined} onPress={() => ctl.choose(i, false)} />;
  }
  const trigger = r.type === "hit" ? menuTrigger((x, y) => rowMenu(i, x, y)) : {};
  return (
    <View key={r.key} style={on ? LIT : null} {...webOnly({ onPointerMove: () => ctl.hover(i), role: "option", "aria-selected": on })} {...(trigger as object)}>
      {row}
    </View>
  );
}

/* ---------- the sheet ---------- */

export interface CmdKProps {
  data: CmdKData;
  initialQuery?: string;
  platform?: KeyPlatform;
  onClose?: () => void;
  onTiming?: CmdKOptions["onTiming"];
}

/** The Cmd-K sheet. Mount it while it is open; Esc, a press outside or a choice calls onClose. */
export function CmdK({ data, initialQuery = "", platform = "mac", onClose, onTiming }: CmdKProps): ReactElement | null {
  const opts = useMemo<CmdKOptions>(() => ({ ...(onClose ? { onClose } : {}), ...(onTiming ? { onTiming } : {}) }), [onClose, onTiming]);
  const ctl = useCmdK(data, opts, initialQuery);
  const state = useCmdKState(ctl);
  if (!state.open) return null;
  return (
    <View testID="cmdk-veil" style={styles.veil}>
      <Pressable accessibilityLabel="Close search" onPress={() => ctl.close()} style={StyleSheet.absoluteFill} />
      <View style={styles.sheet}>
        <CmdKBody controller={ctl} platform={platform} {...(data.spaceName ? { placeholder: `Search ${data.spaceName()}` } : {})} />
      </View>
    </View>
  );
}

/** Screen shell.new-tab: the same search, inline in a new tab. Enter fills the tab (open), Cmd-Enter opens a new tab. */
export function NewTabSearch({ data, platform = "mac" }: { data: CmdKData; platform?: KeyPlatform }): ReactElement {
  const ctl = useCmdK(data);
  return (
    <View testID="newtab-page" style={styles.newtab}>
      <CmdKBody controller={ctl} platform={platform} inline placeholder={"Open anything, or start something…"} />
    </View>
  );
}

const FIXED = (Platform.OS === "web" ? "fixed" : "absolute") as unknown as "absolute";

const styles = StyleSheet.create({
  veil: { position: FIXED, top: 0, left: 0, right: 0, bottom: 0, zIndex: 70, backgroundColor: "rgba(10,10,12,0.22)", alignItems: "center", paddingTop: (Platform.OS === "web" ? "14vh" : 72) as unknown as number },
  sheet: { width: "100%", maxWidth: 632, paddingHorizontal: 16 },
  card: { width: "100%", backgroundColor: "var(--raised)", borderRadius: 14, overflow: "hidden", boxShadow: "var(--sh-pop), 0 30px 60px -20px rgba(0,0,0,0.35)" } as object,
  cardInline: { width: "100%", maxWidth: 640, alignSelf: "center", borderRadius: 14, boxShadow: "none", borderWidth: 1, borderColor: "var(--line)" } as object,
  newtab: { flex: 1, width: "100%", alignItems: "center", paddingTop: 40, paddingHorizontal: 16 },
  head: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "var(--line)" },
  input: { flex: 1, height: 52, paddingHorizontal: 18, fontSize: 16, color: "var(--ink)", backgroundColor: "transparent" },
  filterBtn: { height: 26, paddingHorizontal: 9, marginRight: 12, borderRadius: 6, justifyContent: "center" },
  filterText: { fontSize: 12, color: "var(--ink-3)" },
  scopes: { paddingVertical: 6, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: "var(--line)" },
  scopesText: { fontSize: 11.5, color: "var(--ink-3)" },
  list: { padding: 6, flexGrow: 0 },
  gh: { paddingTop: 8, paddingBottom: 4, paddingHorizontal: 10, fontSize: 11, fontWeight: "600", color: "var(--ink-3)" },
  none: { padding: 14, fontSize: 13, color: "var(--ink-3)" },
  tile: { width: 20, height: 20, marginRight: 10, alignItems: "center", justifyContent: "center" },
  dot: { width: 12, height: 12, borderRadius: 6 },
  kind: { fontSize: 11.5, color: "var(--ink-3)" },
  keys: { fontSize: 11.5, color: "var(--ink-3)" },
  foot: { flexDirection: "row", gap: 14, paddingVertical: 8, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: "var(--line)" },
  footText: { fontSize: 11.5, color: "var(--ink-3)" },
});
