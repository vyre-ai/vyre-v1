import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Avatar } from "../../../../../ui/src/Avatar/index.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import type { CapMap } from "../../../../../generated/types.ts";
import { Empty, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { ObjectList } from "../objects/ObjectList.tsx";
import type { ObjectListRow } from "../objects/ObjectList.tsx";
import { Actions, Button, Field, FormSheet, Note, pickRow, ReadState, useAction, useRead } from "./shared.tsx";
import { Choice } from "./ai-controls.tsx";

type HoldsOut = CapMap["governance.holds.list"]["out"];
type Hold = HoldsOut["holds"][number];
type Target = Hold["target"];
type SearchHit = Pick<CapMap["search.query"]["out"]["hits"][number], "kind" | "id" | "title">;
type NamedTarget = Target & { title: string };

export function holdTargetOf(hit: SearchHit): NamedTarget | null {
  const kind = hit.kind === "chat" ? "thread" : hit.kind;
  return kind === "file" || kind === "channel" || kind === "thread" || kind === "person" ? { kind, id: hit.id, title: hit.title } : null;
}
export function mergeHolds(first: readonly Hold[], second: readonly Hold[]): Hold[] {
  const rows = new Map(first.map((hold) => [`${hold.target.kind}:${hold.target.id}`, hold]));
  for (const hold of second) rows.set(`${hold.target.kind}:${hold.target.id}`, hold);
  return [...rows.values()];
}
export function visibleHolds(holds: readonly Hold[], released: ReadonlySet<string>): Hold[] {
  return holds.filter((hold) => !released.has(`${hold.target.kind}:${hold.target.id}`));
}
export function namedPeopleForHold(people: readonly { id: string; name: string }[], query: string): NamedTarget[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return people.filter((person) => person.name.toLocaleLowerCase().includes(needle)).map((person) => ({ kind: "person", id: person.id, title: person.name }));
}

export function Holds(): ReactElement {
  const data = useConsoleData();
  const [placing, setPlacing] = useState(false);
  const [kind, setKind] = useState<"all" | Target["kind"]>("all");
  const list = useRead<HoldsOut>("governance.holds.list", { ...(kind === "all" ? {} : { kind }), limit: 100 });
  const [more, setMore] = useState<Hold[]>([]);
  const [page, setPage] = useState<{ loaded: boolean; next?: string; busy: boolean }>({ loaded: false, busy: false });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NamedTarget[]>([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<NamedTarget | null>(null);
  const [reason, setReason] = useState("");
  const [placePreview, setPlacePreview] = useState<{ target: Target; title: string; reason: string } | null>(null);
  const [releasePreview, setReleasePreview] = useState<Hold | null>(null);
  const [released, setReleased] = useState<ReadonlySet<string>>(new Set());
  const action = useAction(list.refresh);
  // the search runs as you type, a beat after the last key
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return undefined; }
    let live = true;
    const timer = setTimeout(() => {
      setSearching(true);
      void Promise.all([
        data.call("search.query", { q, types: ["person", "file", "channel", "chat"], mode: "keyword", limit: 50 }),
        data.call("files.folder.search", { q, scope: "folders", limit: 50 }),
        data.call("access.principals.list", { kind: "person", limit: 100 }),
      ]).then(([found, folders, people]) => {
        if (!live) return;
        const hits = (found as CapMap["search.query"]["out"]).hits.map(holdTargetOf).filter((item): item is NamedTarget => item !== null);
        const folderHits = (folders as CapMap["files.folder.search"]["out"]).folders.map((folder) => ({ kind: "folder" as const, id: folder.folderId, title: folder.name }));
        const peopleHits = namedPeopleForHold((people as CapMap["access.principals.list"]["out"]).principals, q);
        const unique = new Map([...hits, ...folderHits, ...peopleHits].map((item) => [`${item.kind}:${item.id}`, item]));
        setResults([...unique.values()]);
      }, () => { if (live) setResults([]); }).finally(() => { if (live) setSearching(false); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query, data]);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const holds = visibleHolds(mergeHolds(more, list.data.holds), released);
  const next = page.loaded ? page.next : list.data.next;
  const rows: ObjectListRow<Hold>[] = holds.map((hold) => ({ id: `${hold.target.kind}:${hold.target.id}`, title: hold.title, note: `${hold.target.kind} · ${hold.reason} · ${new Date(hold.at).toLocaleString()} · ${data.name(hold.by)}`, search: hold.reason, filters: [hold.target.kind], value: hold, actions: [{ label: "Release hold…", destructive: true, onSelect: () => setReleasePreview(hold) }] }));
  const verifyPlaced = async (expected: { target: Target; reason: string }): Promise<string> => {
    const out = await data.call("governance.holds.list", { kind: expected.target.kind, limit: 100 }) as HoldsOut;
    const placed = out.holds.find((hold) => hold.target.id === expected.target.id && hold.reason === expected.reason);
    if (!placed) throw new Error("The hold was not visible after it was placed.");
    setMore((current) => mergeHolds(current, [placed]));
    setReleased((current) => { const next = new Set(current); next.delete(`${placed.target.kind}:${placed.target.id}`); return next; });
    return "Hold placed";
  };
  return <>
    <Section title="Holds" count={rows.length} right={<View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}><Button label="Place a hold" testID="hold-new" onPress={() => setPlacing(true)} /><Choice label="Target kind" value={kind} options={[{ key: "all", title: "All targets" }, { key: "person", title: "People" }, { key: "file", title: "Files" }, { key: "folder", title: "Folders" }, { key: "channel", title: "Channels" }, { key: "thread", title: "Threads" }]} onChange={(value) => { setKind(value as typeof kind); setMore([]); setPage({ loaded: false, busy: false }); }} /></View>}>
      <ObjectList rows={rows} selectedId={null} onOpen={(row) => row.value && setReleasePreview(row.value)} pagination={{ ...(next ? { next } : {}), busy: page.busy, onMore: () => { if (!next || page.busy) return; setPage((current) => ({ ...current, busy: true })); void data.call("governance.holds.list", { ...(kind === "all" ? {} : { kind }), cursor: next, limit: 100 }).then((out) => { const nextPage = out as HoldsOut; setMore((current) => mergeHolds(current, nextPage.holds)); setPage({ loaded: true, ...(nextPage.next ? { next: nextPage.next } : {}), busy: false }); }, () => setPage((current) => ({ ...current, busy: false }))); } }} empty="Nothing is on hold." />
    </Section>
    {placing ? <FormSheet title="Place a hold" testID="hold-sheet" submit={placePreview ? "Place hold" : "Review hold"} onClose={() => { setPlacing(false); setPlacePreview(null); }}
      disabled={placePreview ? action.busy : !target || !reason.trim()} why={!target ? "Pick what to hold" : !reason.trim() ? "Give a reason" : undefined}
      onSubmit={() => { if (placePreview) { void action.run("governance.holds.place", { target: placePreview.target, reason: placePreview.reason }, () => verifyPlaced(placePreview)).then((out) => { if (out) { setPlacePreview(null); setTarget(null); setReason(""); setQuery(""); setPlacing(false); } }); } else if (target && reason.trim()) setPlacePreview({ target: { kind: target.kind, id: target.id }, title: target.title, reason: reason.trim() }); }}>
      {placePreview ? <Note>{placePreview.title} will stop expiring and cannot be erased until this hold is released.</Note> : <>
        <Field label="Find a person, file, folder, channel or thread" value={query} onChange={(value) => { setQuery(value); setTarget(null); setPlacePreview(null); }} />
        {results.length ? results.slice(0, 8).map((item) => <Row key={`${item.kind}:${item.id}`} {...pickRow({ id: `hold-target-${item.kind}-${item.id}`, title: item.title, note: item.kind, face: item.kind === "person" ? <Avatar name={item.title} seedId={item.id} size={24} /> : <Glyph name={item.kind === "folder" ? "data" : "audit"} size={16} color="var(--ink-3)" />, picked: target?.kind === item.kind && target?.id === item.id, onPress: () => { setTarget(item); setPlacePreview(null); } })} />) : query.trim() && !searching ? <Empty icon="search">Nothing found</Empty> : null}
        <Field label="Reason" value={reason} onChange={(value) => { setReason(value); setPlacePreview(null); }} multiline />
      </>}
    </FormSheet> : null}
    {releasePreview ? <Section title="Release hold"><Note>{releasePreview.title} can expire or be erased under the active policies after release.</Note><Actions><Button label="Cancel" onPress={() => setReleasePreview(null)} /><Button label="Release hold" danger disabled={action.busy} onPress={() => void action.run("governance.holds.release", { target: releasePreview.target }, "Hold released").then((out) => { if (out) { const key = `${releasePreview.target.kind}:${releasePreview.target.id}`; setReleased((current) => new Set([...current, key])); setMore((current) => current.filter((hold) => `${hold.target.kind}:${hold.target.id}` !== key)); setReleasePreview(null); } })} /></Actions></Section> : null}
    {action.note ? <Note>{action.note}</Note> : null}
  </>;
}
