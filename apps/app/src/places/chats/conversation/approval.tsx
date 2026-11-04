// The approval card of a chat (rc.8). A turn that parks on a hold (Ask mode before a change, or any mode before something leaves Vyre) leaves a turn_status "waiting" block with the hold's task.
// The card reads that task and answers it here: what the agent wants to do, a short excerpt, Allow and Deny. Deny asks for an optional reason that goes back to the agent. An answered card
// collapses to one line ("Allowed · edit Q4 pricing.docx"). The same task is in Needs you; answering in either place answers both: the card reads the task on every change in the Space, so it never offers a
// choice that is gone, and a press that was too late hears "Already decided.".
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "./data.tsx";
import { Glyph, TextButton } from "./parts.tsx";
import { collect } from "./model.ts";
import { askLine, askRows, denyNote, diffLines, doneLine, excerptLines, heldOf, outcomeOf, plainRows, sentLine, wantsLine } from "./approval-model.ts";
import type { DiffLine } from "./approval-model.ts";
import { Face } from "../needsyou/parts.tsx";
import { HeldCard } from "./held-card.tsx";
import type { HeldEditor } from "./held-card.tsx";
import { outwardOf, scheduleWords, verbOfChannel } from "../../../../../../lib/outward.ts";
import type { Outward, Recipient } from "../../../../../../lib/outward.ts";
import { useFollow } from "./use-follow.ts";
import { DECIDED_LINE, isDecided } from "../../../shell/decided.ts";

type Task = CapMap["tasks.get"]["out"]["task"];
type Data = Pick<ConversationData, "call" | "nav" | "threadId" | "changes">;

/** The name of the file or record a step is about, for the line that says what it wants. Empty when it cannot be read. */
async function subjectOf(data: Data, cap: string, input: Record<string, unknown>): Promise<string | undefined> {
  // a message to a teammate names them: "Send this to Rubab Khan?" (lane l-agentdm)
  if (cap === "chat.message_person" && typeof input["to"] === "string") {
    try { return ((await data.call("access.principals.get", { principal: { kind: "person", id: input["to"] } })) as { principal?: { name?: string } }).principal?.name || undefined; } catch { return undefined; }
  }
  const fileId = input["fileId"];
  if (cap.startsWith("files.") && typeof fileId === "string") {
    try { return ((await data.call("files.get", { fileId })) as CapMap["files.get"]["out"]).file.name; } catch { return undefined; }
  }
  return undefined;
}

