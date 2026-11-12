// Import: commit (spec 2.9 Lifecycle, 2.10 last line). The previewed rows are written as an import Run through records.bulk_upsert, in batches. No automation fires unless the importer ticked
// "run automations" (default off), on the preview or on the commit. The same key gives the same answer and writes nothing twice; an import is written once.
// A batch that fails stops the import: the rows already written stay, the Run is marked failed so it can be undone, and import.failed says why. A Run that was stopped ends the import as canceled.
import { call, clean, codeOf, ensure, keyed, listSessions, me, raise, remember, saveSession, staged, tolerant } from "../projections.ts";
import type { ImportCtx, In, RowError, Session } from "../projections.ts";
import type { FieldInfo } from "../mapping.ts";
import { buildRows, compileAll, planBase, tokenFor } from "./preview.ts";
import { fieldsOf } from "./parse.ts";

export const BATCH = 500;
const MAX_BYTES = 64_000_000;
const KEPT_ERRORS = 1000;

/** The imports this process is writing now. One left "running" that is not here was cut off by a restart (interrupted below). */
const writing = new Set<string>();

/** The line the owner of an import cut off by a restart gets, on the failed Run. */
export const CUT_OFF = "The server restarted while this import was being written. The rows written before it stopped are kept; undo the import or bring in the rest again.";

/**
 * After a restart (and every minute after): an import left "running" that no commit in this process is writing ends failed, so its Run's owner is told (run.failed) instead of it hanging as running
 * for ever. Its Run is ended with the same line. Import starts nothing in the background, so a commit cut off by a restart cannot pick up where it stopped.
 */
export async function interrupted(ctx: ImportCtx): Promise<string[]> {
  ensure(ctx.db);
  const out: string[] = [];
  for (const s of listSessions(ctx.db)) {
    if (s.state !== "running" || writing.has(s.importId)) continue;
    Object.assign(s, { state: "failed" });
    saveSession(ctx.db, s);
    if (s.runId) await finish(ctx, s.runId, "failed", `Stopped: ${CUT_OFF}`, CUT_OFF);
    out.push(s.importId);
  }
  return out;
}

async function finish(ctx: ImportCtx, runId: string, status: "succeeded" | "failed" | "stopped", summary: string, error?: string): Promise<void> {
  await tolerant(ctx, "runs.finish", { runId, status, summary, ...(error ? { error: { code: "internal.unexpected", message: error } } : {}) }, null);
}

