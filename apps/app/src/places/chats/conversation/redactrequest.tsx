// The "Redact before I can read" card of a chat (Redaction for AI, owner 3 Nov, rc.20): an agent asked to read a file in a Redacted folder that nobody has reviewed. Open to review opens the file
// beside the chat with its Redact tab; Done there wakes the agent (the server's file.redact_ready). Not now puts the request aside (files.redact.later). Once the file is reviewed the card says by
// whom. It reads files.marks.list for the file: the request is waiting while it is in the file's requests.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MenuIcon } from "../../../../../../ui/src/Menu/index.tsx";
import type { ConversationData } from "./data.tsx";
import { useFollow } from "./use-follow.ts";

type Data = Pick<ConversationData, "call" | "nameOf" | "changes" | "nav">;
export interface RedactRequestBlock { requestId: string; fileId: string; name: string; agentId?: string; state?: "waiting" | "done" | "later" }

export const isRedactRequest = (type: string): boolean => type === "redact_request";
export const requestLine = (agent: string, file: string): string => `${agent} wants to read ${file}. It's in a Redacted folder.`;

const EYE_OFF = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 8s2.4-4.2 6.2-4.2c1.2 0 2.3.4 3.2.9M14.2 8s-2.4 4.2-6.2 4.2c-1.2 0-2.3-.4-3.2-.9"/><path d="M6.5 9.5a2 2 0 012.9-2.9M2.5 13.5l11-11"/></svg>`;
const CHECK = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7"/></svg>`;

export function RedactRequestCard({ block, agent, data }: { block: RedactRequestBlock; agent: string; data: Data }): ReactElement {
  const [state, setState] = useState<"waiting" | "done" | "later">(block.state ?? "waiting");
  const [by, setBy] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const load = useCallback(async (): Promise<void> => {
    try {
      const l = (await data.call("files.marks.list", { fileId: block.fileId })) as { requests: { requestId: string }[]; reviewed?: { by: string } };
      if (l.requests.some((r) => r.requestId === block.requestId)) setState((s) => (s === "later" ? s : "waiting"));
      else if (l.reviewed) { setState("done"); setBy(l.reviewed.by); }
    } catch { /* the card keeps what it knew */ }
  }, [data, block.fileId, block.requestId]);
  useEffect(() => { void load(); }, [load]);
  useFollow(data.changes, load, state === "waiting");
  const later = (): void => { void data.call("files.redact.later", { requestId: block.requestId }).then(() => setState("later")).catch((e: unknown) => setProblem(e instanceof Error ? e.message : "That did not work.")); };
  return (
    <View style={st.card} testID={`redactreq-${block.requestId}`} accessibilityLabel={requestLine(agent, block.name)}>
      <View style={st.head}><MenuIcon icon={EYE_OFF} /><Text style={st.title}>Redact before I can read</Text></View>
      <Text style={st.body}>{`${agent} wants to read `}<Text style={st.b}>{block.name}</Text>{". It's in a Redacted folder."}</Text>
      {state === "waiting" ? (
        <View style={st.foot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open to review" testID={`redactreq-open-${block.requestId}`} onPress={() => data.nav.openBeside("file", block.fileId)} style={({ hovered }: { hovered?: boolean }) => [st.pri, hovered === true && st.priOver]}>
            <Text style={st.priText}>Open to review</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Not now" testID={`redactreq-later-${block.requestId}`} onPress={later} style={({ hovered }: { hovered?: boolean }) => [st.sec, hovered === true && st.over]}>
            <Text style={st.secText}>Not now</Text>
          </Pressable>
          <View style={st.grow} />
          <Text style={st.quiet}>Waiting</Text>
        </View>
      ) : state === "later" ? <Text style={st.quiet}>{`Not now. ${agent} asks again when the file is opened.`}</Text>
        : <View style={st.done}><MenuIcon icon={CHECK} color="var(--ok)" /><Text style={st.ok}>{`Reviewed${by ? ` by ${data.nameOf(by)}` : ""}`}</Text></View>}
      {problem ? <Text style={st.quiet} accessibilityLiveRegion="polite">{problem}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginTop: 4, borderRadius: 12, borderWidth: 1, borderColor: "var(--line-2)" as string, paddingVertical: 11, paddingHorizontal: 12, gap: 8, backgroundColor: "var(--raised)" as string, maxWidth: 520 },
  head: { flexDirection: "row", alignItems: "center", gap: 7 },
  title: { color: "var(--ink)" as string, fontWeight: "600", fontSize: 12.5 },
  body: { color: "var(--ink-2)" as string, fontSize: 13, lineHeight: 19 },
  b: { color: "var(--ink)" as string, fontWeight: "600" },
  foot: { flexDirection: "row", alignItems: "center", gap: 6 },
  grow: { flex: 1 },
  pri: { height: 28, paddingHorizontal: 11, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  priOver: { opacity: 0.9 },
  priText: { color: "var(--accent-ink)" as string, fontWeight: "600", fontSize: 12.5 },
  sec: { height: 28, paddingHorizontal: 9, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  over: { backgroundColor: "var(--hover)" as string },
  secText: { color: "var(--ink-2)" as string, fontWeight: "500", fontSize: 12.5 },
  quiet: { color: "var(--ink-3)" as string, fontSize: 12 },
  done: { flexDirection: "row", alignItems: "center", gap: 6 },
  ok: { color: "var(--ok)" as string, fontSize: 12 },
});
