import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "./shared.tsx";

type Schema = CapMap["schema.describe"]["out"];
type SchemaOp = CapMap["schema.diff"]["in"]["ops"][number];

function schemaOps(text: string): SchemaOp[] | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed as SchemaOp[] : null;
  } catch { return null; }
}

export function SchemaPage(): ReactElement {
  const types = useRead<Schema>("schema.describe", {});
  const changes = useRead<CapMap["schema.changes.list"]["out"]>("schema.changes.list", {});
  const trash = useRead<CapMap["schema.trash.list"]["out"]>("schema.trash.list", {});
  const [selected, setSelected] = useState<Schema["types"][number] | null>(null);
  const [opsText, setOpsText] = useState("[]");
  const [preview, setPreview] = useState<CapMap["schema.diff"]["out"] | null>(null);
  const action = useAction(() => { types.refresh(); changes.refresh(); trash.refresh(); });
  if (!types.data || !changes.data || !trash.data) return <ReadState error={types.error ?? changes.error ?? trash.error} retry={() => { types.refresh(); changes.refresh(); trash.refresh(); }} />;
  const rows = types.data.types.map((type) => <Row key={type.key} id={`console-schema-${type.key}`} title={type.title} note={`${type.fields.length} fields · ${type.label} · Version ${type.version}${type.syncedFrom ? ` · Synced from ${type.syncedFrom}` : ""}`} onPress={() => setSelected(type)} />);
  const ops = schemaOps(opsText);
  return <View testID="console-schema"><Section title="Record types" count={rows.length}><Group>{rows.length ? rows : <Note>No record types.</Note>}</Group></Section>{selected ? <Section title={selected.title}><Group><Row id="schema-key" title="Key" note={selected.key} /><Row id="schema-label" title="Sensitivity" note={selected.label} />{selected.fields.map((field) => <Row key={field.key} id={`schema-field-${field.key}`} title={field.title} note={`${field.type}${field.required ? " · Required" : ""}${field.label ? ` · ${field.label}` : ""}`} />)}</Group></Section> : null}<Section title="Change schema"><Group><Field multiline label="Operations (JSON array)" testID="schema-ops" value={opsText} onChange={(value) => { setOpsText(value); setPreview(null); }} />{ops === null ? <Note>Enter a JSON array of schema operations.</Note> : null}<Button label="Preview schema change" testID="schema-preview" disabled={!ops || ops.length === 0 || action.busy} onPress={() => { if (ops) void action.run<CapMap["schema.diff"]["out"]>("schema.diff", { ops }, "Preview ready").then((out) => { if (out) setPreview(out); }); }} />{preview ? <><Note>{preview.additive} additive; {preview.destructive} destructive; {preview.problems.length} problems.</Note>{preview.items.map((item) => <Row key={item.itemKey} id={`schema-diff-${item.itemKey}`} title={item.summary} note={`${item.destructive ? "Destructive" : "Additive"} · ${item.affectedRows} rows`} />)}<Actions><Button label="Discard preview" onPress={() => setPreview(null)} /><Button label="Apply exact preview" disabled={action.busy || preview.problems.length > 0} onPress={() => { const current = schemaOps(opsText); if (current) void action.run("schema.apply", { ops: current, previewToken: preview.previewToken, confirm: true }, "Schema updated").then((out) => { if (out) setPreview(null); }); }} /></Actions></> : null}</Group></Section><Section title="Recent changes" count={changes.data.changes.length}><Group>{changes.data.changes.length ? changes.data.changes.map((change) => <Row key={change.changeId} id={`schema-change-${change.changeId}`} title={change.summary} note={`${change.destructive ? "Destructive" : "Additive"} · ${new Date(change.at).toLocaleString()}`} />) : <Note>No schema changes.</Note>}</Group></Section><Section title="Field Trash" count={trash.data.items.length}><Group>{trash.data.items.length ? trash.data.items.map((item, n) => <Row key={`${item.type}:${item.field ?? n}`} id={`schema-trash-${n}`} title={`${item.type}${item.field ? `.${item.field}` : ""}`} note={`${item.rows} rows · Expires ${new Date(item.expiresAt).toLocaleDateString()}`} trailing={item.field ? <Button label="Restore" onPress={() => void action.run("schema.restore_field", { type: item.type, field: item.field }, "Field restored")} /> : null} />) : <Note>No dropped fields.</Note>}</Group></Section>{action.note ? <Note>{action.note}</Note> : null}</View>;
}

type Label = CapMap["access.labels.list"]["out"]["labels"][number]["label"];
export function LabelsPage(): ReactElement {
  const list = useRead<CapMap["access.labels.list"]["out"]>("access.labels.list", {});
  const [resourceType, setResourceType] = useState("record_type");
  const [resourceId, setResourceId] = useState("");
  const [label, setLabel] = useState<Label>("internal");
  const [scanType, setScanType] = useState("");
  const [suggestions, setSuggestions] = useState<CapMap["schema.sensitivity.scan"]["out"]["suggestions"]>([]);
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const labels = list.data.labels.map((item) => <Row key={item.label} id={`console-label-${item.label}`} title={`${item.label[0]!.toUpperCase()}${item.label.slice(1)}`} note={`Rank ${item.rank} · AI providers ${item.providers} · ${item.syncToLaptop ? "Laptop sync allowed" : "No laptop sync"}`} selected={label === item.label} onPress={() => setLabel(item.label)} />);
  return <View testID="console-labels"><Section title="Sensitivity labels"><Group>{labels}</Group></Section><Section title="Label a resource"><Group><Field label="Resource type" value={resourceType} onChange={setResourceType} /><Field label="Resource id" value={resourceId} onChange={setResourceId} /><Button label="Set label" testID="label-set" disabled={!resourceId.trim() || action.busy} onPress={() => void action.run("access.labels.set", { resource: { type: resourceType, id: resourceId.trim() }, label }, "Label updated")} /></Group></Section><Section title="Sensitive-data scan"><Group><Field label="Record type" value={scanType} onChange={setScanType} /><Button label="Scan record type" testID="label-scan" disabled={!scanType.trim() || action.busy} onPress={() => void action.run<CapMap["schema.sensitivity.scan"]["out"]>("schema.sensitivity.scan", { type: scanType.trim() }, "Scan complete").then((out) => { if (out) setSuggestions(out.suggestions); })} />{suggestions.map((item) => <Row key={item.field} id={`label-suggestion-${item.field}`} title={item.field} note={`${item.matches} ${item.kind} matches · Suggest ${item.suggestedLabel}${item.seal ? " and seal" : ""}`} />)}</Group></Section>{action.note ? <Note>{action.note}</Note> : null}</View>;
}
