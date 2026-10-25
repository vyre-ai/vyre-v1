// Right pane > Memory (spec 3.2, 4.13): what the agent knows, each fact with when it holds, when it was learned and where it came from. Proposed facts wait on top for Accept or
// Reject (with Undo). Click a fact to read it whole, then Correct it (the old one is kept, marked replaced, with you as the source of the new one) or Remove it. The filter menu
// narrows to facts from you and can include the replaced ones. Everything reads from the kept copy.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { accept, copyText, correct, reject, removeFact } from "./actions.ts";
import type { PaneDeps } from "./actions.ts";
import { usePaneData, useScreenQuery } from "./data.tsx";
import { CURRENT, MAP_LIMIT, factNote, isDefaultFilter, learnedWhen, parseMap, showingLine, sourceLabel, sourceName, splitFacts, statusFor } from "./model.ts";
import type { Fact, MapIndex, MemoryFilter } from "./model.ts";
import { Icon, LeadIcon, PaneList, TextButton, Tool } from "./parts.tsx";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import type { Entry } from "./parts.tsx";

type FactsOut = CapMap["memory.facts.list"]["out"];
type CountsOut = CapMap["memory.counts"]["out"];

export const MEMORY_SCREEN = "chats.agent-memory";
const CHATS_SCREEN = "chats.agent-page";
type ThreadsOut = CapMap["threads.list"]["out"];
type NotesOut = CapMap["memory.notes.list"]["out"];
type NoteOut = CapMap["memory.read_note"]["out"];

