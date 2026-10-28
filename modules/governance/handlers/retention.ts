// Retention and holds (spec 2.26; ARCH 4.11): the ten kinds with their defaults and the Space's overrides, the daily job per kind, and holds on files, channels, threads, folders and people.
// DECISION: overrides live in the Space setting retention.overrides (kind to value; `records:<type>` for one record type), so they are in Settings history like any other setting and a value equal to the
// default is not kept as an override.
// DECISION: a job does only what a capability exists for, through ctx.call (modules are leaf nodes): trash purges files that have been in Trash longer than the retention (files.purge), audit moves rows
// past the retention into the archive (audit.archive). run_logs, transcripts, file_versions, logs, events, backups, memory and records have no purge or compaction capability in the frozen contract yet, so
// their job runs, removes nothing and says so; each is a contract gap for the steward (reported on the packet). A value that is not an age (forever, per_policy, the compound file-version rule) removes nothing.
// DECISION: seedTicks (called by the host's boot hook) gives every kind its first daily tick; a job is scheduled for tomorrow the first time it runs and again each time its scheduled call fires; run now does the same work in a Run without adding a second schedule.
// DECISION: a hold on a file also covers it through its folders, and a hold on a person covers everything they own; a held item is skipped and counted, never removed.
import { DEFS, HOLD_KINDS, KINDS, ageOf, bad, codeOf, ensure, finishRun, first, holdRow, isId, list, num, numOrNull, obj, pageOf, paging, refuse, rowsOf, startRun, str, text, missing } from "../projections.ts";
import type { Def, GovCtx, HoldKind, Json, Kind, Row } from "../projections.ts";
import { purgeKind } from "./erasers.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { isHostService } from "../../../lib/trust.ts";

const DAY = 86_400_000;
const VALUE = /^(forever|per_policy|[0-9]+[dwmy])$/;
const RECORD_TYPE = /^[a-z][a-z0-9_]*$/;
const PREFIX: Record<HoldKind, string[]> = { file: ["fil"], channel: ["chn"], thread: ["thr"], folder: ["fld"], person: ["rec", "usr"] };

// ---- overrides

async function overridesOf(ctx: GovCtx): Promise<Record<string, string>> {
  try {
    const v = obj(obj(await ctx.call("settings.get", { key: "retention.overrides" }))["row"])["value"];
    return Object.fromEntries(Object.entries(obj(v)).filter(([, x]) => typeof x === "string")) as Record<string, string>;
  } catch (e) {
    if (codeOf(e) === "validation.not_found") return {};
    throw e;
  }
}

async function saveOverrides(ctx: GovCtx, next: Record<string, string>): Promise<void> {
  await ctx.call("settings.set_space", { key: "retention.overrides", value: next });
}

function kindOf(ctx: GovCtx, v: unknown): Kind {
  return (KINDS as readonly string[]).includes(v as string) ? (v as Kind) : bad(ctx, "That kind of data is not known.");
}

function rowOf(d: Def, o: Record<string, string>): Json {
  const out: Json = { key: d.key, title: d.title, default: d.default, value: o[d.key] ?? d.default, overridden: o[d.key] !== undefined, holdable: d.holdable, tombstone: d.tombstone };
  if (d.key === "records") {
    const per = Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith("records:")).map(([k, v]) => [k.slice("records:".length), v]));
    if (Object.keys(per).length) out["perRecordType"] = per;
  }
  return out;
}

const defOf = (kind: Kind): Def => DEFS.find((d) => d.key === kind) as Def;

export async function retentionGet(ctx: GovCtx) {
  ensure(ctx);
  const o = await overridesOf(ctx);
  return { kinds: DEFS.map((d) => rowOf(d, o)) };
}

function overrideKey(ctx: GovCtx, kind: Kind, recordType: unknown): string {
  if (recordType === undefined) return kind;
  if (kind !== "records") bad(ctx, "Only records are set per record type.");
  if (typeof recordType !== "string" || !RECORD_TYPE.test(recordType)) bad(ctx, "The record type is not valid.");
  return `records:${recordType}`;
}

