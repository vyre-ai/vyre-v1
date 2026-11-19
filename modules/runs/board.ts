// The board and the messages of a tree (r42-runtime slice 5). Nodes of one tree coordinate through these instead of through their parent: a node writes what it found with the evidence it stands on, asks a question the
// parent or a person can answer, and tells a sibling something; the receiver reads it at its next step.
// DECISION: a fact or decision needs evidence (a reference or a quoted line); a question needs none. Two nodes that state different things about one topic do not overwrite each other: both stay, and one question is raised
// for the parent ("Calder and Pine disagree about the price"). The same node saying a topic again replaces its own earlier word (the old entry points at the new one).
// DECISION: a message goes to a node of the same tree and is delivered when the receiver asks for what is waiting (takeMessages), which marks it delivered once; two people or nodes writing at once are two rows in order.
import { appendEvent } from "./node-log.ts";
import { clean, newRunId, nul, raise } from "./projections.ts";
import type { Db, RunsCtx } from "./projections.ts";
import { findNode, getNode } from "./node.ts";
import type { Node } from "./node.ts";

type Row = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const idOf = (p: string): string => `${p}_${newRunId().slice(4)}`;
export const MAX_TEXT = 2_000;
export const MAX_EVIDENCE = 12;

export interface BoardEntry {
  id: string;
  rootRun: string;
  kind: "fact" | "decision" | "question";
  topic?: string;
  text: string;
  byRun: string;
  evidence: string[];
  at: number;
  supersededBy?: string;
  answer?: { byRun: string; text: string; at: number };
}
const entryOf = (r: Row): BoardEntry => {
  let evidence: string[] = [];
  try {
    evidence = JSON.parse(String(r["evidence_json"] ?? "[]"));
  } catch {
    evidence = [];
  }
  return clean({
    id: String(r["id"]),
    rootRun: String(r["root_run"]),
    kind: String(r["kind"]) as BoardEntry["kind"],
    topic: str(r["topic"]),
    text: String(r["text"]),
    byRun: String(r["by_run"]),
    evidence,
    at: int(r["at"]) ?? 0,
    supersededBy: str(r["superseded_by"]),
    answer: str(r["answer_text"])
      ? { byRun: String(r["answer_by"] ?? ""), text: String(r["answer_text"]), at: int(r["answer_at"]) ?? 0 }
      : undefined,
  }) as BoardEntry;
};

