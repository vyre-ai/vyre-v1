import { useState } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { Actions, Button, Field, Note, ReadState, Select, attempt, useAction, useRead } from "./shared.tsx";

type Schema = CapMap["schema.describe"]["out"];
type SchemaOp = CapMap["schema.diff"]["in"]["ops"][number];
type SchemaMode = "type.create" | "field.add" | "field.update" | "field.rename" | "field.drop" | "type.drop";

export function exactSchemaApplyInput(preview: CapMap["schema.diff"]["out"], ops: readonly SchemaOp[]) {
  return {
    ops: [...ops],
    previewToken: preview.previewToken,
    confirm: preview.items.filter((item) => item.destructive).map((item) => item.itemKey),
    reason: "Console schema builder",
    idempotencyKey: attempt(),
  };
}

export function SchemaPage(): ReactElement {
  const types = useRead<Schema>("schema.describe", {});
  const changes = useRead<CapMap["schema.changes.list"]["out"]>("schema.changes.list", {});
  const trash = useRead<CapMap["schema.trash.list"]["out"]>("schema.trash.list", {});
  const fieldTypes = useRead<CapMap["schema.field_types"]["out"]>("schema.field_types", {});
  const [selected, setSelected] = useState<Schema["types"][number] | null>(null);
  const [mode, setMode] = useState<SchemaMode>("field.add");
  const [typeKey, setTypeKey] = useState("");
  const [typeTitle, setTypeTitle] = useState("");
  const [typePlural, setTypePlural] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldTitle, setFieldTitle] = useState("");
  const [fieldType, setFieldType] = useState("text");
  const [newKey, setNewKey] = useState("");
  const [required, setRequired] = useState(false);
  const [preview, setPreview] = useState<CapMap["schema.diff"]["out"] | null>(null);
  const [previewOps, setPreviewOps] = useState<SchemaOp[] | null>(null);
  const action = useAction(() => { types.refresh(); changes.refresh(); trash.refresh(); fieldTypes.refresh(); });
  if (!types.data || !changes.data || !trash.data || !fieldTypes.data) return <ReadState error={types.error ?? changes.error ?? trash.error ?? fieldTypes.error} retry={() => { types.refresh(); changes.refresh(); trash.refresh(); fieldTypes.refresh(); }} />;
  const rows = types.data.types.map((type) => <Row key={type.key} id={`console-schema-${type.key}`} title={type.title} note={`${type.fields.length} fields · ${type.label} · Version ${type.version}${type.syncedFrom ? ` · Synced from ${type.syncedFrom}` : ""}`} onPress={() => setSelected(type)} />);
  const knownFieldType = fieldTypes.data.fieldTypes.some((item) => item.key === fieldType);
  const op = ((): SchemaOp | null => {
    if (mode === "type.create") return typeKey.trim() && typeTitle.trim() ? { op: mode, type: typeKey.trim(), def: { title: typeTitle.trim(), plural: typePlural.trim() || `${typeTitle.trim()}s`, icon: "table", label: "internal", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }] } } : null;
    if (!selected) return null;
    if (mode === "type.drop") return { op: mode, type: selected.key };
    if (!fieldKey.trim()) return null;
    if (mode === "field.drop") return { op: mode, type: selected.key, field: fieldKey.trim() };
    if (mode === "field.rename") return newKey.trim() ? { op: mode, type: selected.key, field: fieldKey.trim(), newKey: newKey.trim() } : null;
    if (!fieldTitle.trim() || !knownFieldType) return null;
    return { op: mode, type: selected.key, field: fieldKey.trim(), def: { title: fieldTitle.trim(), type: fieldType, required } };
  })();
  const chooseMode = (next: SchemaMode): void => { setMode(next); setPreview(null); setPreviewOps(null); };
  return <View testID="console-schema"><Section title="Record types" count={rows.length}><Group>{rows.length ? rows : <Note>No record types.</Note>}</Group></Section>{selected ? <Section title={selected.title}><Group><Row id="schema-key" title="Key" note={selected.key} /><Row id="schema-label" title="Sensitivity" note={selected.label} />{selected.fields.map((field) => <Row key={field.key} id={`schema-field-${field.key}`} title={field.title} note={`${field.type}${field.required ? " · Required" : ""}${field.label ? ` · ${field.label}` : ""}`} onPress={() => { setFieldKey(field.key); setFieldTitle(field.title); setFieldType(field.type); setRequired(Boolean(field.required)); }} />)}</Group></Section> : null}<Section title="Schema builder"><Group><Actions><Button label="Create record type" onPress={() => chooseMode("type.create")} /><Button label="Add field" onPress={() => chooseMode("field.add")} /><Button label="Edit field" onPress={() => chooseMode("field.update")} /><Button label="Rename field" onPress={() => chooseMode("field.rename")} /><Button label="Drop field" danger onPress={() => chooseMode("field.drop")} />{selected ? <Button label="Drop record type" danger onPress={() => chooseMode("type.drop")} /> : null}</Actions>{mode === "type.create" ? <><Field label="Type key" value={typeKey} onChange={setTypeKey} /><Field label="Singular title" value={typeTitle} onChange={setTypeTitle} /><Field label="Plural title" value={typePlural} onChange={setTypePlural} /></> : <>{selected ? <Note>Editing {selected.title}</Note> : <Note>Select a record type first.</Note>}{mode !== "type.drop" ? <Field label="Field key" value={fieldKey} onChange={setFieldKey} /> : null}{mode === "field.rename" ? <Field label="New field key" value={newKey} onChange={setNewKey} /> : null}{mode === "field.add" || mode === "field.update" ? <><Field label="Field title" value={fieldTitle} onChange={setFieldTitle} /><Select label="Field type" value={fieldType} options={fieldTypes.data.fieldTypes.map((item) => ({ key: item.key, title: item.title }))} onChange={setFieldType} /><Button label={required ? "Required field" : "Optional field"} onPress={() => setRequired((value) => !value)} />{!knownFieldType ? <Note>Choose one of the listed field types.</Note> : null}</> : null}</>}<Button label="Preview schema change" testID="schema-preview" disabled={!op || action.busy} onPress={() => { if (op) { const ops = [op]; void action.run<CapMap["schema.diff"]["out"]>("schema.diff", { ops }, "Preview ready").then((out) => { if (out) { setPreview(out); setPreviewOps(ops); } }); } }} />{preview && previewOps ? <><Note>{preview.additive} additive; {preview.destructive} destructive; {preview.problems.length} problems.</Note>{preview.items.map((item) => <Row key={item.itemKey} id={`schema-diff-${item.itemKey}`} title={item.summary} note={`${item.destructive ? "Destructive" : "Additive"} · ${item.affectedRows} rows`} />)}<Actions><Button label="Discard preview" onPress={() => { setPreview(null); setPreviewOps(null); }} /><Button label="Apply exact preview" danger={preview.destructive > 0} disabled={action.busy || preview.problems.length > 0} onPress={() => void action.run("schema.apply", exactSchemaApplyInput(preview, previewOps), "Schema updated").then((out) => { if (out) { setPreview(null); setPreviewOps(null); } })} /></Actions></> : null}</Group></Section><Section title="Recent changes" count={changes.data.changes.length}><Group>{changes.data.changes.length ? changes.data.changes.map((change) => <Row key={change.changeId} id={`schema-change-${change.changeId}`} title={change.summary} note={`${change.destructive ? "Destructive" : "Additive"} · ${new Date(change.at).toLocaleString()}`} />) : <Note>No schema changes.</Note>}</Group></Section><Section title="Field Trash" count={trash.data.items.length}><Group>{trash.data.items.length ? trash.data.items.map((item, n) => <Row key={`${item.type}:${item.field ?? n}`} id={`schema-trash-${n}`} title={`${item.type}${item.field ? `.${item.field}` : ""}`} note={`${item.rows} rows · Expires ${new Date(item.expiresAt).toLocaleDateString()}`} trailing={item.field ? <Button label="Restore" onPress={() => void action.run("schema.restore_field", { type: item.type, field: item.field }, "Field restored")} /> : null} />) : <Note>No dropped fields.</Note>}</Group></Section>{action.note ? <Note>{action.note}</Note> : null}</View>;
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
