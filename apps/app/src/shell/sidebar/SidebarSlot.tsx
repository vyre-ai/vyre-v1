// The shared place sidebar (spec 3.0, the prototype's left list): one slot beside every place body, with the title, a collapse button, a search field, then the place's own items.
//
// How a place uses it (stable API, documented for the place packets):
//   <SidebarContent title="Chats" searchPlaceholder="Search chats">{(query, slot) => <ChatsSidebarItems query={query} onOpen={slot.openBody} />}</SidebarContent>
// Put it anywhere inside the place. The shell draws it in the slot (a portal, so the place's providers still reach it). `query` is the search field's text;
// call `slot.openBody()` when an item is chosen so the phone leaves the list for the body. A place without <SidebarContent> has no sidebar and no slot.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MenuIcon } from "../../../../../ui/src/Menu/index.tsx";
import { iconMarkup } from "../rail/icons.tsx";
import { collapseKey, phoneView, readCollapsed, writeCollapsed } from "./model.ts";
import type { PhoneView, SidebarStorage } from "./model.ts";
import { portalInto } from "./portal.ts";
import { ResizeHandle, useResizable } from "../../../../../ui/src/SidePane/resize.tsx";
import { SHEET, sq } from "../../../../../ui/src/SidePane/host.tsx";

export interface SidebarEntry { title: string; searchPlaceholder: string; noSearch?: boolean }

export interface SidebarSlotApi {
  /** The search field's text. */
  query: string;
  collapsed: boolean;
  setCollapsed(v: boolean): void;
  /** True once a place has put content in the slot. */
  hasSidebar: boolean;
  compact: boolean;
  /** On the phone: leave the list for the body. Call it when an item is chosen. */
  openBody(): void;
  /** On the phone: from the body back to the list. */
  back(): void;
  view: PhoneView;
  title: string;
  /** The header's spot for a place's own button(s), left of the collapse button (portal into it with portalInto). Absent where there is no slot. */
  actionsOutlet?: unknown;
}

const Ctx = createContext<SidebarSlotApi | null>(null);
const Reg = createContext<{ register(e: SidebarEntry | null): void; outlet: unknown } | null>(null);

export const SIDEBAR_DEFAULT = 244;

export interface SidebarSlotProviderProps {
  deviceId: string;
  personId: string;
  spaceId: string;
  place: string;
  /** The place epoch: a switch resets the phone to the list. */
  epoch: number;
  compact: boolean;
  storage?: SidebarStorage | null;
  /** For tests and shots: start with an entry registered. */
  initialEntry?: SidebarEntry;
  /** For tests and shots: start on the phone's body view (an item already open). */
  initialBodyOpen?: boolean;
  children?: ReactNode;
}

export function SidebarSlotProvider(p: SidebarSlotProviderProps): ReactElement {
  const key = collapseKey(p.deviceId, p.personId);
  const read = (): boolean => { try { return readCollapsed((p.storage ?? deviceStorage())?.getItem(key) ?? null); } catch { return false; } };
  const [collapsed, setCollapsedState] = useState<boolean>(read);
  const [entry, setEntry] = useState<SidebarEntry | null>(p.initialEntry ?? null);
  const [query, setQuery] = useState("");
  const [bodyOpen, setBodyOpen] = useState(p.initialBodyOpen === true);
  const [outlet, setOutlet] = useState<unknown>(null);
  const [actionsOutlet, setActionsOutlet] = useState<unknown>(null);
  useEffect(() => { setCollapsedState(read()); setQuery(""); setBodyOpen(false); }, [key, p.epoch]);
  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    try { (p.storage ?? deviceStorage())?.setItem(key, writeCollapsed(v)); } catch { /* a full or blocked store keeps the choice for this session only */ }
  }, [key, p.storage]);
  const hasSidebar = entry !== null;
  const api = useMemo<SidebarSlotApi>(() => ({
    query, collapsed, setCollapsed, hasSidebar, compact: p.compact, openBody: () => setBodyOpen(true), back: () => setBodyOpen(false),
    view: phoneView(hasSidebar, p.compact, bodyOpen), title: entry?.title ?? "", actionsOutlet,
  }), [query, collapsed, setCollapsed, hasSidebar, p.compact, bodyOpen, entry?.title, actionsOutlet]);
  const reg = useMemo(() => ({ register: setEntry, outlet }), [outlet]);
  return (
    <Ctx.Provider value={api}>
      <Reg.Provider value={reg}>
        <OutletContext.Provider value={{ entry, query, setQuery, setOutlet, setActionsOutlet }}>{p.children}</OutletContext.Provider>
      </Reg.Provider>
    </Ctx.Provider>
  );
}

