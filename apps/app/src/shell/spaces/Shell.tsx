// The shell (spec 3.0, 2.1, ARCH 7.0): title bar on top; under it, on the quiet rail ground, the fixed rail and then soft sheets: the sidebar, the main view with its tab strip and the open place, and the
// right rail. A place never draws this frame: its sidebar and its panes land in the sheets through ui/SidePane's host. One Space is open at a time:
// a switch shows the skeleton as its first frame, unmounts every place, and keys the next place by the new Space, so two Spaces' rows never meet on screen.
// Places are drawn by `renderPlace`; the shell owns the frame, the tabs, the keys and the Space.
import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { reportProblem } from "../../../../../ui/src/Menu/index.tsx";
import { Avatar } from "../../../../../ui/src/Avatar/index.tsx";
import { holdView, installMotion, keepView, showKept } from "../../../../../ui/src/theme/motion.ts";
import { afterPaint, holdNav, navBusy } from "../../../../../ui/src/theme/pending.ts";
import type { Kept, Swap } from "../../../../../ui/src/theme/motion.ts";
import {
  SHEET_GAP,
  SHEET_RADIUS,
  SIDEBAR_OVERLAY,
  SheetHostProvider,
  ShellLayoutProvider,
  sq,
  useSquircle,
} from "../../../../../ui/src/SidePane/host.tsx";
import type { ShellLayoutApi } from "../../../../../ui/src/SidePane/host.tsx";
import { BREAKPOINTS, bandKey, layoutPanels } from "../../../../../ui/src/SidePane/layout.ts";
import { paneWidths } from "../../../../../ui/src/SidePane/index.tsx";
import { Tooltip } from "../../../../../ui/src/Tooltip/index.tsx";
import { installTips } from "../../../../../ui/src/Tooltip/tips.ts";
import { mark } from "../../startup/marks.ts";
import { NeedsTeamSpace } from "../../../../../ui/src/NeedsTeamSpace/index.tsx";
import { States } from "../../../../../ui/src/States/index.tsx";
import type { PhoneDeviceLike } from "../../../../../ui/src/Softphone/index.tsx";
import type { InboxData } from "../../places/inbox/sidebar/data.tsx";
import { Rail } from "../rail/Rail.tsx";
import {
  SidebarBack,
  SidebarExpand,
  SidebarHide,
  SidebarSlot,
  SidebarSlotProvider,
  toggleSidebar,
  useSidebarSlot,
} from "../sidebar/index.ts";
import type { SidebarStorage } from "../sidebar/index.ts";
import { PLACES_WITH_LIST } from "../sidebar/model.ts";
import type { KitDef, PlaceId } from "../rail/kits.ts";
import { MainTabs, useTabs } from "../tabs/MainTabs.tsx";
import { PROFILE_HASH } from "../tabs/store.ts";
import { TitleBar } from "../titlebar/TitleBar.tsx";
import { notices } from "../noticeslot/model.ts";
import { inTerminal } from "../keyboard/useShellKeys.ts";
import { HubProvider, ShownLocationProvider, useHubState } from "./context.tsx";
import { KEPT_PLACES, PlaceStack, isKeptPlace, keptRevealed } from "./kept-places.tsx";
import { titleText } from "./hub.ts";
import type { HubState, ShellHub, ShellTheme } from "./hub.ts";
import { shellKey } from "./keys.ts";

/** A slow view stops holding the old one after this long: its own quiet sign takes over. */
const HOLD_MAX_MS = 900;
/** How many tabs keep a still copy of their last view (see Sheets). */
const KEPT_VIEWS = 6;
import type { SpaceKind } from "./model.ts";
import { SpaceSkeleton } from "./Skeleton.tsx";
import { watchPurge } from "./purge.ts";
import type { ShellPurge } from "./purge.ts";
import { requestAddServer } from "../computers-available.ts";
import { SpaceTile } from "./SpaceSwitcher.tsx";
import type { SpaceAction, SpaceMenuInput } from "./SpaceSwitcher.tsx";

const InboxPhoneShell = lazy(() => import("../providers/inbox.tsx").then((m) => ({ default: m.InboxPhoneShell })));
const InboxCallTitlePill = lazy(() =>
  import("../providers/inbox.tsx").then((m) => ({ default: m.InboxCallTitlePill })),
);

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

