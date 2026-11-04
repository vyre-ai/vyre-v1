// The sheets over a note: Share (add a person by name, their role Can edit, Can view or Remove; the Space Off, Can view or Can edit; and the sentence about which agents read it),
// Turn into task (filled from the note: title, for whom, due, keep the note) and Turn into record (a type, its fields filled from the note, keep the note). Each sits on the dimmed
// layer; Esc or Cancel closes it and Cmd-Enter makes the task or the record (the page owns those keys). Their small menus are ui/Menu.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Ico } from "./icons.tsx";
import { Layer } from "./NoteDialog.tsx";
import { fillFromNote, noteName, noteShareRows, notePatchOf, recordFields } from "./model.ts";
import type { DueChoice, Note, NoteSharePatch, RecordType, Who } from "./model.ts";
import { AccessSheet } from "../../../../../../ui/src/AccessSheet/index.tsx";

const EVERYONE_ID = "grp_everyone";
import { Btn, TickBox, dom, pressPoint, web } from "./parts.tsx";

export interface Person { id: string; name: string; kind: "person" | "agent"; username?: string }

/* ---------- share ---------- */

export function ShareSheet({ n, who, people, onShare, onCopyLink, onClose }: {
  n: Note; who: Who; people: readonly Person[];
  onShare(patch: NoteSharePatch): void;
  onCopyLink?(): void;
  onClose(): void;
}): ReactElement {
  // the one Access sheet: a note is shared with people (Can view, Can edit) or with the Space; agents read what their person can see, so none are offered
  const inSpace = people.filter((p) => p.kind === "person" && p.id !== n.owner);
  const send = (patch: NoteSharePatch | null): void => { if (patch) onShare(patch); };
  return (
    <AccessSheet
      mode="share" itemType="note" resourceType="file" resourceId={n.noteId} itemName={noteName(n)} target="item" ownerName={who.nameOf(n.owner)} ownerId={n.owner} spaceName={who.spaceName}
      levels={["view", "edit"]} shares={noteShareRows(n, who.nameOf)} allowExternal={false} density="regular"
      {...(n.owner === who.meId ? {} : { maxLevel: "view" as const })}
      directory={{ people: inSpace.map((p) => ({ id: p.id, name: p.name, kind: "person" as const, ...(p.username ? { sub: p.username } : {}) })), space: { id: "space", name: `Everyone in ${who.spaceName}`, kind: "space", subject: { kind: "group", id: EVERYONE_ID } } }}
      meId={who.meId} {...(onCopyLink ? { onCopyLink } : {})}
      onShare={(i) => send(notePatchOf(i))} onUnshare={(i) => send(notePatchOf(i, true))}
      onClose={onClose}
    />
  );
}

/* ---------- turn into task ---------- */

export interface TaskDraft { title: string; who: Person; due: DueChoice; keep: boolean }
export type TaskDone = { taskId: string; key?: string };

export function TaskSheet({ n, draft, setDraft, done, choices, dues, onMake, onOpenTask, onClose }: {
  n: Note; draft: TaskDraft; setDraft(d: TaskDraft): void; done: TaskDone | null; choices: readonly Person[]; dues: readonly DueChoice[];
  onMake(): void; onOpenTask(id: string): void; onClose(): void;
}): ReactElement {
  const menu = useMenu();
  if (done) {
    return (
      <Layer onClose={onClose} testID="task-layer" label="the task">
        <View role="dialog" aria-modal accessibilityLabel="Task made" testID="task-made" style={s.sheet}>
          <View style={s.dn}><Ico name="check" size={15} color="var(--ok)" /><Text style={s.dnText}><Text style={s.dnB}>{`${done.key ?? "Task"} made`}</Text>{" · linked to the note both ways"}</Text></View>
          <Row id="task-made-task" title={draft.title} note={[draft.who.name, draft.due.at === null ? "" : draft.due.label].filter(Boolean).join(" · ")} leading={<View style={s.brn}><Ico name="task" size={16} color="var(--ink-3)" /></View>} onPress={() => onOpenTask(done.taskId)} />
          <Row id="task-made-note" title={noteName(n)} note={draft.keep ? "Kept in Notes, shows the task" : "Archived, opens from the task"} leading={<View style={s.brn}><Ico name="note" size={16} color="var(--ink-3)" /></View>} />
          <View style={s.foot}>
            <Btn label="Open the task" kind="ghost" sm onPress={() => onOpenTask(done.taskId)} testID="task-open" />
            <View style={{ flex: 1 }} />
            <Btn label="Done" kind="primary" onPress={() => onClose()} testID="task-done" />
          </View>
        </View>
      </Layer>
    );
  }
  const whoMenu = (x: number, y: number): void => menu.show(choices.map((p) => ({ label: p.name, checked: p.id === draft.who.id, onSelect: () => setDraft({ ...draft, who: p }) })), x, y, "other", undefined, choices.length > 8 ? { search: "Find a person or agent" } : undefined);
  const dueMenu = (x: number, y: number): void => menu.show(dues.map((d) => ({ label: d.label, checked: d.label === draft.due.label, onSelect: () => setDraft({ ...draft, due: d }) })), x, y, "other");
  return (
    <Layer onClose={onClose} testID="task-layer" label="the task">
      <View role="dialog" aria-modal accessibilityLabel="Turn into task" testID="task-sheet" style={s.sheet}>
        <View style={s.from}><Ico name="task" size={14} color="var(--ink-3)" /><Text numberOfLines={1} style={s.sub}>{`Turn into task · from “${noteName(n)}”`}</Text></View>
        <TextInput value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} accessibilityLabel="Task title" testID="task-title" autoFocus style={s.cct} />
        <View style={s.ccg}>
          <Field k="For"><Pick onPress={whoMenu} testID="task-for" lead={<Avatar name={draft.who.name} seedId={draft.who.id} kind={draft.who.kind} size={18} />} text={draft.who.name} /></Field>
          <Field k="Due"><Pick onPress={dueMenu} testID="task-due" lead={<Ico name="cal" size={14} color="var(--ink-3)" />} text={draft.due.label} /></Field>
          <Field k="Details"><Text style={[s.vs, { lineHeight: 18, paddingVertical: 5 }]}>{"The note’s text goes in the task, with a link back to the note."}</Text></Field>
          <Field k="The note" last><Check on={draft.keep} label="Keep it in Notes" onPress={() => setDraft({ ...draft, keep: !draft.keep })} testID="task-keep" /></Field>
        </View>
        <View style={s.foot}>
          <Text style={s.vs}>{"⌘Enter"}</Text>
          <View style={{ flex: 1 }} />
          <Btn label="Cancel" kind="ghost" sm onPress={() => onClose()} testID="task-cancel" />
          <Btn label="Make task" kind="primary" onPress={() => onMake()} disabled={draft.title.trim() === ""} testID="task-make" />
        </View>
      </View>
      {menu.element}
    </Layer>
  );
}

