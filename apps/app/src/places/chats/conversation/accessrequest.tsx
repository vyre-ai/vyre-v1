// The access request card of a chat: someone asked for access to something in this chat. People who can decide it see Approve and Decline right here (access.requests.approve grants, access.requests.decline
// tells the asker); everyone else sees who it is waiting on. Needs you keeps its row and both close together because both read the one request.
import { useCallback, useEffect, useState } from "react";
import { useFollow } from "./use-follow.ts";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ConversationData } from "./data.tsx";
import { Glyph } from "./parts.tsx";
import { Card, CardActions, CardDone, CardHead } from "../../../../../../ui/src/Card/index.tsx";

type Data = Pick<ConversationData, "call" | "nameOf" | "changes">;
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
  useFollow(data.changes, load, state === null || state === "waiting");
  if (state === null) return null;
  const who = block.requester ? data.nameOf(block.requester) : "Someone";
  const line = accessLine(who, block);
  if (state !== "waiting") {
    return (
      <CardDone testID={`accessreq-done-${block.requestId}`} ok={state === "granted"} glyph={<Glyph name={state === "granted" ? "check" : "x"} size={13} color={state === "granted" ? "var(--ok)" : "var(--ink-3)"} />} text={`${state === "granted" ? "Approved" : "Declined"} · ${line}`} />
    );
  }
  const decide = async (cap: "access.requests.approve" | "access.requests.decline"): Promise<void> => {
    setBusy(true); setProblem("");
    try { await data.call(cap, cap === "access.requests.approve" ? { requestId: block.requestId, ...(block.level ? { level: block.level } : {}) } : { requestId: block.requestId }); await load(); }
    catch (e) { setProblem((e as { message?: string }).message ?? "That did not go through. Try again."); void load(); }
    finally { setBusy(false); }
  };
  return (
    <Card kind="decision" testID={`accessreq-${block.requestId}`} label={line}>
      <CardHead title={line} />
      {block.note ? <Text style={st.note}>{block.note}</Text> : null}
      {canDecide ? (
        <CardActions busy={busy} secondary={[{ label: "Deny", onPress: () => void decide("access.requests.decline"), testID: `accessreq-decline-${block.requestId}` }]} primary={{ label: "Allow", onPress: () => void decide("access.requests.approve"), testID: `accessreq-approve-${block.requestId}` }} error={problem} />
      ) : <Text testID={`accessreq-wait-${block.requestId}`} style={st.note}>Waiting on the people who can decide it.</Text>}
    </Card>
  );
}

const st = StyleSheet.create({
  note: { fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
});