/** Where Space Settings goes: a Team Space's own settings are Console > Space (offered only to someone who may open the Console); a Personal Space keeps its Space pages in Settings (owner walk, 12 Nov: it opened Your Profile). */
export function spaceSettingsTarget(def: { kind: string; console?: boolean }): ["console" | "settings", string] {
  return def.kind !== "personal" && def.console === true
    ? ["console", "screen=console.page&page=space"]
    : ["settings", "page=space"];
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
  onSwitchSpace?: (spaceId: string) => void;
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
        <View testID="place-stage" style={styles.stage} {...(Platform.OS === "web" ? { dataSet: { stage: "1" } } : {})}>
          {children}
        </View>
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
const SLIDE = (
  Platform.OS === "web"
    ? {
        transitionProperty: "margin-left, opacity",
        transitionDuration: "220ms",
        transitionTimingFunction: "cubic-bezier(.2,.8,.2,1)",
      }
    : {}
) as object;

/** The computer's frame: the sidebar sheet, the main sheet with the tabs, then the outlets panes land in. */
export function Sheets({
  tabs,
  toast,
  hub,
  shown,
  scope,
  keptKey,
  children,
}: {
  tabs: ReactNode;
  toast?: ReactNode;
  hub?: ShellHub;
  /** The key a place is held under in the kept places (kept-places.tsx), so a press on a tab of a kept place can be told from one that must be made. */
  keptKey?: ((place: string) => string) | undefined;
  /** The tab whose view is on screen, and what its views belong to (the Space and its sign-in): a view kept for one is never shown for another. */
  shown?: string | undefined;
  scope?: string | undefined;
  children: ReactNode;
}): ReactElement {
  const main = useRef<unknown>(null);
  // What each of the last tabs showed when it was left. Pressing a tab shows its own last view at once, and the live view takes its place when it is ready: the
  // press is answered in the same frame instead of after the place has been made again (owner, 16 Nov 2026, F97: "switching tab ... takes about 2 seconds").
  const onScreen = useRef<string | undefined>(undefined);
  // read by the holder when it runs; a ref, so the holder is not taken down and made again (cancelling a copy in flight) each time the shell draws
  const keptKeyRef = useRef(keptKey);
  keptKeyRef.current = keptKey;
  const keptViews = useRef<{ scope: string; views: Map<string, Kept> }>({ scope: "", views: new Map() });
  useEffect(() => {
    onScreen.current = shown;
  }, [shown]);
  useEffect(() => {
    keptViews.current = { scope: scope ?? "", views: new Map() };
  }, [scope]);
  // A switch never shows a blank frame: a still copy of the view stays over the sheet until the next view stops loading, then lets go in one fade.
  useEffect(() => {
    if (!hub || Platform.OS !== "web") return undefined;
    installMotion((globalThis as { document?: Parameters<typeof installMotion>[0] }).document);
    let held: Swap | null = null;
    let queued: (() => void) | null = null;
    const hold = (
      to: string | undefined,
      then: (() => void) | undefined,
      from: string | undefined,
      place?: string,
    ): boolean => {
      // A place that is still made (kept-places.tsx) is revealed in the frame of the press: nothing is made after it, so no still copy of any page is taken or held in front of it, and the press does not wait a frame.
      if (
        to !== undefined &&
        place !== undefined &&
        keptKeyRef.current !== undefined &&
        isKeptPlace(keptKeyRef.current(place))
      )
        return false;
      const el0 = main.current as { querySelector?: (q: string) => unknown } | null;
      const body = el0?.querySelector?.('[data-testid="place-body"]') ?? null;
      const views = keptViews.current.views;
      // the tab being left: its view is kept as it looks now (the newest six)
      if (from !== undefined && body !== null) {
        const k = keepView(body);
        if (k !== null) {
          views.delete(from);
          views.set(from, k);
          for (const key of views.keys()) {
            if (views.size <= KEPT_VIEWS) break;
            views.delete(key);
          }
        }
      }
      // the tab being shown: its own last view goes over the page at once; with none kept, the view on screen stays until the next one is ready, as before
      const back = to !== undefined && to !== from && body !== null ? views.get(to) : undefined;
      const paper =
        back !== undefined && typeof getComputedStyle === "function" && main.current
          ? getComputedStyle(main.current as Element).backgroundColor
          : undefined;
      const swap = (back !== undefined ? showKept(back, body, paper) : null) ?? holdView(main.current, main.current);
      if (swap === null) return false;
      held = swap;
      // the page being left dims if the next one is slow (ui/theme/motion.ts); the mark goes when the copy does
      const sheet = main.current as {
        setAttribute?(k: string, v: string): void;
        removeAttribute?(k: string): void;
      } | null;
      sheet?.setAttribute?.("data-pending", "1");
      const began = Date.now();
      let frames = 0;
      const wait = (): void => {
        const el = main.current as { querySelector?: (q: string) => unknown } | null;
        frames += 1;
        // the view that arrived has nothing on its page yet (a file or a record still being read): the still copy stays over it. Never a frame with an empty page between two views (owner, 16 Nov: "2 seconds of blank screen").
        const stage = el?.querySelector?.('[data-testid="place-stage"]') as { innerText?: string } | null | undefined;
        const empty = stage !== null && stage !== undefined && (stage.innerText ?? "").replace(/\s+/g, "").length < 12;
        // the next page is made after the frame that answers the press (r41): until it is drawn the page under the copy is still the old one, so the copy stays
        if (
          frames < 3 ||
          ((navBusy() || el?.querySelector?.("[data-loading]:not([data-swap] [data-loading])") || empty) &&
            Date.now() - began < HOLD_MAX_MS)
        ) {
          requestAnimationFrame(wait);
          return;
        }
        swap.fade();
        sheet?.removeAttribute?.("data-pending");
        held = null;
      };
      // The tab's own last view is over the page: it is painted first and the place is made after that paint, so the press is answered in the next frame and not
      // after the place has been made. A page that is not being drawn (a hidden window) gives no frame, so a short timer does the same.
      if (back !== undefined && then !== undefined) {
        let ran = false;
        const run = (): void => {
          if (ran) return;
          ran = true;
          then();
          requestAnimationFrame(wait);
        };
        requestAnimationFrame(() => setTimeout(run, 0));
        setTimeout(run, 120);
        return true;
      }
      requestAnimationFrame(wait);
      return false;
    };
    hub.setHolder((to, then, soon, place) => {
      if (held !== null || queued !== null) return false;
      const from = onScreen.current;
      // A change the shell draws after the next painted frame (r41): the copy is taken after that frame as well. The frame that answers the press then has only the rail or the tab strip to
      // repaint, not a second copy of the whole page (measured: the press was painted after 64 to 96 ms with the copy in that frame).
      if (soon === true && to === undefined) {
        queued = afterPaint(() => {
          queued = null;
          // the place on screen came back from the kept ones: it is complete, there is nothing for a copy to stand in for
          if (keptRevealed()) return;
          hold(undefined, undefined, from);
        });
        return false;
      }
      return hold(to, then, from, place);
    });
    return () => {
      queued?.();
      queued = null;
      hub.setHolder(null);
    };
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
  const register = useCallback(
    (kind: "sidebar" | "pane", id: string, close?: () => void, meta?: { def: number; min: number; max: number }) => {
      if (kind === "sidebar") {
        const spec = { id, def: meta?.def ?? 272, min: meta?.min ?? 220, max: meta?.max ?? 360 };
        // the shell's own sidebar is always first; a list a place adds follows it
        setSidebars((n) =>
          [...n.filter((x) => x.id !== id), spec].sort(
            (a, b) => Number(b.id === "place-sidebar") - Number(a.id === "place-sidebar"),
          ),
        );
        return () => setSidebars((n) => n.filter((x) => x.id !== id));
      }
      const entry = { id, close: close ?? (() => undefined) };
      setPanes((p) => [...p.filter((x) => x.id !== id), entry]);
      return () => setPanes((p) => p.filter((x) => x !== entry && !(x.id === id && x.close === entry.close)));
    },
    [],
  );
  const activePane = panes.length === 0 ? null : (panes[panes.length - 1] as { id: string }).id;
  const band0 = layoutPanels({ windowWidth, hasSidebar: true, sidebarOpen: true, paneOpen: false }).band;
  const savedOf = (key: string): number | null => paneWidths.get(bandKey(key, band0));
  // the slot has an entry from the first frame; its own registration lands one effect later
  const allSidebars =
    slot.hasSidebar && !sidebars.some((x) => x.id === "place-sidebar")
      ? [{ id: "place-sidebar", def: 272, min: 220, max: 360 }, ...sidebars]
      : sidebars;
  const layout = useMemo(
    () =>
      layoutPanels({
        windowWidth,
        hasSidebar: allSidebars.length > 0,
        sidebars: allSidebars.map((x) => ({ ...x, saved: savedOf(x.id) })),
        sidebarOpen: !slot.collapsed,
        sidebarPeek: peek,
        paneOpen: activePane !== null,
        saved: { pane: activePane === null ? null : savedOf(activePane) },
      }),
    [windowWidth, allSidebars.length, sidebars, slot.hasSidebar, slot.collapsed, peek, activePane, version],
  ); // eslint-disable-line react-hooks/exhaustive-deps -- savedOf reads the store, version says it changed
  const mode = layout.sidebar.mode;
  const paneOverlay = layout.pane.mode === "overlay";
  useEffect(() => {
    if (peek && (mode === "docked" || mode === "none" || mode === "screen")) setPeek(false);
  }, [peek, mode]);
  useEffect(() => {
    if (activePane !== null) setPeek(false);
  }, [activePane]);
  const api = useMemo<ShellLayoutApi>(
    () => ({
      layout,
      register,
      activePane,
      saved: savedOf,
      commit: (key, width) => {
        if (width === null) paneWidths.reset(bandKey(key, band0));
        else paneWidths.set(bandKey(key, band0), width);
        setVersion((v) => v + 1);
      },
      peekSidebar: setPeek,
    }),
    [layout, register, activePane, band0],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const leaveOverlay = useCallback(() => {
    if (paneOverlay) (panes[panes.length - 1] as { close: () => void } | undefined)?.close();
    else setPeek(false);
  }, [paneOverlay, panes]);
  const overlayOn = paneOverlay || mode === "overlay";
  const hidden = mode === "hidden";
  const docked = mode === "docked";
  useSquircle();
  useEffect(() => {
    if (Platform.OS === "web") {
      installTips();
      installMotion((globalThis as { document?: Parameters<typeof installMotion>[0] }).document);
    }
  }, []);
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const doc = (
      globalThis as {
        document?: {
          addEventListener(t: string, f: (e: KeyboardEvent) => void): void;
          removeEventListener(t: string, f: (e: KeyboardEvent) => void): void;
          querySelector(q: string): unknown;
        };
      }
    ).document;
    const onKey = (e: KeyboardEvent): void => {
      if (shellKey(e)?.type === "sidebar") {
        // Cmd-B is Bold in a text editor: an editor that took it has already said so
        if (e.defaultPrevented) return;
        e.preventDefault();
        toggleSidebar(slot, api);
        return;
      }
      // Escape closes an overlay sheet unless a menu or a dialog (or a field's own handler) has taken it
      if (
        overlayOn &&
        e.key === "Escape" &&
        !e.defaultPrevented &&
        doc?.querySelector('[role="menu"],[role="dialog"],[aria-modal="true"]') == null
      )
        leaveOverlay();
    };
    doc?.addEventListener("keydown", onKey);
    return () => doc?.removeEventListener("keydown", onKey);
  }, [slot, api, overlayOn, leaveOverlay]);
  const leftWrap = [
    styles.leftWrap,
    SLIDE,
    mode === "overlay" ? SIDEBAR_OVERLAY : null,
    docked ? { marginRight: SHEET_GAP } : null,
    hidden ? { marginLeft: -(leftW + SHEET_GAP), marginRight: SHEET_GAP, opacity: 0 } : null,
  ];
  return (
    <SheetHostProvider value={host}>
      <ShellLayoutProvider value={api}>
        <View
          testID="sheets"
          style={styles.sheets}
          {...(Platform.OS === "web" ? { dataSet: { band: layout.band, sidebar: mode, pane: layout.pane.mode } } : {})}
        >
          <View
            testID="sheet-left-wrap"
            aria-hidden={hidden}
            pointerEvents={hidden ? "none" : "auto"}
            onLayout={(e) => {
              const w = Math.round(e.nativeEvent.layout.width);
              if (w > 0) setLeftW(w);
            }}
            style={leftWrap}
          >
            <SidebarSlot />
            <View
              testID="sheet-left"
              style={styles.outlet}
              ref={(n) => {
                if (n !== null) setLeft(n);
              }}
            />
          </View>
          <View testID="sheet-main" ref={main as never} style={[styles.mainSheet, SLIDE]} {...sq("sheet")}>
            <View style={styles.tabsRow}>
              <SidebarExpand />
              <View style={styles.tabsFill}>{tabs}</View>
            </View>
            {children}
            {toast}
          </View>
          {overlayOn ? (
            <Pressable testID="sheet-scrim" accessibilityLabel="Close" onPress={leaveOverlay} style={styles.scrim} />
          ) : null}
          <View
            testID="sheet-right"
            style={styles.outlet}
            ref={(n) => {
              if (n !== null) setRight(n);
            }}
          />
        </View>
      </ShellLayoutProvider>
    </SheetHostProvider>
  );
}

/** A place frame: the first time it draws after a switch it tells the hub, which records the switch time. */
function PlaceFrame({
  hub,
  epoch,
  children,
}: {
  hub: Pick<ShellHub, "placeDrawn">;
  epoch: number;
  children?: ReactNode;
}): ReactElement {
  useEffect(() => {
    hub.placeDrawn(epoch);
  }, [hub, epoch]);
  return (
    <View testID="shell-place" style={styles.place}>
      {children}
    </View>
  );
}

/** A screen the shell draws itself (a place that needs a Team Space, a new tab, a failure) is a usable first screen: without this mark the launch frame waits out its 8 s cap, because only a place module marks it (F55). */
function ScreenUsable(): null {
  useEffect(() => {
    mark("app.usable");
  }, []);
  return null;
}

/** What the stage draws: the skeleton, a failure, a new tab, a place that needs a Team Space, or the place itself. Every screen the shell draws itself says the app is usable; a place module says it once it has drawn. */
export function ShellStage({
  hub,
  state,
  spaceName,
  kind,
  ctx,
  activeTab,
  compact,
  renderPlace,
  renderNewTab,
  onSpaceAction,
  keep = 1,
}: {
  /** How many places stay made, the one on screen among them (kept-places.tsx). 1: none is kept, a place is made and unmade as it is opened and left. */
  keep?: number;
  hub: Pick<ShellHub, "placeDrawn" | "retry">;
  state: { phase: string; error: string | null; epoch: number; place: PlaceId; hash: string };
  spaceName: string;
  kind: string;
  ctx: PlaceContext;
  activeTab: { key: string; isNew?: boolean } | undefined;
  compact: boolean;
  renderPlace(ctx: PlaceContext): ReactNode;
  renderNewTab?(ctx: PlaceContext): ReactNode;
  onSpaceAction?(a: SpaceAction): void;
}): ReactElement {
  // The places a person was just in stay made, out of the page (kept-places.tsx): going back to one shows it as it was left. They belong to the Space and the switch that opened it, so a
  // Space switch (a new epoch, and its skeleton) unmakes them all, as it always unmade every place. The stack is always the first thing the stage draws, whatever is on screen beside it,
  // so a new tab or a failure does not unmake it.
  const scope = `${state.epoch}:${ctx.spaceId}`;
  const blocked = kind === "personal" ? teamOnly(state.place, state.hash) : null;
  const newTab = activeTab !== undefined && activeTab.isNew === true;
  const place = state.phase !== "skeleton" && state.error === null && !newTab && blocked === null;
  const placeKey = `${state.epoch}:${ctx.spaceId}:${state.place}`;
  const placeBody = place ? (
    <ShownLocationProvider place={state.place} hash={state.hash}>
      {renderPlace(ctx)}
    </ShownLocationProvider>
  ) : null;
  const other =
    state.phase === "skeleton" ? (
      <SpaceSkeleton />
    ) : state.error !== null ? (
      <>
        <ScreenUsable />
        <States
          kind="error"
          message={`Couldn't open ${spaceName}`}
          cause={state.error}
          next="Try again"
          retryable
          onRetry={() => hub.retry()}
        />
      </>
    ) : newTab ? (
      <PlaceFrame hub={hub} epoch={state.epoch} key={`${state.epoch}:${ctx.spaceId}:${activeTab.key}`}>
        <ScreenUsable />
        {renderNewTab !== undefined ? (
          renderNewTab(ctx)
        ) : (
          <States kind="empty" title="Open anything, or start something" icon="search" />
        )}
      </PlaceFrame>
    ) : blocked !== null ? (
      <PlaceFrame hub={hub} epoch={state.epoch} key={placeKey}>
        <ScreenUsable />
        <NeedsTeamSpace
          what={blocked}
          density={compact ? "compact" : "regular"}
          onAction={() => onSpaceAction?.("add")}
        />
      </PlaceFrame>
    ) : keep > 1 ? null : (
      <PlaceFrame hub={hub} epoch={state.epoch} key={placeKey}>
        {placeBody}
      </PlaceFrame>
    );
  if (keep <= 1) return <>{other}</>;
  return (
    <>
      <PlaceStack
        scope={scope}
        current={place ? placeKey : null}
        keep={keep}
        node={
          place ? (
            <PlaceFrame hub={hub} epoch={state.epoch}>
              {placeBody}
            </PlaceFrame>
          ) : null
        }
      />
      {other}
    </>
  );
}

/** What the stage draws, as one value. The shell defers it: a press is answered by the rail and the tab strip in a frame of their own, and the page is made after that frame. */
interface StageInput {
  state: HubState;
  spaceId: string;
  spaceName: string;
  kind: SpaceKind;
  kit: KitDef;
  tabKey: string | undefined;
  tabNew: boolean;
  compact: boolean;
  renderPlace: ShellProps["renderPlace"];
  renderNewTab: ShellProps["renderNewTab"];
  onSpaceAction: ShellProps["onSpaceAction"];
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
  useEffect(
    () =>
      purge === undefined
        ? undefined
        : watchPurge(purge, (e) =>
            hub.flash(`Couldn't remove this device's data: ${e instanceof Error ? e.message : "try again"}`),
          ),
    [purge, hub],
  );
  useEffect(() => (theme === undefined ? undefined : theme.subscribe((t) => setSkin(t.skin))), [theme]);
  useEffect(() => {
    if (theme !== undefined) setSkin(theme.current().skin);
  }, [theme, state.epoch]);

  const act = (action: SpaceAction): void => {
    props.onSpaceAction?.(action);
    const name = session.def.name;
    if (action === "settings") hub.go(...spaceSettingsTarget(session.def));
    else if (action === "terminal") hub.go("chats", `screen=chats.terminal-list&at=${Date.now()}`);
    else if (action === "add-server") {
      requestAddServer();
      hub.go("settings");
    } else if (action === "profile") hub.go("settings", PROFILE_HASH);
    else if (action === "away") {
      // a session sets away for real (stored, seen by teammates); a sample shell with no Space behind it only shows it here
      if (props.team) props.team.away(!state.away);
      else {
        hub.setAway(!state.away);
        hub.flash(state.away ? "Welcome back" : "You are set as away");
      }
    } else if (action === "invite") {
      if (props.team) props.team.invite();
      else hub.flash(`Inviting people needs ${name} to be open`);
    } else if (action === "add" && props.addsSpace !== true) {
      requestAddServer();
      hub.go("settings");
    }
  };

  const switchBy = (spaceId: string): void => {
    if (props.onSwitchSpace) {
      props.onSwitchSpace(spaceId);
      return;
    }
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
    const doc = (
      globalThis as {
        document?: {
          addEventListener(t: string, f: (e: KeyboardEvent) => void): void;
          removeEventListener(t: string, f: (e: KeyboardEvent) => void): void;
        };
      }
    ).document;
    if (doc === undefined) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      const k = shellKey(e);
      if (k === null) return;
      if (k.type === "space") {
        const to = hub.spaces()[k.index];
        if (to === undefined) return;
        e.preventDefault();
        switchBy(to.spaceId);
      } else if (k.type === "new-tab") {
        e.preventDefault();
        hub.newTab();
      } else if (k.type === "reopen-tab") {
        e.preventDefault();
        hub.reopenTab();
      } else if (k.type === "close-tab") {
        e.preventDefault();
        hub.closeTab();
      } else if (k.type === "search") {
        e.preventDefault();
        props.onSearch?.();
      } else if (k.type === "report") {
        e.preventDefault();
        reportProblem({});
      }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  });

  // The place frame is keyed by epoch, Space and place only: an item change (ctx.hash) updates the place in place, so its sidebar scroll, pane and composer keep their state.
  const activeTab = tabs.tabs.find((t) => t.key === tabs.active);
  // A press is answered inside 100 ms (r41). The hub's change draws the rail, the title and the tab strip at once; the page (the place and everything in it) is made after that frame has been
  // painted, as a transition: React makes it without holding the next frames, and a second press before it is done starts over from that press. Until the page is drawn the old one stays (under the
  // still copy of Sheets, which dims when the wait is long). What is not a change of address (a count, the session arriving) reaches the page in the same pass, and a Space switch is never held back:
  // its skeleton is the first frame by design.
  const tabKey = activeTab?.key;
  const tabNew = activeTab?.isNew === true;
  const live = useMemo<StageInput>(
    () => ({
      state,
      spaceId: session.def.spaceId,
      spaceName: session.def.name,
      kind: session.def.kind,
      kit: session.kit,
      tabKey,
      tabNew,
      compact,
      renderPlace: props.renderPlace,
      renderNewTab: props.renderNewTab,
      onSpaceAction: props.onSpaceAction,
    }),
    [
      state,
      session.def.spaceId,
      session.def.name,
      session.def.kind,
      session.kit,
      tabKey,
      tabNew,
      compact,
      props.renderPlace,
      props.renderNewTab,
      props.onSpaceAction,
    ],
  );
  const scope = `${state.epoch}\n${state.phase}\n${session.def.spaceId}`;
  const address = `${scope}\n${state.place}\n${state.hash}\n${tabKey ?? ""}\n${tabNew ? 1 : 0}`;
  const [drawn, setDrawn] = useState({ scope, address, place: state.place });
  // A place that is still made (the last few: kept-places.tsx) is revealed in the frame of the press: it is already complete, so nothing waits for a frame to answer first.
  const reveals =
    !tabNew && drawn.place !== state.place && isKeptPlace(`${state.epoch}:${session.def.spaceId}:${state.place}`);
  // the page on screen is not the one the hub names yet
  const behind = drawn.scope === scope && drawn.address !== address && !reveals;
  // what the stage drew last, kept from the pass that was drawn (an effect, so a pass React threw away never counts)
  const last = useRef(live);
  useEffect(() => {
    if (!behind) last.current = live;
  }, [behind, live]);
  const shown = behind ? last.current : live;
  useEffect(() => {
    if (!behind) {
      if (drawn.address !== address || drawn.scope !== scope) setDrawn({ scope, address, place: state.place });
      return undefined;
    }
    // the copy of the old page is kept until the new one is drawn (Sheets), and a pressed row stays lit (ui/theme/pending.ts)
    const release = holdNav();
    const cancel = afterPaint(() => startTransition(() => setDrawn({ scope, address, place: state.place })));
    return () => {
      cancel();
      release();
    };
  }, [behind, scope, address, drawn.address, drawn.scope, state.place]);
  const stage = useMemo(
    () => (
      <ShellStage
        hub={hub}
        state={shown.state}
        spaceName={shown.spaceName}
        kind={shown.kind}
        ctx={{
          spaceId: shown.spaceId,
          spaceName: shown.spaceName,
          kind: shown.kind,
          place: shown.state.place,
          hash: shown.state.hash,
          epoch: shown.state.epoch,
          kit: shown.kit,
        }}
        activeTab={shown.tabKey === undefined ? undefined : { key: shown.tabKey, isNew: shown.tabNew }}
        compact={shown.compact}
        keep={Platform.OS === "web" && !shown.compact ? KEPT_PLACES : 1}
        renderPlace={shown.renderPlace}
        {...(shown.renderNewTab !== undefined ? { renderNewTab: shown.renderNewTab } : {})}
        {...(shown.onSpaceAction !== undefined ? { onSpaceAction: shown.onSpaceAction } : {})}
      />
    ),
    [hub, shown],
  );
  const ctx = { spaceId: session.def.spaceId };

  const spaceTile = (
    <SpaceTile
      spaces={hub.spaces()}
      openId={state.openId}
      away={state.away}
      onSwitch={switchBy}
      onAction={act}
      {...(props.runsOn ? { runsOn: props.runsOn } : {})}
    />
  );
  const frame = (
    <View testID="shell" style={styles.root} accessibilityLabel={`Vyre, ${session.def.name}`}>
      <TitleBar
        title={titleText(session.def.name, state.place, state.away)}
        online={state.online}
        waiting={state.waiting}
        onOpenWaiting={() =>
          props.onOpenWaiting !== undefined ? props.onOpenWaiting() : hub.go("settings", "waiting")
        }
        onSearch={() => props.onSearch?.()}
        compact={compact}
        nav={state.nav ?? { back: null, forward: null }}
        onBack={() => void hub.back()}
        onForward={() => void hub.forward()}
        call={
          props.phone ? (
            <Suspense fallback={null}>
              <InboxCallTitlePill />
            </Suspense>
          ) : null
        }
      />
      <View style={compact ? styles.bodyPhone : styles.body}>
        {compact ? null : (
          <Rail
            groups={hub.rail()}
            active={state.place}
            onSelect={(place) => hub.go(place)}
            onOpenInTab={(place) => hub.go(place, undefined, true)}
            {...(props.onPrefetchPlace === undefined ? {} : { onPrefetch: props.onPrefetchPlace })}
            fresh={state.fresh}
            onSettle={hub.settle}
            header={spaceTile}
            foot={
              <RailFoot
                {...(props.me ? { me: props.me } : {})}
                {...(props.onOpenMe ? { onOpenMe: props.onOpenMe } : {})}
              />
            }
          />
        )}
        <SidebarSlotProvider
          deviceId={props.sidebar?.deviceId ?? "device"}
          personId={props.sidebar?.personId ?? "me"}
          spaceId={ctx.spaceId}
          place={shown.state.place}
          epoch={shown.state.epoch}
          hash={shown.state.hash}
          initialHold={!compact && (PLACES_WITH_LIST.has(state.place) || tabNew)}
          compact={compact}
          storage={props.sidebar?.storage ?? null}
        >
          {compact ? (
            <View style={styles.main}>
              <Stage>{stage}</Stage>
            </View>
          ) : (
            <Sheets
              hub={hub}
              shown={activeTab?.key}
              scope={`${state.epoch}:${ctx.spaceId}`}
              keptKey={(place) => `${state.epoch}:${ctx.spaceId}:${place}`}
              tabs={
                <MainTabs
                  controller={session.tabs}
                  onNavigate={(tab) => hub.showTab(tab)}
                  onShow={(tab) => hub.showTab(tab)}
                  onNewTab={() => hub.newTab()}
                  onGoToPlace={(place) => hub.go(place)}
                />
              }
            >
              <Stage>{stage}</Stage>
            </Sheets>
          )}
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
      {props.phone ? (
        <Suspense fallback={frame}>
          <InboxPhoneShell device={props.phone.device} data={props.phone.data}>
            {frame}
          </InboxPhoneShell>
        </Suspense>
      ) : (
        frame
      )}
    </HubProvider>
  );
}

/** The foot of the rail, inside the one panel: the person's face (there is no lock any more: signed in means unlocked). */
function RailFoot({
  me,
  onOpenMe,
}: {
  me?: { id: string; name: string; photo?: string };
  onOpenMe?: () => void;
}): ReactElement | null {
  if (!me) return null;
  return (
    <View testID="rail-foot" style={styles.foot}>
      <MeFace me={me} {...(onOpenMe ? { onPress: onOpenMe } : {})} />
    </View>
  );
}

/** The person's own face at the foot of the rail. Their profile opens beside whatever is open. */
function MeFace({
  me,
  onPress,
}: {
  me: { id: string; name: string; photo?: string };
  onPress?: () => void;
}): ReactElement {
  return (
    <Tooltip text="You">
      <Pressable
        role="button"
        aria-label={`${me.name}, your profile`}
        testID="rail-me"
        onPress={onPress}
        style={styles.me}
      >
        <Avatar name={me.name} seedId={me.id} kind="person" size={24} {...(me.photo ? { photo: me.photo } : {})} />
      </Pressable>
    </Tooltip>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "var(--rail)" as string },
  // one gutter: the window edge to the rail and the rail to the sheets are both SHEET_GAP; the top edge is the title bar's
  body: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
    gap: SHEET_GAP,
    paddingLeft: SHEET_GAP,
    paddingRight: SHEET_GAP,
    paddingBottom: SHEET_GAP,
  },
  sheets: { flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row" },
  outlet: { flexDirection: "row", minHeight: 0, flexShrink: 0 },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 30,
    borderRadius: SHEET_RADIUS,
    backgroundColor: "rgba(0,0,0,0.32)" as string,
  },
  leftWrap: { flexDirection: "row", minHeight: 0, flexShrink: 0 },
  tabsRow: { flexDirection: "row", flexShrink: 0 },
  tabsFill: { flex: 1, minWidth: 0 },
  mainSheet: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    borderRadius: SHEET_RADIUS,
    overflow: "hidden",
    backgroundColor: "var(--win)" as string,
  },
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
