// The approval card of a chat (rc.8). A turn that parks on a hold (Ask mode before a change, or any mode before something leaves Vyre) leaves a turn_status "waiting" block with the hold's task.
// The card reads that task and answers it here: what the agent wants to do, a short excerpt, Allow and Deny. Deny asks for an optional reason that goes back to the agent. An answered card
// collapses to one line ("Allowed · edit Q4 pricing.docx"). The same task is in Needs you; answering in either place answers both: the card reads the task on every change in the Space, so it never offers a
// choice that is gone, and a press that was too late hears "Already decided.".
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card, CardActions, CardDeny, CardDone, CardHead } from "../../../../../../ui/src/Card/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ConversationData } from "./data.tsx";
import { Glyph } from "./parts.tsx";
import { collect } from "./model.ts";
import { askLine, askRows, denyNote, diffLines, doneLine, excerptLines, heldOf, outcomeOf, plainRows, sentLine, wantsLine } from "./approval-model.ts";
import type { DiffLine } from "./approval-model.ts";
import { Face } from "../needsyou/parts.tsx";
import { HeldCard } from "./held-card.tsx";
import type { HeldEditor } from "./held-card.tsx";
import { outwardOf, scheduleLine, verbOfChannel, whenWords } from "../../../../../../lib/outward.ts";
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

/** 24-hour clock time of a moment, in a zone or the viewer's own. */
const clock = (at: number, timeZone?: string): string => { try { return new Date(at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: false, ...(timeZone ? { timeZone } : {}) }); } catch { return new Date(at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: false }); } };

