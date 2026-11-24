// The shared place sidebar (spec 3.0, the prototype's left list): one slot beside every place body, with the title, a collapse button, a search field, then the place's own items.
//
// How a place uses it (stable API, documented for the place packets):
//   <SidebarContent title="Chats" searchPlaceholder="Search chats">{(query, slot) => <ChatsSidebarItems query={query} onOpen={slot.openBody} />}</SidebarContent>
// Put it anywhere inside the place. The shell draws it in the slot (a portal, so the place's providers still reach it). `query` is the search field's text;
// call `slot.openBody()` when an item is chosen so the phone leaves the list for the body. A place without <SidebarContent> has no sidebar and no slot.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MenuIcon } from "../../../../../ui/src/Menu/index.tsx";
import { iconMarkup } from "../rail/icons.tsx";
import { collapseKey, hashOpensBody, linkNamesBody, phoneView, readCollapsed, writeCollapsed } from "./model.ts";
import type { PhoneView, SidebarStorage } from "./model.ts";
import { portalInto } from "./portal.ts";
import { ResizeHandle, useResizable } from "../../../../../ui/src/SidePane/resize.tsx";
import { SHEET, sq, usePanelPresence, useShellLayout } from "../../../../../ui/src/SidePane/host.tsx";
import type { ShellLayoutApi } from "../../../../../ui/src/SidePane/host.tsx";
import { SIDEBAR } from "../../../../../ui/src/SidePane/layout.ts";
import { RADIUS } from "../../../../../ui/src/tokens/radius.ts";
import { NavRows } from "../../../../../ui/src/theme/pending.ts";

export interface SidebarEntry {
  title: string;
  searchPlaceholder: string;
  noSearch?: boolean;
  /** The place that put this here has gone and the next one has not arrived yet: the column keeps its room, with nothing in it (see SIDEBAR_HOLD_MS). */
  held?: true;
}

/**
 * How long the column keeps its room after a place leaves. Two places that both have a list (a Chats tab, then a Console tab) must never show a frame without the column
 * between them: the tab strip and the body would slide across and back (owner, 15 Nov 2026; measured in team/v1/TABS-2026-11-15.md). A place with no list lets it go after this.
 */
export const SIDEBAR_HOLD_MS = 260;
/** How long the column keeps the room it was given at the first frame for a place that has not drawn its list yet (its code and the session are still arriving). */
export const INITIAL_HOLD_MS = 2500;

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

export const SIDEBAR_DEFAULT = SIDEBAR.def;
const SIDEBAR_META = { def: SIDEBAR.def, min: SIDEBAR.min, max: SIDEBAR.max };

export interface SidebarSlotProviderProps {
  deviceId: string;
  personId: string;
  spaceId: string;
  place: string;
  /** The place epoch: a switch resets the phone to the list. */
  epoch: number;
  /** The item the place has open (its address). A link that opens an item while the phone shows the list takes the phone to the body, as pressing a row does. */
  hash?: string;
  /** Addresses that came from outside so far (HubState.links). */
  links?: number;
  /** Addresses the place wrote itself so far (HubState.reports). */
  reports?: number;
  /** The hub's count of own reports as of now (not as last drawn): Back remembers it, so a report issued before Back that is drawn after it is known for what it is. */
  liveReports?: () => number;
  compact: boolean;
  storage?: SidebarStorage | null;
  /** For tests and shots: start with an entry registered. */
  initialEntry?: SidebarEntry;
  /** The place that opens first has a list: the column has its room from the first frame, empty, until that place fills it (or lets it go after INITIAL_HOLD_MS when it never does). Read once, at mount. */
  initialHold?: boolean;
  /** For tests and shots: start on the phone's body view (an item already open). */
  initialBodyOpen?: boolean;
  children?: ReactNode;
}

// How many presses and keys the person has made so far: Back remembers it, so a report issued with no input since is still the press Back dismissed, and one after another input is a new open.
let inputs = 0;
let listening = false;
export const inputsSoFar = (): number => {
  if (!listening) {
    listening = true;
    const doc = (globalThis as { document?: { addEventListener?: (t: string, f: () => void, c: boolean) => void } })
      .document;
    for (const t of ["pointerdown", "keydown"]) doc?.addEventListener?.(t, () => void (inputs += 1), true);
  }
  return inputs;
};
/** For tests: the person made one more press or key. */
export const noteInputForTests = (): void => void (inputs += 1);

