// ui/ObjectPage: every Console object has this page (spec 3.10, ARCH 7.10): a header with name, kind, owner, status and actions; the tabs Overview,
// Access and Activity plus the specific ones; and a side sheet. A destructive action shows its impact and waits for a yes; once done it offers Undo.
// Keys: Left and Right move between tabs (Home and End jump), Escape closes the side sheet or a confirm. Menus use the shared Menu.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { MenuIcon, menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { OBJECT_PAGE_BASE_TABS } from "./props.ts";
import type { Density, ObjectAction, ObjectPageProps, ObjectTab } from "./props.ts";

export type { Density, ObjectAction, ObjectPageProps, ObjectTab } from "./props.ts";
export { OBJECT_PAGE_BASE_TABS, frozenObjectPageProps } from "./props.ts";

/* ---------- pure logic ---------- */

/** The three base tabs, then the specific ones. A specific tab that reuses a base id replaces it in place. */
export function withBaseTabs(specific: readonly ObjectTab[]): ObjectTab[] {
  const out: ObjectTab[] = OBJECT_PAGE_BASE_TABS.map((t) => specific.find((s) => s.id === t.id) ?? t);
  for (const tab of specific) if (!out.some((t) => t.id === tab.id)) out.push(tab);
  return out;
}

export type TabKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

/** The tab a key moves to. Does not wrap, so a held key stops at the ends. */
export function moveTab(tabs: readonly ObjectTab[], active: string, key: TabKey): string {
  if (tabs.length === 0) return active;
  if (key === "Home") return tabs[0]?.id ?? active;
  if (key === "End") return tabs[tabs.length - 1]?.id ?? active;
  const at = tabs.findIndex((t) => t.id === active);
  if (at < 0) return tabs[0]?.id ?? active;
  const next = key === "ArrowRight" ? Math.min(tabs.length - 1, at + 1) : Math.max(0, at - 1);
  return tabs[next]?.id ?? active;
}

/** The label of a tab with its count: "Access 12". A tab without a count is its label. */
export function tabText(tab: ObjectTab): string {
  return tab.count === null ? tab.label : `${tab.label} ${tab.count}`;
}

export interface ActionSplit {
  /** The first safe action: the one outlined button. */
  primary: ObjectAction | null;
  /** The other safe actions, as quiet text buttons on a wide page. */
  secondary: ObjectAction[];
  /** Destructive actions live in the more menu, never on the page face. */
  destructive: ObjectAction[];
}

export function splitActions(actions: readonly ObjectAction[]): ActionSplit {
  const safe = actions.filter((a) => !a.destructive);
  return { primary: safe[0] ?? null, secondary: safe.slice(1), destructive: actions.filter((a) => a.destructive) };
}

/** What a destructive action says before it runs. The caller's impact line leads; without one the line still asks. */
export function confirmLine(action: ObjectAction, name: string, impact: string | undefined): string {
  const lead = impact !== undefined && impact.trim() !== "" ? impact.trim() : `${action.label} ${name}?`;
  return lead;
}

/** The line after a destructive action ran, beside Undo. */
export function doneLine(action: ObjectAction, name: string): string {
  return `${action.label}: ${name}.`;
}

export type ObjectActionResult = { ok: true } | { ok: false; error: string };
export async function settleObjectAction(run: () => void | boolean | Promise<void | boolean>): Promise<ObjectActionResult> {
  try {
    const result = await run();
    return result === false ? { ok: false, error: "The action did not complete." } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The action did not complete." };
  }
}

/** True when the status reads as healthy (a green dot). */
export function statusTone(status: string): "ok" | "warn" | "off" {
  const s = status.trim().toLowerCase();
  if (["active", "healthy", "connected", "ok", "running", "live", "on"].includes(s)) return "ok";
  if (["pending", "invited", "degraded", "paused", "needs you", "expiring", "warning"].includes(s)) return "warn";
  return "off";
}

/** The line under the name: kind, then owner. */
export function subtitle(kind: string, owner: string, extra?: string): string {
  return [kind, extra ?? "", owner].filter((part) => part !== "").join(" · ");
}

/* ---------- web-only props without a ts-ignore ---------- */

function webProps(props: Record<string, unknown>): Record<string, unknown> {
  return Platform.OS === "web" ? props : {};
}

interface KeyLike {
  key: string;
  preventDefault?: () => void;
  target?: { tagName?: string };
}

/* ---------- the view ---------- */

