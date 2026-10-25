// The shell (spec 3.0, 2.1, ARCH 7.0): title bar on top; under it the rail, then the main view with its tab strip and the open place. One Space is open at a time:
// a switch shows the skeleton as its first frame, unmounts every place, and keys the next place by the new Space, so two Spaces' rows never meet on screen.
// Places are drawn by `renderPlace`; the shell owns the frame, the tabs, the keys and the Space.
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { reportProblem } from "../../../../../ui/src/Menu/index.tsx";
import { NeedsTeamSpace } from "../../../../../ui/src/NeedsTeamSpace/index.tsx";
import { States } from "../../../../../ui/src/States/index.tsx";
import { Rail } from "../rail/Rail.tsx";
import { SidebarBack, SidebarExpand, SidebarSlot, SidebarSlotProvider, useSidebarSlot } from "../sidebar/index.ts";
import type { SidebarStorage } from "../sidebar/index.ts";
import type { KitDef, PlaceId } from "../rail/kits.ts";
import { MainTabs, useTabs } from "../tabs/MainTabs.tsx";
import { TitleBar } from "../titlebar/TitleBar.tsx";
import { HubProvider, useHubState } from "./context.tsx";
import { titleText } from "./hub.ts";
import type { ShellHub, ShellTheme } from "./hub.ts";
import { shellKey } from "./keys.ts";
import type { SpaceKind } from "./model.ts";
import { SpaceSkeleton } from "./Skeleton.tsx";
import { SpaceTile } from "./SpaceSwitcher.tsx";
import type { SpaceAction } from "./SpaceSwitcher.tsx";

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
  /** Who and where, for remembering a collapsed sidebar on this device. Without it the choice lasts for the session. */
  sidebar?: { deviceId: string; personId: string; storage: SidebarStorage | null };
}

/** The body beside the sidebar. On a computer the sidebar sits left of the place. On the phone a place with a sidebar opens on its list; choosing an item shows the body with Back. */
function Stage({ children }: { children: ReactNode }): ReactElement {
  const slot = useSidebarSlot();
  const showList = slot.compact && slot.view === "list";
  return (
    <View style={styles.stageRow}>
      <SidebarSlot />
      {/* the place stays mounted while the phone shows its list, because its sidebar content is drawn from inside the place */}
      <View style={[styles.stageCol, showList && styles.hidden]}>
        <SidebarBack />
        <SidebarExpand />
        <View style={styles.stage}>{children}</View>
      </View>
    </View>
  );
}

/** What a Personal Space cannot do (spec 2.1 matrix), by place. */
export function teamOnly(place: PlaceId): string | null {
  return place === "apps" ? "Sites, forms and campaigns" : null;
}

export const COMPACT_BELOW = 700;

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

  useEffect(() => (theme === undefined ? undefined : theme.subscribe((t) => setSkin(t.skin))), [theme]);
  useEffect(() => { if (theme !== undefined) setSkin(theme.current().skin); }, [theme, state.epoch]);

  const act = (action: SpaceAction): void => {
    props.onSpaceAction?.(action);
    const name = session.def.name;
    if (action === "settings") hub.go("settings");
    else if (action === "terminal") hub.go("chats", "terminal");
    else if (action === "profile") hub.go("settings", "profile");
    else if (action === "away") {
      hub.setAway(!state.away);
      hub.flash(state.away ? "Welcome back" : "You are set as away");
    } else if (action === "invite") hub.flash(`Invite link copied for ${name}`);
    else if (action === "add") hub.flash("Join with a link, or connect a server");
  };

  const switchBy = (spaceId: string): void => {
    const to = hub.spaces().find((s) => s.spaceId === spaceId);
    if (hub.switchTo(spaceId) && to !== undefined) hub.flash(`Switched to ${to.name}`);
  };

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
    const blocked = session.def.kind === "personal" ? teamOnly(state.place) : null;
    stage = (
      <PlaceFrame hub={hub} epoch={state.epoch} key={`${state.epoch}:${ctx.spaceId}:${state.place}`}>
        {blocked !== null ? <NeedsTeamSpace what={blocked} density={compact ? "compact" : "regular"} onAction={() => props.onSpaceAction?.("add")} /> : props.renderPlace(ctx)}
      </PlaceFrame>
    );
  }

  return (
    <HubProvider hub={hub}>
      <View testID="shell" style={styles.root} accessibilityLabel={`Vyre, ${session.def.name}`}>
        <TitleBar
          title={titleText(session.def.name, state.place, state.away)}
          status={state.status}
          onUndo={() => hub.undoStatus()}
          online={state.online}
          waiting={state.waiting}
          onOpenWaiting={() => (props.onOpenWaiting !== undefined ? props.onOpenWaiting() : hub.go("settings", "waiting"))}
          onSearch={() => props.onSearch?.()}
          skin={skin}
          onSkin={(id) => {
            theme?.setSkin(id);
            hub.flash("Skin saved for this Space");
          }}
          compact={compact}
        />
        <View style={styles.body}>
          <Rail
            groups={hub.rail()}
            active={state.place}
            onSelect={(place) => hub.go(place)}
            header={<SpaceTile spaces={hub.spaces()} openId={state.openId} away={state.away} onSwitch={switchBy} onAction={act} />}
          />
          <View style={styles.main}>
            <MainTabs controller={session.tabs} onNavigate={(tab) => hub.showTab(tab)} onNewTab={() => hub.newTab()} onGoToPlace={(place) => hub.go(place)} />
            <SidebarSlotProvider
              deviceId={props.sidebar?.deviceId ?? "device"} personId={props.sidebar?.personId ?? "me"} spaceId={ctx.spaceId} place={state.place}
              epoch={state.epoch} compact={compact} storage={props.sidebar?.storage ?? null}
            >
              <Stage>{stage}</Stage>
            </SidebarSlotProvider>
          </View>
        </View>
      </View>
    </HubProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "var(--win)" as string },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  main: { flex: 1, minWidth: 0 },
  stageRow: { flex: 1, flexDirection: "row", minHeight: 0 },
  stageCol: { flex: 1, minWidth: 0, minHeight: 0 },
  hidden: { display: "none" },
  stage: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  place: { flex: 1, minHeight: 0 },
});