const OutletContext = createContext<{ entry: SidebarEntry | null; query: string; setQuery(q: string): void; setOutlet(n: unknown): void; setActionsOutlet(n: unknown): void } | null>(null);

export function useSidebarSlot(): SidebarSlotApi {
  const v = useContext(Ctx);
  if (v === null) throw new Error("useSidebarSlot needs a SidebarSlotProvider above it");
  return v;
}

/** The place's side: put it inside the place. The shell draws it in the slot. */
export function SidebarContent(props: { title: string; searchPlaceholder?: string; /** The place has no search of its own: ⌘K is the one search (Chats). */ noSearch?: boolean; children: (query: string, slot: SidebarSlotApi) => ReactNode }): ReactElement | null {
  const reg = useContext(Reg);
  const slot = useContext(Ctx);
  const search = props.searchPlaceholder ?? "Search";
  useEffect(() => {
    reg?.register({ title: props.title, searchPlaceholder: search, ...(props.noSearch === true ? { noSearch: true } : {}) });
    return () => reg?.register(null);
  }, [reg?.register, props.title, search, props.noSearch]);
  if (reg === null || slot === null) return null;
  return <>{portalInto(reg.outlet, props.children(slot.query, slot))}</>;
}

/** What the shell draws beside the body: the chrome, then an empty outlet the place's content portals into. */
export function SidebarSlot(): ReactElement | null {
  const slot = useSidebarSlot();
  const o = useContext(OutletContext);
  const resize = useResizable({ paneKey: "place-sidebar", defaultWidth: SIDEBAR_DEFAULT, grow: "right", min: 200, maxFraction: 0.5, maxWidth: 380 });
  if (o === null || o.entry === null) return null;
  const full = slot.compact;
  // On the phone an opened body replaces the list. The slot stays mounted (display none) because the place's sidebar content is portalled into its outlet.
  const away = slot.compact && slot.view === "body";
  const inner = (
    <>
      <View style={s.head}>
        <Text style={s.title} accessibilityRole="header" numberOfLines={1}>{o.entry.title}</Text>
        <View style={s.actions} testID="sidebar-actions" ref={(n) => { if (n !== null) o.setActionsOutlet(n); }} />
        {full ? null : (
          <Pressable accessibilityRole="button" accessibilityLabel="Hide the sidebar" testID="sidebar-collapse" onPress={() => slot.setCollapsed(true)}
            {...webOnly({ title: "Hide the sidebar (⌘⇧\\)" })}
            style={({ hovered }: { hovered?: boolean }) => [s.icon, hovered === true && s.hover]}>
            <MenuIcon icon={PANEL} color="var(--ink-3)" />
          </Pressable>
        )}
      </View>
      {o.entry.noSearch === true ? null : (
        <View style={s.search} testID="sidebar-search">
          <MenuIcon icon={iconMarkup("search")} color="var(--ink-3)" />
          <TextInput accessibilityLabel={o.entry.searchPlaceholder} testID="sidebar-search-input" value={o.query} onChangeText={o.setQuery} placeholder={o.entry.searchPlaceholder} placeholderTextColor="var(--ink-4)" style={s.input} />
        </View>
      )}
      <View style={s.outlet} testID="sidebar-outlet" ref={(n) => { if (n !== null) o.setOutlet(n); }} />
    </>
  );
  if (full) return <View style={[s.slot, s.full, away && s.away]} testID="place-sidebar" accessibilityLabel={`${o.entry.title} sidebar`} aria-hidden={away}>{inner}</View>;
  return (
    <View style={[s.column, { width: resize.width, minWidth: 0 }]} testID="place-sidebar" accessibilityLabel={`${o.entry.title} sidebar`} aria-hidden={away}>
      <View style={SHEET} {...sq("sheet")}>{inner}</View>
      <ResizeHandle r={resize} at="right" label="Resize the sidebar" testID="sidebar-resize" />
    </View>
  );
}

