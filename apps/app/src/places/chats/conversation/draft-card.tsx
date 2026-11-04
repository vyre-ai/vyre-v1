// An email an agent drafted, in the chat where it was asked (lane l-chrome2a): the held email card (held-card.tsx) with Edit and Send and Don't send. The draft is a message the person's own mailbox holds
// (mail.draft); Edit rewrites it in place, Send sends that draft as the person, Don't send discards it. It shows whether or not the Gate held anything, because a draft is not sent until the person says so.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { ConversationData } from "./data.tsx";
import { HeldCard } from "./held-card.tsx";
import type { HeldEditor } from "./held-card.tsx";
import { verbOfChannel } from "../../../../../../lib/outward.ts";
import type { LinkCardData } from "../../../../../../ui/src/blocks/link-card/model.ts";

interface Party { address: string; name?: string }
const subjectOf = (d: Draft | null | undefined): string => (d ? d.subject : "");

/**
 * Don't send, with the person's reason, goes back to the agent the way the held card's does: a line in the chat that wakes it with the words, and a lesson in its memory (refused, with the reason as the note).
 * Either failing leaves the draft discarded.
 */
export async function tellAgent(data: ConversationData, agentId: string | undefined, subject: string, reason: string, was: string): Promise<void> {
  const why = reason.trim();
  if (data.threadId && agentId) {
    try { await data.call("chat.post", { threadId: data.threadId, body: `Don't send that email${subject ? ` ("${subject.slice(0, 80)}")` : ""}.${why ? ` ${why}` : ""}`, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `draft-no:${agentId}:${Date.now()}` }); } catch { /* the draft is gone; the note is a courtesy */ }
  }
  if (agentId && why) { try { await data.call("memory.corrections.record", { agentId, how: "refuse", was, now: "", note: why }); } catch { /* where memory does not have it, nothing is lost */ } }
}

interface Draft { mailboxId: string; to: Party[]; cc: Party[]; subject: string; text: string; status: string }

export function DraftCard({ draftId, agent, agentId, data, editor }: { draftId: string; agent: string; agentId?: string; data: ConversationData; editor?: HeldEditor }): ReactElement | null {
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
      {...(editor ? { editor } : {})} stoppedNote="It waits for you: nothing is sent until you press Allow."
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
      onDrop={async (reason) => { await data.call("mail.drafts.discard", { draftId }); await tellAgent(data, agentId, subjectOf(draft), reason, draft?.text ?? ""); }}
    />
  );
}

/** An email an agent drafted at Gmail or Outlook: the same card. The card carries its words and the calls its buttons make; Edit changes the words here, Send sends them and deletes the draft there, Don't send deletes it there. */
export function ProviderDraftCard({ card, agent, agentId, data, editor }: { card: LinkCardData; agent: string; agentId?: string; data: ConversationData; editor?: HeldEditor }): ReactElement {
  const [text, setText] = useState(card.body ?? "");
  const [subject, setSubject] = useState(card.title);
  const [at, setAt] = useState(0);
  const send = (card.actions ?? []).find((a) => a.key === "send");
  const discard = (card.actions ?? []).find((a) => a.key === "discard");
  const to = (card.to ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const verb = verbOfChannel({ channel: "email", to: to.map((address) => ({ kind: "address" as const, address })), body: "", bodyField: "text" }, (r) => r.address ?? "");
  const hhmm = new Date(at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const key = card.target?.id ?? "draft";
  const dropIt = async (): Promise<void> => { if (discard?.cap) await data.call(discard.cap, { ...(discard.input ?? {}), idempotencyKey: `draft-del:${key}:${Date.now()}` }); };
  return (
    <HeldCard
      testID={`draft-${key}`} agent={agent} to={to.map((address) => ({ name: address, seed: address, kind: "person" as const }))} verb={verb} subject={subject} body={text}
      state="waiting" doneLine={`Sent to ${to.slice(0, 2).join(" and ")} · ${hhmm}`} editable editSubject {...(editor ? { editor } : {})} stoppedNote={`Saved as a draft in ${card.via ?? "your mailbox"}. Nothing is sent until you press Send.`}
      onSave={async ({ body, subject: s2 }) => { setText(body); if (s2 !== undefined) setSubject(s2); }}
      onSend={async () => {
        if (!send?.cap) throw new Error("This cannot be sent from here.");
        await data.call(send.cap, { ...(send.input ?? {}), subject, text, idempotencyKey: `draft-send:${key}:${Date.now()}` });
        setAt(Date.now());
        try { await dropIt(); } catch { /* it was sent; the old draft may stay */ }
      }}
      onDrop={async (reason) => { await dropIt(); await tellAgent(data, agentId, subject, reason, text); }}
    />
  );
}