function changed(ctx: GovCtx, key: string): void {
  ctx.emit("policy.changed", `entity/retention.${key}`, { key: `retention.${key}`, scope: "space", kind: "retention", by: ctx.principal.id });
}

export async function retentionSet(ctx: GovCtx, input: { kind: string; value: string; recordType?: string }) {
  ensure(ctx);
  const kind = kindOf(ctx, input.kind);
  if (typeof input.value !== "string" || !VALUE.test(input.value)) bad(ctx, "Retention is an age like 90d, 2y or 6m, or forever.");
  const key = overrideKey(ctx, kind, input.recordType);
  const d = defOf(kind);
  const o = await overridesOf(ctx);
  const fallback = key === kind ? d.default : (o["records"] ?? d.default);
  const next = { ...o };
  if (input.value === fallback) delete next[key];
  else next[key] = input.value;
  if (JSON.stringify(next) !== JSON.stringify(o)) {
    await saveOverrides(ctx, next);
    changed(ctx, key);
  }
  return { row: rowOf(d, next) };
}

export async function retentionReset(ctx: GovCtx, input: { kind: string; recordType?: string }) {
  ensure(ctx);
  const kind = kindOf(ctx, input.kind);
  const key = overrideKey(ctx, kind, input.recordType);
  const o = await overridesOf(ctx);
  const next = { ...o };
  delete next[key];
  if (key in o) {
    await saveOverrides(ctx, next);
    changed(ctx, key);
  }
  return { row: rowOf(defOf(kind), next) };
}

// ---- holds

/** Is a file held: itself, a folder above it, or its owner as a person. */
export async function fileHeld(ctx: GovCtx, fileId: string, known?: Json): Promise<boolean> {
  if (holdRow(ctx, "file", fileId)) return true;
  const file = known ?? obj(obj(await ctx.call("files.get", { fileId }))["file"]);
  if (text(file["ownerId"]) && holdRow(ctx, "person", text(file["ownerId"]))) return true;
  let folder = text(file["folderId"]);
  for (let hops = 0; folder && hops < 32; hops++) {
    if (holdRow(ctx, "folder", folder)) return true;
    folder = text(obj(obj(await ctx.call("files.folder.get", { folderId: folder }))["folder"])["parentId"]);
  }
  return false;
}

function targetOf(ctx: GovCtx, v: unknown): { kind: HoldKind; id: string } {
  const t = obj(v);
  const kind = t["kind"];
  if (!(HOLD_KINDS as readonly string[]).includes(kind as string)) return bad(ctx, "A hold goes on a file, channel, thread, folder or person.");
  const id = t["id"];
  if (typeof id !== "string" || !PREFIX[kind as HoldKind].some((p) => isId(p, id))) return bad(ctx, `That is not a ${String(kind)} id.`);
  return { kind: kind as HoldKind, id };
}

async function titleOf(ctx: GovCtx, kind: HoldKind, id: string): Promise<string> {
  try {
    if (kind === "file") return text(obj(obj(await ctx.call("files.get", { fileId: id }))["file"])["name"]) || id;
    if (kind === "folder") return text(obj(obj(await ctx.call("files.folder.get", { folderId: id }))["folder"])["name"]) || id;
    if (kind === "channel") return text(obj(obj(await ctx.call("channels.get", { channelId: id }))["channel"])["name"]) || id;
    if (kind === "person") return text(obj(obj(await ctx.call("access.principals.get", { principal: { kind: "person", id } }))["principal"])["name"]) || id;
  } catch {
    // a title that cannot be read does not hide the hold
  }
  return id;
}

