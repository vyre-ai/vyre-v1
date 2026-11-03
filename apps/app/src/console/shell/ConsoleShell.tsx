// The Console shell (spec 3.10): a top bar (Space mark and name, "Console", health dot, Cmd-K, Assistant toggle Cmd-J, skin, Open the app, the admin), the left navigation with its groups,
// and the page. Pages hide by permission; a page opened without its permission, or the whole Console without console.access, shows the shared LockedState with Ask for access.
// In the app it is a place in the shell, so `embedded` leaves the shell's own bar, theme and search to the shell. Alone (a phone, or console.<space-address>) it draws its own top bar.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Avatar } from "../../../../../ui/src/Avatar/index.tsx";
import { States } from "../../../../../ui/src/States/index.tsx";
import { LockedState } from "../../../../../ui/src/LockedState/index.tsx";
import type { AskInvoke } from "../../../../../ui/src/LockedState/index.tsx";
import { useMenu } from "../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { skins, system } from "../../../../../ui/src/tokens/skins.ts";
import type { CapMap } from "../../../../../generated/types.ts";
import { Audit } from "../pages/audit/Audit.tsx";
import type { AuditFilter } from "../pages/audit/model.ts";
import { HEALTH_LABEL, HEALTH_TONE, Overview } from "../pages/overview/Overview.tsx";
import { ConsoleDataProvider, useConsoleData, useScreenQuery } from "./data.tsx";
import type { ConsoleData } from "./data.tsx";
import { Dot, Glyph } from "./glyphs.tsx";
import { DEFAULT_PAGE, PAGES, PAGE_NOTE, pageById, visiblePages } from "./nav.ts";
import { OLD_NAMES, landing, nowIn, resolve, sectionOf, visibleSections, visibleTabs } from "./sections.ts";
import type { PageDef } from "./nav.ts";
import { Lead, PageHelpContext, pointer } from "./ui.tsx";
import { Info } from "../../../../../ui/src/Tip/index.tsx";
import { openOnboarding } from "../../onboarding/store.ts";

export const TOP_BAR_HEIGHT = 44;
export const NAV_WIDTH = 232;
export const ASSISTANT_WIDTH = 340;
export const SYSTEM_SKIN = "system";

export interface ConsoleShellProps {
  initialPage?: string;
  renderPage?: (id: string, state: Record<string, unknown>) => ReactNode;
  /** The audit filter or open entry a link arrived with. */
  initialAudit?: { filter?: AuditFilter; open?: string | null };
  /** The open skin's id, or "system". */
  skin?: string;
  onSkin?: (id: string) => void;
  /** The Assistant pane starts open. */
  assistantOpen?: boolean;
  /** What the Assistant pane holds (P-L7b_10 supplies the Cmd-J thread). */
  assistant?: ReactNode;
  /** Sends Ask for access (access.request) from a locked page. */
  invoke?: AskInvoke;
  /** The window width, when the shell knows it before the first layout (and for the tests, which render without a window). */
  width?: number;
  /** Inside the app's shell: no top bar of its own, and Cmd-K stays the shell's. */
  embedded?: boolean;
  /** At the Console's own address there is no app here to open. */
  noApp?: boolean;
}

export function skinMenuEntries(current: string, onSkin: (id: string) => void): MenuEntry[] {
  const out: MenuEntry[] = [{ label: system.name, checked: current === SYSTEM_SKIN, onSelect: () => onSkin(SYSTEM_SKIN) }];
  for (const base of ["dark", "light"] as const) {
    out.push({ head: base === "dark" ? "Dark" : "Light" });
    for (const k of skins) if (k.base === base) out.push({ label: k.name, checked: k.id === current, onSelect: () => onSkin(k.id) });
  }
  return out;
}

export function skinLabel(id: string): string {
  return id === SYSTEM_SKIN ? system.name : skins.find((k) => k.id === id)?.name ?? system.name;
}

export function ConsoleShell(props: ConsoleShellProps): ReactElement {
  const data = useConsoleData();
  if (!data.can("console.access")) {
    return (
      <View style={s.locked} testID="console-locked">
        <LockedState
          resourceType="space" resourceId={data.space.id} title="The Console" reason="role_lacks_permission" level="manage" status="none" canRequest note="" density="regular"
          {...(props.invoke ? { invoke: props.invoke } : {})}
        />
      </View>
    );
  }
  return <ShellBody {...props} />;
}