export interface ObjectPageViewProps extends ObjectPageProps {
  /** The list this object belongs to, for the breadcrumb ("People"). */
  parent?: string;
  onBack?: () => void;
  /** A line under the name, replacing "Kind · Owner". */
  subtitle?: string;
  avatar?: ReactNode;
  /** Impact lines for destructive actions, by action id: "Removing Omar reassigns 3 things." */
  impacts?: Readonly<Record<string, string>>;
  /** Called when an action is chosen. For a destructive one it is called after the person confirms. */
  onAction?: (id: string) => void | boolean | Promise<void | boolean>;
  /** After a destructive action ran: Undo puts it back. */
  onUndo?: (id: string) => void;
  onTab?: (id: string) => void;
  onCloseSheet?: () => void;
  sheetTitle?: string;
  sheet?: ReactNode;
  /** The body of the active tab. */
  children?: ReactNode;
  testID?: string;
}

interface Pending {
  actionId: string;
}

export function ObjectPage(props: ObjectPageViewProps): ReactElement {
  const { name, kind, owner, status, actions, tabs, density, sheetOpen, impacts, onAction, onUndo, onTab, onBack } = props;
  const measuredWidth = useWindowDimensions().width;
  const compact = density === "compact" || measuredWidth > 0 && measuredWidth < 720;
  const [active, setActive] = useState(props.activeTabId);
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [sheet, setSheet] = useState(sheetOpen);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const activeProp = useRef(props.activeTabId);
  const sheetProp = useRef(props.sheetOpen);
  const { element: menuElement, show } = useMenu();
  const split = splitActions(actions);
  const tone = statusTone(status);

  useEffect(() => {
    if (activeProp.current !== props.activeTabId) { activeProp.current = props.activeTabId; setActive(props.activeTabId); }
  }, [props.activeTabId]);
  useEffect(() => {
    if (sheetProp.current !== props.sheetOpen) { sheetProp.current = props.sheetOpen; setSheet(props.sheetOpen); }
  }, [props.sheetOpen]);

  const select = useCallback((id: string) => {
    setActive(id);
    if (onTab) onTab(id);
  }, [onTab]);

  const choose = useCallback((action: ObjectAction) => {
    if (busyAction !== null) return;
    if (action.destructive) {
      setPending({ actionId: action.id });
      setDone(null);
      setActionError(null);
      return;
    }
    if (!onAction) return;
    setBusyAction(action.id); setActionError(null);
    void settleObjectAction(() => onAction(action.id)).then((result) => { if (!result.ok) setActionError(result.error); }).finally(() => setBusyAction(null));
  }, [busyAction, onAction]);

  const confirm = useCallback(async () => {
    if (pending === null || busyAction !== null) return;
    const action = actions.find((a) => a.id === pending.actionId);
    if (action === undefined) return;
    if (!onAction) { setPending(null); return; }
    setBusyAction(action.id); setActionError(null);
    const result = await settleObjectAction(() => onAction(action.id));
    setBusyAction(null);
    if (!result.ok) { setActionError(result.error); return; }
    setPending(null); setDone(action.id);
  }, [pending, busyAction, actions, onAction]);

  const closeSheet = useCallback(() => {
    setSheet(false);
    if (props.onCloseSheet) props.onCloseSheet();
  }, [props]);

  /** The more menu: on a phone every action, on a wide page only the destructive ones (the rest are buttons). */
  const menuFor = (includeSafe: boolean): MenuEntry[] => {
    const safe = [...(split.primary === null ? [] : [split.primary]), ...split.secondary];
    const items: MenuEntry[] = [];
    if (includeSafe) for (const a of safe) items.push({ label: a.label, onSelect: () => choose(a) });
    if (items.length > 0 && split.destructive.length > 0) items.push({ separator: true });
    for (const a of split.destructive) items.push({ label: a.label, danger: true, onSelect: () => choose(a) });
    return items;
  };

  const onKeyDown = (event: KeyLike): void => {
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (event.key === "Escape") {
      if (pending !== null) {
        event.preventDefault?.();
        setPending(null);
      } else if (sheet) {
        event.preventDefault?.();
        closeSheet();
      }
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
      const next = moveTab(tabs, active, event.key);
      if (next !== active) {
        event.preventDefault?.();
        select(next);
      }
    }
  };

  const pendingAction = pending === null ? null : actions.find((a) => a.id === pending.actionId) ?? null;
  const doneAction = done === null ? null : actions.find((a) => a.id === done) ?? null;
  const more = menuFor(compact);
  const secondaryButtons: ReactNode[] = [];
  if (!compact) for (const a of split.secondary) secondaryButtons.push(<HeadButton key={a.id} label={a.label} testID={`object-action-${a.id}`} disabled={busyAction !== null} onPress={() => choose(a)} />);
  const tabNodes: ReactNode[] = [];
  for (const tab of tabs) {
    const on = tab.id === active;
    tabNodes.push(
      <Pressable
        key={tab.id}
        role="tab"
        aria-selected={on}
        aria-label={tabText(tab)}
        testID={`object-tab-${tab.id}`}
        onPress={() => select(tab.id)}
        style={[styles.tab, on && styles.tabOn]}
      >
        <Text style={[styles.tabText, on && styles.tabTextOn]}>{tab.label}</Text>
        {tab.count !== null ? <Text style={styles.tabCount}>{tab.count}</Text> : null}
      </Pressable>,
    );
  }

  return (
    <View
      style={styles.root}
      testID={props.testID ?? `object-page-${props.id}`}
      role="region"
      aria-label={`${kind}: ${name}`}
      {...webProps({ onKeyDown, dataSet: { density, kind } })}
    >
      <View style={styles.main}>
        {props.parent !== undefined ? (
          <View style={styles.crumbs} testID="object-crumbs">
            <Pressable role="link" aria-label={`Back to ${props.parent}`} onPress={onBack} testID="object-parent" style={styles.crumbBtn}>
              <Text style={styles.crumb}>{props.parent}</Text>
            </Pressable>
            <Text style={styles.crumbSep} aria-hidden>{"›"}</Text>
            <Text style={styles.crumbHere} numberOfLines={1}>{name}</Text>
          </View>
        ) : null}

        <View
          style={[styles.head, compact && styles.headCompact]}
          testID="object-header"
          {...menuTrigger((x, y) => show(menuFor(true), x, y, "context", { label: name }))}
        >
          {props.avatar !== undefined ? <View style={styles.avatar}>{props.avatar}</View> : null}
          <View style={styles.titles}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1} role="heading" aria-level={1}>{name}</Text>
              <View style={styles.status} testID="object-status">
                <View style={[styles.dot, tone === "ok" ? styles.dotOk : tone === "warn" ? styles.dotWarn : styles.dotOff]} />
                <Text style={styles.statusText}>{status}</Text>
              </View>
            </View>
            <Text style={styles.sub} numberOfLines={1} testID="object-subtitle">{props.subtitle ?? subtitle(kind, owner)}</Text>
          </View>
          <View style={styles.actions}>
            {!compact && split.primary !== null ? <HeadButton label={split.primary.label} outlined testID={`object-action-${split.primary.id}`} disabled={busyAction !== null} onPress={() => choose(split.primary as ObjectAction)} /> : null}
            {secondaryButtons}
            {more.length > 0 ? (
              <Pressable
                role="button"
                aria-label="More"
                aria-haspopup="menu"
                testID="object-more"
                onPress={(e) => show(more, e.nativeEvent.pageX ?? 0, e.nativeEvent.pageY ?? 0, "context", { label: name })}
                style={styles.more}
              >
                <MenuIcon icon="more" color="var(--ink-2)" size={16} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.tabsBox}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} role="tablist" aria-label={`${name} tabs`} testID="object-tabs">
            {tabNodes}
          </ScrollView>
        </View>

        {pendingAction !== null ? (
          <View style={styles.confirm} testID="object-confirm" role="alertdialog" aria-label={confirmLine(pendingAction, name, impacts?.[pendingAction.id])}>
            <Text style={styles.confirmText}>{confirmLine(pendingAction, name, impacts?.[pendingAction.id])}</Text>
            <View style={styles.confirmBtns}>
              <HeadButton label="Cancel" testID="object-cancel" disabled={busyAction !== null} onPress={() => setPending(null)} />
              <HeadButton label={busyAction === pendingAction.id ? `${pendingAction.label}…` : pendingAction.label} danger testID="object-confirm-go" disabled={busyAction !== null} onPress={() => { void confirm(); }} />
            </View>
          </View>
        ) : null}

        {actionError !== null ? <View style={styles.error} role="alert" testID="object-action-error"><Text style={styles.errorText}>{actionError}</Text></View> : null}

        {doneAction !== null ? (
          <View style={styles.done} testID="object-done" role="status">
            <Text style={styles.doneText}>{doneLine(doneAction, name)}</Text>
            {onUndo ? <HeadButton label="Undo" testID="object-undo" onPress={() => { onUndo(doneAction.id); setDone(null); }} /> : null}
          </View>
        ) : null}

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyInner} testID="object-body">
          {props.children}
        </ScrollView>
      </View>

      {sheet ? (
        <View style={[styles.sheet, compact && styles.sheetCompact]} testID="object-sheet" role="complementary" aria-label={props.sheetTitle ?? "Details"}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{props.sheetTitle ?? "Details"}</Text>
            <View style={styles.grow} />
            <Pressable role="button" aria-label="Close" testID="object-sheet-close" onPress={closeSheet} style={styles.more}>
              <MenuIcon icon="x" color="var(--ink-3)" size={15} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>{props.sheet}</ScrollView>
        </View>
      ) : null}
      {menuElement}
    </View>
  );
}

