// The Console shell (spec 3.10): a top bar (Space mark and name, "Console", health dot, Cmd-K, Assistant toggle Cmd-J, skin, Open the app, the admin), the left navigation with its groups,
// and the page. Pages hide by permission; a page opened without its permission, or the whole Console without console.access, shows the shared LockedState with Ask for access.
// Runs on the Space's own server (console.<space-address>) and is not linked from the app.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Avatar } from "../../../../ui/src/Avatar/index.tsx";
import { LockedState } from "../../../../ui/src/LockedState/index.tsx";
import type { AskInvoke } from "../../../../ui/src/LockedState/index.tsx";
import { useMenu } from "../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../ui/src/Row/index.tsx";
import { skins } from "../../../../ui/src/tokens/skins.ts";
import type { CapMap } from "../../../../generated/types.ts";
import { Audit } from "../pages/audit/Audit.tsx";
import type { AuditFilter } from "../pages/audit/model.ts";
import { HEALTH_LABEL, HEALTH_TONE, Overview } from "../pages/overview/Overview.tsx";
import { ConsoleDataProvider, useConsoleData, useScreenQuery } from "./data.tsx";
import type { ConsoleData } from "./data.tsx";
import { Dot, Glyph } from "./glyphs.tsx";
import { DEFAULT_PAGE, GROUPS, PAGES, pageById, visiblePages } from "./nav.ts";
import type { PageDef } from "./nav.ts";
import { pointer } from "./ui.tsx";

export const TOP_BAR_HEIGHT = 44;
export const NAV_WIDTH = 232;
export const ASSISTANT_WIDTH = 340;
export const SYSTEM_SKIN = "system";

export interface ConsoleShellProps {
  initialPage?: string;
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
}

export function skinMenuEntries(current: string, onSkin: (id: string) => void): MenuEntry[] {
  const out: MenuEntry[] = [{ label: "System", checked: current === SYSTEM_SKIN, onSelect: () => onSkin(SYSTEM_SKIN) }];
  for (const base of ["dark", "light"] as const) {
    out.push({ head: base === "dark" ? "Dark" : "Light" });
    for (const k of skins) if (k.base === base) out.push({ label: k.name, checked: k.id === current, onSelect: () => onSkin(k.id) });
  }
  return out;
}

