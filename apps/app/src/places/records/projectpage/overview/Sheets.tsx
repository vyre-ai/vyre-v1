// The Overview's sheets: a live block's settings, the page's history, the template chooser and save-as-template, and a new property. Each is the one ui/Dialog.
import { createElement, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Dialog } from "../../../../../../../ui/src/Dialog/index.tsx";
import { Row } from "../../../../../../../ui/src/Row/index.tsx";
import { Avatar } from "../../../../../../../ui/src/Avatar/index.tsx";
import { useProjectPageData } from "../data.tsx";
import { SPEC_CHOICES, VIEWS, kindOf, liveDescription, liveReady, liveTitle, revisionLine } from "./model.ts";
import type { PageTemplate, Revision, TypeName, View as LiveView } from "./model.ts";
import type { LiveAttrs } from "./LiveBlockView.tsx";

/** One choice among a few: a select (the owner banned pill filters). Off the web, where there is no select element, the choices are a short column of radio rows. */
function Select<T extends string>({ label, value, options, onChange, testID }: { label: string; value: T; options: readonly { id: T; label: string }[]; onChange(v: T): void; testID: string }): ReactElement {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {Platform.OS === "web" ? createElement("select", {
        "aria-label": label, "data-testid": testID, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value as T),
        style: { height: 34, borderRadius: 8, padding: "0 28px 0 10px", fontSize: 13.5, fontFamily: "inherit", color: "var(--ink)", backgroundColor: "var(--sunk)", border: "1px solid var(--line-2)", width: "100%", boxSizing: "border-box", appearance: "none", WebkitAppearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%23928DA2' stroke-width='1.5'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center" },
      }, ...options.map((o) => createElement("option", { key: o.id, value: o.id }, o.label))) : (
        <View accessibilityRole="radiogroup" accessibilityLabel={label}>
          {/* ui-rows-lint: not a list (the choices of one setting) */}
          {options.map((o) => <Pressable key={o.id} accessibilityRole="radio" accessibilityState={{ checked: value === o.id }} testID={`${testID}-${o.id || "any"}`} onPress={() => onChange(o.id)} style={s.opt}><Text style={[s.optText, value === o.id && s.optOn]}>{o.label}</Text></Pressable>)}
        </View>
      )}
    </View>
  );
}

/** The settings of one live block: its title, what it filters on, and how it is drawn. Saving writes them to the block (the page then saves like any edit). */
export function LiveSettings({ attrs, onSave, onClose }: { attrs: LiveAttrs; onSave(next: { spec: Record<string, unknown>; view: string }): void; onClose(): void }): ReactElement {
  const me = useProjectPageData().me?.id;
  void me;
  const d = useProjectPageData();
  const kind = kindOf(attrs.type);
  const [spec, setSpec] = useState<Record<string, unknown>>({ ...((attrs.spec ?? {}) as Record<string, unknown>) });
  const [view, setView] = useState<string>(attrs.view || kind?.defaultView || "list");
  const [types, setTypes] = useState<TypeName[]>([]);
  useEffect(() => {
    if (attrs.type !== "records" && attrs.type !== "metric") return;
    void Promise.resolve(d.call("schema.types.list", {})).then((o) => setTypes(((o as { types?: { key: string; plural?: string; title?: string }[] }).types ?? []).map((t) => ({ key: t.key, title: t.title ?? t.key, plural: t.plural ?? t.title ?? t.key })))).catch(() => undefined);
  }, [d, attrs.type]);
  const set = (k: string, v: unknown): void => setSpec((cur) => { const n = { ...cur }; if (v === "" || v === undefined) delete n[k]; else n[k] = v; return n; });
  const choices = SPEC_CHOICES[attrs.type as keyof typeof SPEC_CHOICES] ?? [];
  const ready = liveReady(attrs.type, spec);
  const needsType = attrs.type === "records" || attrs.type === "metric";
  return (
    <Dialog title={kind?.label ?? "Live block"} onClose={onClose} testID="live-settings" actions={[{ label: "Cancel", onPress: onClose, testID: "live-settings-cancel" }, { label: "Save", primary: true, disabled: !ready, why: "Choose what this shows first", onPress: () => onSave({ spec, view }), testID: "live-settings-save" }]}>
      <Text style={s.note}>A live block shows the project&apos;s real data. It saves a filter and a view, never a copy.</Text>
      <Text testID="live-settings-live" style={s.live}>{`Live \u00B7 ${liveDescription(attrs.type, spec, types)}`}</Text>
      <View style={s.field}><Text style={s.label}>Title</Text><TextInput accessibilityLabel="Title" testID="live-title" value={String(spec["title"] ?? "")} onChangeText={(v) => set("title", v)} placeholder={liveTitle(attrs.type, {})} placeholderTextColor="var(--ink-4)" style={s.input} /></View>
      {needsType ? (
        types.length > 0 ? <Select label="Record type" value={String(spec["type"] ?? "")} options={[...(spec["type"] ? [] : [{ id: "", label: "Choose a type" }]), ...types.map((t) => ({ id: t.key, label: t.plural }))]} onChange={(v) => set("type", v)} testID="live-type" />
          : <View style={s.field}><Text style={s.label}>Record type</Text><TextInput accessibilityLabel="Record type" testID="live-type" value={String(spec["type"] ?? "")} onChangeText={(v) => set("type", v.trim())} placeholder="The record type's key" placeholderTextColor="var(--ink-4)" style={s.input} /></View>
      ) : null}
      {/* ui-rows-lint: not a list (one select per setting) */}
      {choices.map((c) => <Select key={c.key} label={c.label} value={String(spec[c.key] ?? c.choices[0]?.id ?? "")} options={c.choices} onChange={(v) => set(c.key, v === "" ? undefined : v)} testID={`live-spec-${c.key}`} />)}
      {attrs.type === "metric" && spec["op"] === "sum" ? <View style={s.field}><Text style={s.label}>Field to add up</Text><TextInput accessibilityLabel="Field to add up" testID="live-field" value={String(spec["field"] ?? "")} onChangeText={(v) => set("field", v.trim())} placeholder="amount" placeholderTextColor="var(--ink-4)" style={s.input} /></View> : null}
      {kind && kind.views.length > 1 ? <Select label="View" value={view as LiveView} options={VIEWS.filter((v) => kind.views.includes(v.id))} onChange={(v) => setView(v)} testID="live-view" /> : null}
    </Dialog>
  );
}