export function ApprovalCard({ taskId, agent, agentId, data, face, editor }: { taskId: string; agent: string; agentId: string; data: Data; /** an agent asking for its person wears that person's face (lane l-agentdm) */ face?: string; /** the held card's editor, when a test or a screenshot puts its own in */ editor?: HeldEditor }): ReactElement | null {
  const [task, setTask] = useState<Task | null | undefined>(undefined);
  const [subject, setSubject] = useState<string | undefined>(undefined);
  /** For an edit of a file that exists: what is taken out and put in, instead of the new text alone. */
  const [diff, setDiff] = useState<{ lines: DiffLine[]; more: number } | null>(null);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"allowed" | "denied" | null>(null);
  const mounted = useRef(true);
  const described = useRef(false);

  // the task on every change; what the held call touches only once, because it does not change
  const load = useCallback(async (): Promise<void> => {
    try {
      const t = ((await data.call("tasks.get", { taskId })) as CapMap["tasks.get"]["out"]).task;
      if (!mounted.current) return;
      setTask(t);
      if (described.current) return;
      described.current = true;
      const h = heldOf(t.blocks);
      const s = await subjectOf(data, h.cap, h.input);
      let d: { lines: DiffLine[]; more: number } | null = null;
      const next = (h.input["content"] as { text?: unknown } | undefined)?.text;
      if (h.cap === "files.write" && typeof next === "string" && typeof h.input["fileId"] === "string") {
        try {
          const cur = ((await data.call("files.read", { fileId: h.input["fileId"], as: "text" })) as { text?: string }).text;
          if (typeof cur === "string") d = diffLines(cur, next);
        } catch { /* no current text: the new text is shown */ }
      }
      if (mounted.current) { setSubject(s); setDiff(d); }
    } catch { if (mounted.current) setTask((was) => was ?? null); }
  }, [data, taskId]);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);
  useFollow(data.changes, load, task === undefined || (task !== null && outcomeOf(task.state) === null && outcome === null));

  if (task === undefined || task === null) return null;
  const held = heldOf(task.blocks);
  // a held message, email, text or post: the one held card (held-card.tsx). The Gate writes who, how, when and what into the hold; a hold parked before that is read from its input the same way.
  const ow: Outward | null = held.what || held.plain ? null : held.outward ?? outwardOf(held.cap, held.input);
  if (ow) {
    const ended = outcome ?? outcomeOf(task.state);
    const nameOf = (r: Recipient): string => (r.kind === "person" ? subject ?? "a teammate" : r.kind === "thread" ? "this chat" : r.address ?? "");
    const first = ow.to[0] ? nameOf(ow.to[0]) : "";
    const hhmm = new Date((task as { updatedAt?: number }).updatedAt ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    const answer = (key: "approve" | "reject", note?: string): Promise<void> => Promise.resolve(data.call("tasks.act", { taskId, action: key, ...(note !== undefined ? { note } : {}) })).then(
      () => { setOutcome(key === "approve" ? "allowed" : "denied"); },
      (e: unknown) => { if (isDecided(e)) { void load(); throw new Error(DECIDED_LINE); } throw e; },
    );
    return (
      <HeldCard
        testID={ended ? `approval-done-${taskId}` : `approval-${taskId}`} agent={agent} to={ow.to.map((r) => ({ name: nameOf(r), seed: r.id ?? r.address ?? agentId, kind: "person" as const }))} verb={verbOfChannel(ow, nameOf)}
        schedule={scheduleWords(ow.schedule, (at) => `at ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`)} subject={ow.subject} body={ow.body}
        edited={Boolean(ow.edited)} state={ended === "allowed" ? "sent" : ended === "denied" ? "dropped" : "waiting"}
        doneLine={ended === "allowed" ? `Sent${first ? ` to ${first}` : ""} · ${hhmm}` : "Not sent"} editable={Boolean(held.holdId) && !ended} editSubject={false}
        {...(editor ? { editor } : {})} onSend={() => answer("approve")} onDrop={(reason) => answer("reject", denyNote(reason))}
        onSave={async ({ body }) => {
          if (!held.holdId) throw new Error("This cannot be edited.");
          await data.call("gate.holds.revise", { holdId: held.holdId, taskId, body });
          // the edit is a lesson for the agent: the way the person changed what it wrote (memory's own path for corrections; where memory does not have it yet, nothing is lost)
          void Promise.resolve(data.call("memory.corrections.record", { agentId, how: "edit", was: ow.body, now: body })).catch(() => undefined);
          described.current = true;
          await load();
        }}
      />
    );
  }
  // a change held only because the chat is in Ask first is a person's to always allow; any other act needs an admin, so the card does not offer it
  const allowable = held.act === "approve";
  const ended = outcome ?? outcomeOf(task.state);
  if (ended) {
    return (
      <View testID={`approval-done-${taskId}`} style={st.done} accessibilityRole="text">
        <Glyph name={ended === "allowed" ? "check" : "x"} size={13} color={ended === "allowed" ? "var(--ok)" : "var(--ink-3)"} />
        <Text style={st.doneText}>{held.plain ? `${ended === "allowed" ? "Approved" : "Sent back"} · ${task.title}` : held.cap === "chat.message_person" ? sentLine(ended, subject, (task.workingNotes as Record<string, string> | undefined)?.["approved_in"] === "chat") : doneLine(ended, held.cap, subject, held.input)}</Text>
      </View>
    );
  }
  const act = (key: "approve" | "reject", note?: string): void => {
    setBusy(true); setLine(null);
    void Promise.resolve(data.call("tasks.act", { taskId, action: key, ...(note !== undefined ? { note } : {}) })).then(
      () => setOutcome(key === "approve" ? "allowed" : "denied"),
      (e: unknown) => { setLine(isDecided(e) ? DECIDED_LINE : e instanceof Error && e.message ? `Failed. ${e.message}` : "Failed. Try again."); if (isDecided(e)) void load(); },
    ).finally(() => setBusy(false));
  };
  /** Allow this and every call like it from this agent in this chat, for 30 days. The rule is the Gate's; /permissions lists it and takes it back. */
  const always = (): void => {
    setBusy(true); setLine(null);
    void Promise.resolve(data.call("gate.allow.set", { act: "approve", target: held.cap, agentId, threadId: data.threadId })).then(
      () => act("approve"),
      () => { setBusy(false); setLine("Could not keep that rule. Try Allow."); },
    );
  };
  // an outside agent asking its person: what happens, that it runs as them, and every input
  const rows = held.plain ? plainRows(held) : held.what ? askRows(task.blocks) : excerptLines(held.input, 5, held.cap);
  const headline = held.what ? askLine(agent, held.what) : wantsLine(agent, held.cap, subject, held.input);
  return (
    <View testID={`approval-${taskId}`} style={st.card} accessibilityRole="summary" accessibilityLabel={headline}>
      <View style={st.head}>
        <Face name={agent} seedId={face ?? agentId} kind={face ? "person" : "agent"} size={20} />
        <Text style={st.title}>{headline}</Text>
      </View>
      {diff && diff.lines.length > 0 ? (
        <View testID={`approval-diff-${taskId}`} style={st.excerpt}>
          {collect(diff.lines.map((l, i) => ({ ...l, i })), (l) => (
            <View key={l.i} style={st.diffLine}>
              <Text style={[st.mark, { color: l.kind === "add" ? "var(--ok)" : "var(--danger)" }]}>{l.kind === "add" ? "+" : "\u2212"}</Text>
              <Text numberOfLines={2} style={[st.value, l.kind === "del" && st.del]}>{l.text}</Text>
            </View>
          ))}
          {diff.more > 0 ? <Text style={st.label}>{`+${diff.more} more`}</Text> : null}
        </View>
      ) : rows.length > 0 ? (
        <View testID={`approval-excerpt-${taskId}`} style={st.excerpt}>
          {collect(rows, (r) => (
            <View key={r.label} style={st.line}>
              <Text style={st.label}>{r.label}</Text>
              <Text numberOfLines={5} style={st.value}>{r.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {denying ? (
        <View style={st.deny}>
          <TextInput accessibilityLabel="Why not (optional)" testID={`approval-reason-${taskId}`} value={reason} onChangeText={setReason} placeholder="Reason (optional)" placeholderTextColor="var(--ink-4)" multiline style={st.input} />
          <View style={st.acts}>
            <TextButton label="Back" onPress={() => setDenying(false)} testID={`approval-back-${taskId}`} />
            <TextButton label={held.plain ? "Send back" : "Deny"} danger disabled={busy} onPress={() => act("reject", denyNote(reason))} testID={`approval-deny-go-${taskId}`} />
          </View>
        </View>
      ) : (
        <View style={st.acts}>
          <TextButton label={held.plain ? "Send back" : "Deny"} onPress={() => setDenying(true)} disabled={busy} testID={`approval-deny-${taskId}`} />
          {allowable ? <TextButton label="Always allow" disabled={busy} onPress={always} testID={`approval-always-${taskId}`} /> : null}
          <TextButton label={held.plain ? "Approve" : "Allow"} primary disabled={busy} onPress={() => act("approve")} testID={`approval-allow-${taskId}`} />
        </View>
      )}
      {line ? <Text accessibilityRole="alert" style={st.err}>{line}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginTop: 8, padding: 12, gap: 10, borderRadius: 12, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, maxWidth: 560 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flexShrink: 1, fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  excerpt: { gap: 6, padding: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  line: { gap: 1 },
  label: { fontSize: 11.5, color: "var(--ink-3)" as string },
  value: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  diffLine: { flexDirection: "row", gap: 8 },
  mark: { width: 12, fontSize: 13, fontWeight: "600" },
  del: { color: "var(--ink-3)" as string, textDecorationLine: "line-through" },
  acts: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  deny: { gap: 8 },
  input: { minHeight: 56, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, fontSize: 13, color: "var(--ink)" as string },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
  done: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  doneText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
