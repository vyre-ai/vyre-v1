// The shell (spec 3.0, 2.1, ARCH 7.0): title bar on top; under it, on the quiet rail ground, the fixed rail and then soft sheets: the sidebar, the main view with its tab strip and the open place, and the
// right rail. A place never draws this frame: its sidebar and its panes land in the sheets through ui/SidePane's host. One Space is open at a time:
// a switch shows the skeleton as its first frame, unmounts every place, and keys the next place by the new Space, so two Spaces' rows never meet on screen.
// Places are drawn by `renderPlace`; the shell owns the frame, the tabs, the keys and the Space.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { reportProblem } from "../../../../../ui/src/Menu/index.tsx";
import { Avatar } from "../../../../../ui/src/Avatar/index.tsx";
import { holdView, installMotion } from "../../../../../ui/src/theme/motion.ts";
import type { Swap } from "../../../../../ui/src/theme/motion.ts";
import { SHEET_GAP, SHEET_RADIUS, SIDEBAR_OVERLAY, SheetHostProvider, ShellLayoutProvider, sq, useSquircle } from "../../../../../ui/src/SidePane/host.tsx";
import type { ShellLayoutApi } from "../../../../../ui/src/SidePane/host.tsx";
import { BREAKPOINTS, bandKey, layoutPanels } from "../../../../../ui/src/SidePane/layout.ts";
import { paneWidths } from "../../../../../ui/src/SidePane/index.tsx";
import { Tooltip } from "../../../../../ui/src/Tooltip/index.tsx";
import { installTips } from "../../../../../ui/src/Tooltip/tips.ts";
import { NeedsTeamSpace } from "../../../../../ui/src/NeedsTeamSpace/index.tsx";
import { States } from "../../../../../ui/src/States/index.tsx";
import type { PhoneDeviceLike } from "../../../../../ui/src/Softphone/index.tsx";
import type { InboxData } from "../../places/inbox/sidebar/data.tsx";
import { Rail } from "../rail/Rail.tsx";
import { SidebarBack, SidebarExpand, SidebarHide, SidebarSlot, SidebarSlotProvider, toggleSidebar, useSidebarSlot } from "../sidebar/index.ts";
import type { SidebarStorage } from "../sidebar/index.ts";
import type { KitDef, PlaceId } from "../rail/kits.ts";
import { MainTabs, useTabs } from "../tabs/MainTabs.tsx";
import { PROFILE_HASH } from "../tabs/store.ts";
import { TitleBar } from "../titlebar/TitleBar.tsx";
import { notices } from "../noticeslot/model.ts";
import { inTerminal } from "../keyboard/useShellKeys.ts";
import { HubProvider, useHubState } from "./context.tsx";
import { titleText } from "./hub.ts";
import type { ShellHub, ShellTheme } from "./hub.ts";
import { shellKey } from "./keys.ts";

/** A slow view stops holding the old one after this long: its own quiet sign takes over. */
const HOLD_MAX_MS = 900;
import type { SpaceKind } from "./model.ts";
import { SpaceSkeleton } from "./Skeleton.tsx";
import { watchPurge } from "./purge.ts";
import type { ShellPurge } from "./purge.ts";
import { requestAddServer } from "../computers-available.ts";
import { SpaceTile } from "./SpaceSwitcher.tsx";
import type { SpaceAction, SpaceMenuInput } from "./SpaceSwitcher.tsx";

const InboxPhoneShell = lazy(() => import("../providers/inbox.tsx").then((m) => ({ default: m.InboxPhoneShell })));
const InboxCallTitlePill = lazy(() => import("../providers/inbox.tsx").then((m) => ({ default: m.InboxCallTitlePill })));

/** What a place needs to know to draw: which Space, which place, which item. Places key every query by `spaceId`. */
export interface PlaceContext {
  spaceId: string;
  spaceName: string;
  kind: SpaceKind;
  place: PlaceId;
  hash: string;
  epoch: number;
  kit: KitDef;
}