/** The Hide button on a sheet that draws its own head (Inbox, Vault, Settings). */
export function SidebarHide(): ReactElement | null {
  const slot = useSidebarSlot();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Hide the sidebar" testID="sidebar-hide" onPress={() => slot.setCollapsed(true)} {...webOnly({ title: "Hide the sidebar (⌘⇧\\)" })} style={({ hovered }: { hovered?: boolean }) => [s.hideFloat, hovered === true && s.hover]}>
      <MenuIcon icon={PANEL} color="var(--ink-3)" />
    </Pressable>
  );
}

/** The button that brings a hidden sidebar back: the shell draws it at the left of the tab strip. */
export function SidebarExpand(): ReactElement | null {
  const slot = useSidebarSlot();
  if (!slot.collapsed || slot.compact) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Show the sidebar" testID="sidebar-expand" onPress={() => slot.setCollapsed(false)} {...webOnly({ title: "Show the sidebar (⌘⇧\\)" })} style={({ hovered }: { hovered?: boolean }) => [s.expand, hovered === true && s.hover]}>
      <MenuIcon icon={PANEL} color="var(--ink-3)" />
    </Pressable>
  );
}

const webOnly = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

function deviceStorage(): SidebarStorage | null {
  if (Platform.OS !== "web") return null;
  try { return (globalThis as { localStorage?: SidebarStorage }).localStorage ?? null; } catch { return null; }
}

/** True when a key press should take the phone from the body back to the list: Escape that nothing else (a menu, a dialog, a field's own handler) has taken. */
export function escapeGoesBack(e: { key: string; defaultPrevented: boolean }, overlayOpen: boolean): boolean {
  return e.key === "Escape" && !e.defaultPrevented && !overlayOpen;
}

/** On the phone, in the body: the way back to the list. A button with an arrow and the place's name; Escape does the same. */
export function SidebarBack(): ReactElement | null {
  const slot = useSidebarSlot();
  const on = slot.hasSidebar && slot.compact && slot.view === "body";
  const back = slot.back;
  useEffect(() => {
    if (!on || Platform.OS !== "web") return undefined;
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void; querySelector(q: string): unknown } }).document;
    if (doc === undefined) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (escapeGoesBack(e, doc.querySelector('[role="menu"],[role="dialog"],[aria-modal="true"]') !== null)) back();
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [on, back]);
  if (!on) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" testID="sidebar-back" onPress={back} style={({ hovered }: { hovered?: boolean }) => [s.back, hovered === true && s.hover]}>
      <MenuIcon icon={CHEVRON_LEFT} color="var(--accent)" />
      <Text style={s.backText}>{slot.title}</Text>
    </Pressable>
  );
}

const CHEVRON_LEFT = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.500L5.500 8l4.500 4.500"/></svg>';

const PANEL = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.500" y="3" width="11" height="10" rx="1.500"/><path d="M6 3v10"/></svg>';

const s = StyleSheet.create({
  slot: { backgroundColor: "var(--side)" as string, minHeight: 0 },
  column: { position: "relative", minHeight: 0, flexShrink: 0 },
  full: { flex: 1 },
  away: { display: "none" },
  head: { height: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4, paddingLeft: 16, paddingRight: 10, paddingTop: 4 },
  title: { color: "var(--ink)" as string, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  actions: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  icon: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  hover: { backgroundColor: "var(--hover)" as string },
  search: { flexDirection: "row", alignItems: "center", gap: 8, height: 32, marginHorizontal: 10, marginBottom: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--field-line)", backgroundColor: "var(--field)" as string },
  input: { flex: 1, minWidth: 0, color: "var(--ink)" as string, fontSize: 13, padding: 0 },
  outlet: { flex: 1, minHeight: 0 },
  expand: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center", marginLeft: 8, marginTop: 6, flexShrink: 0 },
  hideFloat: { position: "absolute", right: 8, top: 12, width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", zIndex: 3 },
  back: { height: 40, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  backText: { color: "var(--accent)" as string, fontSize: 14, fontWeight: "500" },
});
