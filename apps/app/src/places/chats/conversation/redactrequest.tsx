// The "Redact before I can read" card of a chat (Redaction for AI, owner 3 Nov, rc.20): an agent asked to read a file in a Redacted folder that nobody has reviewed. Open to review opens the file
// beside the chat with its Redact tab; Done there wakes the agent (the server's file.redact_ready). Not now puts the request aside (files.redact.later). Once the file is reviewed the card says by
// whom. It reads files.marks.list for the file: the request is waiting while it is in the file's requests.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text } from "react-native";
import { Card, CardActions, CardDone, CardHead } from "../../../../../../ui/src/Card/index.tsx";
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
    <Card kind="decision" size="full" testID={`redactreq-${block.requestId}`} label={requestLine(agent, block.name)}>
      <CardHead title="Redact before I can read" lead={<MenuIcon icon={EYE_OFF} />} />
      <Text style={st.body}>{`${agent} wants to read `}<Text style={st.b}>{block.name}</Text>{". It's in a Redacted folder."}</Text>
      {state === "waiting" ? (
        <CardActions note={<Text style={st.quiet}>Waiting</Text>} secondary={[{ label: "Not now", onPress: later, testID: `redactreq-later-${block.requestId}` }]} primary={{ label: "Open to review", onPress: () => data.nav.openBeside("file", block.fileId), testID: `redactreq-open-${block.requestId}` }} />
      ) : state === "later" ? <Text style={st.quiet}>{`Not now. ${agent} asks again when the file is opened.`}</Text>
        : <CardDone glyph={<MenuIcon icon={CHECK} color="var(--ok)" />} text={`Reviewed${by ? ` by ${data.nameOf(by)}` : ""}`} />}
      {problem ? <Text style={st.quiet} accessibilityLiveRegion="polite">{problem}</Text> : null}
    </Card>
  );
}

const st = StyleSheet.create({
  body: { color: "var(--ink-2)" as string, fontSize: 13, lineHeight: 19 },
  b: { color: "var(--ink)" as string, fontWeight: "600" },
  quiet: { color: "var(--ink-3)" as string, fontSize: 12 },
});