export interface ShellProps {
  hub: ShellHub;
  theme?: ShellTheme;
  renderPlace: (ctx: PlaceContext) => ReactNode;
  /** The body of a "+" tab: one search that opens anything (P-L9_15 draws it). */
  renderNewTab?: (ctx: PlaceContext) => ReactNode;
  onSearch?: () => void;
  onOpenWaiting?: () => void;
  /** Sign out, Add a Space and the like leave the shell; it tells you. */
  onSpaceAction?: (action: SpaceAction) => void;
  /** The host opens Add a Space itself (the join or create screens): the shell then does nothing more for "add". Without it, "add" falls back to adding a server. */
  addsSpace?: boolean;
  /** Production activates the target server session; sample hubs can switch locally. */
  onSwitchSpace?: (spaceId:string) => void;
  /** Called when a person points at or focuses a place in the rail or a tab: the session reads that place's first queries ahead of the click. */
  onPrefetchPlace?: (place: PlaceId) => void;
  /** Who and where, for remembering a collapsed sidebar on this device. Without it the choice lasts for the session. */
  sidebar?: { deviceId: string; personId: string; storage: SidebarStorage | null };
  /** The phone: the voice device and the Inbox's data. The softphone dock wraps the whole shell, so a call outlives the place that was open when it started, and the running call is a pill in the title bar. */
  phone?: { device: PhoneDeviceLike; data: InboxData };
  /** The purge client and the connection's purge signals: a purged device wipes itself and tells the server with devices.purge_ack. */
  purge?: ShellPurge;
  /** The Space menu's two acts that reach the Space: Invite People copies a real invite link, Set Yourself Away is stored and teammates see it. Left out in a sample shell. */
  team?: { invite(): void; away(on: boolean): void };
  /** Where new chats run by default in a Team Space (the Space menu's "Chats run on"). */
  runsOn?: SpaceMenuInput["runsOn"];
  /** The person signed in: their own face sits at the foot of the rail and opens their profile. */
  me?: { id: string; name: string; photo?: string } | undefined;
  onOpenMe?: () => void;
}

/** The body beside the sidebar. On a computer the sidebar is its own sheet left of this; on the phone a place with a sidebar opens on its list, and choosing an item shows the body with Back. */
export function Stage({ children }: { children: ReactNode }): ReactElement {
  const slot = useSidebarSlot();
  const showList = slot.compact && slot.view === "list";
  return (
    <View style={styles.stageRow}>
      {slot.compact ? <SidebarSlot /> : null}
      {/* the place stays mounted while the phone shows its list, because its sidebar content is drawn from inside the place */}
      <View testID="place-body" aria-hidden={showList} style={[styles.stageCol, showList && styles.hidden]}>
        <SidebarBack />
        <View testID="place-stage" style={styles.stage}>{children}</View>
      </View>
    </View>
  );
}

/** What a Personal Space cannot do (spec 2.1 matrix), by place. */
export function teamOnly(place: PlaceId, hash = ""): string | null {
  // artifacts are a person's own: any Space shows them
  if (hash.includes("screen=apps.artifacts")) return null;
  return place === "apps" ? "Sites and forms" : null;
}

/** Under this window width the shell is one panel at a time (the layout model's phone band). */
export const COMPACT_BELOW = BREAKPOINTS.sheet;

/** The sidebar slides on the one panel motion: 220 ms, the standard ease. */
const SLIDE = (Platform.OS === "web" ? { transitionProperty: "margin-left, opacity", transitionDuration: "220ms", transitionTimingFunction: "cubic-bezier(.2,.8,.2,1)" } : {}) as object;