/** The page's versions, newest first. Only the latest change can be undone (a version is not restored by itself); Undo makes a new version, so it can be undone too. */
export function HistorySheet({ projectId, now, canEdit, me, onUndone, onClose }: { projectId: string; now: number; canEdit: boolean; me?: string | undefined; onUndone(): void; onClose(): void }): ReactElement {
  const d = useProjectPageData();
  const [rows, setRows] = useState<readonly Revision[] | null>(null);
  const [note, setNote] = useState("");
  const load = (): void => { void Promise.resolve(d.call("projects.overview_doc.history", { projectId, limit: 50 })).then((o) => setRows((o as { revisions: Revision[] }).revisions), () => setNote("The history could not be read.")); };
  useEffect(load, [d, projectId]); // eslint-disable-line react-hooks/exhaustive-deps -- read once per open
  const undo = async (rev: number): Promise<void> => {
    try { await d.call("projects.overview_doc.undo", { projectId, rev }); onUndone(); load(); setNote("Undone. The undo is a version too."); } catch (e) { setNote((e as { message?: string }).message ?? "That could not be undone."); }
  };
  const restore = async (rev: number): Promise<void> => {
    const latest = rows?.[0]?.rev;
    try { await d.call("projects.overview_doc.restore", { projectId, rev, ...(latest !== undefined ? { baseRev: latest } : {}), idempotencyKey: globalThis.crypto.randomUUID() }); onUndone(); load(); setNote(`Version ${rev} is back. The restore is a version too.`); } catch (e) { setNote((e as { message?: string }).message ?? "That version could not be restored."); }
  };
  return (
    <Dialog title="History" onClose={onClose} testID="overview-history" actions={[{ label: "Done", primary: true, onPress: onClose, testID: "overview-history-done" }]}>
      <Text style={s.note}>Every change is a version, with who made it. Undo takes back the latest one; Restore brings an older one back.</Text>
      <ScrollView style={s.hist} testID="overview-history-list">
        {rows === null ? <Text style={s.note}>Loading…</Text> : rows.map((r, i) => {
          const who = r.by === me ? "you" : d.nameOf(r.by);
          const l = revisionLine(r, who, now);
          return (
            <Row key={r.rev} id={`rev-${r.rev}`} title={l.title} note={l.note} leading={<Avatar name={d.nameOf(r.by)} kind={r.authorKind === "agent" ? "agent" : "person"} size={22} />}
              trailing={i === 0 ? (canEdit && r.undoOf === undefined && rows.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel={`Undo version ${r.rev}`} testID={`rev-undo-${r.rev}`} onPress={() => void undo(r.rev)} style={s.act}><Text style={s.actText}>Undo</Text></Pressable> : <Text style={s.cur}>Current</Text>) : canEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`Restore version ${r.rev}`} testID={`rev-restore-${r.rev}`} onPress={() => void restore(r.rev)} style={s.act}><Text style={s.actText}>Restore</Text></Pressable> : undefined} />
          );
        })}
      </ScrollView>
      {note ? <Text accessibilityLiveRegion="polite" testID="overview-history-note" style={s.note}>{note}</Text> : null}
    </Dialog>
  );
}