export async function commit(ctx: ImportCtx, input: In): Promise<unknown> {
  ensure(ctx.db);
  const again = keyed<{ runId: string; importId: string }>(ctx.db, input.idempotencyKey, "import.commit");
  if (again) return again;
  const s: Session = staged(ctx, input.importId, "validation.precondition_failed");
  if (s.state !== "staged") raise(ctx, "validation.precondition_failed", "That import was already written.", { reason: "already_written", state: s.state });
  const plan = s.plan;
  if (!plan || !s.previewToken) raise(ctx, "validation.precondition_failed", "Preview the import before writing it.", { reason: "no_preview" });
  if (input.previewToken !== s.previewToken || tokenFor(s, planBase(plan)) !== s.previewToken) {
    raise(ctx, "validation.precondition_failed", "The preview is out of date. Preview again.", { reason: "stale_preview" });
  }
  const table = s.tables.find((t) => t.name === plan.table);
  if (!table) raise(ctx, "validation.precondition_failed", "The staged table is gone. Parse the source again.", { reason: "no_table" });
  if (JSON.stringify(table.rows).length > MAX_BYTES) raise(ctx, "validation.too_large", "This import is too large to write at once. Split it into smaller files.");

  const fields = new Map<string, FieldInfo>((await fieldsOf(ctx, plan.type)).map((f) => [f.key, f] as const));
  for (const n of plan.newFields) fields.set(n.key, { key: n.key, type: n.type, title: n.title });
  const rows = buildRows(table, plan.mapping, fields, compileAll(ctx, plan.mapping));
  if (rows.length !== plan.actions.length) raise(ctx, "validation.precondition_failed", "The preview is out of date. Preview again.", { reason: "stale_preview" });
  const runAutomations = input.runAutomations ?? plan.runAutomations;
  const todoAt = rows.map((_b, i) => i).filter((i) => plan.actions[i] === "c" || plan.actions[i] === "u" || plan.actions[i] === "r");   // the data row each written row came from, so a refusal names the row in the file
  const todo = todoAt.map((i) => rows[i]!.fields as Record<string, unknown>);
  const errors: RowError[] = rows.flatMap((b) => b.errors);
  const skippedByPlan = [...plan.actions].filter((a) => a === "s").length;

  const started = await call<{ runId: string }>(ctx, "runs.start", { kind: "other", name: `Import ${plan.type}`, owner: me(ctx) }, { idempotencyKey: `imp-run:${s.importId}` });
  const runId = started.runId;
  s.state = "running"; s.runId = runId; s.ranAutomations = runAutomations === true;
  saveSession(ctx.db, s);
  ctx.emit("import.started", `entity/${s.importId}`, { importId: s.importId, runId, type: plan.type, source: s.source, rows: todo.length });

  const result = { runId, importId: s.importId };
  let created = 0, updated = 0, skipped = skippedByPlan;
  writing.add(s.importId);
  try {
    if (plan.newFields.length > 0) {
      await call(ctx, "schema.apply", {
        ops: plan.newFields.map((n) => ({ op: "field.add", type: plan.type, field: n.key, def: { key: n.key, type: n.type, title: n.title } })), reason: `Import into ${plan.type}`,
      }, { idempotencyKey: `imp-schema:${s.importId}` });
    }
    for (let at = 0, n = 0; at < todo.length; at += BATCH, n++) {
      const run = await tolerant<{ run?: { status?: string } }>(ctx, "runs.get", { runId }, {});
      if (run.run?.status === "stopped") {
        s.state = "canceled";
        break;
      }
      const out = await call<{ created?: number; updated?: number; skipped?: number; refused?: Array<{ row: number; message: string }>; stopped?: { reason: string; row: number; message: string; notDone: number[] } }>(ctx, "records.bulk_upsert", {
        type: plan.type, rows: todo.slice(at, at + BATCH), match: plan.onMatch === "create" ? [] : plan.match, runAutomations: runAutomations === true, ...(plan.onMatch === "create" ? { createOnly: true } : {}), ...(plan.onMatch === "skip" ? { skipExisting: true } : {}),   // "create": every row is a new record
      }, { idempotencyKey: `imp:${s.importId}:${n}` });
      created += out.created ?? 0; updated += out.updated ?? 0; skipped += out.skipped ?? 0;
      // a row the importer may not change (or the store refused: a locked field, a record on hold) is a failed row with its reason, on the row of the file it came from; the rest of the batch was written
      for (const r of out.refused ?? []) errors.push({ row: (todoAt[at + r.row] ?? at + r.row) + 1, message: r.message });
      // the call stopped part way (the store went away, or a record changed under it): what it wrote is kept and counted above, the rows it did not try are listed, and the import ends failed
      if (out.stopped) {
        for (const r of out.stopped.notDone) errors.push({ row: (todoAt[at + r] ?? at + r) + 1, message: "Not written: the import stopped before this row." });
        throw new Error(`row ${(todoAt[at + out.stopped.row] ?? at + out.stopped.row) + 1}: ${out.stopped.message}`);
      }
    }
  } catch (e) {
    writing.delete(s.importId);
    const message = e instanceof Error ? e.message : ((e as { error?: { message?: string } } | null)?.error?.message ?? codeOf(e));
    Object.assign(s, { state: "failed", created, updated, skipped, failed: errors.length, errors: errors.slice(0, KEPT_ERRORS) });
    saveSession(ctx.db, s);
    await finish(ctx, runId, "failed", `Stopped after ${created + updated} rows: ${message}`, message);
    ctx.emit("import.failed", `entity/${s.importId}`, { importId: s.importId, runId, type: plan.type, error: message });
    remember(ctx.db, input.idempotencyKey, "import.commit", result);
    return result;
  }
  writing.delete(s.importId);
  const canceled = s.state === "canceled";
  Object.assign(s, { state: canceled ? "canceled" : "done", created, updated, skipped, failed: errors.length, errors: errors.slice(0, KEPT_ERRORS) });
  // the rows are not kept once they are written (or the import is canceled): the counts and the errors stay
  s.tables = s.tables.map((t) => ({ ...t, rows: [] }));
  saveSession(ctx.db, s);
  const line = `${created} created, ${updated} updated, ${skipped} skipped, ${errors.length} failed`;
  if (canceled) await finish(ctx, runId, "stopped", `Stopped by a person. ${line}`);
  else {
    await finish(ctx, runId, "succeeded", line);
    ctx.emit("import.completed", `entity/${s.importId}`, clean({ importId: s.importId, runId, type: plan.type, source: s.source, created, updated, skipped, failed: errors.length, ranAutomations: runAutomations === true }));
  }
  remember(ctx.db, input.idempotencyKey, "import.commit", result);
  return result;
}