const CHEVRON_RIGHT = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.500L10.500 8 6 12.500"/></svg>';

/** The small arrow at the end of a row that opens something. */
export function ObjectChevron(): ReactElement {
  return <MenuIcon icon={CHEVRON_RIGHT} color="var(--ink-3)" size={14} />;
}

/** A titled group on an object page: "Owns 3" over a card of rows. Pass shared Rows as children. */
export function ObjectSection({ title, count, children, testID }: { title: string; count?: number; children: ReactNode; testID?: string }): ReactElement {
  return (
    <View testID={testID ?? `object-section-${title.toLowerCase().replace(/\s+/g, "-")}`} style={sectionStyles.section}>
      <View style={sectionStyles.head}>
        <Text style={sectionStyles.title} role="heading" aria-level={2}>{title}</Text>
        {count === undefined ? null : <Text style={sectionStyles.count}>{count}</Text>}
      </View>
      <View style={sectionStyles.card}>{children}</View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  section: { gap: 8 },
  head: { flexDirection: "row", alignItems: "baseline", gap: 7, paddingHorizontal: 2 },
  title: { color: "var(--ink)" as string, fontSize: 13.5, fontWeight: "600" },
  count: { color: "var(--ink-3)" as string, fontSize: 12.5 },
  card: { borderRadius: 10, boxShadow: "0 0 0 1px var(--line)" as string, backgroundColor: "var(--raised)" as string, padding: 4 },
});

