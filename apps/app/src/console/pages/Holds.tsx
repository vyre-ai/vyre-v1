import { useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { ObjectList } from "../objects/ObjectList.tsx";
import type { ObjectListRow } from "../objects/ObjectList.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "./shared.tsx";
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

export function Holds(): ReactElement {
  const data = useConsoleData();
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
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const holds = mergeHolds(more, list.data.holds);
  const next = page.loaded ? page.next : list.data.next;
  const rows: ObjectListRow<Hold>[] = holds.map((hold) => ({ id: `${hold.target.kind}:${hold.target.id}`, title: hold.title, note: `${hold.target.kind} · ${hold.reason} · ${new Date(hold.at).toLocaleString()} · ${data.name(hold.by)}`, search: hold.reason, filters: [hold.target.kind], value: hold, actions: [{ label: "Release hold…", destructive: true, onSelect: () => setReleasePreview(hold) }] }));
  const search = (): void => {
    if (!query.trim() || searching) return;
    setSearching(true); setTarget(null); setPlacePreview(null);
    void Promise.all([
      data.call("search.query", { q: query.trim(), types: ["person", "file", "channel", "chat"], mode: "keyword", limit: 50 }),
      data.call("files.folder.search", { q: query.trim(), scope: "folders", limit: 50 }),
    ]).then(([found, folders]) => {
      const hits = (found as CapMap["search.query"]["out"]).hits.map(holdTargetOf).filter((item): item is NamedTarget => item !== null);
      const folderHits = (folders as CapMap["files.folder.search"]["out"]).folders.map((folder) => ({ kind: "folder" as const, id: folder.folderId, title: folder.name }));
      setResults([...hits, ...folderHits]);
    }, () => setResults([])).finally(() => setSearching(false));
  };
  const verifyPlaced = async (expected: { target: Target; reason: string }): Promise<string> => {
    const out = await data.call("governance.holds.list", { kind: expected.target.kind, limit: 100 }) as HoldsOut;
    if (!out.holds.some((hold) => hold.target.id === expected.target.id && hold.reason === expected.reason)) throw new Error("The hold was not visible after it was placed.");
    return "Hold placed";
  };
  return <>
    <Section title="Holds" count={rows.length} right={<Choice label="Target kind" value={kind} options={[{ key: "all", title: "All targets" }, { key: "person", title: "People" }, { key: "file", title: "Files" }, { key: "folder", title: "Folders" }, { key: "channel", title: "Channels" }, { key: "thread", title: "Threads" }]} onChange={(value) => { setKind(value as typeof kind); setMore([]); setPage({ loaded: false, busy: false }); }} />}>
      <ObjectList rows={rows} selectedId={null} onOpen={(row) => row.value && setReleasePreview(row.value)} pagination={{ ...(next ? { next } : {}), busy: page.busy, onMore: () => { if (!next || page.busy) return; setPage((current) => ({ ...current, busy: true })); void data.call("governance.holds.list", { ...(kind === "all" ? {} : { kind }), cursor: next, limit: 100 }).then((out) => { const nextPage = out as HoldsOut; setMore((current) => mergeHolds(current, nextPage.holds)); setPage({ loaded: true, ...(nextPage.next ? { next: nextPage.next } : {}), busy: false }); }, () => setPage((current) => ({ ...current, busy: false }))); } }} empty="Nothing is on hold." />
    </Section>
    <Section title="Place a hold">
      <Field label="Find a person, file, folder, channel or thread" value={query} onChange={(value) => { setQuery(value); setTarget(null); setPlacePreview(null); }} /><Button label={searching ? "Searching…" : "Search"} disabled={searching || !query.trim()} onPress={search} />
      {results.length ? <Choice label="Target" value={target ? `${target.kind}:${target.id}` : ""} options={results.map((item) => ({ key: `${item.kind}:${item.id}`, title: `${item.title} · ${item.kind}` }))} onChange={(value) => { setTarget(results.find((item) => `${item.kind}:${item.id}` === value) ?? null); setPlacePreview(null); }} /> : null}
      <Field label="Reason" value={reason} onChange={(value) => { setReason(value); setPlacePreview(null); }} multiline />
      {placePreview ? <><Note>{placePreview.title} will stop expiring and cannot be erased until this hold is released.</Note><Actions><Button label="Back" onPress={() => setPlacePreview(null)} /><Button label="Place hold" danger disabled={action.busy} onPress={() => void action.run("governance.holds.place", { target: placePreview.target, reason: placePreview.reason }, () => verifyPlaced(placePreview)).then((out) => { if (out) { setPlacePreview(null); setTarget(null); setReason(""); } })} /></Actions></> : <Button label="Review hold" disabled={!target || !reason.trim()} onPress={() => { if (target && reason.trim()) setPlacePreview({ target: { kind: target.kind, id: target.id }, title: target.title, reason: reason.trim() }); }} />}
    </Section>
    {releasePreview ? <Section title="Release hold"><Note>{releasePreview.title} can expire or be erased under the active policies after release.</Note><Actions><Button label="Cancel" onPress={() => setReleasePreview(null)} /><Button label="Release hold" danger disabled={action.busy} onPress={() => void action.run("governance.holds.release", { target: releasePreview.target }, "Hold released").then((out) => { if (out) setReleasePreview(null); })} /></Actions></Section> : null}
    {action.note ? <Note>{action.note}</Note> : null}
  </>;
}