export function ApprovalCard({ taskId, agent, agentId, data, face, faceSeed, editor }: { taskId: string; /** a helper's request wears the helper's own face: the id its face is drawn from */ faceSeed?: string; agent: string; agentId: string; data: Data; /** an agent asking for its person wears that person's face (lane l-agentdm) */ face?: string; /** the held card's editor, when a test or a screenshot puts its own in */ editor?: HeldEditor }): ReactElement | null {
  const [task, setTask] = useState<Task | null | undefined>(undefined);
  const [subject, setSubject] = useState<string | undefined>(undefined);
  const [theirTz, setTheirTz] = useState<string | undefined>(undefined);
  /** For an edit of a file that exists: what is taken out and put in, instead of the new text alone. */
  const [diff, setDiff] = useState<{ lines: DiffLine[]; more: number } | null>(null);
  const [denying, setDenying] = useState(false);
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
      // when it waits for a time, the recipient's own zone (what they set themselves) says what hour it is for them
      const who = (h.outward ?? outwardOf(h.cap, h.input))?.to.find((r) => r.kind === "person")?.id;
      const tz = who ? await Promise.resolve(data.call("settings.public_of", { personId: who })).then((r) => (r as { timezone?: string }).timezone, () => undefined) : undefined;
      let d: { lines: DiffLine[]; more: number } | null = null;
      const next = (h.input["content"] as { text?: unknown } | undefined)?.text;
      if (h.cap === "files.write" && typeof next === "string" && typeof h.input["fileId"] === "string") {
        try {
          const cur = ((await data.call("files.read", { fileId: h.input["fileId"], as: "text" })) as { text?: string }).text;
          if (typeof cur === "string") d = diffLines(cur, next);
        } catch { /* no current text: the new text is shown */ }
      }
      if (mounted.current) { setSubject(s); setDiff(d); setTheirTz(tz); }
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
    const ev = ow.event;
    const viewerTz = ((): string | undefined => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
    const host = (u: string): string => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    const nameOf = (r: Recipient): string => (r.kind === "person" ? r.name ?? subject ?? "a teammate" : r.kind === "thread" ? "this chat" : r.address ?? "");
    const first = ow.to[0] ? nameOf(ow.to[0]) : "";
    const hhmm = new Date((task as { updatedAt?: number }).updatedAt ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    const only = !ev && ow.to.length === 1 && ow.to[0]!.kind !== "thread" ? (ow.to[0]!.id ?? ow.to[0]!.address ?? "").toLowerCase() : "";
    /** The rule is for this agent, this one recipient and this channel's act: nothing wider. Settings lists it and takes it back. */
    const always = only && held.act !== "pay" ? async (): Promise<void> => {
      await data.call("gate.allow.set", { act: held.act, target: only, agentId, recipient: true });
      await answer("approve");
    } : undefined;
    const answer = (key: "approve" | "reject", note?: string): Promise<void> => Promise.resolve(data.call("tasks.act", { taskId, action: key, ...(note !== undefined ? { note } : {}) })).then(
      () => { setOutcome(key === "approve" ? "allowed" : "denied"); },
      (e: unknown) => { if (isDecided(e)) { void load(); throw new Error(DECIDED_LINE); } throw e; },
    );
    return (
      <HeldCard
        testID={ended ? `approval-done-${taskId}` : `approval-${taskId}`} agent={agent} headFace={{ name: agent, seed: agentId, kind: "agent" }} to={ev ? [] : ow.to.map((r) => ({ name: nameOf(r), seed: r.id ?? r.address ?? agentId, kind: "person" as const }))} verb={verbOfChannel(ow, nameOf)}
        schedule={scheduleLine(ow.schedule, { yours: (at) => clock(at), theirs: theirTz ? (at) => clock(at, theirTz) : null })} subject={ow.subject} body={ow.body}
        {...(ev ? {
          subjectLabel: "Title", editSubject: true, fold: "Agenda", fieldMd: ["Where"],
          fields: [["When", whenWords(ev, viewerTz) ?? "Not given"], ...(ev.where || ev.link ? [["Where", [ev.where ?? "", ev.link ? `[${host(ev.link)}](${ev.link})` : ""].filter(Boolean).join(" · ")] as const] : [])],
          invitees: ow.to.map((r) => ({ name: r.name ?? r.address ?? "A guest", seed: r.address ?? r.id ?? agentId })),
          inviteNote: ow.to.length === 0 ? "No guests" : ev.notify ? "They get an email invite" : "They are not emailed",
        } : {})}
        {...(always ? { alwaysLabel: `Always allow ${agent} to ${verbOfChannel(ow, nameOf)}`, onAlways: always } : {})}
        edited={Boolean(ow.edited)} state={ended === "allowed" ? "sent" : ended === "denied" ? "dropped" : "waiting"}
        doneLine={ended === "allowed" ? (ev ? `${ev.notify ? "Invites sent" : "Added to the calendar"} · ${hhmm}` : `Sent${first ? ` to ${first}` : ""} · ${hhmm}`) : "Not sent"} editable={Boolean(held.holdId) && !ended} editSubject={Boolean(ev)}
        {...(editor ? { editor } : {})} onSend={() => answer("approve")} onDrop={(reason) => answer("reject", denyNote(reason))}
        onSave={async ({ body, subject }) => {
          if (!held.holdId) throw new Error("This cannot be edited.");
          await data.call("gate.holds.revise", { holdId: held.holdId, taskId, body, ...(ev && subject !== undefined ? { title: subject } : {}) });
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
      <CardDone testID={`approval-done-${taskId}`} ok={ended === "allowed"} glyph={<Glyph name={ended === "allowed" ? "check" : "x"} size={13} color={ended === "allowed" ? "var(--ok)" : "var(--ink-3)"} />} text={held.plain ? `${ended === "allowed" ? "Approved" : "Sent back"} · ${task.title}` : held.cap === "chat.message_person" ? sentLine(ended, subject, (task.workingNotes as Record<string, string> | undefined)?.["approved_in"] === "chat") : doneLine(ended, held.cap, subject, held.input)} />
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
    <Card kind="decision" testID={`approval-${taskId}`} label={headline} onCancel={denying ? () => setDenying(false) : undefined}>
      <CardHead title={headline} lead={<Face name={agent} seedId={face ?? faceSeed ?? agentId} kind={face ? "person" : "agent"} size={20} />} />
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
              {/^https?:\/\/\S+$/.test(r.text) ? <Text accessibilityRole="link" {...({ href: r.text, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } as object)} style={st.link}>{r.text.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</Text> : <Text numberOfLines={5} style={st.value}>{r.text}</Text>}
            </View>
          ))}
        </View>
      ) : null}
      {denying ? (
        <CardDeny ids={{ reason: `approval-reason-${taskId}`, back: `approval-back-${taskId}`, go: `approval-deny-go-${taskId}` }} busy={busy} onBack={() => setDenying(false)} onDeny={(r) => act("reject", denyNote(r))} />
      ) : (
        <CardActions
          busy={busy}
          secondary={[...(allowable ? [{ label: "Always allow", onPress: always, testID: `approval-always-${taskId}` }] : []), { label: "Deny", onPress: () => setDenying(true), testID: `approval-deny-${taskId}` }]}
          primary={{ label: "Allow", onPress: () => act("approve"), testID: `approval-allow-${taskId}` }}
          error={line}
        />
      )}
    </Card>
  );
}

const st = StyleSheet.create({
  excerpt: { gap: 6, padding: 10, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  line: { gap: 1 },
  label: { fontSize: 11.5, color: "var(--ink-3)" as string },
  link: { fontSize: 13, lineHeight: 18, color: "var(--accent)" as string },
  value: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  diffLine: { flexDirection: "row", gap: 8 },
  mark: { width: 12, fontSize: 13, fontWeight: "600" },
  del: { color: "var(--ink-3)" as string, textDecorationLine: "line-through" },
});