export function boardPut(
  ctx: RunsCtx,
  by: Node,
  i: { kind: BoardEntry["kind"]; text: string; topic?: string | undefined; evidence?: readonly string[] | undefined },
): { entry: BoardEntry; conflict?: BoardEntry } {
  const text = i.text.trim();
  if (text === "" || text.length > MAX_TEXT)
    raise(ctx, "validation.bad_input", `Write it in up to ${MAX_TEXT} characters.`, { reason: "bad_text" });
  const evidence = [...new Set((i.evidence ?? []).map((e) => e.trim()).filter((e) => e !== ""))].slice(0, MAX_EVIDENCE);
  if (i.kind !== "question" && evidence.length === 0)
    raise(ctx, "validation.bad_input", "A fact or a decision needs what it stands on: a reference or a quoted line.", {
      reason: "no_evidence",
    });
  const now = ctx.now();
  const id = idOf("bde");
  const topic = i.topic?.trim() === "" ? undefined : i.topic?.trim();
  ctx.db.run(
    "INSERT INTO runs_board (id, root_run, kind, topic, text, by_run, evidence_json, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    by.rootRun,
    i.kind,
    nul(topic),
    text,
    by.id,
    JSON.stringify(evidence),
    now,
  );
  let conflict: BoardEntry | undefined;
  if (topic !== undefined && i.kind !== "question") {
    const live = (
      ctx.db.all(
        "SELECT * FROM runs_board WHERE root_run = ? AND topic = ? AND kind != 'question' AND superseded_by IS NULL AND id != ? ORDER BY at ASC",
        by.rootRun,
        topic,
        id,
      ) as Row[]
    ).map(entryOf);
    for (const old of live) {
      if (old.byRun === by.id) ctx.db.run("UPDATE runs_board SET superseded_by = ? WHERE id = ?", id, old.id);
      else if (old.text !== text && conflict === undefined) conflict = old;
    }
    if (conflict !== undefined) {
      const open = (
        ctx.db.all(
          "SELECT id FROM runs_board WHERE root_run = ? AND topic = ? AND kind = 'question' AND answer_text IS NULL AND superseded_by IS NULL",
          by.rootRun,
          topic,
        ) as Row[]
      ).length;
      if (open === 0) {
        const qid = idOf("bde");
        ctx.db.run(
          "INSERT INTO runs_board (id, root_run, kind, topic, text, by_run, evidence_json, at) VALUES (?, ?, 'question', ?, ?, ?, ?, ?)",
          qid,
          by.rootRun,
          topic,
          `Two nodes say different things about ${topic}. Which one stands?`,
          by.id,
          JSON.stringify([id, conflict.id]),
          now,
        );
        appendEvent(ctx.db, {
          rootRun: by.rootRun,
          runId: by.id,
          at: now,
          type: "board",
          actor: ctx.principal.id,
          key: `board:${qid}`,
          payload: { entryId: qid, kind: "question", topic },
        });
      }
    }
  }
  appendEvent(ctx.db, {
    rootRun: by.rootRun,
    runId: by.id,
    at: now,
    type: "board",
    actor: ctx.principal.id,
    key: `board:${id}`,
    payload: { entryId: id, kind: i.kind, ...(topic ? { topic } : {}) },
  });
  const entry = entryOf((ctx.db.all("SELECT * FROM runs_board WHERE id = ?", id) as Row[])[0]!);
  return conflict ? { entry, conflict } : { entry };
}

export const boardList = (db: Db, rootRun: string, includeOld = false): BoardEntry[] =>
  (
    db.all(
      includeOld
        ? "SELECT * FROM runs_board WHERE root_run = ? ORDER BY at ASC, id ASC"
        : "SELECT * FROM runs_board WHERE root_run = ? AND superseded_by IS NULL ORDER BY at ASC, id ASC",
      rootRun,
    ) as Row[]
  ).map(entryOf);

/** The parent or a person answers a question; the asker reads the answer on the board. Answering twice keeps the first. */
export function boardAnswer(ctx: RunsCtx, entryId: string, by: string, text: string, rootRun: string): BoardEntry {
  // an entry of another tree is not found, whoever asks: an id learnt elsewhere gives no way into another job
  const row = (ctx.db.all("SELECT * FROM runs_board WHERE id = ? AND root_run = ?", entryId, rootRun) as Row[])[0];
  if (!row || String(row["kind"]) !== "question")
    raise(ctx, "validation.not_found", "That question is not on the board.", { reason: "no_question" });
  const t = text.trim();
  if (t === "" || t.length > MAX_TEXT)
    raise(ctx, "validation.bad_input", `Write the answer in up to ${MAX_TEXT} characters.`, { reason: "bad_text" });
  const r = ctx.db.run(
    "UPDATE runs_board SET answer_by = ?, answer_text = ?, answer_at = ? WHERE id = ? AND answer_text IS NULL",
    by,
    t,
    ctx.now(),
    entryId,
  );
  if (r.changes === 1)
    appendEvent(ctx.db, {
      rootRun: String(row["root_run"]),
      runId: String(row["by_run"]),
      at: ctx.now(),
      type: "board",
      actor: by,
      key: `answer:${entryId}`,
      payload: { entryId, answered: true },
    });
  return entryOf((ctx.db.all("SELECT * FROM runs_board WHERE id = ?", entryId) as Row[])[0]!);
}

// ---- messages ----

export interface Message {
  id: string;
  rootRun: string;
  fromRun: string;
  toRun: string;
  body: string;
  at: number;
  deliveredAt?: number;
  seenAt?: number;
}
const msgOf = (r: Row): Message =>
  clean({
    id: String(r["id"]),
    rootRun: String(r["root_run"]),
    fromRun: String(r["from_run"]),
    toRun: String(r["to_run"]),
    body: String(r["body"]),
    at: int(r["at"]) ?? 0,
    deliveredAt: int(r["delivered_at"]),
    seenAt: int(r["seen_at"]),
  }) as Message;