/** The computer's frame: the sidebar sheet, the main sheet with the tabs, then the outlets panes land in. */
export function Sheets({ tabs, toast, hub, children }: { tabs: ReactNode; toast?: ReactNode; hub?: ShellHub; children: ReactNode }): ReactElement {
  const main = useRef<unknown>(null);
  // A switch never shows a blank frame: a still copy of the view stays over the sheet until the next view stops loading, then lets go in one fade.
  useEffect(() => {
    if (!hub || Platform.OS !== "web") return undefined;
    installMotion((globalThis as { document?: Parameters<typeof installMotion>[0] }).document);
    let held: Swap | null = null;
    hub.setHolder(() => {
      if (held !== null) return;
      const swap = holdView(main.current, main.current);
      if (swap === null) return;
      held = swap;
      const began = Date.now();
      let frames = 0;
      const wait = (): void => {
        const el = main.current as { querySelector?: (q: string) => unknown } | null;
        frames += 1;
        if (frames < 3 || (el?.querySelector?.("[data-loading]:not([data-swap] [data-loading])") && Date.now() - began < HOLD_MAX_MS)) { requestAnimationFrame(wait); return; }
        swap.fade();
        held = null;
      };
      requestAnimationFrame(wait);
    });
    return () => hub.setHolder(null);
  }, [hub]);
  const [left, setLeft] = useState<unknown>(null);
  const [right, setRight] = useState<unknown>(null);
  const host = useMemo(() => ({ left, right, hide: <SidebarHide /> }), [left, right]);
  const slot = useSidebarSlot();
  const [leftW, setLeftW] = useState(0);
  const windowWidth = useWindowDimensions().width;

  // what is open right now: the panels tell the shell (usePanelPresence); the newest pane owns the right side
  const [panes, setPanes] = useState<readonly { id: string; close: () => void }[]>([]);
  const [sidebars, setSidebars] = useState<readonly { id: string; def: number; min: number; max: number }[]>([]);
  const [peek, setPeek] = useState(false);
  const [version, setVersion] = useState(0);
  const register = useCallback((kind: "sidebar" | "pane", id: string, close?: () => void, meta?: { def: number; min: number; max: number }) => {
    if (kind === "sidebar") {
      const spec = { id, def: meta?.def ?? 272, min: meta?.min ?? 220, max: meta?.max ?? 360 };
      // the shell's own sidebar is always first; a list a place adds follows it
      setSidebars((n) => [...n.filter((x) => x.id !== id), spec].sort((a, b) => Number(b.id === "place-sidebar") - Number(a.id === "place-sidebar")));
      return () => setSidebars((n) => n.filter((x) => x.id !== id));
    }
    const entry = { id, close: close ?? (() => undefined) };
    setPanes((p) => [...p.filter((x) => x.id !== id), entry]);
    return () => setPanes((p) => p.filter((x) => x !== entry && !(x.id === id && x.close === entry.close)));
  }, []);
  const activePane = panes.length === 0 ? null : (panes[panes.length - 1] as { id: string }).id;
  const band0 = layoutPanels({ windowWidth, hasSidebar: true, sidebarOpen: true, paneOpen: false }).band;
  const savedOf = (key: string): number | null => paneWidths.get(bandKey(key, band0));
  // the slot has an entry from the first frame; its own registration lands one effect later
  const allSidebars = slot.hasSidebar && !sidebars.some((x) => x.id === "place-sidebar") ? [{ id: "place-sidebar", def: 272, min: 220, max: 360 }, ...sidebars] : sidebars;
  const layout = useMemo(() => layoutPanels({
    windowWidth, hasSidebar: allSidebars.length > 0, sidebars: allSidebars.map((x) => ({ ...x, saved: savedOf(x.id) })), sidebarOpen: !slot.collapsed, sidebarPeek: peek, paneOpen: activePane !== null,
    saved: { pane: activePane === null ? null : savedOf(activePane) },
  }), [windowWidth, allSidebars.length, sidebars, slot.hasSidebar, slot.collapsed, peek, activePane, version]);   // eslint-disable-line react-hooks/exhaustive-deps -- savedOf reads the store, version says it changed
  const mode = layout.sidebar.mode;
  const paneOverlay = layout.pane.mode === "overlay";
  useEffect(() => { if (peek && (mode === "docked" || mode === "none" || mode === "screen")) setPeek(false); }, [peek, mode]);
  useEffect(() => { if (activePane !== null) setPeek(false); }, [activePane]);
  const api = useMemo<ShellLayoutApi>(() => ({
    layout, register, activePane,
    saved: savedOf,
    commit: (key, width) => { if (width === null) paneWidths.reset(bandKey(key, band0)); else paneWidths.set(bandKey(key, band0), width); setVersion((v) => v + 1); },
    peekSidebar: setPeek,
  }), [layout, register, activePane, band0]);   // eslint-disable-line react-hooks/exhaustive-deps
  const leaveOverlay = useCallback(() => {
    if (paneOverlay) (panes[panes.length - 1] as { close: () => void } | undefined)?.close();
    else setPeek(false);
  }, [paneOverlay, panes]);
  const overlayOn = paneOverlay || mode === "overlay";
  const hidden = mode === "hidden";
  const docked = mode === "docked";
  useSquircle();
  useEffect(() => { if (Platform.OS === "web") { installTips(); installMotion((globalThis as { document?: Parameters<typeof installMotion>[0] }).document); } }, []);
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void; querySelector(q: string): unknown } }).document;
    const onKey = (e: KeyboardEvent): void => {
      if (shellKey(e)?.type === "sidebar") { e.preventDefault(); toggleSidebar(slot, api); return; }
      // Escape closes an overlay sheet unless a menu or a dialog (or a field's own handler) has taken it
      if (overlayOn && e.key === "Escape" && !e.defaultPrevented && doc?.querySelector('[role="menu"],[role="dialog"],[aria-modal="true"]') == null) leaveOverlay();
    };
    doc?.addEventListener("keydown", onKey);
    return () => doc?.removeEventListener("keydown", onKey);
  }, [slot, api, overlayOn, leaveOverlay]);
  const leftWrap = [
    styles.leftWrap, SLIDE,
    mode === "overlay" ? SIDEBAR_OVERLAY : null,
    docked ? { marginRight: SHEET_GAP } : null,
    hidden ? { marginLeft: -(leftW + SHEET_GAP), marginRight: SHEET_GAP, opacity: 0 } : null,
  ];
  return (
    <SheetHostProvider value={host}>
      <ShellLayoutProvider value={api}>
        <View testID="sheets" style={styles.sheets} {...(Platform.OS === "web" ? { dataSet: { band: layout.band, sidebar: mode, pane: layout.pane.mode } } : {})}>
          <View testID="sheet-left-wrap" aria-hidden={hidden} pointerEvents={hidden ? "none" : "auto"} onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0) setLeftW(w); }} style={leftWrap}>
            <SidebarSlot />
            <View testID="sheet-left" style={styles.outlet} ref={(n) => { if (n !== null) setLeft(n); }} />
          </View>
          <View testID="sheet-main" ref={main as never} style={[styles.mainSheet, SLIDE]} {...sq("sheet")}>
            <View style={styles.tabsRow}><SidebarExpand /><View style={styles.tabsFill}>{tabs}</View></View>
            {children}
            {toast}
          </View>
          {overlayOn ? <Pressable testID="sheet-scrim" accessibilityLabel="Close" onPress={leaveOverlay} style={styles.scrim} /> : null}
          <View testID="sheet-right" style={styles.outlet} ref={(n) => { if (n !== null) setRight(n); }} />
        </View>
      </ShellLayoutProvider>
    </SheetHostProvider>
  );
}

