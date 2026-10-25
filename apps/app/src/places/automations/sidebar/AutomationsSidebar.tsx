// The Automations sidebar (spec 3.7): tabs Automations and Journeys, a search box ("/" focuses it), the Failed runs row, then Needs you, Personal, Shared with me, Space and Running.
// Personal and Space hold Groups that open and close; every row is a ui/Row with its leading and trailing slots (ruling 36). Right-click, the ... button and Shift-F10 open the row menu.
// (ListSections cannot carry counts, open Groups, a plus on its header or the Failed runs and Needs you rows the prototype shows, so the sections are drawn here from the same Row.)
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { SIDEBAR, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import { Glyph } from "../canvas/icons.tsx";
import { Badge, Dot, IconButton, SubTabs, pointer, webOnly } from "../canvas/parts.tsx";
import type { KeyEventLike } from "../canvas/parts.tsx";
import { allGroupKeys, failedTotal, journeyNote, nextId, noteOf, sectionsOf, visibleOrder } from "./model.ts";
import type { AutoRow, GroupBlock, GroupRow, JourneyRow, Section, SectionKey } from "./model.ts";

type ListOut = CapMap["automations.list"]["out"];
type GroupsOut = CapMap["automations.groups.list"]["out"];
type JourneysOut = CapMap["journeys.list"]["out"];

export type SidebarTab = "automations" | "journeys";

export interface SidebarProps {
  selectedId?: string | null;
  initialTab?: SidebarTab;
  /** Automations other people own that were shared with this person. */
  shared?: ReadonlySet<string>;
  /** Why an Automation needs attention, in a few words ("Needs the Twilio key"), by id. */
  reasons?: Readonly<Record<string, string>>;
  initialOpen?: readonly string[];
}

const EMPTY: readonly string[] = [];

export function AutomationsSidebar({ selectedId = null, initialTab = "automations", shared, reasons, initialOpen = EMPTY }: SidebarProps): ReactElement {
  const data = useAutomationsData();
  const [tab, setTab] = useState<SidebarTab>(initialTab);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(initialOpen));
  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionKey>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { element, show } = useMenu();
  const search = useRef<{ focus?: () => void } | null>(null);
  const list = useScreenQuery<ListOut>(SIDEBAR, "automations", {});
  const groupsQ = useScreenQuery<GroupsOut>(SIDEBAR, "groups", {});
  const journeysQ = useScreenQuery<JourneysOut>(SIDEBAR, "journeys", {});
  const autos: readonly AutoRow[] = list.status === "ready" ? list.data.automations : [];
  const groups: readonly GroupRow[] = groupsQ.status === "ready" ? groupsQ.data.groups : [];
  const journeys: readonly JourneyRow[] = journeysQ.status === "ready" ? journeysQ.data.journeys : [];
  const sections = useMemo(() => sectionsOf(autos, groups, { me: data.me.id, q, ...(shared ? { shared } : {}), ...(reasons ? { reasons } : {}) }), [autos, groups, data.me.id, q, shared, reasons]);
  const order = useMemo(() => visibleOrder(sections, q ? allGroupKeys(sections) : open, collapsed), [sections, open, collapsed, q]);
  const failed = failedTotal(autos);

  useEffect(() => { if (!note) return undefined; const t = setTimeout(() => setNote(null), 4000); return () => clearTimeout(t); }, [note]);

  const fail = (e: unknown): void => setNote(e instanceof Error ? e.message : "That did not work.");
  const create = async (groupId?: string): Promise<void> => {
    try {
      const out = (await data.call("automations.create", { name: "New automation", ...(groupId ? { groupId } : {}) })) as { automation?: { id: string } };
      if (out?.automation?.id) data.nav.openAutomation(out.automation.id);
    } catch (e) { fail(e); }
  };
  const createGroup = async (): Promise<void> => {
    try { await data.call("automations.groups.create", { name: "New group" }); } catch (e) { fail(e); }
  };
  const toggleGroup = (key: string): void => setOpen((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleSection = (key: SectionKey): void => setCollapsed((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const rowMenu = (a: AutoRow, x: number, y: number): void => {
    const move: MenuEntry[] = [{ head: "Move to a group" }];
    for (const g of groups) move.push({ label: g.name, checked: a.groupId === g.id, onSelect: () => void data.call("automations.move", { automationId: a.id, groupId: g.id }).catch(fail) });
    move.push({ label: "No group", checked: !a.groupId, onSelect: () => void data.call("automations.move", { automationId: a.id }).catch(fail) });
    show([
      { label: "Open", onSelect: () => data.nav.openAutomation(a.id) },
      { label: "Move to a group", onSelect: () => show(move, x, y, "other") },
      ...(a.failedRuns > 0 ? [{ label: "Open failed runs", onSelect: () => data.nav.openFailedRuns() }] : []),
      { separator: true },
      { label: "Move to Trash", danger: true, onSelect: () => show([{ head: "Move this Automation to Trash?" }, { label: "Move to Trash", danger: true, onSelect: () => void data.call("automations.delete", { automationId: a.id }).catch(fail) }, { label: "Cancel" }], x, y, "other") },
    ], x, y, "context", { label: a.name });
  };
  const groupMenu = (g: GroupBlock, x: number, y: number): void => {
    show([
      { label: "New automation in this group", onSelect: () => void create(g.id) },
      { label: "Rename", onSelect: () => setRenaming({ id: g.id, name: g.name }) },
      { separator: true },
      { label: "Delete group", danger: true, onSelect: () => show([{ head: "Delete this Group? Its Automations stay." }, { label: "Delete group", danger: true, onSelect: () => void data.call("automations.groups.delete", { groupId: g.id }).catch(fail) }, { label: "Cancel" }], x, y, "other") },
    ], x, y, "context", { label: g.name });
  };
  const plusMenu = (x: number, y: number): void => {
    show([{ label: "New automation", onSelect: () => void create() }, { label: "New group", onSelect: () => void createGroup() }], x, y, "other");
  };
  const commitRename = async (): Promise<void> => {
    const r = renaming;
    setRenaming(null);
    if (!r || !r.name.trim()) return;
    try { await data.call("automations.groups.rename", { groupId: r.id, name: r.name.trim() }); } catch (e) { fail(e); }
  };

  const onKey = (e: KeyEventLike): void => {
    const k = e.key ?? "";
    if (k === "/" && focusId !== "search") { e.preventDefault?.(); search.current?.focus?.(); return; }
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault?.();
      const to = nextId(order, focusId, k === "ArrowDown" ? 1 : -1);
      if (to) { setFocusId(to); focusRow(to); }
      return;
    }
    if (k === "ArrowRight" || k === "ArrowLeft") {
      if (focusId?.startsWith("group:")) { e.preventDefault?.(); const key = focusId.slice(6); const isOpen = open.has(key); if ((k === "ArrowRight") !== isOpen) toggleGroup(key); }
      return;
    }
    if (k === "Enter" && focusId) {
      e.preventDefault?.();
      if (focusId.startsWith("group:")) toggleGroup(focusId.slice(6));
      else { const id = focusId.slice(focusId.indexOf(":") + 1); data.nav.openAutomation(id); }
    }
  };

  const body: ReactElement[] = [];
  if (tab === "automations") {
    for (const s of sections) body.push(renderSection(s));
  }
  function renderSection(s: Section): ReactElement {
    const isCollapsed = collapsed.has(s.key);
    const parts: ReactElement[] = [];
    if (!isCollapsed) {
      for (const a of s.loose) parts.push(autoRow(s.key, a, 0));
      for (const g of s.groups) {
        const key = `${s.key}:${g.id}`;
        const isOpen = q !== "" || open.has(key);
        parts.push(
          <View key={`group-${key}`} {...menuTrigger((x, y) => groupMenu(g, x, y))}>
            {renaming?.id === g.id ? (
              <View style={sb.rename}>
                <TextInput accessibilityLabel="Group name" testID={`rename-${g.id}`} autoFocus value={renaming.name} onChangeText={(t) => setRenaming({ id: g.id, name: t })} onBlur={() => void commitRename()} onSubmitEditing={() => void commitRename()} style={sb.renameInput} />
              </View>
            ) : (
              <Row
                id={`group-${key}`} title={g.name} selected={focusId === `group:${key}`} onPress={() => { setFocusId(`group:${key}`); toggleGroup(key); }}
                leading={<View style={sb.chev}><Glyph name={isOpen ? "chevD" : "chevR"} size={11} color="var(--ink-3)" /><Glyph name="folder" size={15} color="var(--ink-3)" /></View>}
                trailing={<View style={sb.tr}>{g.failed > 0 ? <View style={sb.fail}><Dot tone="danger" size={6} /><Text style={sb.failN}>{g.failed}</Text></View> : null}<Text style={sb.n}>{String(g.rows.length)}</Text></View>}
              />
            )}
          </View>,
        );
        if (isOpen) for (const a of g.rows) parts.push(autoRow(s.key, a, 1));
      }
    }
    return (
      <View key={`section-${s.key}`} testID={`section-${s.key}`} accessibilityLabel={s.title} style={sb.section}>
        <View style={sb.sHead}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${s.title}, ${isCollapsed ? "closed" : "open"}`} accessibilityState={{ expanded: !isCollapsed }} testID={`head-${s.key}`} onPress={() => toggleSection(s.key)} style={[sb.sHeadBtn, pointer]}>
            <Glyph name={isCollapsed ? "chevR" : "chevD"} size={11} color="var(--ink-3)" />
            <Text accessibilityRole="header" style={sb.sTitle}>{s.title}</Text>
            <Text style={sb.sCount}>{String(s.count)}</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          {s.canAdd ? <IconButton icon="plus" label={`Add to ${s.title}`} size={22} testID={`add-${s.key}`} onPress={() => plusMenu(-1, -1)} /> : null}
        </View>
        {parts}
      </View>
    );
  }
  function autoRow(section: SectionKey, a: AutoRow, depth: 0 | 1): ReactElement {
    const rid = `${section}:${a.id}`;
    const tone = a.failedRuns > 0 ? "danger" : a.status === "paused" || section === "needs" && a.status !== "on" ? "warn" : a.status === "on" ? "ok" : "muted";
    const waiting = a.lastRun?.status === "waiting";
    return (
      <View key={`auto-${rid}`} {...menuTrigger((x, y) => rowMenu(a, x, y))} {...webOnly({ dataSet: { row: rid } })}>
        <Row
          id={`auto-${rid}`} title={a.name} note={noteOf(a, reasons)} selected={selectedId === a.id || focusId === rid}
          onPress={() => { setFocusId(rid); data.nav.openAutomation(a.id); }}
          leading={<View style={[sb.lead, depth === 1 && { marginLeft: 20 }]}><Dot tone={tone} /></View>}
          trailing={<Glyph name={waiting ? "clock" : "bolt"} size={13} color="var(--ink-3)" />}
        />
      </View>
    );
  }

  const journeyRows: ReactElement[] = [];
  for (const j of journeys) {
    if (q && !j.name.toLowerCase().includes(q.trim().toLowerCase())) continue;
    journeyRows.push(<Row key={j.id} id={`journey-${j.id}`} title={j.name} note={journeyNote(j)} leading={<View style={sb.lead}><Glyph name="journey" size={15} color="var(--ink-3)" /></View>} onPress={() => data.nav.openJourney(j.id)} />);
  }

  const tabs = [{ key: "automations", label: "Automations", note: String(autos.length) }, { key: "journeys", label: "Journeys", note: String(journeys.length) }];
  return (
    <View testID="automations-sidebar" accessibilityLabel="Automations" style={sb.frame} {...webOnly({ onKeyDown: onKey })}>
      <SubTabs tabs={tabs} active={tab} onSelect={(k) => setTab(k as SidebarTab)} label="Automations and Journeys" />
      <View style={sb.searchWrap}>
        <View style={sb.search}>
          <Glyph name="search" size={14} color="var(--ink-3)" />
          <TextInput
            ref={(r) => { search.current = r as unknown as { focus?: () => void } | null; }}
            accessibilityLabel={tab === "automations" ? "Search Automations" : "Search Journeys"} testID="search" value={q} onChangeText={setQ}
            onFocus={() => setFocusId("search")} onBlur={() => setFocusId((c) => (c === "search" ? null : c))}
            placeholder="Search" placeholderTextColor="var(--ink-3)"
            {...webOnly({ onKeyDown: (e: KeyEventLike) => { if (e.key === "Escape") { setQ(""); e.stopPropagation?.(); } if (e.key === "ArrowDown") { e.preventDefault?.(); e.stopPropagation?.(); const to = order[0]; if (to) { setFocusId(to); focusRow(to); } } } })}
            style={sb.searchInput}
          />
          {q ? <IconButton icon="x" label="Clear the search" size={20} onPress={() => setQ("")} /> : <Text style={sb.slash}>/</Text>}
        </View>
      </View>
      <ScrollView style={sb.scroll} contentContainerStyle={sb.scrollIn} keyboardShouldPersistTaps="handled">
        {tab === "automations" ? (
          <>
            <Row
              id="failed-runs" title="Failed runs" onPress={() => data.nav.openFailedRuns()}
              leading={<View style={sb.lead}><Glyph name="warn" size={15} color="var(--danger)" /></View>}
              trailing={failed > 0 ? <Badge n={failed} tone="danger" testID="failed-count" /> : undefined}
            />
            {body}
            {autos.length === 0 && list.status === "ready" ? <Text style={sb.empty}>No automations yet</Text> : null}
          </>
        ) : (
          <>
            <View style={sb.section}>
              <View style={sb.sHead}><Text accessibilityRole="header" style={sb.sTitle}>Journeys</Text><Text style={sb.sCount}>{String(journeys.length)}</Text></View>
              {journeyRows}
              {journeys.length === 0 && journeysQ.status === "ready" ? <Text style={sb.empty}>No Journeys yet</Text> : null}
            </View>
          </>
        )}
      </ScrollView>
      {note ? <Text style={sb.note} accessibilityLiveRegion="polite" testID="sidebar-note">{note}</Text> : null}
      {element}
    </View>
  );
}

const focusRow = (id: string): void => {
  const doc = (globalThis as { document?: { querySelector(s: string): { querySelector(s: string): { focus?: () => void } | null } | null } }).document;
  setTimeout(() => doc?.querySelector(`[data-row="${id}"]`)?.querySelector("[role=button]")?.focus?.(), 0);
};

const sb = StyleSheet.create({
  frame: { width: 268, backgroundColor: "var(--side)" as string, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  searchWrap: { paddingHorizontal: 10, paddingTop: 12, paddingBottom: 6 },
  search: { height: 34, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderRadius: 9, backgroundColor: "var(--hover)" as string },
  searchInput: { flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--ink)" as string, ...({ outlineStyle: "none", outlineWidth: 0 } as object) },
  slash: { fontSize: 12, color: "var(--ink-4)" as string },
  scroll: { flex: 1 },
  scrollIn: { paddingHorizontal: 8, paddingBottom: 24 },
  section: { marginTop: 14 },
  sHead: { height: 26, flexDirection: "row", alignItems: "center", paddingLeft: 2 },
  sHeadBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingHorizontal: 4, borderRadius: 6 },
  sTitle: { fontSize: 12, fontWeight: "600", color: "var(--ink-2)" as string },
  sCount: { fontSize: 12, color: "var(--ink-4)" as string },
  lead: { width: 22, alignItems: "center", justifyContent: "center", marginRight: 4 },
  chev: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: 6 },
  tr: { flexDirection: "row", alignItems: "center", gap: 10 },
  fail: { flexDirection: "row", alignItems: "center", gap: 4 },
  failN: { fontSize: 12, color: "var(--danger)" as string },
  n: { fontSize: 12, color: "var(--ink-3)" as string, minWidth: 10, textAlign: "right" },
  rename: { height: 28, paddingHorizontal: 8, justifyContent: "center" },
  renameInput: { height: 24, borderRadius: 6, borderWidth: 1, borderColor: "var(--accent)" as string, paddingHorizontal: 6, fontSize: 13, color: "var(--ink)" as string },
  empty: { fontSize: 12.5, color: "var(--ink-3)" as string, padding: 12 },
  note: { fontSize: 12, color: "var(--ink-2)" as string, padding: 10, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
});
