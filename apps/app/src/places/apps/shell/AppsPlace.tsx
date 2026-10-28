// The Apps place (spec 3.6): a sidebar of five groups (Sites, Forms, Campaigns, Templates, Sending domains) with a search and one New menu, and the selected group's list in the main view. The
// lists are live queries over the kept copy (generated/screens.ts: apps.sites, apps.forms, apps.campaigns, apps.templates). A row opens its own screen (P-L9e_06 to P-L9e_09 mount there);
// its menu and the hover buttons act on it with one capability call: Publish a form, Launch a campaign, Install a template. Launch and Publish go through Gate, so the line says when they wait
// for a yes. In a Personal Space the place says it needs a Team Space. Click selects, double click or Enter opens, right-click and the More button open the menu.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { NeedsTeamSpace } from "../../../../../../ui/src/NeedsTeamSpace/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { openKitBuilder, runAction } from "./actions.ts";
import { AppsDataProvider, useAppsData, useOptionalAppsData, useScreenQuery } from "./data.tsx";
import type { AppsData } from "./data.tsx";
import { AppsSurface } from "./Surfaces.tsx";
import { ACTION_LABEL, GROUPS, NEEDS_YES, actionsFor, campaignRow, domainRow, formRow, groupOf, matches, siteRow, templateRow } from "./model.ts";
import type { AppRow, DomainRow, GroupKey, RowAction } from "./model.ts";

export { AppsDataProvider } from "./data.tsx";
export type { AppsData, AppsNav } from "./data.tsx";

export type AppsRoute =
  | { kind: "list"; group?: GroupKey | undefined }
  | { kind: "detail"; group: Exclude<GroupKey, "sites">; id: string }
  | { kind: "create"; group: "forms" | "campaigns" | "templates" | "domains" };

const ROW_HEIGHT = 44;
const DOUBLE_MS = 450;
export const WIDE = 760;
type Lists = Record<GroupKey, { rows: readonly AppRow[]; ready: boolean; error?: string }>;

function useLists(): Lists {
  const d = useAppsData();
  const sites = useScreenQuery<CapMap["sites.list"]["out"]>("apps.sites", "sites", {}, !(d.deferred ?? []).includes("sites"));
  const forms = useScreenQuery<CapMap["forms.list"]["out"]>("apps.forms", "forms", {});
  const campaigns = useScreenQuery<CapMap["campaigns.list"]["out"]>("apps.campaigns", "campaigns", {});
  const templates = useScreenQuery<CapMap["templates.list"]["out"]>("apps.templates", "templates", {});
  const [domains, setDomains] = useState<readonly DomainRow[] | null>(null);
  const [domainError, setDomainError] = useState<string | undefined>();
  useEffect(() => {
    let live = true;
    void (d.call("mail.domain.list", {}) as Promise<{ domains: DomainRow[] }>).then((o) => { if (live) setDomains(o.domains); }).catch((error: unknown) => { if (live) setDomainError(error instanceof Error ? error.message : "Could not load sending domains. Check your access and connection."); });
    return () => { live = false; };
  }, [d]);
  return useMemo(() => {
    const rows = <T,>(q: { status: string; data?: unknown; error?: { message: string } }, pick: (o: never) => T[], map: (x: T) => AppRow): { rows: AppRow[]; ready: boolean; error?: string } => {
      const out: AppRow[] = [];
      if (q.status === "ready") for (const x of pick(q.data as never)) out.push(map(x));
      return { rows: out, ready: q.status === "ready", ...(q.error ? { error: q.error.message } : {}) };
    };
    const dom: AppRow[] = [];
    for (const x of domains ?? []) dom.push(domainRow(x));
    return {
      sites: rows(sites, (o: CapMap["sites.list"]["out"]) => [...o.sites], siteRow), forms: rows(forms, (o: CapMap["forms.list"]["out"]) => [...o.forms], formRow),
      campaigns: rows(campaigns, (o: CapMap["campaigns.list"]["out"]) => [...o.campaigns], campaignRow), templates: rows(templates, (o: CapMap["templates.list"]["out"]) => [...o.templates], templateRow),
      domains: { rows: dom, ready: domains !== null, ...(domainError ? { error: domainError } : {}) },
    };
  }, [sites, forms, campaigns, templates, domains, domainError]);
}

