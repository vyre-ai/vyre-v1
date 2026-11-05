// The room digest (owner, 4 Nov, rc.22): what a group chat, project chat or channel said before the recent window, kept up to date in batches so an agent that is tagged already knows the room.
// Reading the room costs nothing; only the batch costs a model call: after about DIGEST_EVERY new messages, or DIGEST_IDLE_MS of quiet with anything new, on the CHEAPEST model of the account that pays for
// the agent's turns, and only when that account's usage limit allows. Otherwise no digest is made and the pack falls back to the raw recent window and an "earlier" line. A digest is stored per
// room and per agent (what that agent could read), and covers only messages the asker may read: nothing before the room was shared (sharedAt).
import type { Db } from "./projections.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;
type Obj = Record<string, unknown>;

export const DIGEST_EVERY = 30;
export const DIGEST_IDLE_MS = 10 * 60_000;
/** A session or week meter at or above this share of its limit stops the batch: passive reading must never use up what a person needs. */
export const LIMIT_STOP_PCT = 80;
const DIGEST_CHARS = 6_000;
const SOURCE_CHARS = 30_000;
const CHEAP = /haiku|mini|flash|lite|nano|small|instant|spark/i;

const ready = new WeakSet<object>();
function ensure(db: Db): void {
  if (ready.has(db as object)) return;
  db.run("CREATE TABLE IF NOT EXISTS engine_room_digest (thread_id TEXT NOT NULL, agent_id TEXT NOT NULL, text TEXT NOT NULL, up_to_seq INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (thread_id, agent_id))");
  ready.add(db as object);
}

export interface Digest { text: string; upToSeq: number; updatedAt: number }

export function getDigest(db: Db, threadId: string, agentId: string): Digest | undefined {
  ensure(db);
  const r = db.all("SELECT text, up_to_seq, updated_at FROM engine_room_digest WHERE thread_id = ? AND agent_id = ?", threadId, agentId)[0] as Obj | undefined;
  return r ? { text: String(r["text"]), upToSeq: Number(r["up_to_seq"]), updatedAt: Number(r["updated_at"]) } : undefined;
}
function saveDigest(db: Db, threadId: string, agentId: string, text: string, upToSeq: number, now: number): void {
  ensure(db);
  db.run("INSERT INTO engine_room_digest (thread_id, agent_id, text, up_to_seq, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (thread_id, agent_id) DO UPDATE SET text = excluded.text, up_to_seq = excluded.up_to_seq, updated_at = excluded.updated_at", threadId, agentId, text, upToSeq, now);
}

/** Whether a batch is due: enough new messages, or some new ones and a quiet room. */
export function digestDue(o: { newCount: number; lastMessageAt: number | undefined; now: number }): boolean {
  if (o.newCount <= 0) return false;
  return o.newCount >= DIGEST_EVERY || (o.lastMessageAt !== undefined && o.now - o.lastMessageAt >= DIGEST_IDLE_MS);
}

/** The cheapest model of an account: by the names vendors give their small ones, else the first one the account may use. */
export function cheapestModel(models: ReadonlyArray<{ model: string; allowed: boolean }>): string | undefined {
  const ok = models.filter((m) => m.allowed);
  return (ok.find((m) => CHEAP.test(m.model)) ?? ok[0])?.model;
}

/** Whether the account's meters allow a passive batch now. A meter that is not readable allows it (a metered key is the person's to spend). */
export function limitAllows(usage: Obj | undefined): boolean {
  if (!usage) return true;
  for (const k of ["session", "week"]) {
    const pct = Number(((usage[k] as Obj | undefined) ?? {})["pct"]);
    if (Number.isFinite(pct) && pct >= LIMIT_STOP_PCT) return false;
  }
  return true;
}

const SYSTEM = "You keep a short digest of a group conversation for an assistant that may be asked to join it. Write plain prose or short bullets: who is in it, what was decided, what is open and who owns it, and names, dates and numbers that matter. Keep what was in the previous digest that still matters. No preamble.";

