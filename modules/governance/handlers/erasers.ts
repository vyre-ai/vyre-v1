// The erasers and purgers governance calls so that erase and retention remove data instead of reporting it (spec 2.26; ARCH 4.11; P-L7_15).
//
// DECISION: governance never touches another module's tables. Every store has one capability that removes from it, and this file is the one table that says which. An ERASER removes one item a finding
// listed; a PURGER removes what is older than a cutoff, in batches. A kind whose capability is not in the contract (the call answers validation.unknown_capability) is `no_eraser` / `no_purger`: nothing
// is removed, the caller says so, and the next backup rotation purges what a restore would bring back. Nothing here pretends: an erase that could not remove a kind never counts it as erased.
// DECISION: the capability names below are the steward's contract request on P-L7_15; until they land every call is `no_eraser` except the ones that exist today (files, memory facts, backups).
// DECISION: the erase of a record is a hard delete (records.purge), not Trash; records.delete runs first only to take it out of every view while the purge runs, and a record already in Trash is purged as is.
import { codeOf, obj, text } from "../projections.ts";
import type { EraseKind, GovCtx, Kind } from "../projections.ts";

/** erased: removed. gone: already gone. trashed: a record taken out of every view (Trash) while records.purge is not in the contract; it is not a hard delete. no_eraser: nothing was removed. */
export type Outcome = "erased" | "gone" | "trashed" | "no_eraser";

const missingCap = (e: unknown): boolean => codeOf(e) === "validation.unknown_capability";
const gone = (e: unknown): boolean => codeOf(e) === "validation.not_found";

interface Eraser { cap: string; input(type: string, id: string, key: string): Record<string, unknown> }
/** One eraser per kind and item type. `key` is a stable idempotency key, so a replay after a restore is one call. */
const ERASERS: Readonly<Record<string, Eraser>> = {
  "records:*": { cap: "records.purge", input: (type, id, key) => ({ type, recordId: id, idempotencyKey: key }) },
  "chats:chat": { cap: "threads.erase", input: (_t, id, key) => ({ threadId: id, idempotencyKey: key }) },
  "chats:channel": { cap: "channels.erase", input: (_t, id, key) => ({ channelId: id, idempotencyKey: key }) },
  "inbox:sms": { cap: "telephony.sms.erase", input: (_t, id, key) => ({ smsId: id, idempotencyKey: key }) },
  "calls:call": { cap: "telephony.call.erase", input: (_t, id, key) => ({ callId: id, idempotencyKey: key }) },
  "mail:email": { cap: "mail.message.erase", input: (_t, id, key) => ({ messageId: id, idempotencyKey: key }) },
  "memory:note": { cap: "memory.notes.erase", input: (_t, id, key) => ({ noteId: id, idempotencyKey: key }) },
  "runs:*": { cap: "runs.purge", input: (_t, id, key) => ({ runId: id, idempotencyKey: key }) },
};

const eraserFor = (kind: EraseKind, type: string): Eraser | undefined => ERASERS[`${kind}:${type}`] ?? ERASERS[`${kind}:*`];

/** Remove one item. Safe to call again: an item that is already gone is `gone`, not a failure. Anything else a store refuses is thrown (a hold is the caller's check, made before). */
export async function eraseItem(ctx: GovCtx, kind: EraseKind, type: string, id: string, reason: string): Promise<Outcome> {
  const key = `gov-erase:${kind}:${type}:${id}`;
  try {
    if (kind === "files") {
      await ctx.call("files.delete", { fileId: id });
      await ctx.call("files.purge", { fileId: id });
      return "erased";
    }
    if (kind === "memory" && type === "fact") {
      await ctx.call("memory.erase", { factIds: [id], reason });
      return "erased";
    }
    if (kind === "records") {
      try { await ctx.call("records.delete", { type, recordId: id }); } catch (e) { if (!gone(e)) throw e; }   // out of every view first; already in Trash is fine
    }
    const e = eraserFor(kind, type);
    if (!e) return "no_eraser";
    const out = obj(await ctx.call(e.cap, e.input(type, id, key)));
    return out["erased"] === false ? "gone" : "erased";
  } catch (e) {
    if (missingCap(e)) return kind === "records" ? "trashed" : "no_eraser";
    if (gone(e)) return "gone";
    throw e;
  }
}

