// The work baton on the task page (work baton, lane W2): the stepper with faces and the holder lit, the brief pinned and collapsed, the deliverable card, the fixes as a checklist, and the
// buttons for the person whose turn it is. Less text: faces and states carry it, a hover explains. The page passes data in and gets commands out; nothing here reads or writes by itself.
import { useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Avatar } from "../Avatar/index.tsx";
import type { TaskRef } from "./model.ts";
import { fixesFromText } from "./baton.ts";
import type { BatonStep, Deliverable, MyMove } from "./baton.ts";

const tip = (title: string): Record<string, unknown> => (Platform.OS === "web" ? { title } : {});
const faceKind = (who: TaskRef): "person" | "agent" | "group" | "automation" => (who.kind === "role" ? "group" : who.kind);

export interface Namer { name(id: string): string }

const STEP_TIP: Record<string, string> = { assigned: "Does the work", review: "Checks it against what done means", approve: "Decides it may go ahead", done: "Finished" };

/** Do, Review, Approve, Done: a face under each step that has someone, the holder lit, finished steps ticked. */
export function Stepper({ steps, namer }: { steps: readonly BatonStep[]; namer: Namer }): ReactElement {
  return <View testID="baton-stepper" accessibilityRole="list" style={s.stepper}>
    {/* ui-rows-lint: not a list (four steps of a stepper, not rows) */}
    {steps.map((step, i) => <View key={step.key} style={s.stepWrap}>
      {i > 0 ? <View style={[s.link, steps[i - 1]!.lit === "past" && s.linkDone]} /> : null}
      <View accessibilityRole="text" testID={`baton-step-${step.key}`} accessibilityLabel={`${step.title}${step.who ? `, ${namer.name(step.who.id)}` : ""}${step.lit === "now" ? ", now" : step.lit === "past" ? ", done" : ""}`} {...tip(`${STEP_TIP[step.key]}${step.who ? `: ${namer.name(step.who.id)}` : ""}`)} style={[s.step, step.lit === "now" && s.stepNow]}>
        {step.who ? <Avatar name={namer.name(step.who.id)} seedId={step.who.id} kind={faceKind(step.who)} size={22} /> : <View style={[s.dot, step.lit === "past" && s.dotDone]}><Text style={[s.tick, step.lit !== "past" && { opacity: 0.35 }]}>{"✓"}</Text></View>}
        <Text style={[s.stepTitle, step.lit === "now" && s.stepTitleNow, step.lit === "past" && s.stepTitlePast]}>{step.title}</Text>
      </View>
    </View>)}
  </View>;
}

