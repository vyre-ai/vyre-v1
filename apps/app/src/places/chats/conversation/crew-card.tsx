// The result card of a crew teammate (DESIGN-crew.md, step 3): the one thing that reaches the lead's chat when a teammate finishes. What changed in a few words (commits, files with their counts), the teammate's own last
// words, and two actions: Merge, which lands the branch in the project, and Send back, which tells the teammate what to change in its own thread. A merged card collapses to one line. The card reads the job's
// state from the crew list, so it is right after a reload and for someone who opens the chat later.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "./data.tsx";
import { Glyph, TextButton } from "./parts.tsx";
import { collect } from "./model.ts";
import type { MessageBlock } from "./model.ts";

type Data = Pick<ConversationData, "call" | "nav">;
type Job = CapMap["engine.crew.list"]["out"]["jobs"][number];

export const isCrewResult = (b: Pick<MessageBlock, "type">): boolean => b.type === "crew_result";

interface Card {
  jobId: string; threadId: string; name: string; title: string; branch: string; state: "done" | "failed";
  commits: number; files: Array<{ path: string; added: number; deleted: number }>; text: string;
}

/** The card's own words, read defensively from the block: a card from an older or odd sender still draws. */
export function cardOf(b: Pick<MessageBlock, "data">): Card {
  const d = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;
  const s = (k: string): string => (typeof d[k] === "string" ? (d[k] as string) : "");
  const files = Array.isArray(d["files"]) ? (d["files"] as Array<Record<string, unknown>>).map((f) => ({ path: String(f["path"] ?? ""), added: Number(f["added"] ?? 0), deleted: Number(f["deleted"] ?? 0) })) : [];
  return { jobId: s("jobId"), threadId: s("threadId"), name: s("name") || "A teammate", title: s("title"), branch: s("branch"), state: s("state") === "failed" ? "failed" : "done", commits: Number(d["ahead"] ?? (Array.isArray(d["commits"]) ? d["commits"].length : 0)), files, text: s("text") };
}

export const statsLine = (c: Pick<Card, "commits" | "files">): string =>
  c.commits === 0 && c.files.length === 0 ? "No changes" : `${c.commits} ${c.commits === 1 ? "commit" : "commits"} · ${c.files.length} ${c.files.length === 1 ? "file" : "files"}`;

const SHOWN = 5;
let seq = 0;

export function CrewResultCard({ block, leadThreadId, data }: { block: MessageBlock; leadThreadId: string; data: Data }): ReactElement {
  const c = cardOf(block);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [back, setBack] = useState(false);
  const [words, setWords] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      try { const out = (await data.call("engine.crew.list", { threadId: leadThreadId })) as CapMap["engine.crew.list"]["out"]; if (live) setJob(out.jobs.find((j) => j.jobId === c.jobId) ?? null); } catch { /* the card still works from its own words */ }
    })();
    return () => { live = false; };
  }, [data, leadThreadId, c.jobId]);

  const merged = job?.state === "merged" || line?.startsWith("Merged") === true;
  const merge = async (): Promise<void> => {
    setBusy(true);
    try {
      const out = (await data.call("engine.crew.merge", { jobId: c.jobId, idempotencyKey: `card-merge-${c.jobId}-${++seq}` })) as { landed: boolean; note?: string; job: Job };
      setJob(out.job);
      setLine(out.landed ? `Merged ${c.branch}` : out.note ?? `${c.branch} is waiting to be merged`);
    } catch { setLine("Could not merge. Try again."); } finally { setBusy(false); }
  };
  const sendBack = async (): Promise<void> => {
    if (words.trim() === "") return;
    setBusy(true);
    try { await data.call("engine.crew.message", { jobId: c.jobId, body: words.trim(), idempotencyKey: `card-back-${c.jobId}-${++seq}` }); setLine(`Sent back to ${c.name}`); setBack(false); setWords(""); } catch { setLine("Could not send that. Try again."); } finally { setBusy(false); }
  };

  if (merged) {
    return <View testID={`crew-card-${c.jobId}`} style={st.done}><Glyph name="check" size={13} /><Text style={st.doneText}>{`Merged · ${c.name}: ${c.title}`}</Text></View>;
  }
  return (
    <View testID={`crew-card-${c.jobId}`} style={st.card}>
      <View style={st.head}>
        <Text style={st.title}>{c.state === "failed" ? `${c.name} could not finish ${c.title}` : `${c.name} finished ${c.title}`}</Text>
        <Text style={st.branch}>{c.branch}</Text>
      </View>
      {c.state === "done" ? <Text testID={`crew-stats-${c.jobId}`} style={st.stats}>{statsLine(c)}</Text> : null}
      {collect(c.files.slice(0, SHOWN), (f) => (
        <View key={f.path} style={st.file}><Text numberOfLines={1} style={st.path}>{f.path}</Text><Text style={st.plus}>{`+${f.added}`}</Text><Text style={st.minus}>{`-${f.deleted}`}</Text></View>
      ))}
      {c.files.length > SHOWN ? <Text style={st.more}>{`and ${c.files.length - SHOWN} more`}</Text> : null}
      {c.text ? <Text numberOfLines={6} style={st.quote}>{c.text}</Text> : null}
      {back ? (
        <View style={st.backBox}>
          <TextInput value={words} onChangeText={setWords} placeholder={`What should ${c.name} change?`} accessibilityLabel={`What ${c.name} should change`} style={st.input} testID={`crew-back-input-${c.jobId}`} multiline />
          <View style={st.row}>
            <TextButton label="Send" primary onPress={() => { void sendBack(); }} disabled={busy || words.trim() === ""} testID={`crew-back-send-${c.jobId}`} />
            <TextButton label="Cancel" onPress={() => { setBack(false); setWords(""); }} />
          </View>
        </View>
      ) : (
        <View style={st.row}>
          {c.state === "done" ? <TextButton label="Merge" primary onPress={() => { void merge(); }} disabled={busy} testID={`crew-merge-${c.jobId}`} /> : null}
          <TextButton label="Send back" onPress={() => setBack(true)} disabled={busy} testID={`crew-back-${c.jobId}`} />
          <TextButton label="Open thread" onPress={() => data.nav.openThread(c.threadId)} testID={`crew-open-${c.jobId}`} />
        </View>
      )}
      {line ? <Text testID={`crew-line-${c.jobId}`} style={st.line}>{line}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 10, padding: 12, gap: 6, backgroundColor: "var(--raised)" as string, maxWidth: 520 },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  title: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1 },
  branch: { fontSize: 11.5, color: "var(--ink-3)" as string },
  stats: { fontSize: 12.5, color: "var(--ink-2)" as string },
  file: { flexDirection: "row", alignItems: "center", gap: 8 },
  path: { flex: 1, fontSize: 12, color: "var(--ink-2)" as string },
  plus: { fontSize: 11.5, color: "var(--ok)" as string },
  minus: { fontSize: 11.5, color: "var(--danger)" as string },
  more: { fontSize: 11.5, color: "var(--ink-3)" as string },
  quote: { fontSize: 12.5, color: "var(--ink-2)" as string, lineHeight: 18, marginTop: 2 },
  row: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" },
  backBox: { gap: 6 },
  input: { minHeight: 56, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 8, padding: 8, fontSize: 13, color: "var(--ink)" as string },
  line: { fontSize: 12, color: "var(--ink-3)" as string },
  done: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 },
  doneText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