export async function holdsPlace(ctx: GovCtx, input: { target: unknown; reason: string }) {
  ensure(ctx);
  const t = targetOf(ctx, input.target);
  if (typeof input.reason !== "string" || input.reason.trim() === "" || input.reason.length > 500) bad(ctx, "A hold needs a reason of up to 500 characters.");
  if (t.kind === "file") await ctx.call("files.get", { fileId: t.id });
  else if (t.kind === "folder") await ctx.call("files.folder.get", { folderId: t.id });
  else if (t.kind === "channel") await ctx.call("channels.get", { channelId: t.id });
  if (holdRow(ctx, t.kind, t.id)) return { ok: true };   // already held: the first reason and name stand
  ctx.db.run(`INSERT INTO governance_hold ("kind", "targetId", "reason", "by", "at") VALUES (?, ?, ?, ?, ?)`, t.kind, t.id, input.reason.trim(), ctx.principal.id, ctx.now());
  ctx.emit("hold.placed", `entity/${t.id}`, { target: t, reason: input.reason.trim(), by: ctx.principal.id });
  return { ok: true };
}

export async function holdsRelease(ctx: GovCtx, input: { target: unknown }) {
  ensure(ctx);
  const t = targetOf(ctx, input.target);
  if (!holdRow(ctx, t.kind, t.id)) return missing(ctx, "That is not on hold.");
  ctx.db.run(`DELETE FROM governance_hold WHERE "kind" = ? AND "targetId" = ?`, t.kind, t.id);
  ctx.emit("hold.released", `entity/${t.id}`, { target: t, by: ctx.principal.id });
  return { ok: true };
}

export async function holdsList(ctx: GovCtx, input: { kind?: string; cursor?: string; limit?: number }) {
  ensure(ctx);
  const { cursor, limit } = paging(ctx, obj(input));
  if (input.kind !== undefined && !(HOLD_KINDS as readonly string[]).includes(input.kind)) bad(ctx, "That kind of hold is not known.");
  const rows = rowsOf(ctx.db.all(`SELECT * FROM governance_hold`)).filter((r) => input.kind === undefined || str(r, "kind") === input.kind)
    .sort((a, b) => num(b, "at") - num(a, "at") || str(a, "targetId").localeCompare(str(b, "targetId")));
  const p = pageOf(rows, cursor, limit);
  const holds = [];
  for (const r of p.page) holds.push({ target: { kind: str(r, "kind"), id: str(r, "targetId") }, title: await titleOf(ctx, str(r, "kind") as HoldKind, str(r, "targetId")), reason: str(r, "reason"), by: str(r, "by"), at: num(r, "at") });
  return { holds, ...(p.next ? { next: p.next } : {}), total: p.total };
}

// ---- jobs

function jobRow(r: Row | null, kind: string): Json {
  const out: Json = { kind, state: r ? str(r, "state") : "idle" };
  for (const [col, key] of [["lastRunAt", "lastRunAt"], ["nextRunAt", "nextRunAt"], ["lastRemoved", "lastRemoved"], ["lastSkippedOnHold", "lastSkippedOnHold"]] as const) if (numOrNull(r, col) !== null) out[key] = num(r, col);
  return out;
}

const jobOf = (ctx: GovCtx, kind: string): Row | null => first(ctx.db.all(`SELECT * FROM governance_job WHERE "kind" = ?`, kind));

function saveJob(ctx: GovCtx, kind: string, f: Record<string, string | number | null>): void {
  if (jobOf(ctx, kind)) ctx.db.run(`UPDATE governance_job SET ${Object.keys(f).map((k) => `"${k}" = ?`).join(", ")} WHERE "kind" = ?`, ...Object.values(f), kind);
  else {
    const all = { lastRunAt: null, nextRunAt: null, lastRemoved: null, lastSkippedOnHold: null, state: "idle", ...f };
    ctx.db.run(`INSERT INTO governance_job ("kind", "lastRunAt", "nextRunAt", "lastRemoved", "lastSkippedOnHold", "state") VALUES (?, ?, ?, ?, ?, ?)`, kind, all.lastRunAt, all.nextRunAt, all.lastRemoved, all.lastSkippedOnHold, all.state);
  }
}

export async function jobsList(ctx: GovCtx) {
  ensure(ctx);
  return { jobs: KINDS.map((k) => jobRow(jobOf(ctx, k), k)) };
}