// ---- purgers (retention)

export type Purged = { kind: Kind; status: "purged"; removed: number; skipped?: number } | { kind: Kind; status: "no_purger" } | { kind: Kind; status: "kept"; why: string };

interface Purger { cap: string; input(before: number, key: string): Record<string, unknown> }
/** One purger per retention kind that removes by age. `trash` and `audit` already have theirs in retention.ts (files.purge and audit.archive); `backups` uses backup.list and backup.delete. */
const PURGERS: Readonly<Partial<Record<Kind, Purger>>> = {
  run_logs: { cap: "runs.purge", input: (before, key) => ({ before, limit: 500, idempotencyKey: key }) },
  transcripts: { cap: "chat.transcript.purge", input: (before, key) => ({ before, limit: 500, idempotencyKey: key }) },
  file_versions: { cap: "files.versions.purge", input: (before, key) => ({ before, limit: 500, idempotencyKey: key }) },
  logs: { cap: "logs.purge", input: (before, key) => ({ before, limit: 5000, idempotencyKey: key }) },
  events: { cap: "events.compact", input: (before, key) => ({ before, limit: 5000, idempotencyKey: key }) },
  records: { cap: "records.purge_trashed", input: (before, key) => ({ before, limit: 500, idempotencyKey: key }) },
};
const MAX_BATCHES = 50;

/** Remove everything of `kind` older than `before` (epoch ms), a batch at a time. `day` makes the idempotency key one per kind and day, so a job that runs twice in a day is the same call. */
export async function purgeKind(ctx: GovCtx, kind: Kind, before: number, day: string): Promise<Purged> {
  if (kind === "backups") return purgeBackups(ctx, before);
  const p = PURGERS[kind];
  if (!p) return { kind, status: "no_purger" };
  let removed = 0, skipped = 0;
  try {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const out = obj(await ctx.call(p.cap, p.input(before, `gov-purge:${kind}:${day}:${batch}`)));
      const n = out["removed"];
      removed += typeof n === "number" ? n : 0;
      skipped += typeof out["skippedOnHold"] === "number" ? out["skippedOnHold"] : 0;
      if (out["more"] !== true) break;
    }
  } catch (e) {
    if (missingCap(e)) return { kind, status: "no_purger" };
    throw e;
  }
  return { kind, status: "purged", removed, ...(skipped ? { skipped } : {}) };
}

/** Backups older than the cutoff go, except the newest verified one (or the newest of all when none is verified), so a purge never leaves a Space with nothing to restore. */
async function purgeBackups(ctx: GovCtx, before: number): Promise<Purged> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const out = obj(await ctx.call("backup.list", { limit: 500, ...(cursor ? { cursor } : {}) }));
    rows.push(...((Array.isArray(out["backups"]) ? out["backups"] : []) as unknown[]).map(obj));
    cursor = typeof out["next"] === "string" ? out["next"] : undefined;
    if (!cursor) break;
  }
  const byAge = rows.filter((b) => typeof b["at"] === "number").sort((a, b) => (b["at"] as number) - (a["at"] as number));
  const keep = text((byAge.find((b) => b["verified"] === true) ?? byAge[0])?.["backupId"]);
  let removed = 0;
  for (const b of byAge) {
    const id = text(b["backupId"]);
    if (!id || id === keep || (b["at"] as number) >= before) continue;
    await ctx.call("backup.delete", { backupId: id });
    removed++;
  }
  return { kind: "backups", status: "purged", removed };
}