export interface DigestDeps {
  db: Db; call: Call; now: () => number; log?: (msg: string, attrs?: Record<string, unknown>) => void;
  /** One request and one answer on an account, as the person it is for (the engine's one-shot; engine.complete is refused at depth 0, which is where this background batch calls from). */
  complete(i: { asker: string; accountRef: string; model?: string; system: string; prompt: string }): Promise<{ text: string }>;
}
const running = new Set<string>();

/**
 * Start a batch if one is due; never waits and never throws, so reading a room never holds a turn. `messages` are the visible ones, oldest first (past sharedAt).
 */
export function maybeRefreshDigest(d: DigestDeps, o: { threadId: string; agentId: string; asker: string; messages: ReadonlyArray<{ threadSeq: number; createdAt: number; kind: string; body: string; author: { id: string } }>; nameOf(id: string): string }): boolean {
  const key = `${o.threadId}|${o.agentId}`;
  if (running.has(key)) return false;
  const have = getDigest(d.db, o.threadId, o.agentId);
  const fresh = o.messages.filter((m) => (m.kind === "text" || m.kind === "agent") && m.body.trim() !== "" && m.threadSeq > (have?.upToSeq ?? 0));
  if (!digestDue({ newCount: fresh.length, lastMessageAt: o.messages.at(-1)?.createdAt, now: d.now() })) return false;
  running.add(key);
  void (async () => {
    try {
      const resolved = (await d.call("engine.account.resolve", { threadId: o.threadId, agentId: o.agentId }, o.asker)) as { accountRef?: string | null; allowed?: boolean } | null;
      if (!resolved?.allowed || !resolved.accountRef) return;
      const usage = (await d.call("engine.usage.get", { threadId: o.threadId, agentId: o.agentId, accountRef: resolved.accountRef }, o.asker).catch(() => undefined)) as Obj | undefined;
      if (!limitAllows(usage)) return;
      const listed = (await d.call("engine.models.list", { accountRef: resolved.accountRef, probe: false }, o.asker)) as { models?: Array<{ model: string; allowed: boolean }> };
      // a list that names nothing (a vendor that serves none): the model the room's agent runs on, or its last turn on this account ran on
      const lastTurn = (usage as { lastTurn?: { model?: string; account?: { ref?: string } } } | undefined)?.lastTurn;
      const ran = lastTurn?.model && (!lastTurn.account?.ref || lastTurn.account.ref === resolved.accountRef) ? lastTurn.model : undefined;
      const model = cheapestModel(listed.models ?? []) ?? (typeof usage?.["model"] === "string" && usage["model"] !== "" ? usage["model"] : undefined) ?? ran;
      let source = fresh.map((m) => `${o.nameOf(m.author.id)}: ${m.body.replace(/\s+/g, " ").trim()}`).join("\n");
      if (source.length > SOURCE_CHARS) source = source.slice(source.length - SOURCE_CHARS);
      const prompt = `${have ? `Previous digest:\n${have.text}\n\n` : ""}New messages:\n${source}\n\nWrite the updated digest.`;
      const out = await d.complete({ asker: o.asker, accountRef: resolved.accountRef, ...(model ? { model } : {}), system: SYSTEM, prompt });
      const text = String(out.text ?? "").trim().slice(0, DIGEST_CHARS);
      if (text !== "") {
        saveDigest(d.db, o.threadId, o.agentId, text, fresh.at(-1)!.threadSeq, d.now());
        // the same batch lets memory note what the room said (memory.capture is idempotent per sentence, skips quiet lines and what came before the chat was shared); a Space without it just goes on
        await d.call("memory.capture", { threadId: o.threadId, reason: "idle" }, o.asker).catch(() => undefined);
      }
    } catch (e) {
      d.log?.("room digest skipped", { threadId: o.threadId, why: e instanceof Error ? e.message.slice(0, 120) : "unknown" });
    } finally {
      running.delete(key);
    }
  })();
  return true;
}