async function purgeTrash(ctx: GovCtx, age: number): Promise<{ removed: number; skipped: number }> {
  let removed = 0;
  let skipped = 0;
  const cutoff = ctx.now() - age;
  let cursor: string | undefined;
  for (let pages = 0; pages < 50; pages++) {
    const page = obj(await ctx.call("files.trash.list", { limit: 200, ...(cursor ? { cursor } : {}) }));
    for (const f of list(page["files"]).map(obj)) {
      const at = typeof f["deletedAt"] === "number" ? f["deletedAt"] : null;
      if (at === null || at > cutoff) continue;
      if (await fileHeld(ctx, text(f["fileId"]), f)) { skipped++; continue; }
      try {
        await ctx.call("files.purge", { fileId: text(f["fileId"]) });
        removed++;
      } catch (e) {
        if (codeOf(e) !== "validation.not_found") throw e;
      }
    }
    cursor = typeof page["next"] === "string" ? page["next"] : undefined;
    if (!cursor) break;
  }
  return { removed, skipped };
}

async function work(ctx: GovCtx, kind: Kind, value: string): Promise<{ removed: number; skipped: number }> {
  const age = ageOf(value);
  if (age === null) return { removed: 0, skipped: 0 };
  if (kind === "trash") return purgeTrash(ctx, age);
  if (kind === "audit") return { removed: num(obj(await ctx.call("audit.archive", { before: ctx.now() - age })) as Row, "archived"), skipped: 0 };
  // run_logs, transcripts, file_versions, logs, events, records and memory: the owning module's purger (erasers.ts). One that is not in the contract yet removes nothing and says so in the job's numbers.
  const day = new Date(ctx.now()).toISOString().slice(0, 10);
  const held = await heldFor(ctx, kind);
  if (held.all) return { removed: 0, skipped: held.count };
  const done = await purgeKind(ctx, kind, ctx.now() - age, day, held.extra);
  return done.status === "purged" ? { removed: done.removed, skipped: (done.skipped ?? 0) + held.count } : { removed: 0, skipped: 0 };
}

/**
 * What a hold keeps out of an age purge. Holds are governance's, so it tells the owning module. A kind it cannot map a hold onto safely is kept whole (`all`): a hold on a person covers everything they own,
 * a hold on a folder covers files by their place, and the owning modules cannot answer that, so those kinds wait until the hold is released. Held files and threads are passed by id.
 */
export async function heldFor(ctx: GovCtx, kind: Kind): Promise<{ all: boolean; count: number; extra: Record<string, unknown> }> {
  const holds = rowsOf(ctx.db.all(`SELECT * FROM governance_hold`));
  const of = (k: string): string[] => holds.filter((h) => str(h, "kind") === k).map((h) => str(h, "targetId"));
  if (kind === "file_versions") {
    if (of("person").length > 0 || of("folder").length > 0) return { all: true, count: of("person").length + of("folder").length, extra: {} };
    return { all: false, count: of("file").length, extra: of("file").length ? { skipFileIds: of("file") } : {} };
  }
  if (kind === "transcripts") {
    if (of("person").length > 0) return { all: true, count: of("person").length, extra: {} };
    const threads = [...of("thread")];
    for (const channelId of of("channel")) {
      try { const main = text(obj(obj(await ctx.call("channels.get", { channelId }))["channel"])["mainThreadId"]); if (main) threads.push(main); } catch (e) { if (codeOf(e) !== "validation.not_found") throw e; }
    }
    return { all: false, count: threads.length, extra: threads.length ? { skipThreadIds: threads } : {} };
  }
  if (kind === "run_logs" || kind === "records") return of("person").length > 0 ? { all: true, count: of("person").length, extra: {} } : { all: false, count: 0, extra: {} };
  return { all: false, count: 0, extra: {} };
}

