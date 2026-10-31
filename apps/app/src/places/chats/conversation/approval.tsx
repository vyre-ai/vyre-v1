// The approval card of a chat (rc.8). A turn that parks on a hold (Ask mode before a change, or any mode before something leaves Vyre) leaves a turn_status "waiting" block with the hold's task.
// The card reads that task and answers it here: what the agent wants to do, a short excerpt, Allow and Deny. Deny asks for an optional reason that goes back to the agent. An answered card
// collapses to one line ("Allowed · edit Q4 pricing.docx"). The same task is in Needs you; answering in either place answers both.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "./data.tsx";
import { Glyph, TextButton } from "./parts.tsx";
import { collect } from "./model.ts";
import { denyNote, diffLines, doneLine, excerptLines, heldOf, outcomeOf, wantsLine } from "./approval-model.ts";
import type { DiffLine } from "./approval-model.ts";
import { Face } from "../needsyou/parts.tsx";

type Task = CapMap["tasks.get"]["out"]["task"];
type Data = Pick<ConversationData, "call" | "nav">;

/** The name of the file or record a step is about, for the line that says what it wants. Empty when it cannot be read. */
async function subjectOf(data: Data, cap: string, input: Record<string, unknown>): Promise<string | undefined> {
  const fileId = input["fileId"];
  if (cap.startsWith("files.") && typeof fileId === "string") {
    try { return ((await data.call("files.get", { fileId })) as CapMap["files.get"]["out"]).file.name; } catch { return undefined; }
  }
  return undefined;
}

export function ApprovalCard({ taskId, agent, agentId, data }: { taskId: string; agent: string; agentId: string; data: Data }): ReactElement | null {
  const [task, setTask] = useState<Task | null | undefined>(undefined);
  const [subject, setSubject] = useState<string | undefined>(undefined);
  /** For an edit of a file that exists: what is taken out and put in, instead of the new text alone. */
  const [diff, setDiff] = useState<{ lines: DiffLine[]; more: number } | null>(null);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"allowed" | "denied" | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const t = ((await data.call("tasks.get", { taskId })) as CapMap["tasks.get"]["out"]).task;
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
        if (live) { setTask(t); setSubject(s); setDiff(d); }
      } catch { if (live) setTask(null); }
    })();
    return () => { live = false; };
  }, [data, taskId]);

  if (task === undefined || task === null) return null;
  const held = heldOf(task.blocks);
  const ended = outcome ?? outcomeOf(task.state);
  if (ended) {
    return (
      <View testID={`approval-done-${taskId}`} style={st.done} accessibilityRole="text">
        <Glyph name={ended === "allowed" ? "check" : "x"} size={13} color={ended === "allowed" ? "var(--ok)" : "var(--ink-3)"} />
        <Text style={st.doneText}>{doneLine(ended, held.cap, subject)}</Text>
      </View>
    );
  }
  const act = (key: "approve" | "reject", note?: string): void => {
    setBusy(true); setLine(null);
    void Promise.resolve(data.call("tasks.act", { taskId, action: key, ...(note !== undefined ? { note } : {}) })).then(
      () => setOutcome(key === "approve" ? "allowed" : "denied"),
      () => setLine("Failed. Try again."),
    ).finally(() => setBusy(false));
  };
  const rows = excerptLines(held.input);
  return (
    <View testID={`approval-${taskId}`} style={st.card} accessibilityRole="summary" accessibilityLabel={wantsLine(agent, held.cap, subject)}>
      <View style={st.head}>
        <Face name={agent} seedId={agentId} kind="agent" size={20} />
        <Text style={st.title}>{wantsLine(agent, held.cap, subject)}</Text>
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
            <TextButton label="Deny" danger disabled={busy} onPress={() => act("reject", denyNote(reason))} testID={`approval-deny-go-${taskId}`} />
          </View>
        </View>
      ) : (
        <View style={st.acts}>
          <TextButton label="Deny" onPress={() => setDenying(true)} disabled={busy} testID={`approval-deny-${taskId}`} />
          <TextButton label="Allow" primary disabled={busy} onPress={() => act("approve")} testID={`approval-allow-${taskId}`} />
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
