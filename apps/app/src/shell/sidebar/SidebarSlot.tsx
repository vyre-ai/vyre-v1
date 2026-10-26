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

export interface SidebarEntry { title: string; searchPlaceholder: string }

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
  const key = collapseKey(p.deviceId, p.personId, p.spaceId, p.place);
  const read = (): boolean => { try { return readCollapsed(p.storage?.getItem(key) ?? null); } catch { return false; } };
  const [collapsed, setCollapsedState] = useState<boolean>(read);
  const [entry, setEntry] = useState<SidebarEntry | null>(p.initialEntry ?? null);
  const [query, setQuery] = useState("");
  const [bodyOpen, setBodyOpen] = useState(p.initialBodyOpen === true);
  const [outlet, setOutlet] = useState<unknown>(null);
  const [actionsOutlet, setActionsOutlet] = useState<unknown>(null);
  useEffect(() => { setCollapsedState(read()); setQuery(""); setBodyOpen(false); }, [key, p.epoch]);
  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    try { p.storage?.setItem(key, writeCollapsed(v)); } catch { /* a full or blocked store keeps the choice for this session only */ }
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
export function SidebarContent(props: { title: string; searchPlaceholder?: string; children: (query: string, slot: SidebarSlotApi) => ReactNode }): ReactElement | null {
  const reg = useContext(Reg);
  const slot = useContext(Ctx);
  const search = props.searchPlaceholder ?? "Search";
  useEffect(() => {
    reg?.register({ title: props.title, searchPlaceholder: search });
    return () => reg?.register(null);
  }, [reg?.register, props.title, search]);
  if (reg === null || slot === null) return null;
  return <>{portalInto(reg.outlet, props.children(slot.query, slot))}</>;
}

/** What the shell draws beside the body: the chrome, then an empty outlet the place's content portals into. */
export function SidebarSlot(): ReactElement | null {
  const slot = useSidebarSlot();
  const o = useContext(OutletContext);
  if (o === null || o.entry === null) return null;
  if (slot.collapsed && !slot.compact) return null;
  const full = slot.compact;
  // On the phone an opened body replaces the list. The slot stays mounted (display none) because the place's sidebar content is portalled into its outlet.
  const away = slot.compact && slot.view === "body";
  return (
    <View style={[s.slot, full ? s.full : s.side, away && s.away]} testID="place-sidebar" accessibilityLabel={`${o.entry.title} sidebar`} aria-hidden={away}>
      <View style={s.head}>
        <Text style={s.title} accessibilityRole="header" numberOfLines={1}>{o.entry.title}</Text>
        <View style={s.actions} testID="sidebar-actions" ref={(n) => { if (n !== null) o.setActionsOutlet(n); }} />
        {full ? null : (
          <Pressable accessibilityRole="button" accessibilityLabel="Collapse sidebar" testID="sidebar-collapse" onPress={() => slot.setCollapsed(true)}
            style={({ hovered }: { hovered?: boolean }) => [s.icon, hovered === true && s.hover]}>
            <MenuIcon icon={PANEL} color="var(--ink-3)" />
          </Pressable>
        )}
      </View>
      <View style={s.search} testID="sidebar-search">
        <MenuIcon icon={iconMarkup("search")} color="var(--ink-3)" />
        <TextInput accessibilityLabel={o.entry.searchPlaceholder} testID="sidebar-search-input" value={o.query} onChangeText={o.setQuery} placeholder={o.entry.searchPlaceholder} placeholderTextColor="var(--ink-4)" style={s.input} />
      </View>
      <View style={s.outlet} testID="sidebar-outlet" ref={(n) => { if (n !== null) o.setOutlet(n); }} />
    </View>
  );
}

/** The button that brings a collapsed sidebar back; the shell draws it at the body's left edge. */
export function SidebarExpand(): ReactElement | null {
  const slot = useSidebarSlot();
  if (!slot.hasSidebar || !slot.collapsed || slot.compact) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Show sidebar" testID="sidebar-expand" onPress={() => slot.setCollapsed(false)} style={({ hovered }: { hovered?: boolean }) => [s.expand, hovered === true && s.hover]}>
      <MenuIcon icon={PANEL} color="var(--ink-3)" />
    </Pressable>
  );
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
  side: { width: 248, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  full: { flex: 1 },
  away: { display: "none" },
  head: { height: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
  title: { color: "var(--ink)" as string, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  actions: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  icon: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  hover: { backgroundColor: "var(--hover)" as string },
  search: { flexDirection: "row", alignItems: "center", gap: 8, height: 32, marginHorizontal: 10, marginBottom: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  input: { flex: 1, minWidth: 0, color: "var(--ink)" as string, fontSize: 13, padding: 0 },
  outlet: { flex: 1, minHeight: 0 },
  expand: { position: "absolute", left: 8, top: 8, width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", zIndex: 3 },
  back: { height: 40, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  backText: { color: "var(--accent)" as string, fontSize: 14, fontWeight: "500" },
});