/** `to` is a node of the same tree, or "parent". A finished receiver takes no message. The same (from, key) twice is the first message. */
export function messageSend(
  ctx: RunsCtx,
  from: Node,
  toRef: string,
  body: string,
  key?: string,
): { message: Message; duplicate: boolean } {
  const b = body.trim();
  if (b === "" || b.length > MAX_TEXT)
    raise(ctx, "validation.bad_input", `Write it in up to ${MAX_TEXT} characters.`, { reason: "bad_text" });
  const to =
    toRef === "parent" ? (from.parentRun ? findNode(ctx.db, from.parentRun) : undefined) : findNode(ctx.db, toRef);
  if (!to || to.rootRun !== from.rootRun)
    raise(ctx, "validation.bad_input", "That one is not in this work.", { reason: "not_in_tree" });
  if (key !== undefined) {
    const have = (
      ctx.db.all("SELECT * FROM runs_message WHERE from_run = ? AND msg_key = ?", from.id, key) as Row[]
    )[0];
    if (have) return { message: msgOf(have), duplicate: true };
  }
  if (to.status === "succeeded" || to.status === "failed" || to.status === "stopped")
    raise(ctx, "validation.precondition_failed", "That one has already finished.", {
      reason: "receiver_finished",
      status: to.status,
    });
  const id = idOf("msg");
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO runs_message (id, root_run, from_run, to_run, body, at, msg_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    from.rootRun,
    from.id,
    to.id,
    b,
    now,
    nul(key),
  );
  appendEvent(ctx.db, {
    rootRun: from.rootRun,
    runId: from.id,
    at: now,
    type: "message",
    actor: ctx.principal.id,
    key: `message:${id}`,
    payload: { messageId: id, toRun: to.id },
  });
  return { message: msgOf((ctx.db.all("SELECT * FROM runs_message WHERE id = ?", id) as Row[])[0]!), duplicate: false };
}

/** What waits for a node, oldest first, marked delivered by this call. A second call finds nothing new: delivery happens once, however often the receiver asks. */
export function takeMessages(ctx: RunsCtx, to: string): Message[] {
  const rows = (
    ctx.db.all(
      "SELECT * FROM runs_message WHERE to_run = ? AND delivered_at IS NULL ORDER BY at ASC, id ASC",
      to,
    ) as Row[]
  ).map(msgOf);
  const now = ctx.now();
  const taken: Message[] = [];
  for (const m of rows) {
    const r = ctx.db.run("UPDATE runs_message SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL", now, m.id);
    if (r.changes === 1) {
      taken.push({ ...m, deliveredAt: now });
      const n = findNode(ctx.db, to);
      if (n)
        appendEvent(ctx.db, {
          rootRun: m.rootRun,
          runId: to,
          at: now,
          type: "message",
          actor: to,
          key: `delivered:${m.id}`,
          payload: { messageId: m.id, delivered: true },
        });
    }
  }
  return taken;
}
export function markSeen(ctx: RunsCtx, ids: readonly string[]): number {
  let n = 0;
  for (const id of ids)
    n += ctx.db.run(
      "UPDATE runs_message SET seen_at = ? WHERE id = ? AND delivered_at IS NOT NULL AND seen_at IS NULL",
      ctx.now(),
      id,
    ).changes;
  return n;
}
export const messagesOf = (db: Db, runId: string): Message[] =>
  (
    db.all("SELECT * FROM runs_message WHERE from_run = ? OR to_run = ? ORDER BY at ASC, id ASC", runId, runId) as Row[]
  ).map(msgOf);
export const messagesInTree = (db: Db, rootRun: string): Message[] =>
  (db.all("SELECT * FROM runs_message WHERE root_run = ? ORDER BY at ASC, id ASC", rootRun) as Row[]).map(msgOf);
export { getNode };