function Page({ initial, route = { kind: "list" } }: { initial?: AppsStart | undefined; route?: AppsRoute | undefined }): ReactElement {
  const d = useAppsData();
  const { width } = useWindowDimensions();
  const wide = width === 0 || width >= WIDE;
  const lists = useLists();
  const groups = GROUPS.filter((g) => !(d.deferred ?? []).includes(g.key));
  const { element, show } = useMenu();
  const [group, setGroup] = useState<GroupKey>(route.group && !(d.deferred ?? []).includes(route.group) ? route.group : initial?.group && !(d.deferred ?? []).includes(initial.group) ? initial.group : "forms");
  const [selected, setSelected] = useState<string | null>(initial?.selected ?? null);
  const [q, setQ] = useState(initial?.q ?? "");
  const [closed, setClosed] = useState<ReadonlySet<GroupKey>>(new Set(initial?.closed ?? []));
  const [note, setNote] = useState<{ text: string; taskId?: string } | null>(null);
  const [showList, setShowList] = useState(wide || initial?.open === true);
  const last = useRef<{ id: string; at: number } | null>(null);
  const search = useRef<{ focus?: () => void } | null>(null);

  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  const perform = useCallback((action: RowAction, row: AppRow): void => {
    if (["publish", "launch", "install"].includes(action)) { d.nav.open(row.group, row.id); return; }
    runAction(d, action, row).then((r) => { if (r.text) setNote(r.taskId ? { text: r.text, taskId: r.taskId } : { text: r.text }); }).catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : "That did not work." }));
  }, [d]);
  const menuFor = (row: AppRow, x: number, y: number): void => {
    const entries: MenuEntry[] = [];
    for (const a of actionsFor(row)) entries.push({ label: NEEDS_YES.has(a) ? `${ACTION_LABEL[a]}…` : ACTION_LABEL[a], onSelect: () => perform(a, row) });
    show(entries, x, y, "context", { label: row.title });
  };
  const newMenu = (x: number, y: number, only?: GroupKey): void => {
    const entries: MenuEntry[] = [];
    if (only === undefined || only === "templates") entries.push({ label: "Save as template", onSelect: () => d.nav.create("templates") });
    for (const g of groups) if ((only === undefined || only === g.key) && (g.key === "forms" || g.key === "campaigns" || g.key === "domains")) entries.push({ label: g.key === "domains" ? "Add sending domain" : `New ${g.one}`, onSelect: () => d.nav.create(g.key) });
    if (only === undefined || only === "templates") entries.push({ separator: true }, { label: "Build a Kit with an agent", onSelect: () => void openKitBuilder(d).catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : "That did not work." })) });
    show(entries, x, y, "other");
  };
  const press = (row: AppRow): void => {
    const now = Date.now();
    const again = last.current && last.current.id === row.id && now - last.current.at < DOUBLE_MS;
    last.current = { id: row.id, at: now };
    setSelected(row.id); setGroup(row.group);
    if (again) d.nav.open(row.group, row.id);
    if (!wide) setShowList(true);
  };

  if (!d.team) {
    return <View style={s.page} testID="apps-needs-team"><View style={s.center}><NeedsTeamSpace density="regular" what="Sites, forms and campaigns" onAction={d.nav.joinTeam} /></View></View>;
  }

  const rowsOf = (g: GroupKey): AppRow[] => { const out: AppRow[] = []; for (const r of lists[g].rows) if (matches(r, q)) out.push(r); return out; };
  const side: ReactElement[] = [];
  for (const g of groups) {
    const rows = rowsOf(g.key);
    const open = !closed.has(g.key);
    side.push(
      <View key={g.key} testID={`apps-group-${g.key}`}>
        <Pressable
          accessibilityRole="button" accessibilityState={{ expanded: open }} aria-expanded={open} accessibilityLabel={`${g.title}, ${rows.length}`} testID={`apps-head-${g.key}`}
          onPress={() => { setGroup(g.key); setClosed((c) => { const n = new Set(c); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; }); }}
          style={(state) => [s.gh, (state as { hovered?: boolean }).hovered === true && s.over]}
        >
          <View style={open ? undefined : s.shut}><Text style={s.chev}>{"▾"}</Text></View>
          <Text style={[s.gt, group === g.key && s.gtOn]}>{g.title}</Text>
          <Text style={s.gn}>{rows.length}</Text>
        </Pressable>
        {open ? sideRows(g.key, rows) : null}
      </View>,
    );
  }
  function sideRows(g: GroupKey, rows: AppRow[]): ReactElement[] {
    const out: ReactElement[] = [];
    for (const r of rows.slice(0, 6)) out.push(<View key={r.id} {...menuTrigger((x, y) => menuFor(r, x, y))}><Row id={`nav:${r.id}`} title={r.title} selected={selected === r.id} onPress={() => press(r)} /></View>);
    if (rows.length > 6) out.push(<Pressable key="more" accessibilityRole="button" testID={`apps-more-${g}`} onPress={() => { setGroup(g); setSelected(null); }}><Text style={s.more}>{`Show all ${rows.length}`}</Text></Pressable>);
    return out;
  }

  const line = (r: AppRow): ReactElement => (

              <View {...menuTrigger((x, y) => menuFor(r, x, y))} style={s.rowWrap}>
                <Row
                  id={r.id} title={r.title} note={r.note} selected={selected === r.id} onPress={() => press(r)}
                  trailing={<View style={s.trail}>{r.count ? <Text style={s.count}>{r.count}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel={`More for ${r.title}`} testID={`more-${r.id}`} onPress={(e) => { const p = pointOf(e); menuFor(r, p.x, p.y); }} style={s.more2}><Text style={s.moreText}>{"···"}</Text></Pressable></View>}
                />
              </View>
  );
  const cur = lists[group];
  const rows = rowsOf(group);
  const g = groupOf(group);
  const main = (
    <View style={s.main} testID="apps-main">
      <View style={s.mh}>
        {!wide ? <Pressable accessibilityRole="button" accessibilityLabel="Back to the groups" testID="apps-back" onPress={() => setShowList(false)}><Text style={s.back}>{"‹ Apps"}</Text></Pressable> : null}
        <Text accessibilityRole="header" style={s.mt} testID="apps-title">{g.title}</Text>
        <Text style={s.mc}>{rows.length}</Text>
        <View style={s.grow} />
        {group === "templates" ? <Pressable accessibilityRole="button" testID="apps-kit" onPress={() => void openKitBuilder(d).catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : "That did not work." }))} style={(state) => [s.btn, (state as { hovered?: boolean }).hovered === true && s.over]}><Text style={s.btnText}>Build a Kit</Text></Pressable> : null}
        {group === "forms" || group === "campaigns" || group === "domains" ? <Pressable accessibilityRole="button" accessibilityLabel={group === "domains" ? "Add sending domain" : `New ${g.one}`} testID="apps-new-group" onPress={(e) => { const p = pointOf(e); newMenu(p.x, p.y, group); }} style={(state) => [s.btn, s.btnPrimary, (state as { hovered?: boolean }).hovered === true && s.over]}><Text style={[s.btnText, s.btnPrimaryText]}>{group === "domains" ? "Add domain" : `New ${g.one}`}</Text></Pressable> : null}
      </View>
      {cur.error ? <States kind="error" message={cur.error} /> : !cur.ready ? <View testID="apps-loading" style={s.skeleton}>{skeleton()}</View> : rows.length === 0 ? (
        <View style={s.empty} testID="apps-empty"><States kind="empty" title={q ? `Nothing matches ${q}` : g.empty} icon="search" /></View>
      ) : (
        <VirtualList
          data={rows} rowHeight={ROW_HEIGHT} keyOf={(r) => (r as AppRow).id}
          renderItem={(raw) => line(raw as AppRow)}
        />
      )}
      {note ? (
        <View style={s.note} accessibilityRole="alert" testID="apps-note">
          <Text style={s.noteText}>{note.text}</Text>
          {note.taskId ? <Pressable accessibilityRole="button" testID="apps-note-open" onPress={() => d.nav.openTask(note.taskId!)}><Text style={s.noteLink}>Open the request</Text></Pressable> : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={s.page} testID="apps-place">
      {wide || !showList ? (
        <View style={[s.side, wide ? s.sideWide : s.sideFull]} testID="apps-sidebar" accessibilityRole="menu" accessibilityLabel="Apps">
          <View style={s.sh}>
            <Text accessibilityRole="header" style={s.title}>Apps</Text>
            <View style={s.grow} />
            <Pressable accessibilityRole="button" accessibilityLabel="New" testID="apps-new" onPress={(e) => { const p = pointOf(e); newMenu(p.x, p.y); }} style={(state) => [s.ib, (state as { hovered?: boolean }).hovered === true && s.over]}><Text style={s.plus}>+</Text></Pressable>
          </View>
          <View style={s.search}>
            <TextInput ref={(r) => { search.current = r as unknown as { focus?: () => void } | null; }} value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor="var(--ink-3)" accessibilityLabel="Search Apps" testID="apps-search" style={s.searchInput} />
          </View>
          <View style={s.groups}>{side}</View>
        </View>
      ) : null}
      {route.kind !== "list" ? <AppsSurface route={route} /> : wide || showList ? main : null}
      {element}
    </View>
  );
}

function pointOf(e: unknown): { x: number; y: number } {
  const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
  const r = ev.currentTarget?.getBoundingClientRect?.();
  return r ? { x: r.left, y: r.bottom + 4 } : { x: ev.nativeEvent?.pageX ?? 0, y: ev.nativeEvent?.pageY ?? 0 };
}
function skeleton(): ReactElement[] {
  const out: ReactElement[] = [];
  for (let i = 0; i < 6; i++) out.push(<View key={i} style={s.skRow} />);
  return out;
}

export interface AppsStart { group?: GroupKey; selected?: string; q?: string; closed?: readonly GroupKey[]; /** On a phone: start on the list rather than the groups. */ open?: boolean }

/** Without data the place draws its frame: the sidebar's title and the main view's blank, the size of the real ones. */
export function AppsLoading(): ReactElement {
  return <View style={s.page} testID="apps-loading-frame"><View style={[s.side, s.sideWide]}><View style={s.sh}><Text accessibilityRole="header" style={s.title}>Apps</Text></View></View><View style={s.main}><View style={s.skeleton}>{skeleton()}</View></View></View>;
}

export default function AppsLayout({ data, start, route }: { data?: AppsData | undefined; start?: AppsStart | undefined; route?: AppsRoute | undefined }): ReactElement {
  const provided = useOptionalAppsData();
  const v = data ?? provided;
  if (!v) return <AppsLoading />;
  if (!v.team) return <View style={s.page} testID="apps-needs-team"><View style={s.center}><NeedsTeamSpace density="regular" what="Forms and campaigns" onAction={v.nav.joinTeam} /></View></View>;
  return <AppsDataProvider value={v}>{route && route.kind !== "list" ? <AppsSurface route={route} /> : <Page initial={start} route={route} />}</AppsDataProvider>;
}
const s = StyleSheet.create({
  page: { flex: 1, flexDirection: "row", minHeight: 0, backgroundColor: "var(--win)" as string },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  side: { minHeight: 0, borderRightWidth: 1, borderRightColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  sideWide: { width: 260, flexShrink: 0 },
  sideFull: { flex: 1, borderRightWidth: 0 },
  sh: { height: 52, flexDirection: "row", alignItems: "center", paddingLeft: 18, paddingRight: 10 },
  title: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2, color: "var(--ink)" as string },
  grow: { flex: 1 },
  ib: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  plus: { fontSize: 18, color: "var(--ink-2)" as string },
  over: { backgroundColor: "var(--hover)" as string },
  search: { paddingHorizontal: 12, paddingBottom: 8 },
  searchInput: { height: 30, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "var(--sel)" as string, fontSize: 13, color: "var(--ink)" as string },
  groups: { paddingHorizontal: 8, paddingBottom: 12 },
  gh: { height: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 6, marginTop: 8 },
  shut: { transform: [{ rotate: "-90deg" }] },
  chev: { fontSize: 10, color: "var(--ink-3)" as string },
  gt: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string, flex: 1 },
  gtOn: { color: "var(--ink)" as string },
  gn: { fontSize: 12, color: "var(--ink-3)" as string },
  more: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 12, paddingVertical: 6 },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  mh: { height: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20 },
  back: { fontSize: 13, color: "var(--accent)" as string },
  mt: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2, color: "var(--ink)" as string },
  mc: { fontSize: 13, color: "var(--ink-3)" as string },
  btn: { height: 28, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center" },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink-2)" as string },
  btnPrimary: { backgroundColor: "var(--accent)" as string },
  btnPrimaryText: { color: "var(--accent-ink)" as string },
  rowWrap: { width: "100%", paddingHorizontal: 8 },
  trail: { flexDirection: "row", alignItems: "center", gap: 8 },
  count: { fontSize: 12, color: "var(--ink-3)" as string },
  more2: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  moreText: { fontSize: 14, color: "var(--ink-3)" as string, letterSpacing: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  skeleton: { paddingHorizontal: 20, paddingTop: 8 },
  skRow: { height: 32, marginBottom: 12, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  note: { position: "absolute", left: 20, bottom: 16, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" } as object,
  noteText: { fontSize: 12.5, color: "var(--ink)" as string },
  noteLink: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
});