/** Start the page from a template (it replaces the blocks; the page it had stays in the history), or keep this page as a template of the Space. */
export function TemplateSheet({ projectId, canEdit, onApply, onSaved, onClose }: { projectId: string; canEdit: boolean; onApply(t: PageTemplate): void; onSaved(title: string): void; onClose(): void }): ReactElement {
  const d = useProjectPageData();
  const [list, setList] = useState<readonly PageTemplate[] | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { void Promise.resolve(d.call("projects.overview_doc.templates.list", {})).then((o) => setList((o as { templates: PageTemplate[] }).templates), () => setErr("The templates could not be read.")); }, [d]);
  const save = async (): Promise<void> => {
    if (name.trim() === "") { setErr("Name the template."); return; }
    try { await d.call("projects.overview_doc.templates.save", { projectId, title: name.trim(), idempotencyKey: globalThis.crypto.randomUUID() }); onSaved(name.trim()); } catch (e) { setErr((e as { message?: string }).message ?? "The template could not be saved."); }
  };
  return (
    <Dialog title="Start from a template" onClose={onClose} testID="overview-templates" actions={[{ label: "Cancel", onPress: onClose, testID: "overview-templates-cancel" }]}>
      <Text style={s.note}>This replaces the blocks on this page. The current page stays in the history.</Text>
      {list === null ? <Text style={s.note}>Loading…</Text> : list.map((t) => (
        <Row key={t.templateId} id={`tpl-${t.templateId}`} title={t.title} {...(t.summary ? { note: t.summary } : {})} trailing={<Text style={s.hNote}>{`${t.blocks} blocks`}</Text>} {...(canEdit ? { onPress: () => onApply(t) } : { inert: true })} />
      ))}
      {canEdit ? (
        <View style={s.field}>
          <Text style={s.label}>Keep this page as a template</Text>
          <View style={s.inline}><TextInput accessibilityLabel="Template name" testID="tpl-name" value={name} onChangeText={setName} placeholder="Name" placeholderTextColor="var(--ink-4)" style={[s.input, { flex: 1 }]} /><Pressable accessibilityRole="button" accessibilityLabel="Save as template" testID="tpl-save" onPress={() => void save()} style={s.act}><Text style={s.actText}>Save</Text></Pressable></View>
        </View>
      ) : null}
      {err ? <Text accessibilityLiveRegion="polite" testID="overview-templates-error" style={s.err}>{err}</Text> : null}
    </Dialog>
  );
}

/** A new property is one of the Project record type's fields; an admin adds fields in the Records settings. This sheet fills one that exists and is empty. */
export function AddPropertySheet({ options, onPick, onClose }: { options: readonly { key: string; title: string }[]; onPick(key: string, value: string): void; onClose(): void }): ReactElement {
  const [key, setKey] = useState(options[0]?.key ?? "");
  const [value, setValue] = useState("");
  return (
    <Dialog title="Add a property" onClose={onClose} testID="overview-addprop" actions={[{ label: "Cancel", onPress: onClose, testID: "addprop-cancel" }, { label: "Add", primary: true, disabled: key === "" || value.trim() === "", onPress: () => onPick(key, value), testID: "addprop-add" }]}>
      {options.length === 0 ? <Text style={s.note} testID="addprop-none">Every field of this project type is already on the page. An admin can add more fields in the Records settings.</Text> : (
        <>
          <Text style={s.note}>A property is a field of the project type, so every project of this kind can show it.</Text>
          <Select label="Property" value={key} options={options.map((o) => ({ id: o.key, label: o.title }))} onChange={setKey} testID="addprop-key" />
          <View style={s.field}><Text style={s.label}>Value</Text><TextInput accessibilityLabel="Value" testID="addprop-value" value={value} onChangeText={setValue} style={s.input} placeholderTextColor="var(--ink-4)" /></View>
        </>
      )}
    </Dialog>
  );
}

const s = StyleSheet.create({
  note: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string, marginBottom: 8 },
  err: { fontSize: 12.5, color: "var(--danger)" as string, marginTop: 6 },
  field: { gap: 6, marginTop: 10 },
  label: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-3)" as string },
  input: { height: 34, borderRadius: 8, paddingHorizontal: 10, fontSize: 13.5, color: "var(--ink)" as string, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string },
  live: { fontSize: 12.5, color: "var(--ink-3)" as string },
  opt: { height: 30, justifyContent: "center", paddingHorizontal: 8 },
  optText: { fontSize: 13, color: "var(--ink-2)" as string },
  optOn: { color: "var(--accent)" as string, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { height: 28, paddingHorizontal: 10, borderRadius: 14, justifyContent: "center", borderWidth: 1, borderColor: "var(--line-2)" as string },
  chipOn: { backgroundColor: "var(--accent-wash)" as string, borderColor: "var(--accent-line)" as string },
  chipText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  chipTextOn: { color: "var(--accent)" as string, fontWeight: "500" },
  hist: { maxHeight: 320 },
  hrow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  trow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 6, borderRadius: 8 },
  over: { backgroundColor: "var(--hover)" as string },
  hTitle: { fontSize: 13.5, color: "var(--ink)" as string },
  hNote: { fontSize: 12, color: "var(--ink-3)" as string },
  cur: { fontSize: 12, color: "var(--ok)" as string },
  act: { height: 28, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center", backgroundColor: "var(--accent-wash)" as string },
  actText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  inline: { flexDirection: "row", gap: 8, alignItems: "center" },
});