function HeadButton({ label, onPress, testID, outlined = false, danger = false, disabled = false }: { label: string; onPress: () => void; testID: string; outlined?: boolean; danger?: boolean; disabled?: boolean }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      role="button"
      aria-label={label}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      style={[styles.btn, outlined && styles.btnOutlined, danger && styles.btnDanger, over && !danger && styles.btnOver, disabled && styles.disabled]}
    >
      <Text style={[styles.btnText, danger && styles.btnTextDanger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: "var(--win)" as string },
  main: { flex: 1, minWidth: 0 },
  crumbs: { flexDirection: "row", alignItems: "center", gap: 8, height: 48, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  crumbBtn: { paddingVertical: 4 },
  crumb: { color: "var(--ink-3)" as string, fontSize: 13.5, fontWeight: "500" },
  crumbSep: { color: "var(--ink-4)" as string, fontSize: 13 },
  crumbHere: { color: "var(--ink)" as string, fontSize: 13.5, fontWeight: "600", flexShrink: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 6 },
  headCompact: { paddingTop: 14, gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, overflow: "hidden" },
  titles: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { color: "var(--ink)" as string, fontSize: 20, fontWeight: "600", lineHeight: 26, flexShrink: 1 },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotOk: { backgroundColor: "var(--ok)" as string },
  dotWarn: { backgroundColor: "var(--warn)" as string },
  dotOff: { backgroundColor: "var(--ink-4)" as string },
  statusText: { color: "var(--ink-2)" as string, fontSize: 12.5 },
  sub: { color: "var(--ink-3)" as string, fontSize: 12.5 },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  more: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btn: { height: 28, paddingHorizontal: 11, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnOutlined: { borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnDanger: { backgroundColor: "var(--danger)" as string },
  btnText: { color: "var(--ink)" as string, fontSize: 12.5, fontWeight: "500" },
  btnTextDanger: { color: "#fff" },
  disabled: { opacity: 0.5 },
  tabsBox: { borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, marginHorizontal: 18 },
  tabs: { gap: 20 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, height: 38, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabOn: { borderBottomColor: "var(--ink)" as string },
  tabText: { color: "var(--ink-3)" as string, fontSize: 13.5, fontWeight: "500" },
  tabTextOn: { color: "var(--ink)" as string },
  tabCount: { color: "var(--ink-3)" as string, fontSize: 12 },
  confirm: { margin: 18, marginBottom: 0, padding: 12, borderRadius: 10, backgroundColor: "var(--sunk)" as string, gap: 10 },
  confirmText: { color: "var(--ink)" as string, fontSize: 13, lineHeight: 19 },
  confirmBtns: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  done: { margin: 18, marginBottom: 0, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--sunk)" as string, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  doneText: { color: "var(--ink-2)" as string, fontSize: 12.5 },
  error: { marginHorizontal: 18, marginTop: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, backgroundColor: "var(--danger-bg)" as string },
  errorText: { color: "var(--danger)" as string, fontSize: 12.5 },
  body: { flex: 1 },
  bodyInner: { padding: 18, gap: 18 },
  sheet: { width: 340, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  sheetCompact: { position: "absolute", left: 0, right: 0, bottom: 0, top: 80, width: "auto", borderLeftWidth: 0, borderTopWidth: 1, borderTopColor: "var(--line)" as string, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  sheetHead: { flexDirection: "row", alignItems: "center", height: 44, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  sheetTitle: { color: "var(--ink)" as string, fontSize: 13.5, fontWeight: "600" },
  sheetBody: { padding: 14, gap: 12 },
  grow: { flex: 1 },
});
