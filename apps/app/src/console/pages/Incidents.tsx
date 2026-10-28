import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { ObjectPage, ObjectSection, withBaseTabs } from "../../../../../ui/src/ObjectPage/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { ObjectList } from "../objects/ObjectList.tsx";
import type { ObjectListRow } from "../objects/ObjectList.tsx";
import { Actions, Button, Field, Note, ReadState, attempt, useAction, useRead } from "./shared.tsx";
import { Choice } from "./ai-controls.tsx";

type IncidentsOut = CapMap["engine.incidents.list"]["out"];
type Incident = IncidentsOut["incidents"][number];
type Kind = Incident["kind"];

export function Incidents(): ReactElement {
  const names = useConsoleData();
  const list = useRead<IncidentsOut>("engine.incidents.list", { limit: 100 });
  const people = useRead<CapMap["access.principals.list"]["out"]>("access.principals.list", { kind: "person" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReadonlySet<string>>(new Set(["open", "assigned"]));
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>("person_report");
  const [openingNote, setOpeningNote] = useState("");
  const refresh = (): void => { list.refresh(); people.refresh(); };
  const action = useAction(refresh);
  if (!list.data || !people.data) return <ReadState error={list.error ?? people.error} retry={refresh} />;
  const selected = list.data.incidents.find((incident) => incident.incidentId === selectedId) ?? null;
  if (selected) return <IncidentObject incident={selected} people={people.data.principals} busy={action.busy} note={action.note} onBack={() => setSelectedId(null)} onRun={action.run} />;
  const rows: ObjectListRow<Incident>[] = list.data.incidents.map((incident) => ({ id: incident.incidentId, title: incident.title, note: `${incident.state} · ${incident.kind.replaceAll("_", " ")} · ${incident.ownerId ? names.name(incident.ownerId) : "Unassigned"}`, search: `${incident.agentId ? names.name(incident.agentId) : ""} ${incident.turnId ?? ""}`, filters: [incident.state, incident.kind], value: incident, actions: [{ label: "Open", onSelect: () => setSelectedId(incident.incidentId) }] }));
  return <View testID="console-ai-incidents"><Section title="Incidents" count={rows.length}><ObjectList rows={rows} selectedId={null} onOpen={(row) => setSelectedId(row.id)} filters={[{ id: "open", label: "Open" }, { id: "assigned", label: "Assigned" }, { id: "resolved", label: "Resolved" }, { id: "label_denied", label: "Label denied" }, { id: "scrub_miss", label: "Scrubber miss" }, { id: "runaway_spend", label: "Runaway spend" }, { id: "repeated_failure", label: "Repeated failure" }, { id: "person_report", label: "Person report" }]} activeFilters={filters} onFilters={setFilters} empty="No AI incidents." /></Section><Section title="Open an incident"><Group><Field label="Title" value={title} onChange={setTitle} /><Choice label="Kind" value={kind} options={[{ key: "person_report", title: "Person report" }, { key: "label_denied", title: "Label denied" }, { key: "scrub_miss", title: "Scrubber miss" }, { key: "runaway_spend", title: "Runaway spend" }, { key: "repeated_failure", title: "Repeated failure" }, { key: "other", title: "Other" }]} onChange={(value) => setKind(value as Kind)} /><Field label="Opening note" value={openingNote} onChange={setOpeningNote} multiline /><Button label="Open incident" disabled={action.busy || !title.trim()} onPress={() => void action.run<CapMap["engine.incident.open"]["out"]>("engine.incident.open", { kind, title: title.trim(), ...(openingNote.trim() ? { note: openingNote.trim() } : {}), idempotencyKey: attempt() }, "Incident opened").then((out) => { if (out) { setTitle(""); setOpeningNote(""); setSelectedId(out.incident.incidentId); } })} /></Group></Section>{action.note ? <Note>{action.note}</Note> : null}</View>;
}

function IncidentObject({ incident, people, busy, note, onBack, onRun }: { incident: Incident; people: CapMap["access.principals.list"]["out"]["principals"]; busy: boolean; note: string; onBack(): void; onRun: <T>(cap: string, input: unknown, success: string) => Promise<T | undefined> }): ReactElement {
  const names = useConsoleData();
  const detail = useRead<CapMap["engine.incident.get"]["out"]>("engine.incident.get", { incidentId: incident.incidentId });
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [ownerId, setOwnerId] = useState(incident.ownerId ?? "");
  const [entry, setEntry] = useState("");
  const run = (id: string): Promise<boolean> | void => {
    if (id === "assign") { setEditing(true); return; }
    if (id === "resolve") return onRun("engine.incident.resolve", { incidentId: incident.incidentId, note: entry.trim() || "Resolved in Console" }, "Incident resolved").then((out) => { if (out) onBack(); return out !== undefined; });
  };
  const current = detail.data?.incident ?? incident;
  const body = tab === "access" ? <ObjectSection title="Ownership"><Row title="Owner" note={current.ownerId ? names.name(current.ownerId) : "Unassigned"} /><Row title="Agent" note={current.agentId ? names.name(current.agentId) : "No linked agent"} /><Row title="Turn" note={current.turnId ?? "No linked turn"} /></ObjectSection> : tab === "activity" ? <ObjectSection title="Notes" count={current.notes.length}>{current.notes.map((item, index) => <Row key={`${item.at}-${index}`} title={names.name(item.by)} note={`${new Date(item.at).toLocaleString()} · ${item.text}`} />)}{current.notes.length === 0 ? <Note>No notes yet.</Note> : null}</ObjectSection> : <ObjectSection title="Overview"><Row title="Kind" note={current.kind.replaceAll("_", " ")} /><Row title="Opened" note={new Date(current.openedAt).toLocaleString()} /><Row title="Resolved" note={current.resolvedAt ? new Date(current.resolvedAt).toLocaleString() : "Not resolved"} /><Field label="Resolution or note" value={entry} onChange={setEntry} multiline /><Button label="Add note" disabled={busy || !entry.trim()} onPress={() => void onRun("engine.incident.note", { incidentId: current.incidentId, text: entry.trim() }, "Note added").then((out) => { if (out) { setEntry(""); detail.refresh(); } })} /></ObjectSection>;
  return <ObjectPage id={current.incidentId} name={current.title} kind="AI incident" owner={current.ownerId ? names.name(current.ownerId) : "Unassigned"} status={current.state} parent="Incidents" onBack={onBack} actions={[{ id: "assign", label: "Assign owner", destructive: false }, ...(current.state === "resolved" ? [] : [{ id: "resolve", label: "Resolve incident", destructive: true }])]} impacts={{ resolve: `Resolving ${current.title} closes it. Add the resolution note before continuing.` }} tabs={withBaseTabs([])} activeTabId={tab} onTab={setTab} onAction={run} sheetOpen={editing} sheetTitle="Assign incident" onCloseSheet={() => setEditing(false)} sheet={<View><Note>Owner</Note>{people.map((person) => <Button key={person.id} label={`${ownerId === person.id ? "✓ " : ""}${person.name}`} onPress={() => setOwnerId(person.id)} />)}<Button label="Assign owner" disabled={busy || !ownerId} onPress={() => void onRun("engine.incident.assign", { incidentId: current.incidentId, ownerId }, "Incident assigned").then((out) => { if (out) { setEditing(false); detail.refresh(); } })} /></View>}>{body}{note ? <Note>{note}</Note> : null}</ObjectPage>;
}