export function SidebarSlotProvider(p: SidebarSlotProviderProps): ReactElement {
  const key = collapseKey(p.deviceId, p.personId);
  const read = (): boolean => {
    try {
      return readCollapsed((p.storage ?? deviceStorage())?.getItem(key) ?? null);
    } catch {
      return false;
    }
  };
  const [collapsed, setCollapsedState] = useState<boolean>(read);
  const [entry, setEntry] = useState<SidebarEntry | null>(
    p.initialEntry ??
      (p.initialHold === true ? { title: "", searchPlaceholder: "", noSearch: true, held: true } : null),
  );
  const [query, setQuery] = useState("");
  const [bodyOpen, setBodyOpen] = useState(p.initialBodyOpen === true || linkNamesBody(p.compact, p.hash));
  const [outlet, setOutlet] = useState<unknown>(null);
  const [actionsOutlet, setActionsOutlet] = useState<unknown>(null);
  useEffect(() => {
    setCollapsedState(read());
    setQuery("");
    setBodyOpen(false);
  }, [key, p.epoch]);
  // a link to a goal, a chat or any item (an address, a notification, Cmd-K) shows that item at once, also where only one panel fits (K9, 13 Nov 2026)
  // A place switch resets to the list even when the new place carries an address: the switch is the epoch, so a change of epoch is not a link to an item.
  const epochSeen = useRef(p.epoch);
  const hashSeen = useRef(p.hash);
  const linksSeen = useRef(p.links ?? 0);
  const reportsSeen = useRef(p.reports ?? 0);
  // the own-report count when Back last closed the body: a report up to that count was issued before Back, so its address coming into the page now is not a new open (-1: Back has not closed anything since the last link)
  const backedAt = useRef(-1);
  // a row was pressed and the address that press writes has not been drawn yet; and whether Back came while it was still to come (the place reports after its own render, so Back can beat the report
  // being issued at all: the count Back remembered does not include it, yet it is still the press Back dismissed)
  const pressPending = useRef(false);
  const backedWhilePending = useRef(false);
  const backedInputs = useRef(0);
  const liveReports = useRef(p.liveReports);
  liveReports.current = p.liveReports;
  useEffect(() => {
    const hashChanged = p.hash !== hashSeen.current;
    const linked = (p.links ?? 0) !== linksSeen.current;
    const reported = (p.reports ?? 0) !== reportsSeen.current;
    hashSeen.current = p.hash;
    linksSeen.current = p.links ?? 0;
    reportsSeen.current = p.reports ?? 0;
    if (epochSeen.current !== p.epoch) {
      epochSeen.current = p.epoch;
      return;
    }
    // only an address reported before Back was pressed is skipped (it was the press Back dismissed): an item opened after that (New chat, a created record, a search result, a press that wrote
    // nothing and a later open of another item) is a later report, past the count Back remembered, and opens the body
    if (linked) {
      backedAt.current = -1;
      pressPending.current = false;
      backedWhilePending.current = false;
    }
    const issuedBeforeBack = backedAt.current >= 0 && (p.reports ?? 0) <= backedAt.current;
    // the press's late report is issued with no input between Back and it: anything the person does next (a press, a key) is a new act, whose report is a new open
    const echo =
      reported &&
      !linked &&
      (issuedBeforeBack || (backedWhilePending.current && inputsSoFar() === backedInputs.current));
    if (reported) {
      pressPending.current = false;
      backedWhilePending.current = false;
    }
    if (hashOpensBody({ compact: p.compact, hash: p.hash, hashChanged, ownReport: echo })) setBodyOpen(true);
  }, [p.compact, p.hash, p.epoch, p.links, p.reports]);
  const setCollapsed = useCallback(
    (v: boolean) => {
      setCollapsedState(v);
      try {
        (p.storage ?? deviceStorage())?.setItem(key, writeCollapsed(v));
      } catch {
        /* a full or blocked store keeps the choice for this session only */
      }
    },
    [key, p.storage],
  );
  const hasSidebar = entry !== null;
  const api = useMemo<SidebarSlotApi>(
    () => ({
      query,
      collapsed,
      setCollapsed,
      hasSidebar,
      compact: p.compact,
      openBody: () => {
        pressPending.current = true;
        backedWhilePending.current = false;
        setBodyOpen(true);
      },
      back: () => {
        backedAt.current = liveReports.current?.() ?? -1;
        backedWhilePending.current = pressPending.current;
        backedInputs.current = inputsSoFar();
        setBodyOpen(false);
      },
      view: phoneView(hasSidebar, p.compact, bodyOpen),
      title: entry?.title ?? "",
      actionsOutlet,
    }),
    [query, collapsed, setCollapsed, hasSidebar, p.compact, bodyOpen, entry?.title, actionsOutlet],
  );
  const letGo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const register = useCallback((e: SidebarEntry | null): void => {
    if (letGo.current !== null) {
      clearTimeout(letGo.current);
      letGo.current = null;
    }
    if (e !== null) {
      setEntry(e);
      return;
    }
    // the place left: keep the column's room, empty, until the next place fills it or the hold runs out
    setEntry((cur) =>
      cur === null ? null : { title: "", searchPlaceholder: cur.searchPlaceholder, noSearch: true, held: true },
    );
    letGo.current = setTimeout(() => {
      letGo.current = null;
      setEntry((cur) => (cur !== null && cur.held === true ? null : cur));
    }, SIDEBAR_HOLD_MS);
  }, []);
  useEffect(() => {
    // the room given at the first frame is let go when no place filled it
    if (p.initialHold === true && p.initialEntry === undefined)
      letGo.current = setTimeout(() => {
        letGo.current = null;
        setEntry((cur) => (cur !== null && cur.held === true ? null : cur));
      }, INITIAL_HOLD_MS);
    return () => {
      if (letGo.current !== null) clearTimeout(letGo.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- read once, at mount
  const reg = useMemo(() => ({ register, outlet }), [register, outlet]);
  return (
    <Ctx.Provider value={api}>
      <Reg.Provider value={reg}>
        <OutletContext.Provider value={{ entry, query, setQuery, setOutlet, setActionsOutlet }}>
          {p.children}
        </OutletContext.Provider>
      </Reg.Provider>
    </Ctx.Provider>
  );
}

const OutletContext = createContext<{
  entry: SidebarEntry | null;
  query: string;
  setQuery(q: string): void;
  setOutlet(n: unknown): void;
  setActionsOutlet(n: unknown): void;
} | null>(null);

/** True where a shell sidebar column exists to draw in (inside the app's shell). A place that can also stand alone draws its own list when this is false. */
export function useInSidebarSlot(): boolean {
  const reg = useContext(Reg);
  const slot = useContext(Ctx);
  return reg !== null && slot !== null;
}

const InColumn = createContext(false);

/** True inside a place's content that the shell draws in its sidebar column: the column's head already carries the title, the buttons' spot and Hide. */
export function useInSidebarColumn(): boolean {
  return useContext(InColumn);
}

/** The slot's api where there is one (inside the shell), else null: a place that can also stand alone uses it to put its buttons in the slot's head. */
export function useOptionalSidebarSlot(): SidebarSlotApi | null {
  return useContext(Ctx);
}

export function useSidebarSlot(): SidebarSlotApi {
  const v = useContext(Ctx);
  if (v === null) throw new Error("useSidebarSlot needs a SidebarSlotProvider above it");
  return v;
}

/** The place's side: put it inside the place. The shell draws it in the slot. */
export function SidebarContent(props: {
  title: string;
  searchPlaceholder?: string;
  /** The place has no search of its own: ⌘K is the one search (Chats). */ noSearch?: boolean;
  children: (query: string, slot: SidebarSlotApi) => ReactNode;
}): ReactElement | null {
  const reg = useContext(Reg);
  const slot = useContext(Ctx);
  const search = props.searchPlaceholder ?? "Search";
  // before paint, so a place that replaces another in the same commit fills the column in that commit: no frame shows it empty
  useLayoutEffect(() => {
    reg?.register({
      title: props.title,
      searchPlaceholder: search,
      ...(props.noSearch === true ? { noSearch: true } : {}),
    });
    return () => reg?.register(null);
  }, [reg?.register, props.title, search, props.noSearch]);
  if (reg === null || slot === null) return null;
  return (
    <>
      {/* a place's list is how a person gets around it: a pressed row is lit at once and its page is made after that frame (ui/theme/pending.ts) */}
      {portalInto(
        reg.outlet,
        <InColumn.Provider value={true}>
          <NavRows>{props.children(slot.query, slot)}</NavRows>
        </InColumn.Provider>,
      )}
    </>
  );
}

/**
 * One kept place's part of the sidebar column (r41, spaces/kept-places.tsx): what the place puts in the column is drawn into a box of its own, and the box is in the column only while the
 * place is shown. A hidden place therefore leaves nothing in the column, and its list comes back as it was. Outside a slot, or off the web, it changes nothing.
 */
export function SidebarFrame({ active, children }: { active: boolean; children?: ReactNode }): ReactElement {
  const reg = useContext(Reg);
  const [box] = useState(() => {
    const doc = (
      globalThis as { document?: { createElement?(t: string): { style: { display: string }; remove(): void } } }
    ).document;
    if (Platform.OS !== "web" || !doc || typeof doc.createElement !== "function") return null;
    const el = doc.createElement("div");
    el.style.display = "contents";
    return el;
  });
  const outlet = reg?.outlet ?? null;
  useLayoutEffect(() => {
    const into = outlet as { appendChild?(n: unknown): unknown } | null;
    if (!box || !active || !into || typeof into.appendChild !== "function") return undefined;
    into.appendChild(box);
    return () => box.remove();
  }, [box, outlet, active]);
  const value = useMemo(
    () => (reg === null || box === null ? reg : { register: reg.register, outlet: outlet === null ? null : box }),
    [reg, box, outlet],
  );
  return <Reg.Provider value={value}>{children}</Reg.Provider>;
}

/** What the shell draws beside the body: the chrome, then an empty outlet the place's content portals into. */
export function SidebarSlot(): ReactElement | null {
  const slot = useSidebarSlot();
  const o = useContext(OutletContext);
  const shell = useShellLayout();
  usePanelPresence("sidebar", "place-sidebar", o !== null && o.entry !== null, undefined, SIDEBAR_META);
  const resize = useResizable({
    kind: "sidebar",
    paneKey: "place-sidebar",
    defaultWidth: SIDEBAR_DEFAULT,
    grow: "right",
    min: SIDEBAR.min,
    maxFraction: 0.5,
    maxWidth: SIDEBAR.max,
  });
  if (o === null || o.entry === null) return null;
  const full = slot.compact;
  // On the phone an opened body replaces the list. The slot stays mounted (display none) because the place's sidebar content is portalled into its outlet.
  const away = slot.compact && slot.view === "body";
  const inner = (
    <>
      <View style={s.head}>
        <Text style={s.title} accessibilityRole="header" numberOfLines={1}>
          {o.entry.title}
        </Text>
        <View
          style={s.actions}
          testID="sidebar-actions"
          ref={(n) => {
            if (n !== null) o.setActionsOutlet(n);
          }}
        />
        {full ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hide the sidebar"
            testID="sidebar-collapse"
            onPress={() => hideSidebar(slot, shell)}
            {...webOnly({ title: "Hide the sidebar (⌘\\)" })}
            style={({ hovered }: { hovered?: boolean }) => [s.icon, hovered === true && s.hover]}
          >
            <MenuIcon icon={PANEL} color="var(--ink-3)" />
          </Pressable>
        )}
      </View>
      {o.entry.noSearch === true ? null : (
        <View style={s.search} testID="sidebar-search">
          <MenuIcon icon={iconMarkup("search")} color="var(--ink-3)" />
          <TextInput
            accessibilityLabel={o.entry.searchPlaceholder}
            testID="sidebar-search-input"
            value={o.query}
            onChangeText={o.setQuery}
            placeholder={o.entry.searchPlaceholder}
            placeholderTextColor="var(--ink-4)"
            style={s.input}
          />
        </View>
      )}
      <View
        style={s.outlet}
        testID="sidebar-outlet"
        ref={(n) => {
          if (n !== null) o.setOutlet(n);
        }}
      />
    </>
  );
  if (full)
    return (
      <View
        style={[s.slot, s.full, away && s.away]}
        testID="place-sidebar"
        accessibilityLabel={`${o.entry.title} sidebar`}
        aria-hidden={away}
      >
        {inner}
      </View>
    );
  return (
    <View
      style={[s.column, { width: resize.width, minWidth: 0 }]}
      testID="place-sidebar"
      accessibilityLabel={`${o.entry.title} sidebar`}
      aria-hidden={away}
    >
      <View style={SHEET} {...sq("sheet")}>
        {inner}
      </View>
      <ResizeHandle r={resize} at="right" label="Resize the sidebar" testID="sidebar-resize" />
    </View>
  );
}

/** The Hide button on a column a place still draws for itself (a ResizableColumn standing in the shell's sidebar spot); the places that use the shell's own column have its head. */
export function SidebarHide(): ReactElement | null {
  const slot = useSidebarSlot();
  const shell = useShellLayout();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Hide the sidebar"
      testID="sidebar-hide"
      onPress={() => hideSidebar(slot, shell)}
      {...webOnly({ title: "Hide the sidebar (⌘\\)" })}
      style={({ hovered }: { hovered?: boolean }) => [s.hideFloat, hovered === true && s.hover]}
    >
      <MenuIcon icon={PANEL} color="var(--ink-3)" />
    </Pressable>
  );
}

/** The button that brings a hidden sidebar back: the shell draws it at the left of the tab strip. */
export function SidebarExpand(): ReactElement | null {
  const slot = useSidebarSlot();
  const shell = useShellLayout();
  // the sidebar is away: hidden by choice, folded behind an open pane, or an overlay band that has not been asked for yet
  const away = shell !== null ? shell.layout.sidebar.mode === "hidden" : slot.collapsed;
  if (!away || slot.compact || !slot.hasSidebar) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Show the sidebar"
      testID="sidebar-expand"
      onPress={() => showSidebar(slot, shell)}
      {...webOnly({ title: "Show the sidebar (⌘\\)" })}
      style={({ hovered }: { hovered?: boolean }) => [s.expand, hovered === true && s.hover]}
    >
      <MenuIcon icon={PANEL} color="var(--ink-3)" />
    </Pressable>
  );
}

/** Put the sidebar away: an overlay goes back, a docked one is collapsed (the choice is kept). */
export function hideSidebar(slot: SidebarSlotApi, shell: ShellLayoutApi | null): void {
  if (shell !== null && shell.layout.sidebar.mode === "overlay") shell.peekSidebar(false);
  else slot.setCollapsed(true);
}

/** Bring it back: where it can dock the choice is un-collapsed; where it cannot (a folded sidebar, the sheet band) it opens as an overlay over main. */
export function showSidebar(slot: SidebarSlotApi, shell: ShellLayoutApi | null): void {
  const l = shell?.layout;
  if (
    shell !== null &&
    l !== undefined &&
    (l.folded || l.band === "sheet" || (l.band === "mid" && l.pane.mode !== "none"))
  ) {
    shell.peekSidebar(true);
    return;
  }
  slot.setCollapsed(false);
}

/** Cmd-\\ and the toggle: one place decides what "toggle" means in every band. */
export function toggleSidebar(slot: SidebarSlotApi, shell: ShellLayoutApi | null): void {
  const mode = shell?.layout.sidebar.mode;
  if (mode === "docked" || mode === "overlay" || (shell === null && !slot.collapsed)) hideSidebar(slot, shell);
  else showSidebar(slot, shell);
}

const webOnly = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

function deviceStorage(): SidebarStorage | null {
  if (Platform.OS !== "web") return null;
  try {
    return (globalThis as { localStorage?: SidebarStorage }).localStorage ?? null;
  } catch {
    return null;
  }
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
    const doc = (
      globalThis as {
        document?: {
          addEventListener(t: string, f: (e: KeyboardEvent) => void): void;
          removeEventListener(t: string, f: (e: KeyboardEvent) => void): void;
          querySelector(q: string): unknown;
        };
      }
    ).document;
    if (doc === undefined) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (escapeGoesBack(e, doc.querySelector('[role="menu"],[role="dialog"],[aria-modal="true"]') !== null)) back();
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [on, back]);
  if (!on) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      testID="sidebar-back"
      onPress={back}
      style={({ hovered }: { hovered?: boolean }) => [s.back, hovered === true && s.hover]}
    >
      <MenuIcon icon={CHEVRON_LEFT} color="var(--accent)" />
      <Text style={s.backText}>{slot.title}</Text>
    </Pressable>
  );
}