/** Boot: give every kind its first daily tick, so a Space that never pressed Run now still has retention running. A kind that already has a tick scheduled is left alone; calling this twice schedules nothing new. */
export async function seedTicks(ctx: GovCtx): Promise<{ scheduled: number }> {
  ensure(ctx);
  if (!ctx.schedule) return { scheduled: 0 };
  let scheduled = 0;
  for (const kind of KINDS) {
    const job = jobOf(ctx, kind);
    if (job && numOrNull(job, "nextRunAt") !== null && num(job, "nextRunAt") > ctx.now()) continue;
    const at = ctx.now() + DAY;
    saveJob(ctx, kind, { nextRunAt: at });
    await ctx.schedule(at, "governance.jobs.tick", { kind });
    scheduled++;
  }
  return { scheduled };
}

/** One run of one job: the work, the numbers in the job row, the event, and the next day's call. */
async function runJob(ctx: GovCtx, kind: Kind): Promise<{ removed: number; skippedOnHold: number }> {
  const before = jobOf(ctx, kind);
  const now = ctx.now();
  const scheduled = numOrNull(before, "nextRunAt") !== null && num(before, "nextRunAt") > now;
  saveJob(ctx, kind, { state: "running" });
  let done: { removed: number; skipped: number };
  try {
    done = await work(ctx, kind, (await overridesOf(ctx))[kind] ?? defOf(kind).default);
  } catch (e) {
    saveJob(ctx, kind, { state: "failed", lastRunAt: now });
    throw e;
  }
  const next = scheduled ? num(before, "nextRunAt") : now + DAY;
  saveJob(ctx, kind, { state: "idle", lastRunAt: now, nextRunAt: next, lastRemoved: done.removed, lastSkippedOnHold: done.skipped });
  if (!scheduled && ctx.schedule) await ctx.schedule(next, "governance.jobs.tick", { kind });
  ctx.emit("retention.purged", `entity/${kind}`, { kind, removed: done.removed, skippedOnHold: done.skipped });
  return { removed: done.removed, skippedOnHold: done.skipped };
}

export async function jobsTick(ctx: GovCtx, input: { kind: string }) {
  ensure(ctx);
  // The daily call is the host's own, or the scheduler's (it runs as whoever scheduled it: an admin who pressed Run now). Anyone else, at any depth, needs policy.manage: a nested call made for a member cannot start a purge early (P-SEC_10).
  if (!isHostService(ctx.principal) && ctx.authorize?.({ perm: "policy.manage", level: "manage" }, { type: "space", id: ctx.space }).effect !== "allow") {
    throw fail("permission.role_lacks_permission", ctx.trace.traceId, { message: "Only the server's own schedule or someone who manages policy runs a retention job.", details: { reason: "system_only" } });
  }
  return runJob(ctx, kindOf(ctx, input.kind));
}

export async function jobsRunNow(ctx: GovCtx, input: { kind: string; idempotencyKey: string }) {
  ensure(ctx);
  const kind = kindOf(ctx, input.kind);
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey === "") bad(ctx, "An idempotency key is required.");
  if (str(jobOf(ctx, kind), "state") === "running") refuse(ctx, "That job is running now.");
  const runId = await startRun(ctx, `Retention: ${kind}`, `retention:${kind}:${input.idempotencyKey}`);
  try {
    const r = await runJob(ctx, kind);
    await finishRun(ctx, runId, { summary: `${r.removed} removed, ${r.skippedOnHold} skipped on hold` });
  } catch (e) {
    await finishRun(ctx, runId, { code: codeOf(e) || "internal.unexpected", message: (e as { error?: { message?: string } } | null)?.error?.message ?? "The retention job failed." });
    throw e;
  }
  return { runId };
}

export async function jobsHealth(ctx: GovCtx) {
  ensure(ctx);
  const late = rowsOf(ctx.db.all(`SELECT * FROM governance_job`)).filter((r) => str(r, "state") === "failed" || (numOrNull(r, "nextRunAt") !== null && num(r, "nextRunAt") < ctx.now() - 12 * 3_600_000));
  if (late.length === 0) return { state: "healthy" as const };
  return { state: late.some((r) => str(r, "state") === "failed") ? ("down" as const) : ("degraded" as const), detail: `Late or failed: ${late.map((r) => str(r, "kind")).sort().join(", ")}. Run them from Console > Data > Retention.` };
}