/* ---------- turn into record ---------- */

export interface RecordDraft { type: string; fields: Record<string, string>; keep: boolean }
export type RecordDone = { recordId: string; name: string; type: string };

export function RecordSheet({ n, types, draft, setDraft, done, onMake, onOpenRecord, onClose }: {
  n: Note; types: readonly RecordType[] | null; draft: RecordDraft; setDraft(d: RecordDraft): void; done: RecordDone | null; onMake(): void; onOpenRecord(id: string, type: string): void; onClose(): void;
}): ReactElement {
  const menu = useMenu();
  const type = types?.find((t) => t.key === draft.type) ?? null;
  const fields = useMemo(() => (type ? recordFields(type) : []), [type]);
  if (done) {
    return (
      <Layer onClose={onClose} testID="record-layer" label="the record">
        <View role="dialog" aria-modal accessibilityLabel="Record made" testID="record-made" style={s.sheet}>
          <View style={s.dn}><Ico name="check" size={15} color="var(--ok)" /><Text style={s.dnText}><Text style={s.dnB}>{done.name || "Record"}</Text>{` · new ${type?.title ?? "record"} record, linked to the note`}</Text></View>
          <View style={s.foot}>
            <Btn label="Open the record" kind="ghost" sm onPress={() => onOpenRecord(done.recordId, done.type)} testID="record-open" />
            <View style={{ flex: 1 }} />
            <Btn label="Done" kind="primary" onPress={() => onClose()} testID="record-done" />
          </View>
        </View>
      </Layer>
    );
  }
  const typeMenu = (x: number, y: number): void => menu.show((types ?? []).map((t) => ({ label: t.title, checked: t.key === draft.type, onSelect: () => setDraft({ ...draft, type: t.key, fields: fillFromNote(t, n) }) })), x, y, "other", undefined, (types ?? []).length > 8 ? { search: "Find a type" } : undefined);
  return (
    <Layer onClose={onClose} testID="record-layer" label="the record">
      <View role="dialog" aria-modal accessibilityLabel="Turn into record" testID="record-sheet" style={s.sheet}>
        <View style={s.from}><Ico name="record" size={14} color="var(--ink-3)" /><Text numberOfLines={1} style={s.sub}>{`Turn into record · from “${noteName(n)}”`}</Text></View>
        <View style={s.ccg}>
          <Field k="Type">
            {types === null ? <Text style={s.vs}>Reading the record types</Text> : types.length === 0 ? <Text style={s.vs}>This Space has no record types yet.</Text> : <Pick onPress={typeMenu} testID="record-type" lead={<Ico name="table" size={14} color="var(--ink-3)" />} text={type?.title ?? "Pick a type"} />}
            {type ? <Text style={s.vs}>{`Records › ${type.plural}`}</Text> : null}
          </Field>
          {/* ui-rows-lint: not a list (the label and value pairs of a form) */}
          {fields.map((f) => (
            <Field key={f.key} k={f.title}>
              <TextInput value={draft.fields[f.key] ?? ""} onChangeText={(v) => setDraft({ ...draft, fields: { ...draft.fields, [f.key]: v } })} accessibilityLabel={f.title} testID={`record-field-${f.key}`} placeholder="Empty" placeholderTextColor="var(--ink-4)" style={s.fv} />
            </Field>
          ))}
          <Field k="The note" last><Check on={draft.keep} label="Attach it to the record, keep it in Notes" onPress={() => setDraft({ ...draft, keep: !draft.keep })} testID="record-keep" /></Field>
        </View>
        {type ? (
          <View style={s.why}>
            <Ico name="spark" size={15} color="var(--ink-3)" />
            <Text style={s.whyText}>Filled from the note. Check them before you make it.</Text>
          </View>
        ) : null}
        <View style={s.foot}>
          <Text style={s.vs}>{"⌘Enter"}</Text>
          <View style={{ flex: 1 }} />
          <Btn label="Cancel" kind="ghost" sm onPress={() => onClose()} testID="record-cancel" />
          <Btn label="Make record" kind="primary" onPress={() => onMake()} disabled={type === null || (draft.fields[type.titleField] ?? "").trim() === ""} testID="record-make" />
        </View>
      </View>
      {menu.element}
    </Layer>
  );
}