/** A place frame: the first time it draws after a switch it tells the hub, which records the switch time. */
function PlaceFrame({ hub, epoch, children }: { hub: ShellHub; epoch: number; children?: ReactNode }): ReactElement {
  useEffect(() => { hub.placeDrawn(epoch); }, [hub, epoch]);
  return <View testID="shell-place" style={styles.place}>{children}</View>;
}

export function Shell(props: ShellProps): ReactElement {
  const { hub, theme } = props;
  const state = useHubState(hub);
  const session = hub.session();
  const tabs = useTabs(session.tabs);
  const width = useWindowDimensions().width;
  const compact = width > 0 && width < COMPACT_BELOW;
  const [skin, setSkin] = useState<string>(() => theme?.current().skin ?? "system");

  const purge = props.purge;
  useEffect(() => (purge === undefined ? undefined : watchPurge(purge, (e) => hub.flash(`Couldn't remove this device's data: ${e instanceof Error ? e.message : "try again"}`))), [purge, hub]);
  useEffect(() => (theme === undefined ? undefined : theme.subscribe((t) => setSkin(t.skin))), [theme]);
  useEffect(() => { if (theme !== undefined) setSkin(theme.current().skin); }, [theme, state.epoch]);

  const act = (action: SpaceAction): void => {
    props.onSpaceAction?.(action);
    const name = session.def.name;
    if (action === "settings") hub.go("settings");
    else if (action === "terminal") hub.go("chats", `screen=chats.terminal-list&at=${Date.now()}`);
    else if (action === "add-server") { requestAddServer(); hub.go("settings"); }
    else if (action === "profile") hub.go("settings", PROFILE_HASH);
    else if (action === "away") {
      // a session sets away for real (stored, seen by teammates); a sample shell with no Space behind it only shows it here
      if (props.team) props.team.away(!state.away);
      else { hub.setAway(!state.away); hub.flash(state.away ? "Welcome back" : "You are set as away"); }
    } else if (action === "invite") {
      if (props.team) props.team.invite();
      else hub.flash(`Inviting people needs ${name} to be open`);
    } else if (action === "add" && props.addsSpace !== true) { requestAddServer(); hub.go("settings"); }
  };

  const switchBy = (spaceId: string): void => {
    if(props.onSwitchSpace){props.onSwitchSpace(spaceId);return;}
    const to = hub.spaces().find((s) => s.spaceId === spaceId);
    if (hub.switchTo(spaceId) && to !== undefined) hub.flash(`Switched to ${to.name}`);
  };

  // what used to be a toast is a passing notice in the top bar (shell/noticeslot): it shows briefly there, with Undo when it can be taken back, then fades
  const lastStatus = useRef<number | null>(null);
  useEffect(() => {
    const st = state.status;
    if (st === null || lastStatus.current === st.id) return;
    lastStatus.current = st.id;
    notices.pass(st.text, st.undo ? { label: "Undo", run: () => hub.undoStatus() } : undefined);
  }, [state.status, hub]);

  // the keys the shell owns: Shift-Cmd-1..3 Space, Cmd-T new tab, Cmd-W close tab, Cmd-K search, Shift-Cmd-/ report
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (doc === undefined) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      const k = shellKey(e);
      if (k === null) return;
      if (k.type === "space") {
        const to = hub.spaces()[k.index];
        if (to === undefined) return;
        e.preventDefault();
        switchBy(to.spaceId);
      } else if (k.type === "new-tab") { e.preventDefault(); hub.newTab(); }
      else if (k.type === "close-tab") { e.preventDefault(); hub.closeTab(); }
      else if (k.type === "search") { e.preventDefault(); props.onSearch?.(); }
      else if (k.type === "report") { e.preventDefault(); reportProblem({}); }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  });

  const ctx: PlaceContext = {
    spaceId: session.def.spaceId,
    spaceName: session.def.name,
    kind: session.def.kind,
    place: state.place,
    hash: state.hash,
    epoch: state.epoch,
    kit: session.kit,
  };
  // The place frame is keyed by epoch, Space and place only: an item change (ctx.hash) updates the place in place, so its sidebar scroll, pane and composer keep their state.
  const activeTab = tabs.tabs.find((t) => t.key === tabs.active);

  let stage: ReactNode;
  if (state.phase === "skeleton") stage = <SpaceSkeleton />;
  else if (state.error !== null) {
    stage = <States kind="error" message={`Couldn't open ${session.def.name}`} cause={state.error} next="Try again" retryable onRetry={() => hub.retry()} />;
  } else if (activeTab !== undefined && activeTab.isNew === true) {
    stage = (
      <PlaceFrame hub={hub} epoch={state.epoch} key={`${state.epoch}:${ctx.spaceId}:${activeTab.key}`}>
        {props.renderNewTab !== undefined ? props.renderNewTab(ctx) : <States kind="empty" title="Open anything, or start something" icon="search" />}
      </PlaceFrame>
    );
  } else {
    const blocked = session.def.kind === "personal" ? teamOnly(state.place, state.hash) : null;
    stage = (
      <PlaceFrame hub={hub} epoch={state.epoch} key={`${state.epoch}:${ctx.spaceId}:${state.place}`}>
        {blocked !== null ? <NeedsTeamSpace what={blocked} density={compact ? "compact" : "regular"} onAction={() => props.onSpaceAction?.("add")} /> : props.renderPlace(ctx)}
      </PlaceFrame>
    );
  }

  const spaceTile = <SpaceTile spaces={hub.spaces()} openId={state.openId} away={state.away} onSwitch={switchBy} onAction={act} {...(props.runsOn ? { runsOn: props.runsOn } : {})} />;
  const frame = (
      <View testID="shell" style={styles.root} accessibilityLabel={`Vyre, ${session.def.name}`}>
        <TitleBar
          title={titleText(session.def.name, state.place, state.away)}
          online={state.online}
          waiting={state.waiting}
          onOpenWaiting={() => (props.onOpenWaiting !== undefined ? props.onOpenWaiting() : hub.go("settings", "waiting"))}
          onSearch={() => props.onSearch?.()}
          compact={compact}
          call={props.phone ? <Suspense fallback={null}><InboxCallTitlePill /></Suspense> : null}
        />
        <View style={compact ? styles.bodyPhone : styles.body}>
          {compact ? null : <Rail
            groups={hub.rail()}
            active={state.place}
            onSelect={(place) => hub.go(place)}
            onOpenInTab={(place) => hub.go(place, undefined, true)}
            {...(props.onPrefetchPlace === undefined ? {} : { onPrefetch: props.onPrefetchPlace })}
            fresh={state.fresh}
            onSettle={hub.settle}
            header={spaceTile}
            foot={<RailFoot {...(props.me ? { me: props.me } : {})} {...(props.onOpenMe ? { onOpenMe: props.onOpenMe } : {})} />}
          />}
          <SidebarSlotProvider
            deviceId={props.sidebar?.deviceId ?? "device"} personId={props.sidebar?.personId ?? "me"} spaceId={ctx.spaceId} place={state.place}
            epoch={state.epoch} compact={compact} storage={props.sidebar?.storage ?? null}
          >
            {compact
              ? <View style={styles.main}><Stage>{stage}</Stage></View>
              : <Sheets hub={hub} tabs={<MainTabs controller={session.tabs} onNavigate={(tab) => hub.showTab(tab)} onNewTab={() => hub.newTab()} onGoToPlace={(place) => hub.go(place)} />}><Stage>{stage}</Stage></Sheets>}
          </SidebarSlotProvider>
          {compact ? (
            <Rail
              bottom
              groups={hub.rail()}
              active={state.place}
              onSelect={(place) => hub.go(place)}
              onOpenInTab={(place) => hub.go(place, undefined, true)}
              {...(props.onPrefetchPlace === undefined ? {} : { onPrefetch: props.onPrefetchPlace })}
              header={spaceTile}
            />
          ) : null}
        </View>
      </View>
  );
  return (
    <HubProvider hub={hub}>
      {props.phone ? <Suspense fallback={frame}><InboxPhoneShell device={props.phone.device} data={props.phone.data}>{frame}</InboxPhoneShell></Suspense> : frame}
    </HubProvider>
  );
}

