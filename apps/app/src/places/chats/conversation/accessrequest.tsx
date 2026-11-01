// The access request card of a chat: someone asked for access to something in this chat. People who can decide it see Approve and Decline right here (access.requests.approve grants, access.requests.decline
// tells the asker); everyone else sees who it is waiting on. Needs you keeps its row and both close together because both read the one request.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ConversationData } from "./data.tsx";
import { Glyph, TextButton } from "./parts.tsx";

type Data = Pick<ConversationData, "call" | "nameOf">;
interface Block { requestId: string; requester?: string; resourceTitle?: string; level?: string; note?: string }

export const isAccessRequest = (type: string): boolean => type === "access_request";

export function accessLine(who: string, b: Block): string {
  return `${who} asks for ${b.level ?? "view"} access to ${b.resourceTitle ?? "this"}`;
}

export function AccessRequestCard({ block, data }: { block: Block; data: Data }): ReactElement | null {
  const [state, setState] = useState<"waiting" | "granted" | "declined" | null>(null);
  const [canDecide, setCanDecide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const load = useCallback(async (): Promise<void> => {
    try {
      const to = (await data.call("access.requests.list", { mine: false })) as { requests?: { id: string; state: "waiting" | "granted" | "declined" }[] };
      const mine = (await data.call("access.requests.list", { mine: true })) as { requests?: { id: string; state: "waiting" | "granted" | "declined" }[] };
      const row = [...(to.requests ?? []), ...(mine.requests ?? [])].find((r) => r.id === block.requestId);
      setCanDecide((to.requests ?? []).some((r) => r.id === block.requestId));
      setState(row?.state ?? "waiting");
    } catch { setState("waiting"); }
  }, [data, block.requestId]);
  useEffect(() => { void load(); }, [load]);
  if (state === null) return null;
  const who = block.requester ? data.nameOf(block.requester) : "Someone";
  const line = accessLine(who, block);
  if (state !== "waiting") {
    return (
      <View testID={`accessreq-done-${block.requestId}`} style={st.done} accessibilityRole="text">
        <Glyph name={state === "granted" ? "check" : "x"} size={13} color={state === "granted" ? "var(--ok)" : "var(--ink-3)"} />
        <Text style={st.doneText}>{`${state === "granted" ? "Approved" : "Declined"} · ${line}`}</Text>
      </View>
    );
  }
  const decide = async (cap: "access.requests.approve" | "access.requests.decline"): Promise<void> => {
    setBusy(true); setProblem("");
    try { await data.call(cap, cap === "access.requests.approve" ? { requestId: block.requestId, ...(block.level ? { level: block.level } : {}) } : { requestId: block.requestId }); await load(); }
    catch (e) { setProblem((e as { message?: string }).message ?? "That did not go through. Try again."); }
    finally { setBusy(false); }
  };
  return (
    <View testID={`accessreq-${block.requestId}`} style={st.card} accessibilityRole="summary" accessibilityLabel={line}>
      <Text style={st.title}>{line}</Text>
      {block.note ? <Text style={st.note}>{block.note}</Text> : null}
      {canDecide ? (
        <View style={st.acts}>
          <TextButton label="Decline" onPress={() => void decide("access.requests.decline")} disabled={busy} testID={`accessreq-decline-${block.requestId}`} />
          <TextButton label="Approve" primary disabled={busy} onPress={() => void decide("access.requests.approve")} testID={`accessreq-approve-${block.requestId}`} />
        </View>
      ) : <Text testID={`accessreq-wait-${block.requestId}`} style={st.note}>Waiting on the people who can decide it.</Text>}
      {problem ? <Text accessibilityRole="alert" style={st.err}>{problem}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  card: { marginTop: 8, padding: 12, gap: 10, borderRadius: 12, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string, maxWidth: 560 },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  note: { fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  acts: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
  done: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  doneText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
