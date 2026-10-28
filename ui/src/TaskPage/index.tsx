import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Row } from "../Row/index.tsx";
import { useMenu } from "../Menu/index.tsx";
import { actionInput, TASK_STATES, taskDue } from "./model.ts";
import type { TaskCap, TaskRef, TaskView } from "./model.ts";
export type { TaskCap, TaskRef, TaskView } from "./model.ts";

export interface TaskPageProps {
  task: TaskView; me: string; online: boolean;
  principals: readonly (TaskRef & { name: string })[];
  history: readonly { eventId: string; at: number; type: string; by: string; note?: string }[];
  onCommand(cap: TaskCap, input: Record<string, unknown>): Promise<void>;
  onBack(): void; onOpen(type: string, id: string): void;
  children?: ReactNode; nameOf?(type: string, id: string): string;
}
const label = (value: string): string => value.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
const dueInput = (at: number | undefined): string => at === undefined ? "" : new Date(at - new Date(at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function TaskPage({ task, me, principals, history, online, onCommand, onBack, onOpen, nameOf, children }: TaskPageProps): ReactElement {
  const menu = useMenu(), width = useWindowDimensions().width;
  const narrow = width > 0 && width < 720;
  const [tab, setTab] = useState("task"), [note, setNote] = useState(""), [answer, setAnswer] = useState("");
  const [editing, setEditing] = useState(false), [title, setTitle] = useState(task.title), [summary, setSummary] = useState(task.summary ?? ""), [why, setWhy] = useState(task.why ?? "");
  const [due, setDue] = useState(dueInput(task.due)), [effort, setEffort] = useState(task.effort === undefined ? "" : String(task.effort));
  const [noteKey, setNoteKey] = useState(""), [noteValue, setNoteValue] = useState("");
  const [busy, setBusy] = useState(false), [line, setLine] = useState(""), [error, setError] = useState("");
  const inflight = useRef(false);
  const who = (id: string): string => principals.find((person) => person.id === id)?.name ?? "Unavailable teammate";
  const named = (type: string, id: string): string => nameOf?.(type, id) ?? (type === "person" || type === "agent" ? who(id) : `Linked ${type}`);
  const run = async (cap: TaskCap, input: Record<string, unknown>, message: string): Promise<boolean> => {
    if (inflight.current || !online) return false;
    inflight.current = true; setBusy(true); setError(""); setLine("");
    try { await onCommand(cap, { taskId: task.id, ...input }); setLine(message); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The task could not be changed. Try again."); return false; }
    finally { inflight.current = false; setBusy(false); }
  };
  const button = (title: string, onPress: () => void, primary = false): ReactElement => <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={busy || !online} onPress={onPress} style={[s.button, primary && s.primary, (busy || !online) && { opacity: 0.45 }]}><Text style={[s.buttonText, primary && { color: "var(--accent-ink)" as string }]}>{title}</Text></Pressable>;
  const field = (title: string, value: string, change: (value: string) => void, multiline = false): ReactElement => <View style={s.field}><Text style={s.label}>{title}</Text><TextInput accessibilityLabel={title} value={value} onChangeText={change} editable={!busy} multiline={multiline} style={[s.input, multiline && { minHeight: 74 }]} /></View>;
  const chooseSlot = (slot: "assigned" | "reviewer" | "approver", x: number, y: number): void => menu.show([
    ...principals.map((person) => ({ label: `${person.name} · ${label(person.kind)}`, checked: task[slot]?.id === person.id, onSelect: () => void run("tasks.assign", { slot, to: { kind: person.kind, id: person.id } }, `${label(slot)} updated`) })),
    ...(slot === "assigned" ? [] : [{ label: "Clear", onSelect: () => void run("tasks.assign", { slot, to: null }, `${label(slot)} cleared`) }]),
  ], x, y, "other");
  const status = (): void => menu.show(TASK_STATES.map((state) => ({ label: state.title, checked: task.state === state.key, onSelect: () => void run("tasks.transition", { to: state.key, expectedFrom: task.state, ...(note.trim() ? { note: note.trim() } : {}) }, `Status: ${state.title}`) })), 20, 110, "other");
  const act = (key: string): void => {
    if (key === "take") { void run("tasks.take", {}, "Task taken"); return; }
    if (key === "snooze") { void run("tasks.snooze", { until: Date.now() + 86_400_000 }, "Snoozed for 24 hours"); return; }
    if (key === "delegate") { menu.show(principals.filter((person) => person.id !== me).map((person) => ({ label: person.name, onSelect: () => void run("tasks.delegate", { to: { kind: person.kind, id: person.id }, ...(note.trim() ? { note: note.trim() } : {}) }, "Task handed over") })), 20, 110, "other"); return; }
    try { const input = actionInput(task, key, note, answer); void run("tasks.act", input, "Action completed").then((ok) => { if (ok) { setNote(""); setAnswer(""); } }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Check this action."); }
  };
  const save = (): void => {
    try {
      if (!title.trim()) throw new Error("Give this task a title.");
      if (effort.trim() && (!/^\d+$/.test(effort.trim()) || !Number.isSafeInteger(Number(effort)))) throw new Error("Effort must be whole minutes.");
      const input = { title: title.trim(), summary, why, due: taskDue(due), effort: effort.trim() ? Number(effort) : null };
      void run("tasks.update", input, "Task updated").then((ok) => { if (ok) setEditing(false); });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Check the task fields."); }
  };
  return <View testID="task-page" style={s.root}>
    <View style={s.toolbar}><Pressable accessibilityRole="button" onPress={onBack}><Text style={s.quiet}>‹ My work</Text></Pressable><View style={{ flex: 1 }} />{button(task.followers.includes(me) ? "Unfollow" : "Follow", () => void run(task.followers.includes(me) ? "tasks.followers.remove" : "tasks.followers.add", { follower: me }, task.followers.includes(me) ? "Unfollowed" : "Following"))}{button("Edit task", () => { setTitle(task.title); setSummary(task.summary ?? ""); setWhy(task.why ?? ""); setDue(dueInput(task.due)); setEffort(task.effort === undefined ? "" : String(task.effort)); setEditing(true); })}</View>
    <ScrollView contentContainerStyle={[s.page, narrow && { padding: 18 }]}>
      {task.source?.kind === "journey" ? <Row title="Journey" note={named("journey", task.source.id)} onPress={() => onOpen("journey", task.source!.id)} /> : null}
      <View style={s.heading}><Pressable accessibilityRole="button" accessibilityLabel="Task status" disabled={busy || !online} onPress={status} style={s.status}><Text style={s.buttonText}>{TASK_STATES.find((state) => state.key === task.state)?.title ?? task.state}</Text></Pressable><Text style={s.quiet}>{label(task.kind)}{task.blocked ? " · Blocked" : ""}</Text></View>
      <Text accessibilityRole="header" style={s.title}>{task.title}</Text>{task.summary ? <Text style={s.summary}>{task.summary}</Text> : null}
      {!online ? <Text accessibilityRole="status" style={s.quiet}>Offline, showing your saved task. Reconnect to make changes.</Text> : null}
      {/* ui-rows-lint: not a list (two navigation tabs) */}
      <View style={s.tabs}>{["task", "activity"].map((id) => <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} onPress={() => setTab(id)} style={[s.tab, tab === id && s.activeTab]}><Text style={s.buttonText}>{label(id)}</Text></Pressable>)}</View>
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}{line ? <Text accessibilityRole="status" style={s.quiet}>{line}</Text> : null}
      {tab === "activity" ? <View>{history.length ? history.map((entry) => <Row key={entry.eventId} title={label(entry.type.replace(/^task\./, ""))} note={`${who(entry.by)} · ${new Date(entry.at).toLocaleString()}${entry.note ? ` · ${entry.note}` : ""}`} />) : <Text style={s.quiet}>No activity yet.</Text>}</View> : <View style={[s.columns, narrow && { flexDirection: "column" }]}>
        <View style={s.main}>
          {editing ? <View style={s.form}>{field("Task title", title, setTitle)}{field("Summary", summary, setSummary)}{field("Why", why, setWhy, true)}{field("Due date and time", due, setDue)}{field("Effort in minutes", effort, setEffort)}<View style={s.actions}>{button("Save task", save, true)}{button("Cancel editing", () => setEditing(false))}</View></View> : task.why ? <Text style={s.body}>{task.why}</Text> : null}
          {children}
          {/* ui-rows-lint: not a list (horizontal decision action toolbar) */}
          {task.actions.length ? <View style={s.form}>{field("Action note", note, setNote, true)}{task.kind === "answer" ? field("Answer", answer, setAnswer, true) : null}<View style={s.actions}>{task.actions.map((action) => <View key={action.key}>{button(action.label, () => act(action.key), action.key === task.actions[0]?.key)}</View>)}</View></View> : null}
          <Text style={s.section}>Working notes</Text>{Object.entries(task.workingNotes).map(([key, value]) => <Row key={key} title={key} note={value} trailing={button(`Remove ${key}`, () => void run("tasks.working_notes.delete", { key }, "Note removed"))} />)}
          {field("Note name", noteKey, setNoteKey)}{field("Working note", noteValue, setNoteValue, true)}{button("Save working note", () => { if (!noteKey.trim()) { setError("Name this working note."); return; } void run("tasks.working_notes.set", { key: noteKey.trim(), value: noteValue }, "Working note saved").then((ok) => { if (ok) { setNoteKey(""); setNoteValue(""); } }); })}
        </View>
        <View style={[s.properties, narrow && { width: "100%" }]}>
          {(["assigned", "reviewer", "approver"] as const).map((slot) => <Row key={slot} title={label(slot)} note={task[slot] ? who(task[slot]!.id) : "Not assigned"} onPress={() => chooseSlot(slot, 20, 140)} />)}
          <Row title="Due" note={task.due === undefined ? "No due date" : new Date(task.due).toLocaleString()} /><Row title="Effort" note={task.effort === undefined ? "Not estimated" : `${task.effort} min`} />
          {task.takenBy ? <Row title="Taken by" note={who(task.takenBy)} trailing={task.takenBy === me ? button("Give back", () => void run("tasks.release", {}, "Task released")) : null} /> : (task.assigned.kind === "group" || task.assigned.kind === "role") ? button("Take task", () => void run("tasks.take", {}, "Task taken")) : null}
          {task.snoozedUntil ? <Row title="Snoozed until" note={new Date(task.snoozedUntil).toLocaleString()} trailing={button("Clear snooze", () => void run("tasks.snooze", { until: null }, "Snooze cleared"))} /> : null}
          {task.source ? <Row title="Source" note={named(task.source.kind, task.source.id)} onPress={() => onOpen(task.source!.kind, task.source!.id)} /> : null}
          {task.recordId ? <Row title="Record" note={named("record", task.recordId)} onPress={() => onOpen("record", task.recordId!)} /> : null}
          {task.fileIds.map((id) => <Row key={id} title={named("file", id)} onPress={() => onOpen("file", id)} />)}
          {task.dependsOn.map((id) => <Row key={id} title="Depends on" note={named("task", id)} onPress={() => onOpen("task", id)} />)}
          {task.threadId ? <Row title="Discussion" onPress={() => onOpen("thread", task.threadId!)} /> : null}
        </View>
      </View>}
    </ScrollView>{menu.element}
  </View>;
}
const s = StyleSheet.create({ root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string }, toolbar: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 24, borderBottomWidth: 1, borderColor: "var(--line)" as string }, page: { padding: 28, gap: 18, width: "100%", maxWidth: 1180, alignSelf: "center" }, heading: { flexDirection: "row", alignItems: "center", gap: 12 }, title: { fontSize: 28, fontWeight: "600", letterSpacing: -0.65, color: "var(--ink)" as string }, summary: { fontSize: 15, lineHeight: 23, color: "var(--ink-2)" as string }, quiet: { fontSize: 12.5, color: "var(--ink-3)" as string }, body: { fontSize: 14, lineHeight: 23, color: "var(--ink)" as string }, columns: { flexDirection: "row", gap: 28 }, main: { flex: 1, minWidth: 0, gap: 14 }, properties: { width: 260, gap: 6 }, tabs: { flexDirection: "row", gap: 18, borderBottomWidth: 1, borderColor: "var(--line)" as string }, tab: { paddingVertical: 10, borderBottomWidth: 2, borderColor: "transparent" }, activeTab: { borderColor: "var(--accent)" as string }, status: { paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7 }, field: { gap: 6 }, label: { fontSize: 12, color: "var(--ink-3)" as string }, input: { borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7, padding: 10, minHeight: 38, color: "var(--ink)" as string }, form: { gap: 12 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, button: { minHeight: 32, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7 }, primary: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string }, buttonText: { fontSize: 12.5, color: "var(--ink)" as string }, error: { fontSize: 13, color: "var(--danger)" as string }, section: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string } });