/** The brief, pinned under the title and collapsed to two lines; a tap opens it with what done means. */
export function BriefCard({ text, doneMeans }: { text: string; doneMeans: readonly string[] }): ReactElement {
  const [open, setOpen] = useState(false);
  const body = text.replace(/^## .+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return <Pressable testID="baton-brief" accessibilityRole="button" accessibilityLabel="Brief" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} {...tip(open ? "Collapse the brief" : "Open the brief")} style={s.card}>
    <View style={s.cardHead}><Text style={s.cardTitle}>Brief</Text><Text style={s.cardMeta}>{open ? "−" : "+"}</Text></View>
    <Text numberOfLines={open ? undefined : 2} style={s.cardBody}>{body}</Text>
    {/* ui-rows-lint: not a list (a few checklist lines in a card) */}
    {open && doneMeans.length > 0 ? <View style={s.doneBox}><Text style={s.cardTitle}>Done means</Text>{doneMeans.map((d) => <Text key={d} style={s.cardBody}>{`• ${d}`}</Text>)}</View> : null}
  </Pressable>;
}

/** What was handed in: the one-line summary and each output as a named field. */
export function DeliverableCard({ deliverable, by }: { deliverable: Deliverable; by?: string }): ReactElement {
  return <View testID="baton-deliverable" style={s.card}>
    <View style={s.cardHead}><Text style={s.cardTitle}>Handed in</Text>{by ? <Text style={s.cardMeta}>{by}</Text> : null}</View>
    {deliverable.summary ? <Text style={s.cardBody}>{deliverable.summary}</Text> : null}
    {/* ui-rows-lint: not a list (fields and lines inside a card) */}
    {deliverable.fields.map((f) => <View key={f.name} style={s.field}><Text style={s.fieldName}>{f.name}</Text><Text selectable style={s.cardBody}>{f.value}</Text></View>)}
  </View>;
}

/** The fixes asked for, numbered, each tickable as the doer works through them. The ticks are the doer's own reminder; the task keeps the list. */
export function FixesList({ fixes }: { fixes: readonly string[] }): ReactElement {
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  return <View testID="baton-fixes" style={s.card}>
    <Text style={s.cardTitle}>Fixes asked for</Text>
    {/* ui-rows-lint: not a list (fields and lines inside a card) */}
    {fixes.map((fix, i) => <Pressable key={`${i}-${fix}`} accessibilityRole="checkbox" accessibilityLabel={fix} accessibilityState={{ checked: done.has(i) }} onPress={() => setDone((cur) => { const n = new Set(cur); if (n.has(i)) n.delete(i); else n.add(i); return n; })} style={s.fix}>
      <View style={[s.box, done.has(i) && s.boxOn]}>{done.has(i) ? <Text style={s.boxTick}>{"✓"}</Text> : null}</View>
      <Text style={[s.cardBody, { flex: 1 }, done.has(i) && s.struck]}>{`${i + 1}. ${fix}`}</Text>
    </Pressable>)}
  </View>;
}

export interface BatonCall { cap: "tasks.submit" | "tasks.review" | "tasks.decide"; input: Record<string, unknown>; message: string }

/** The buttons for the person whose turn it is: hand in, approve or send back with fixes, approve or reject with a reason. Their words go where the agent's tool would put them. */
export function BatonActions({ move, wanted, busy, onCall }: { move: Exclude<MyMove, null>; wanted: ReadonlyArray<{ name: string; required: boolean }>; busy: boolean; onCall(call: BatonCall): void }): ReactElement {
  const [text, setText] = useState(""), [mode, setMode] = useState<"" | "send_back" | "reject">(""), [outputs, setOutputs] = useState<Record<string, string>>({}), [problem, setProblem] = useState("");
  const btn = (title: string, press: () => void, primary = false, hint = ""): ReactElement => <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={busy} onPress={press} {...tip(hint || title)} style={[s.btn, primary && s.btnPrimary, busy && { opacity: 0.45 }]}><Text style={[s.btnText, primary && { color: "var(--accent-ink)" as string }]}>{title}</Text></Pressable>;
  const fail = (m: string): void => setProblem(m);
  const submit = (): void => {
    if (!text.trim()) return fail("Say in one line what you did.");
    const missing = wanted.find((f) => f.required && !(outputs[f.name] ?? "").trim());
    if (missing) return fail(`Fill in ${missing.name}.`);
    setProblem("");
    const filled = Object.fromEntries(Object.entries(outputs).filter(([, v]) => v.trim() !== ""));
    onCall({ cap: "tasks.submit", input: { summary: text.trim(), outputs: filled }, message: "Handed in" });
  };
  const sendBack = (): void => {
    const fixes = fixesFromText(text);
    if (fixes.length === 0) return fail("Write what to change, one fix per line.");
    setProblem(""); onCall({ cap: "tasks.review", input: { verdict: "send_back", fixes }, message: "Sent back" });
  };
  const reject = (): void => {
    if (!text.trim()) return fail("Say why.");
    setProblem(""); onCall({ cap: "tasks.decide", input: { verdict: "reject", reason: text.trim() }, message: "Rejected" });
  };
  return <View testID="baton-actions" style={s.card}>
    {move === "work" ? <>
      {/* ui-rows-lint: not a list (fields and lines inside a card) */}
      {wanted.map((f) => <View key={f.name} style={s.field}><Text style={s.fieldName}>{f.required ? f.name : `${f.name} (optional)`}</Text><TextInput accessibilityLabel={f.name} value={outputs[f.name] ?? ""} onChangeText={(v) => setOutputs({ ...outputs, [f.name]: v })} editable={!busy} multiline style={s.input} /></View>)}
      <TextInput accessibilityLabel="What you did" placeholder="What you did, in one line" value={text} onChangeText={setText} editable={!busy} style={s.input} />
      <View style={s.row}>{btn("Hand in", submit, true, "Pass it to the next step")}</View>
    </> : null}
    {move === "review" ? <>
      {mode === "send_back" ? <TextInput accessibilityLabel="Fixes" placeholder={"One fix per line"} value={text} onChangeText={setText} editable={!busy} multiline style={[s.input, { minHeight: 74 }]} /> : null}
      <View style={s.row}>{mode === "send_back" ? <>{btn("Send back", sendBack, true, "Back to the doer with these fixes")}{btn("Cancel", () => { setMode(""); setProblem(""); })}</> : <>{btn("Looks good", () => onCall({ cap: "tasks.review", input: { verdict: "approve" }, message: "Approved" }), true, "Everything on Done means holds")}{btn("Send back", () => setMode("send_back"), false, "Ask for numbered changes")}</>}</View>
    </> : null}
    {move === "approve" ? <>
      {mode === "reject" ? <TextInput accessibilityLabel="Reason" placeholder="Why not" value={text} onChangeText={setText} editable={!busy} multiline style={[s.input, { minHeight: 56 }]} /> : null}
      <View style={s.row}>{mode === "reject" ? <>{btn("Reject", reject, true, "Back to the doer with your reason")}{btn("Cancel", () => { setMode(""); setProblem(""); })}</> : <>{btn("Approve", () => onCall({ cap: "tasks.decide", input: { verdict: "approve" }, message: "Approved" }), true, "Done; held actions go out")}{btn("Reject", () => setMode("reject"), false, "Send it back with a reason")}</>}</View>
    </> : null}
    {problem ? <Text accessibilityRole="alert" style={s.problem}>{problem}</Text> : null}
  </View>;
}

const s = StyleSheet.create({
  stepper: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 0, paddingVertical: 4 },
  stepWrap: { flexDirection: "row", alignItems: "center" },
  link: { width: 22, height: 2, backgroundColor: "var(--line)" as string, marginHorizontal: 6, borderRadius: 1 },
  linkDone: { backgroundColor: "var(--accent)" as string },
  step: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, borderWidth: 1, borderColor: "transparent" },
  stepNow: { borderColor: "var(--accent)" as string, backgroundColor: "var(--hover)" as string },
  stepTitle: { fontSize: 12.5, color: "var(--ink-3)" as string },
  stepTitleNow: { color: "var(--ink)" as string, fontWeight: "600" },
  stepTitlePast: { color: "var(--ink-2)" as string },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "var(--line)" as string },
  dotDone: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  tick: { fontSize: 12, color: "var(--accent-ink)" as string },
  card: { gap: 8, padding: 14, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 10, backgroundColor: "var(--win)" as string },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 12, fontWeight: "600", color: "var(--ink-3)" as string, letterSpacing: 0.3 },
  cardMeta: { fontSize: 12, color: "var(--ink-3)" as string },
  cardBody: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  doneBox: { gap: 4, paddingTop: 6 },
  field: { gap: 3 },
  fieldName: { fontSize: 12, color: "var(--ink-3)" as string },
  fix: { flexDirection: "row", alignItems: "flex-start", gap: 9, paddingVertical: 2 },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: "var(--ink-3)" as string, alignItems: "center", justifyContent: "center", marginTop: 1 },
  boxOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  boxTick: { fontSize: 11, color: "var(--accent-ink)" as string },
  struck: { textDecorationLine: "line-through", color: "var(--ink-3)" as string },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7, padding: 10, minHeight: 38, color: "var(--ink)" as string, fontSize: 13.5 },
  btn: { minHeight: 34, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7 },
  btnPrimary: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  btnText: { fontSize: 13, color: "var(--ink)" as string },
  problem: { fontSize: 12.5, color: "var(--danger)" as string },
});