function ShellBody({ initialPage = DEFAULT_PAGE, initialAudit, skin = SYSTEM_SKIN, onSkin, assistantOpen = false, assistant, invoke, width: given, renderPage, embedded = false, noApp = false }: ConsoleShellProps): ReactElement {
  const data = useConsoleData();
  const measured = useWindowDimensions().width;
  const narrow = (given ?? measured) < 900;
  const [page, setPage] = useState<string>(pageById(resolve(initialPage)) ? resolve(initialPage) : DEFAULT_PAGE);
  const [pageState, setPageState] = useState<Record<string, unknown>>({});
  const [assistantOn, setAssistantOn] = useState(assistantOpen);
  /** The page each section was last on, so a click on a section returns to it. */
  const [lastIn, setLastIn] = useState<Readonly<Record<string, string>>>({});
  const menu = useMenu();
  const searchBtn = useRef<unknown>(null);
  const skinBtn = useRef<unknown>(null);
  const pagesBtn = useRef<unknown>(null);
  const [pageHelps, setPageHelps] = useState<readonly string[]>([]);
  const registerHelp = useCallback((text: string) => { setPageHelps((h) => [...h, text]); return () => setPageHelps((h) => h.filter((x) => x !== text)); }, []);
  const pages = visiblePages(data.can, data.allowedScreens);
  // the dot on Machines: how many alerts the machines have (a disk nearly full, memory pressure, offline with pinned work, a failed backup, an update waiting)
  const [machineAlerts, setMachineAlerts] = useState(0);
  const machinesOpen = pages.some((p) => p.id === "machines");
  useEffect(() => {
    if (!machinesOpen) return undefined;
    let live = true;
    const load = (): void => { void (data.call("network.machine_alerts", {}) as Promise<{ alerts?: unknown[] }>).then((o) => { if (live) setMachineAlerts(o.alerts?.length ?? 0); }, () => undefined); };
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [machinesOpen, data]);
  const def = pageById(page) ?? PAGES[0]!;
  const helpLine = [PAGE_NOTE[def.id], ...pageHelps].filter(Boolean).join(". ");

  const go = useCallback((raw: string, state: Record<string, unknown> = {}): void => {
    const id = resolve(raw);
    const d = pageById(id);
    if (!d) return;
    setPage(id);
    setPageState(state);
    data.nav.openPage(id, state);
    const sec = sectionOf(id);
    if (sec) setLastIn((m) => (m[sec.id] === id ? m : { ...m, [sec.id]: id }));
  }, [data.nav]);
  useEffect(() => { if (pageById(resolve(initialPage))) setPage(resolve(initialPage)); }, [initialPage]);
  // the pages other pages open (a tile, an attention row, the activity list) go through the shell, never around it
  const shellData = { ...data, nav: { ...data.nav, openPage: (id: string, state?: Record<string, unknown>): void => { go(id, state); } } };

  const below = (ref: { current: unknown }): { x: number; y: number } => {
    const box = (ref.current as { getBoundingClientRect?: () => { left: number; bottom: number } } | null)?.getBoundingClientRect?.();
    return { x: box?.left ?? 0, y: (box?.bottom ?? 0) + 4 };
  };
  const openSearch = useCallback((from: { current: unknown } = searchBtn): void => {
    const a = below(from);
    const entries: MenuEntry[] = [{ head: "Go to" }];
    const ok = (p: PageDef): boolean => (data.allowedScreens ? data.allowedScreens.has(p.screen) : data.can(p.needs));
    for (const sec of visibleSections(ok)) {
      entries.push({ separator: true }, { head: sec.title });
      for (const t of visibleTabs(sec, ok)) for (const x of t.views) entries.push({ label: t.views.length > 1 ? `${t.tab.label}: ${x.label}` : t.tab.label, onSelect: () => go(x.page) });
    }
    // names people knew: the search finds them and says where they went
    const old = OLD_NAMES.filter(([, id]) => { const d = pageById(resolve(id)); return d !== undefined && ok(d); });
    if (old.length > 0) { entries.push({ separator: true }, { head: "Old names" }); for (const [name, id] of old) entries.push({ label: `${name}, now in ${nowIn(id)}`, onSelect: () => go(id) }); }
    menu.show(entries, a.x, a.y, "other", { label: "Console search" });
  }, [data, go, menu]);

  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (!doc || embedded) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "k") { e.preventDefault(); openSearch(); }
      if (k === "j") { e.preventDefault(); setAssistantOn((v) => !v); }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [openSearch, embedded]);

  const overview = useScreenQuery<CapMap["console.overview"]["out"]>("console.overview", "overview", {});
  const health = overview.status === "ready" ? overview.data.health : null;

  const ok = (p: PageDef): boolean => (data.allowedScreens ? data.allowedScreens.has(p.screen) : data.can(p.needs));
  const sections = visibleSections(ok);
  const here = sectionOf(page);
  const navRows: ReactElement[] = [];
  for (const sec of sections) {
    if (sec.id === "space") navRows.push(<View key="gap" style={{ height: 12 }} />);
    navRows.push(<Row key={sec.id} id={`nav-${sec.id}`} title={sec.title} selected={here?.id === sec.id} leading={<Lead><Glyph name={sec.icon} size={15} color={here?.id === sec.id ? "var(--ink)" : "var(--ink-3)"} /></Lead>} {...(sec.id === "machines" && machineAlerts > 0 ? { trailing: <View style={s.alertDot} testID="nav-machines-alerts" accessibilityLabel={`${machineAlerts} machine alert${machineAlerts === 1 ? "" : "s"}`}><Text style={s.alertDotText}>{machineAlerts}</Text></View> } : {})} onPress={() => { const to = landing(sec, ok, lastIn[sec.id]); if (to) go(to); }} />);
  }
  const tabs = here ? visibleTabs(here, ok) : [];
  const activeTab = tabs.find((t) => t.views.some((x) => x.page === page));
  const strip = tabs.length > 1 ? (
    <View style={s.tabs} accessibilityRole="tablist" testID="console-tabs">
      {tabs.map((t) => {
        const on = t === activeTab, to = t.views.find((x) => x.page === lastIn[here!.id])?.page ?? t.views[0]!.page;
        return <Pressable key={t.tab.label} accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on} testID={`tab-${t.tab.views[0]!.page}`} onPress={() => go(on ? t.views[0]!.page : to)} style={[s.tab, on && s.tabOn, pointer]}><Text style={[s.tabText, on && s.tabTextOn]}>{t.tab.label}</Text></Pressable>;
      })}
    </View>
  ) : null;
  const views = activeTab && activeTab.views.length > 1 ? (
    <View style={s.views} accessibilityRole="tablist" testID="console-views">
      {activeTab.views.map((x) => <Pressable key={x.page} accessibilityRole="tab" accessibilityState={{ selected: x.page === page }} aria-selected={x.page === page} testID={`view-${x.page}`} onPress={() => go(x.page)} style={[s.view, pointer]}><Text style={[s.viewText, x.page === page && s.viewTextOn]}>{x.label}</Text></Pressable>)}
    </View>
  ) : null;
  const extras = activeTab?.tab.extras?.[page] ?? [];

  const allowed = data.allowedScreens ? data.allowedScreens.has(def.screen) : data.can(def.needs);
  const drawn = (id: string): ReactElement => <>{renderPage?.(id, pageState) ?? <States kind="error" message={`${pageById(id)?.title ?? id} is not implemented in this candidate yet.`} />}</>;
  const body = ((): ReactElement => {
    if (!allowed) {
      return <LockedState resourceType="space" resourceId={data.space.id} title={def.title} reason="role_lacks_permission" level="manage" status="none" canRequest note="" density="regular" {...(invoke ? { invoke } : {})} />;
    }
    if (def.id === "overview") return <Overview />;
    if (def.id === "audit") {
      const filter = (pageState["filter"] as AuditFilter | undefined) ?? initialAudit?.filter;
      const open = (pageState["open"] as string | undefined) ?? initialAudit?.open;
      return <Audit key={JSON.stringify(pageState)} {...(filter ? { initialFilter: filter } : {})} {...(open ? { initialOpen: open } : {})} />;
    }
    return <>{drawn(def.id)}{extras.filter((x) => { const d = pageById(x); return d !== undefined && ok(d); }).map((x) => <View key={x} style={s.extra} testID={`extra-${x}`}>{drawn(x)}</View>)}</>;
  })();

  return (
    <View style={s.frame} testID="console">
      {embedded ? null : <View style={s.top} testID="console-top">
        <Avatar name={data.space.name} kind="space" size={22} />
        <Text numberOfLines={1} style={s.space}>{data.space.name}</Text>
        {narrow ? null : <Text style={s.console}>Console</Text>}
        {health ? <View style={s.health} testID="console-health" accessibilityLabel={`Server ${HEALTH_LABEL[health].toLowerCase()}`}><Dot tone={HEALTH_TONE[health]} size={8} /></View> : null}
        <View style={{ flex: 1 }} />
        <Pressable ref={(r) => { searchBtn.current = r; }} accessibilityRole="button" accessibilityLabel="Search" testID="console-search" onPress={() => openSearch()} style={[s.chip, pointer]}>
          <Glyph name="search" size={14} color="var(--ink-2)" />{narrow ? null : <><Text style={s.chipText}>Search</Text><Text style={s.kbd}>{"⌘"}K</Text></>}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Assistant" accessibilityState={{ selected: assistantOn }} aria-pressed={assistantOn} testID="console-assistant-toggle" onPress={() => setAssistantOn((v) => !v)} style={[s.chip, pointer, assistantOn && s.chipOn]}>
          <Glyph name="assistant" size={14} color={assistantOn ? "var(--accent)" : "var(--ink-2)"} />{narrow ? null : <><Text style={s.chipText}>Assistant</Text><Text style={s.kbd}>{"⌘"}J</Text></>}
        </Pressable>
        <Pressable ref={(r) => { skinBtn.current = r; }} accessibilityRole="button" accessibilityLabel="Skin" testID="console-skin" onPress={() => { const a = below(skinBtn); menu.show(skinMenuEntries(skin, (id) => onSkin?.(id)), a.x, a.y, "other", { label: "Skin" }); }} style={[s.chip, pointer]}>
          {narrow ? <Glyph name="gear" size={14} color="var(--ink-2)" /> : <><Text style={s.chipText}>{skinLabel(skin)}</Text><Glyph name="chevD" size={10} color="var(--ink-4)" /></>}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Setup guide" testID="console-setup-guide" onPress={() => { openOnboarding(); }} style={[s.chip, pointer]}>
          <Glyph name="ok" size={14} color="var(--ink-2)" />{narrow ? null : <Text style={s.chipText}>Setup guide</Text>}
        </Pressable>
        {noApp ? null : <Pressable accessibilityRole="link" accessibilityLabel="Open the app" testID="console-open-app" onPress={() => data.nav.openApp()} style={[s.chip, pointer]}>
          <Glyph name="open" size={14} color="var(--ink-2)" />{narrow ? null : <Text style={s.chipText}>Open the app</Text>}
        </Pressable>}
        <View style={s.admin} testID="console-admin" accessibilityLabel={`${data.me.name}, ${data.me.role}`}><Avatar name={data.me.name} size={22} /></View>
      </View>}
      <View style={s.below}>
        {narrow ? null : <ScrollView style={s.nav} contentContainerStyle={s.navScroll} testID="console-nav" accessibilityLabel="Console navigation">{navRows}</ScrollView>}
        <View style={s.main} testID={`page-${def.id}`} accessibilityLabel={def.title}>
          <View style={s.head}>
            {narrow ? (
              <Pressable ref={(r) => { pagesBtn.current = r; }} accessibilityRole="button" accessibilityLabel={`${def.title}. Go to another page`} testID="console-pages" onPress={() => openSearch(pagesBtn)} style={[s.pages, pointer]}>
                <Text accessibilityRole="header" aria-level={1} style={s.title}>{here?.title ?? def.title}</Text><Glyph name="chevD" size={12} color="var(--ink-3)" />
              </Pressable>
            ) : <Text accessibilityRole="header" aria-level={1} style={s.title}>{here?.title ?? def.title}</Text>}
            {helpLine ? <Info help={helpLine} testID="page-help" /> : null}
            {embedded && health ? <View style={s.health} testID="console-health" accessibilityLabel={`Server ${HEALTH_LABEL[health].toLowerCase()}`}><Dot tone={HEALTH_TONE[health]} size={8} /></View> : null}
            {embedded ? <><View style={{ flex: 1 }} /><Pressable accessibilityRole="button" accessibilityLabel="Setup guide" testID="console-setup-guide" onPress={() => { openOnboarding(); }} style={[s.chip, pointer]}><Glyph name="ok" size={14} color="var(--ink-2)" /><Text style={s.chipText}>Setup guide</Text></Pressable></> : null}
          </View>
          {strip}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}>
            <View style={def.id === "audit" ? s.wide : def.id === "machines" || def.id === "permissions" || def.id === "roles" ? s.machines : s.column}>
              {views}
              <PageHelpContext.Provider value={registerHelp}><ShellDataGate value={shellData}>{body}</ShellDataGate></PageHelpContext.Provider>
            </View>
          </ScrollView>
        </View>
        {assistantOn ? (
          <View style={s.assistant} testID="console-assistant" accessibilityLabel="Assistant">
            {assistant ?? <Text style={s.soon}>Your assistant opens here, with the page you are on as context.</Text>}
          </View>
        ) : null}
      </View>
      {menu.element}
    </View>
  );
}