/** The foot of the rail, inside the one panel: the person's face (there is no lock any more: signed in means unlocked). */
function RailFoot({ me, onOpenMe }: { me?: { id: string; name: string; photo?: string }; onOpenMe?: () => void }): ReactElement | null {
  if (!me) return null;
  return <View testID="rail-foot" style={styles.foot}><MeFace me={me} {...(onOpenMe ? { onPress: onOpenMe } : {})} /></View>;
}

/** The person's own face at the foot of the rail. Their profile opens beside whatever is open. */
function MeFace({ me, onPress }: { me: { id: string; name: string; photo?: string }; onPress?: () => void }): ReactElement {
  return (
    <Tooltip text="You">
      <Pressable role="button" aria-label={`${me.name}, your profile`} testID="rail-me" onPress={onPress} style={styles.me}>
        <Avatar name={me.name} seedId={me.id} kind="person" size={24} {...(me.photo ? { photo: me.photo } : {})} />
      </Pressable>
    </Tooltip>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "var(--rail)" as string },
  // one gutter: the window edge to the rail and the rail to the sheets are both SHEET_GAP; the top edge is the title bar's
  body: { flex: 1, flexDirection: "row", minHeight: 0, gap: SHEET_GAP, paddingLeft: SHEET_GAP, paddingRight: SHEET_GAP, paddingBottom: SHEET_GAP },
  sheets: { flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row" },
  outlet: { flexDirection: "row", minHeight: 0, flexShrink: 0 },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 30, borderRadius: SHEET_RADIUS, backgroundColor: "rgba(0,0,0,0.32)" as string },
  leftWrap: { flexDirection: "row", minHeight: 0, flexShrink: 0 },
  tabsRow: { flexDirection: "row", flexShrink: 0 },
  tabsFill: { flex: 1, minWidth: 0 },
  mainSheet: { flex: 1, minWidth: 0, minHeight: 0, borderRadius: SHEET_RADIUS, overflow: "hidden", backgroundColor: "var(--win)" as string },
  foot: { alignItems: "center", gap: 4 },
  me: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  bodyPhone: { flex: 1, flexDirection: "column", minHeight: 0 },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  stageRow: { flex: 1, flexDirection: "row", minHeight: 0 },
  stageCol: { flex: 1, minWidth: 0, minHeight: 0 },
  hidden: { display: "none" },
  stage: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  place: { flex: 1, minHeight: 0 },
});