export function MemoryTab({ deps, spaceName, window }: { deps: PaneDeps; spaceName: string; window?: VirtualWindow }): ReactElement {
  const data = usePaneData();
  const menu = useMenu();
  const [filter, setFilter] = useState<MemoryFilter>(CURRENT);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const agentId = data.agent.agentId;
  const name = data.agent.name;
  const clock = data.clock();
  const known = useScreenQuery<FactsOut>(MEMORY_SCREEN, "facts", { agentId, layer: "agent", status: statusFor(filter), ...(filter.fromMe ? { fromMe: true } : {}) });
  const waiting = useScreenQuery<FactsOut>(MEMORY_SCREEN, "facts", { agentId, layer: "agent", status: ["proposed"] });
  const counts = useScreenQuery<CountsOut>(MEMORY_SCREEN, "counts", { agentId });
  const chats = useScreenQuery<ThreadsOut>(CHATS_SCREEN, "chats", {});
  const chatTitle = (id: string): string | undefined => (chats.status === "ready" ? chats.data.threads.find((t) => t.threadId === id)?.title : undefined);
  // MAP.md, the index every chat loads: read through the notes capabilities (the memory screen has no query for it), once per agent.
  const [map, setMap] = useState<MapIndex | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const list = (await data.call("memory.notes.list", { agentId, layer: "agent" })) as NotesOut;
        const note = list.notes.find((n) => n.path === "MAP.md");
        if (!note) { if (live) setMap(null); return; }
        const read = (await data.call("memory.read_note", { noteId: note.noteId })) as NoteOut;
        if (live) setMap(parseMap(read.markdown));
      } catch { if (live) setMap(null); }
    })();
    return () => { live = false; };
  }, [agentId, data]);

  if (known.status === "loading" || waiting.status === "loading") {
    return <View testID="memory-loading" accessibilityLabel="Loading" style={st.sk}><View style={st.skBar} /><View style={[st.skBar, { width: "70%" }]} /><View style={st.skBar} /></View>;
  }
  const proposed = splitFacts(waiting.data.facts).proposed;
  const facts = splitFacts(known.data.facts).known;

  const filterMenu = (x: number, y: number): void => {
    const items: MenuEntry[] = [
      { label: "Only facts from you", checked: filter.fromMe, onSelect: () => setFilter((f) => ({ ...f, fromMe: !f.fromMe })) },
      { label: "Include replaced facts", checked: filter.replaced, onSelect: () => setFilter((f) => ({ ...f, replaced: !f.replaced })) },
      { separator: true },
      { label: "Show current", checked: isDefaultFilter(filter), onSelect: () => setFilter(CURRENT) },
    ];
    menu.show(items, x, y, "other");
  };
  const toggle = (id: string): void => { setOpen((o) => (o === id ? null : id)); setEdit(null); };
  const source = (f: Fact): void => data.nav.openSource(f.sourceKind, f.sourceRef, f.sourceLink);
  const factMenu = (f: Fact): MenuEntry[] => [
    ...(f.status === "current" ? [{ label: "Correct…", onSelect: () => { setOpen(f.factId); setEdit(f.factId); setDraft(f.text); } } as MenuEntry] : []),
    { label: "Show Source", onSelect: () => source(f) },
    { label: "Copy", onSelect: () => void copyText(deps, f.text) },
    ...(f.status === "current" ? [{ separator: true } as MenuEntry, { label: "Remove From Memory", danger: true, onSelect: () => void removeFact(deps, f) } as MenuEntry] : []),
  ];

  const entries: Entry[] = [];
  if (map) {
    const keyRows: ReactElement[] = [];
    for (const r of map.rows) keyRows.push(<View key={r.key} style={st.mapRow}><Text style={st.mapKey} numberOfLines={1}>{r.key}</Text><Text style={st.mapText} numberOfLines={1}>{r.text}</Text></View>);
    entries.push({
      key: "map", type: "block",
      node: (
        <View testID="memory-map" style={st.map}>
          <View style={st.mapHead}>
            <View style={st.mapIcon}><Icon name="doc" size={14} /></View>
            <View style={{ flex: 1, minWidth: 0 }}><Text style={st.mapName}>MAP.md</Text><Text style={st.hint}>Loaded in every chat</Text></View>
            <Text testID="map-count" style={st.mapCount}>{`${map.lines} / ${MAP_LIMIT}`}</Text>
          </View>
          <View testID="map-keys" style={st.mapKeys}>{keyRows}</View>
        </View>
      ),
    });
  }
  if (proposed.length > 0) {
    entries.push({ key: "l-proposed", type: "label", text: `Proposed · ${proposed.length}`, right: "Accept or reject" });
    for (const f of proposed) {
      const from = sourceLabel(f, chatTitle);
      entries.push({
        key: `p-${f.factId}`, type: "block",
        node: (
          <PressableCard testID={`proposed-${f.factId}`} menu={[{ label: "Accept", onSelect: () => void accept(deps, f) }, { label: "Reject", onSelect: () => void reject(deps, f) }, { separator: true }, { label: "Show Source", onSelect: () => source(f) }]} title={f.text}>
            <Text style={st.cardText}>{f.text}</Text>
            <View style={st.cardFoot}>
              <Text style={st.hint}>from <Text onPress={() => source(f)} style={st.srcLink} testID={`proposed-source-${f.factId}`}>{from}</Text>{` · ${learnedWhen(f.learnedAt, clock)}`}</Text>
              <View style={st.acts}>
                <Tool icon="check" label="Accept" onPress={() => void accept(deps, f)} testID={`accept-${f.factId}`} />
                <Tool icon="x" label="Reject" onPress={() => void reject(deps, f)} testID={`reject-${f.factId}`} />
              </View>
            </View>
          </PressableCard>
        ),
      });
    }
  }
  entries.push({
    key: "h-known", type: "block",
    node: (
      <View testID="memory-head" style={st.head}>
        <Text accessibilityRole="header" style={st.headText}>{`What ${name} knows in ${spaceName}`}</Text>
        <Tool icon="filter" label="Filter" onPress={filterMenu} active={!isDefaultFilter(filter)} testID="memory-filter" />
      </View>
    ),
  });
  if (!isDefaultFilter(filter)) {
    const n = counts.status === "ready" ? (filter.fromMe ? counts.data.fromMe : counts.data.current) : null;
    entries.push({
      key: "showing", type: "block",
      node: (
        <View testID="memory-showing" style={st.showing}>
          <Text style={st.showingText}>{showingLine(filter)}{n !== null ? ` · ${n}` : ""}</Text>
          <TextButton label="Show current" onPress={() => setFilter(CURRENT)} testID="memory-reset" />
        </View>
      ),
    });
  }
  if (facts.length === 0) entries.push({ key: "none", type: "empty", text: "No facts match.", testID: "memory-empty" });
  for (const f of facts) {
    const isOpen = open === f.factId;
    entries.push({
      key: `f-${f.factId}`, type: "row", title: f.text, note: factNote(f, clock), selected: isOpen, testID: `fact-${f.factId}`,
      leading: <LeadIcon name={f.status === "closed" ? "clock" : "doc"} color={f.status === "closed" ? "var(--ink-4)" : "var(--ink-3)"} />,
      onPress: () => toggle(f.factId), menu: factMenu(f),
    });
    if (isOpen) {
      entries.push({
        key: `o-${f.factId}`, type: "block",
        node: edit === f.factId ? (
          <View testID={`fact-edit-${f.factId}`} style={st.detail}>
            <TextInput accessibilityLabel="Correct this fact" value={draft} onChangeText={setDraft} multiline style={st.input} />
            <Text style={st.hint}>The old fact stays, marked replaced, with you as the source of the new one.</Text>
            <View style={st.row}>
              <TextButton label="Save" primary onPress={() => void correct(deps, f, draft).then((ok) => { if (ok) { setEdit(null); setOpen(null); } })} testID={`fact-save-${f.factId}`} />
              <TextButton label="Cancel" onPress={() => setEdit(null)} testID={`fact-cancel-${f.factId}`} />
            </View>
          </View>
        ) : (
          <View testID={`fact-detail-${f.factId}`} style={st.detail}>
            <Text style={st.full}>{f.text}</Text>
            <Pressable accessibilityRole="link" accessibilityLabel={`Open the source: ${sourceName(f.sourceKind)}`} onPress={() => source(f)} style={st.src} testID={`fact-source-${f.factId}`}>
              <Icon name="chat" size={12} /><Text style={st.srcText}>{`Open ${sourceName(f.sourceKind)}`}</Text>
            </Pressable>
            {f.status === "current" ? (
              <View style={st.row}>
                <TextButton label="Correct" onPress={() => { setEdit(f.factId); setDraft(f.text); }} testID={`fact-correct-${f.factId}`} />
                <TextButton label="Remove" onPress={() => void removeFact(deps, f).then((ok) => { if (ok) setOpen(null); })} testID={`fact-remove-${f.factId}`} />
              </View>
            ) : <Text style={st.hint}>Replaced. It no longer shapes answers.</Text>}
          </View>
        ),
      });
    }
  }
  return <View style={st.fill}><PaneList plain entries={entries} {...(window ? { window } : {})} testID="memory-list" />{menu.element}</View>;
}