/** Re-provides the data with the shell's own `openPage`, so every page navigates through the shell. */
function ShellDataGate({ value, children }: { value: ConsoleData; children: ReactNode }): ReactElement {
  return <ConsoleDataProvider value={value}>{children}</ConsoleDataProvider>;
}

const s = StyleSheet.create({
  frame: { flex: 1, backgroundColor: "var(--win)" as string },
  locked: { flex: 1, backgroundColor: "var(--win)" as string },
  top: { height: TOP_BAR_HEIGHT, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, backgroundColor: "var(--rail)" as string, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  space: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1, maxWidth: 220 },
  console: { fontSize: 13.5, color: "var(--ink-3)" as string },
  health: { marginLeft: 2 },
  chip: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, borderRadius: 7 },
  chipOn: { backgroundColor: "var(--accent-wash)" as string },
  chipText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  kbd: { fontSize: 10.5, fontWeight: "500", color: "var(--ink-4)" as string, paddingHorizontal: 4, borderRadius: 4, borderWidth: 1, borderColor: "var(--line-2)" as string },
  admin: { marginLeft: 4 },
  below: { flex: 1, flexDirection: "row", minHeight: 0 },
  nav: { width: NAV_WIDTH, flexGrow: 0, backgroundColor: "var(--side)" as string, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  navScroll: { padding: 8, paddingBottom: 24 },
  indent: { paddingLeft: 10 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 8, marginTop: 6 },
  groupTitle: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string },
  main: { flex: 1, minWidth: 0 },
  pages: { flexDirection: "row", alignItems: "center", gap: 6, height: 32 },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  title: { fontSize: 14.5, fontWeight: "600", color: "var(--ink)" as string },
  content: { padding: 24, alignItems: "center", flexGrow: 1 },
  column: { width: "100%", maxWidth: 960 },
  machines: { width: "100%", maxWidth: 1200 },
  tabs: { flexDirection: "row", gap: 20, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  tab: { height: 38, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent", marginBottom: -1 },
  tabOn: { borderBottomColor: "var(--accent)" as string },
  tabText: { fontSize: 13.5, fontWeight: "500", color: "var(--ink-3)" as string },
  tabTextOn: { color: "var(--ink)" as string },
  views: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginBottom: 18 },
  view: { paddingVertical: 2 },
  viewText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-3)" as string },
  viewTextOn: { color: "var(--ink)" as string },
  extra: { marginTop: 8 },
  alertDot: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "var(--warn)" as string },
  alertDotText: { fontSize: 11, fontWeight: "600", color: "#fff" },
  wide: { width: "100%", maxWidth: 1200, flex: 1, minHeight: 480 },
  soon: { fontSize: 13, color: "var(--ink-3)" as string, padding: 14 },
  assistant: { width: ASSISTANT_WIDTH, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--side)" as string, padding: 14 },
});
