// The audience check at the answer-posting step (agent-visibility gap 6). An agent reads as the person who asked; in a chat other people read, everyone there sees its answer. So before an answer
// is posted, every record, file, mail, calendar item or other resource the turn's tools read (host/src/seams/answer-reads.ts) is checked against every person who reads the chat
// (lib/audience.ts: its members, or the whole Space for a public channel). When one of them may not open one of those things, the answer goes to the asker privately, in their own chat with the
// agent, and the shared chat gets one line saying so. Nothing the turn read is compared by its words: the rule is about access, so a summary that leaks nothing is still sent privately.
// A check that cannot be made (no audience, no answer from authorize) never shares.
import { chatAudience } from "../../lib/audience.ts";
import { takeReads } from "../../host/src/seams/answer-reads.ts";
import type { ReadResource } from "../../host/src/seams/answer-reads.ts";

export const PRIVATELY = "I sent you the details privately, in your own chat with me: some of what I used here is not open to everyone in this chat.";

type Level = "view" | "use" | "edit" | "manage";
export interface AnswerAudienceDeps {
  /** Call a capability as a person. */
  call(cap: string, input: unknown, as?: string): Promise<unknown>;
  /** May every one of these people do this on this resource (each on their own grants)? */
  mayAll?(people: readonly string[], action: { perm: string | null; level: Level }, resource: ReadResource): boolean;
  /** Post as the agent, for the person it works for. */
  postAs?(agentId: string, post: { actingFor?: string; threadId: string; body: string; blocks: unknown[]; mentions: Array<{ kind: "person" | "agent"; id: string }>; clientId: string }): Promise<unknown>;
  newId(): string;
}

export interface Screened {
  /** What goes into the shared chat. */
  body: string;
  /** The answer went to the asker privately. */
  withheld: boolean;
  /** The resources some person in the chat may not open (for the log; ids only). */
  closed: ReadResource[];
}

const PAGE = 500;

// The transcript of a turn that read something waits for its answer's check (modules/engine/transcript.ts): what the check decided is shared there, never more. Per turn id, settled once.
const verdicts = new Map<string, { settle: (s: { body: string; withheld: boolean }) => void; done: Promise<{ body: string; withheld: boolean }> }>();
function slot(turnId: string) {
  let v = verdicts.get(turnId);
  if (!v) {
    let settle!: (s: { body: string; withheld: boolean }) => void;
    const done = new Promise<{ body: string; withheld: boolean }>((r) => { settle = r; });
    v = { settle, done };
    verdicts.set(turnId, v);
    if (verdicts.size > 2_000) verdicts.delete(verdicts.keys().next().value as string);
  }
  return v;
}
/** The check of this turn's answer has run: what went into the chat. */
export function settleAnswer(turnId: string, s: { body: string; withheld: boolean }): void { slot(turnId).settle(s); }
/** What the check of this turn's answer decided, or null when it did not run in time (a failed turn has no answer to check). */
export async function answerVerdict(turnId: string, ms: number): Promise<{ body: string; withheld: boolean } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((r) => { timer = setTimeout(() => r(null), ms); timer.unref?.(); });
  try { return await Promise.race([slot(turnId).done, late]); } finally { clearTimeout(timer); verdicts.delete(turnId); }
}

/** Everyone who reads the chat besides the asker: its people, or every active person in the Space for a Space-wide chat. Null when it cannot be known. */
async function readersOf(d: AnswerAudienceDeps, threadId: string, asker: string): Promise<string[] | null> {
  const a = await chatAudience((cap, input) => d.call(cap, input, asker), threadId);
  if (!a.space) return a.people.filter((p) => p !== asker);
  const out = new Set<string>(a.people);
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    let page: { principals?: Array<{ id?: string }>; next?: string };
    try { page = (await d.call("access.principals.list", { kind: "person", status: "active", limit: PAGE, ...(cursor ? { cursor } : {}) }, asker)) as typeof page; } catch { return null; }
    for (const p of page.principals ?? []) if (typeof p.id === "string") out.add(p.id);
    if (!page.next) break;
    cursor = page.next;
    if (i === 19) return null;
  }
  out.delete(asker);
  return [...out];
}

/** Check one answer before it is posted. The turn's reads are taken (and so cleared) here. */
export async function screenAnswer(d: AnswerAudienceDeps, q: { threadId: string; agentId: string; asker: string; reply: string }): Promise<Screened> {
  const reads = takeReads(q.threadId, q.agentId, q.asker);
  if (reads.length === 0 || q.asker === "" || q.reply.trim() === "") return { body: q.reply, withheld: false, closed: [] };
  const others = await readersOf(d, q.threadId, q.asker);
  let closed: ReadResource[];
  if (others === null || !d.mayAll) closed = reads;   // who reads the chat, or what they may open, cannot be known: never share
  else if (others.length === 0) closed = [];
  else closed = reads.filter((r) => r.type === "*" || !d.mayAll!(others, { perm: null, level: "view" }, r));
  if (closed.length === 0) return { body: q.reply, withheld: false, closed };
  await sendPrivately(d, q);
  return { body: PRIVATELY, withheld: true, closed };
}

/** The whole answer, in the asker's own chat with the agent (made once per chat it came from, and kept). */
async function sendPrivately(d: AnswerAudienceDeps, q: { threadId: string; agentId: string; asker: string; reply: string }): Promise<void> {
  if (!d.postAs) throw new Error("no way to answer privately");
  const started = (await d.call("chat.start", { kind: "chat", agentIds: [q.agentId], title: "Private answers", idempotencyKey: `private-answers:${q.threadId}:${q.agentId}:${q.asker}` }, q.asker)) as { thread?: { threadId?: string } };
  const threadId = started.thread?.threadId;
  if (!threadId) throw new Error("no private chat");
  await d.postAs(q.agentId, { actingFor: q.asker, threadId, body: q.reply, blocks: [], mentions: [], clientId: d.newId() });
}