/* ---------- pieces ---------- */

function Field({ k, children, last = false }: { k: string; children: ReactElement | (ReactElement | null)[]; last?: boolean }): ReactElement {
  return (
    <View style={[s.fieldRow, last ? null : null]}>
      <Text style={s.k}>{k}</Text>
      <View style={s.v}>{children}</View>
    </View>
  );
}

function Pick({ onPress, lead, text, testID }: { onPress(x: number, y: number): void; lead: ReactElement; text: string; testID: string }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={text} testID={testID} onPress={(e) => { const p = pressPoint(e); onPress(p.x, p.y); }} style={s.pick} {...dom({ dataSet: { nbtn: "ghost" } })}>
      {lead}
      <Text style={s.pickText}>{text}</Text>
      <View style={{ transform: [{ rotate: "90deg" }] }}><Ico name="chev" size={10} color="var(--ink-4)" /></View>
    </Pressable>
  );
}

function Check({ on, label, onPress, testID }: { on: boolean; label: string; onPress(): void; testID: string }): ReactElement {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label} testID={testID} onPress={onPress} style={s.cb}>
      <TickBox on={on} />
      <Text style={s.cbText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  sheet: { width: "100%", maxWidth: 460, borderRadius: 16, backgroundColor: "var(--raised)" as string, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 16, ...(web ? ({ boxShadow: "var(--sh-pop)" } as object) : null) },
  h2: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, color: "var(--ink-3)" as string, marginTop: 2, flexShrink: 1 },
  from: { flexDirection: "row", alignItems: "center", gap: 6 },
  fld: { flexDirection: "row", alignItems: "center", gap: 8, height: 36, paddingHorizontal: 10, borderRadius: 9, backgroundColor: "var(--field)" as string, marginTop: 14 },
  fldInput: { flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--ink)" as string, ...(web ? ({ outlineStyle: "none" } as object) : null) },
  sug: { marginTop: 6, borderRadius: 10, padding: 4, ...(web ? ({ boxShadow: "inset 0 0 0 1px var(--line)" } as object) : null) },
  vs: { fontSize: 12.5, color: "var(--ink-3)" as string },
  slab: { fontSize: 11.5, color: "var(--ink-4)" as string, marginTop: 16, marginBottom: 4 },
  face: { width: 26, height: 44, marginRight: 10, alignItems: "center", justifyContent: "center" },
  tile: { height: 26, borderRadius: 8, backgroundColor: "var(--accent)" as string },
  tileText: { fontSize: 12, fontWeight: "600", color: "var(--accent-ink)" as string },
  role: { flexDirection: "row", alignItems: "center", gap: 4, height: 26, paddingLeft: 8, paddingRight: 6, borderRadius: 7 },
  roleText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  why: { flexDirection: "row", gap: 9, marginTop: 14, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  whyText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  foot: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16 },
  cct: { width: "100%", fontSize: 17, lineHeight: 24, fontWeight: "600", color: "var(--ink)" as string, marginTop: 12, ...(web ? ({ outlineStyle: "none" } as object) : null) },
  ccg: { marginTop: 12 },
  fieldRow: { flexDirection: "row", alignItems: "stretch", gap: 12 },
  k: { width: 96, fontSize: 12.5, color: "var(--ink-3)" as string, paddingTop: 9, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  v: { flex: 1, minHeight: 38, flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", paddingVertical: 4, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  fv: { flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--ink)" as string, height: 28, ...(web ? ({ outlineStyle: "none" } as object) : null) },
  pick: { flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingLeft: 8, paddingRight: 6, marginLeft: -8, borderRadius: 6 },
  pickText: { fontSize: 13.5, color: "var(--ink)" as string },
  cb: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 28 },
  cbText: { fontSize: 13.5, color: "var(--ink-2)" as string },
  dn: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 30 },
  dnText: { fontSize: 13, color: "var(--ink-3)" as string, flexShrink: 1 },
  dnB: { fontWeight: "500", color: "var(--ink-2)" as string },
  brn: { width: 18, marginRight: 10, alignItems: "center" },
});
