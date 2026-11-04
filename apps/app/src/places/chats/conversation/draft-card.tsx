// An email an agent drafted, in the chat where it was asked (lane l-chrome2a): the held email card (held-card.tsx) with Edit and Send and Don't send. The draft is a message the person's own mailbox holds
// (mail.draft); Edit rewrites it in place, Send sends that draft as the person, Don't send discards it. It shows whether or not the Gate held anything, because a draft is not sent until the person says so.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { ConversationData } from "./data.tsx";
import { HeldCard } from "./held-card.tsx";
import type { HeldEditor } from "./held-card.tsx";
import { verbOfChannel } from "../../../../../../lib/outward.ts";

interface Party { address: string; name?: string }
interface Draft { mailboxId: string; to: Party[]; cc: Party[]; subject: string; text: string; status: string }

export function DraftCard({ draftId, agent, data, editor }: { draftId: string; agent: string; agentId?: string; data: ConversationData; editor?: HeldEditor }): ReactElement | null {
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  const [at, setAt] = useState(0);
  const mounted = useRef(true);
  const key = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async (): Promise<void> => {
    try {
      const r = (await data.call("mail.message.get", { messageId: draftId })) as { message: { mailboxId: string; to?: Party[]; cc?: Party[]; subject?: string; status: string }; text?: string };
      if (mounted.current) setDraft({ mailboxId: r.message.mailboxId, to: r.message.to ?? [], cc: r.message.cc ?? [], subject: r.message.subject ?? "", text: r.text ?? "", status: r.message.status });
    } catch { if (mounted.current) setDraft(null); }
  }, [data, draftId]);
  useEffect(() => { void load(); }, [load]);
  if (draft === undefined) return null;
  const idem = (what: string): string => `draft-card:${draftId}:${what}:${++key.current}:${Date.now()}`;
  const names = (ps: readonly Party[]): string[] => ps.map((p) => p.name || p.address);
  const gone = draft === null;
  const sent = !gone && draft.status !== "draft";
  const to = gone ? [] : draft.to;
  const verb = gone ? "send an email" : verbOfChannel({ channel: "email", to: to.map((p) => ({ kind: "address" as const, address: p.address, ...(p.name ? { name: p.name } : {}) })), body: "", bodyField: "text" }, (r) => r.name || r.address || "");
  const hhmm = new Date(at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <HeldCard
      testID={`draft-${draftId}`} agent={agent} to={to.map((p) => ({ name: p.name || p.address, seed: p.address, kind: "person" as const }))} verb={verb}
      subject={gone ? "" : draft.subject} fields={!gone && draft.cc.length > 0 ? [["Cc", names(draft.cc).join(", ")]] : []} body={gone ? "" : draft.text}
      state={gone ? "dropped" : sent ? "sent" : "waiting"} doneLine={sent ? `Sent to ${names(to).slice(0, 2).join(" and ")} · ${hhmm}` : "Not sent"} editable={!gone && !sent} editSubject
      {...(editor ? { editor } : {})} sendLabel="Send" stoppedNote="It waits for you: nothing is sent until you press Send."
      onSend={async () => {
        if (!draft) return;
        await data.call("mail.send", { mailboxId: draft.mailboxId, draftId, to: draft.to, ...(draft.cc.length > 0 ? { cc: draft.cc } : {}), subject: draft.subject, text: draft.text, idempotencyKey: idem("send") });
        setAt(Date.now());
        await load();
      }}
      onSave={async ({ body, subject }) => {
        if (!draft) return;
        await data.call("mail.draft", { mailboxId: draft.mailboxId, draftId, text: body, ...(subject !== undefined ? { subject } : {}), idempotencyKey: idem("edit") });
        await load();
      }}
      onDrop={async () => { await data.call("mail.drafts.discard", { draftId }); }}
    />
  );
}