/** A proposed fact as a card (the prototype draws them boxed); right-click gives the same Accept and Reject as the buttons. */
function PressableCard({ title, menu: items, testID, children }: { title: string; menu: MenuEntry[]; testID: string; children: ReactElement[] }): ReactElement {
  const m = useMenu();
  // The outer View carries the spacing as padding: the list measures a row without its margins, so margins would overlap the next row.
  return <View style={st.cardOuter}><View testID={testID} style={st.card} {...menuTrigger((x, y) => m.show(items, x, y, "context", { label: title }))}>{children}{m.element}</View></View>;
}

const st = StyleSheet.create({
  map: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4, gap: 8 },
  mapHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  mapIcon: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: "var(--line)" as string, alignItems: "center", justifyContent: "center", backgroundColor: "var(--raised)" as string },
  mapName: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  mapCount: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  mapKeys: { borderRadius: 8, backgroundColor: "var(--sunk)" as string, paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  mapRow: { flexDirection: "row", gap: 8 },
  mapKey: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5, color: "var(--accent)" as string, flexShrink: 0 },
  mapText: { flex: 1, minWidth: 0, fontSize: 12, color: "var(--ink-2)" as string },
  cardOuter: { paddingHorizontal: 8, paddingVertical: 3 },
  card: { padding: 10, gap: 6, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  cardText: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  cardFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  srcLink: { color: "var(--accent)" as string },
  fill: { flex: 1, minHeight: 0 },
  sk: { padding: 8, gap: 12 },
  skBar: { height: 12, borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  acts: { flexDirection: "row", alignItems: "center", gap: 2 },
  head: { minHeight: 34, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 8, paddingTop: 12, paddingBottom: 2 },
  headText: { flexShrink: 1, fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  showing: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, minHeight: 28 },
  showingText: { flexShrink: 1, fontSize: 12, color: "var(--ink-3)" as string },
  detail: { marginHorizontal: 8, marginBottom: 6, paddingHorizontal: 10, paddingVertical: 8, gap: 8, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  full: { fontSize: 13, lineHeight: 19, color: "var(--ink)" as string },
  src: { flexDirection: "row", alignItems: "center", gap: 6 },
  srcText: { fontSize: 12.5, color: "var(--accent)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  hint: { fontSize: 11.5, lineHeight: 16, color: "var(--ink-3)" as string },
  input: { minHeight: 56, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 7, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, color: "var(--ink)" as string, fontSize: 13 },
});