export function skinLabel(id: string): string {
  return id === SYSTEM_SKIN ? "System" : skins.find((k) => k.id === id)?.name ?? "System";
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

function ShellBody({ initialPage = DEFAULT_PAGE, initialAudit, skin = SYSTEM_SKIN, onSkin, assistantOpen = false, assistant, invoke, width: given }: ConsoleShellProps): ReactElement {
  const data = useConsoleData();
  const measured = useWindowDimensions().width;
  const narrow = (given ?? measured) < 900;
  const [page, setPage] = useState<string>(pageById(initialPage) ? initialPage : DEFAULT_PAGE);
  const [pageState, setPageState] = useState<Record<string, unknown>>({});
  const [assistantOn, setAssistantOn] = useState(assistantOpen);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set(["Access", pageById(initialPage)?.group ?? ""]));
  const menu = useMenu();
  const searchBtn = useRef<unknown>(null);
  const skinBtn = useRef<unknown>(null);
  const pages = visiblePages(data.can);
  const def = pageById(page) ?? PAGES[0]!;

  const go = useCallback((id: string, state: Record<string, unknown> = {}): void => {
    const d = pageById(id);
    if (!d) return;
    setPage(id);
    setPageState(state);
    if (d.group) setOpenGroups((g) => (g.has(d.group) ? g : new Set([...g, d.group])));
  }, []);
  // the pages other pages open (a tile, an attention row, the activity list) go through the shell, never around it
  const shellData = { ...data, nav: { ...data.nav, openPage: (id: string, state?: Record<string, unknown>): void => { go(id, state); data.nav.openPage(id, state); } } };

  const below = (ref: { current: unknown }): { x: number; y: number } => {
    const box = (ref.current as { getBoundingClientRect?: () => { left: number; bottom: number } } | null)?.getBoundingClientRect?.();
    return { x: box?.left ?? 0, y: (box?.bottom ?? 0) + 4 };
  };
  const openSearch = useCallback((): void => {
    const a = below(searchBtn);
    const entries: MenuEntry[] = [{ head: "Go to" }, ...visiblePages(data.can).map((p): MenuEntry => ({ label: p.title, onSelect: () => go(p.id) }))];
    menu.show(entries, a.x, a.y, "other", { label: "Console search" });
  }, [data, go, menu]);

  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: KeyboardEvent) => void): void; removeEventListener(t: string, f: (e: KeyboardEvent) => void): void } }).document;
    if (!doc) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "k") { e.preventDefault(); openSearch(); }
      if (k === "j") { e.preventDefault(); setAssistantOn((v) => !v); }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [openSearch]);

  const overview = useScreenQuery<CapMap["console.overview"]["out"]>("console.overview", "overview", {});
  const health = overview.status === "ready" ? overview.data.health : null;

  const navRows: ReactElement[] = [];
  const pushPage = (p: PageDef, indent: boolean): void => {
    navRows.push(<View key={p.id} style={indent ? s.indent : undefined}><Row id={`nav-${p.id}`} title={p.title} selected={page === p.id} leading={<Glyph name={p.icon} size={15} color={page === p.id ? "var(--ink)" : "var(--ink-3)"} />} onPress={() => go(p.id)} /></View>);
  };
  for (const p of pages.filter((x) => x.group === "" && x.id === "overview")) pushPage(p, false);
  for (const g of GROUPS) {
    const inGroup = pages.filter((x) => x.group === g);
    if (inGroup.length === 0) continue;
    const open = openGroups.has(g);
    navRows.push(
      <Pressable key={`g-${g}`} accessibilityRole="button" accessibilityLabel={g} accessibilityState={{ expanded: open }} testID={`navgroup-${g}`} onPress={() => setOpenGroups((cur) => { const n = new Set(cur); if (n.has(g)) n.delete(g); else n.add(g); return n; })} style={[s.groupHead, pointer]}>
        <View style={{ transform: [{ rotate: open ? "0deg" : "-90deg" }] }}><Glyph name="chevD" size={11} color="var(--ink-4)" /></View>
        <Text style={s.groupTitle}>{g}</Text>
      </Pressable>,
    );
    if (open) for (const p of inGroup) pushPage(p, true);
  }
  for (const p of pages.filter((x) => x.group === "" && x.id !== "overview")) pushPage(p, false);

  const allowed = data.can(def.needs);
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
    return <Text style={s.soon} testID="page-soon">{def.title} opens here.</Text>;
  })();

  return (
    <View style={s.frame} testID="console">
      <View style={s.top} testID="console-top">
        <Avatar name={data.space.name} kind="space" size={22} />
        <Text numberOfLines={1} style={s.space}>{data.space.name}</Text>
        <Text style={s.console}>Console</Text>
        {health ? <View style={s.health} testID="console-health" accessibilityLabel={`Server ${HEALTH_LABEL[health].toLowerCase()}`}><Dot tone={HEALTH_TONE[health]} size={8} /></View> : null}
        <View style={{ flex: 1 }} />
        <Pressable ref={(r) => { searchBtn.current = r; }} accessibilityRole="button" accessibilityLabel="Search" testID="console-search" onPress={openSearch} style={[s.chip, pointer]}>
          <Glyph name="search" size={14} color="var(--ink-2)" />{narrow ? null : <><Text style={s.chipText}>Search</Text><Text style={s.kbd}>{"⌘"}K</Text></>}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Assistant" accessibilityState={{ selected: assistantOn }} testID="console-assistant-toggle" onPress={() => setAssistantOn((v) => !v)} style={[s.chip, pointer, assistantOn && s.chipOn]}>
          <Glyph name="assistant" size={14} color={assistantOn ? "var(--accent)" : "var(--ink-2)"} />{narrow ? null : <><Text style={s.chipText}>Assistant</Text><Text style={s.kbd}>{"⌘"}J</Text></>}
        </Pressable>
        <Pressable ref={(r) => { skinBtn.current = r; }} accessibilityRole="button" accessibilityLabel="Skin" testID="console-skin" onPress={() => { const a = below(skinBtn); menu.show(skinMenuEntries(skin, (id) => onSkin?.(id)), a.x, a.y, "other", { label: "Skin" }); }} style={[s.chip, pointer]}>
          {narrow ? <Glyph name="gear" size={14} color="var(--ink-2)" /> : <><Text style={s.chipText}>{skinLabel(skin)}</Text><Glyph name="chevD" size={10} color="var(--ink-4)" /></>}
        </Pressable>
        <Pressable accessibilityRole="link" accessibilityLabel="Open the app" testID="console-open-app" onPress={() => data.nav.openApp()} style={[s.chip, pointer]}>
          <Glyph name="open" size={14} color="var(--ink-2)" />{narrow ? null : <Text style={s.chipText}>Open the app</Text>}
        </Pressable>
        <View style={s.admin} testID="console-admin" accessibilityLabel={`${data.me.name}, ${data.me.role}`}><Avatar name={data.me.name} size={22} /></View>
      </View>
      <View style={s.below}>
        {narrow ? null : <ScrollView style={s.nav} contentContainerStyle={s.navScroll} testID="console-nav" accessibilityLabel="Console navigation">{navRows}</ScrollView>}
        <View style={s.main} testID={`page-${def.id}`} accessibilityLabel={def.title}>
          <View style={s.head}><Text accessibilityRole="header" aria-level={1} style={s.title}>{def.title}</Text></View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}>
            <View style={def.id === "audit" ? s.wide : s.column}>
              <ShellDataGate value={shellData}>{body}</ShellDataGate>
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
  head: { height: 48, justifyContent: "center", paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  title: { fontSize: 14.5, fontWeight: "600", color: "var(--ink)" as string },
  content: { padding: 24, alignItems: "center", flexGrow: 1 },
  column: { width: "100%", maxWidth: 960 },
  wide: { width: "100%", maxWidth: 1200, flex: 1, minHeight: 480 },
  soon: { fontSize: 13, color: "var(--ink-3)" as string, padding: 14 },
  assistant: { width: ASSISTANT_WIDTH, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--side)" as string, padding: 14 },
});