const CHEVRON_LEFT =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.500L5.500 8l4.500 4.500"/></svg>';

const PANEL =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.500" y="3" width="11" height="10" rx="1.500"/><path d="M6 3v10"/></svg>';

const s = StyleSheet.create({
  slot: { backgroundColor: "var(--side)" as string, minHeight: 0 },
  column: { position: "relative", minHeight: 0, flexShrink: 0 },
  full: { flex: 1 },
  away: { display: "none" },
  head: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    paddingLeft: 16,
    paddingRight: 10,
    paddingTop: 4,
  },
  title: { color: "var(--ink)" as string, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  actions: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  icon: { width: 28, height: 28, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  hover: { backgroundColor: "var(--hover)" as string },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 32,
    marginHorizontal: 10,
    marginBottom: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "var(--field-line)",
    backgroundColor: "var(--field)" as string,
  },
  input: { flex: 1, minWidth: 0, color: "var(--ink)" as string, fontSize: 13, padding: 0 },
  outlet: { flex: 1, minHeight: 0 },
  expand: {
    width: 28,
    height: 28,
    borderRadius: RADIUS,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
    marginTop: 6,
    flexShrink: 0,
  },
  hideFloat: {
    position: "absolute",
    right: 8,
    top: 12,
    width: 28,
    height: 28,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  back: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
  },
  backText: { color: "var(--accent)" as string, fontSize: 14, fontWeight: "500" },
});
