// The Overview's sheets: a live block's settings, the page's history, the template chooser and save-as-template, and a new property. Each is the one ui/Dialog.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Dialog } from "../../../../../../../ui/src/Dialog/index.tsx";
import { Avatar } from "../../../../../../../ui/src/Avatar/index.tsx";
import { useProjectPageData } from "../data.tsx";
import { SPEC_CHOICES, VIEWS, kindOf, liveReady, liveTitle, revisionLine } from "./model.ts";
import type { PageTemplate, Revision, View as LiveView } from "./model.ts";
import type { LiveAttrs } from "./LiveBlockView.tsx";

function Chips<T extends string>({ label, value, options, onChange, testID }: { label: string; value: T; options: readonly { id: T; label: string }[]; onChange(v: T): void; testID: string }): ReactElement {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => (
          <Pressable key={o.id} accessibilityRole="radio" accessibilityState={{ checked: value === o.id }} accessibilityLabel={o.label} testID={`${testID}-${o.id || "any"}`} onPress={() => onChange(o.id)} style={[s.chip, value === o.id && s.chipOn]}>
            <Text style={[s.chipText, value === o.id && s.chipTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** The settings of one live block: its title, what it filters on, and how it is drawn. Saving writes them to the block (the page then saves like any edit). */
export function LiveSettings({ attrs, onSave, onClose }: { attrs: LiveAttrs; onSave(next: { spec: Record<string, unknown>; view: string }): void; onClose(): void }): ReactElement {
  const d = useProjectPageData();
  const kind = kindOf(attrs.type);
  const [spec, setSpec] = useState<Record<string, unknown>>({ ...((attrs.spec ?? {}) as Record<string, unknown>) });
  const [view, setView] = useState<string>(attrs.view || kind?.defaultView || "list");
  const [types, setTypes] = useState<{ key: string; title: string }[]>([]);
  useEffect(() => {
    if (attrs.type !== "records" && attrs.type !== "metric") return;
    void Promise.resolve(d.call("schema.types.list", {})).then((o) => setTypes(((o as { types?: { key: string; plural?: string; title?: string }[] }).types ?? []).map((t) => ({ key: t.key, title: t.plural ?? t.title ?? t.key })))).catch(() => undefined);
  }, [d, attrs.type]);
  const set = (k: string, v: unknown): void => setSpec((cur) => { const n = { ...cur }; if (v === "" || v === undefined) delete n[k]; else n[k] = v; return n; });
  const choices = SPEC_CHOICES[attrs.type as keyof typeof SPEC_CHOICES] ?? [];
  const ready = liveReady(attrs.type, spec);
  const needsType = attrs.type === "records" || attrs.type === "metric";
  return (
    <Dialog title={kind?.label ?? "Live block"} onClose={onClose} testID="live-settings" actions={[{ label: "Cancel", onPress: onClose, testID: "live-settings-cancel" }, { label: "Save", primary: true, disabled: !ready, why: "Choose what this shows first", onPress: () => onSave({ spec, view }), testID: "live-settings-save" }]}>
      <Text style={s.note}>A live block shows the project&apos;s real data. It saves a filter and a view, never a copy.</Text>
      <View style={s.field}><Text style={s.label}>Title</Text><TextInput accessibilityLabel="Title" testID="live-title" value={String(spec["title"] ?? "")} onChangeText={(v) => set("title", v)} placeholder={liveTitle(attrs.type, {})} placeholderTextColor="var(--ink-4)" style={s.input} /></View>
      {needsType ? (
        <View style={s.field}>
          <Text style={s.label}>Record type</Text>
          {types.length > 0 ? (
            <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Record type">
              {types.map((t) => <Pressable key={t.key} accessibilityRole="radio" accessibilityState={{ checked: spec["type"] === t.key }} accessibilityLabel={t.title} testID={`live-type-${t.key}`} onPress={() => set("type", t.key)} style={[s.chip, spec["type"] === t.key && s.chipOn]}><Text style={[s.chipText, spec["type"] === t.key && s.chipTextOn]}>{t.title}</Text></Pressable>)}
            </View>
          ) : <TextInput accessibilityLabel="Record type" testID="live-type" value={String(spec["type"] ?? "")} onChangeText={(v) => set("type", v.trim())} placeholder="The record type's key" placeholderTextColor="var(--ink-4)" style={s.input} />}
        </View>
      ) : null}
      {choices.map((c) => <Chips key={c.key} label={c.label} value={String(spec[c.key] ?? c.choices[0]?.id ?? "")} options={c.choices} onChange={(v) => set(c.key, v === "" ? undefined : v)} testID={`live-spec-${c.key}`} />)}
      {attrs.type === "metric" && spec["op"] === "sum" ? <View style={s.field}><Text style={s.label}>Field to add up</Text><TextInput accessibilityLabel="Field to add up" testID="live-field" value={String(spec["field"] ?? "")} onChangeText={(v) => set("field", v.trim())} placeholder="amount" placeholderTextColor="var(--ink-4)" style={s.input} /></View> : null}
      {kind && kind.views.length > 1 ? <Chips label="View" value={view as LiveView} options={VIEWS.filter((v) => kind.views.includes(v.id))} onChange={(v) => setView(v)} testID="live-view" /> : null}
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
  return (
    <Dialog title="History" onClose={onClose} testID="overview-history" actions={[{ label: "Done", primary: true, onPress: onClose, testID: "overview-history-done" }]}>
      <Text style={s.note}>Every change is a version, with who made it. Undo takes back the latest one.</Text>
      <ScrollView style={s.hist} testID="overview-history-list">
        {rows === null ? <Text style={s.note}>Loading…</Text> : rows.map((r, i) => {
          const who = r.by === me ? "you" : d.nameOf(r.by);
          const l = revisionLine(r, who, now);
          return (
            <View key={r.rev} style={s.hrow} testID={`rev-${r.rev}`}>
              <Avatar name={d.nameOf(r.by)} kind={r.authorKind === "agent" ? "agent" : "person"} size={22} />
              <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={2} style={s.hTitle}>{l.title}</Text><Text style={s.hNote}>{l.note}</Text></View>
              {i === 0 ? (canEdit && r.undoOf === undefined && rows.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel={`Undo version ${r.rev}`} testID={`rev-undo-${r.rev}`} onPress={() => void undo(r.rev)} style={s.act}><Text style={s.actText}>Undo</Text></Pressable> : <Text style={s.cur}>Current</Text>) : null}
            </View>
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
        <Pressable key={t.templateId} accessibilityRole="button" accessibilityLabel={t.title} testID={`tpl-${t.templateId}`} disabled={!canEdit} onPress={() => onApply(t)} style={({ hovered }: { hovered?: boolean }) => [s.trow, hovered === true && s.over]}>
          <View style={{ flex: 1, minWidth: 0 }}><Text style={s.hTitle}>{t.title}</Text>{t.summary ? <Text numberOfLines={2} style={s.hNote}>{t.summary}</Text> : null}</View>
          <Text style={s.hNote}>{t.blocks} blocks</Text>
        </Pressable>
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
          <Chips label="Property" value={key} options={options.map((o) => ({ id: o.key, label: o.title }))} onChange={setKey} testID="addprop-key" />
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
