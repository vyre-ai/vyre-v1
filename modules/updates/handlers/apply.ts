// Updates, part two: apply and roll back (spec 3.10, b13 releases: "auto-updates with backup and roll back"; ARCH 7.10).
//
// apply: read the channel's signed manifest, refuse anything whose signature does not check, take a backup through backup.run and confirm it landed, then
// install, check health, and put the old version back when the new one is not healthy. A failed update records its reason and emits update.failed; the
// server is left on the version it started with.
// rollback: switch to a version the server still keeps, check health, record it. A rollback changes code only; data written by the newer version stays,
// which is why apply insists on the backup first.

import {
  compareVersions, failWith, fetchVerified, mint, need, parseVersion, readState, recordHistory, channelOf,
} from "./channels.ts";
import type { UpdateCtx } from "./channels.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";

const activeOperations = new Set<string>();
async function exclusiveOperation<T>(ctx: UpdateCtx, work: () => Promise<T>): Promise<T> {
  if (activeOperations.has(ctx.space)) return failWith(ctx.trace.traceId, 'validation.precondition_failed', 'Another server update or rollback is running. Wait for it to finish.');
  activeOperations.add(ctx.space);
  try { return await work(); }
  finally { activeOperations.delete(ctx.space); }
}
function operationBusy(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as {code?:unknown}).code === 'update.operation_busy';
}

const asRow = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Take a backup and prove it exists. backup.run answers with the id even when the copy failed (it announces backup.failed), so the list is the proof. */
async function backupFirst(ctx: UpdateCtx, runId: string): Promise<string> {
  let id = "";
  try {
    id = String(asRow(await ctx.call("backup.run" as never, { idempotencyKey: `update:${runId}:backup-first` }))?.["backupId"] ?? "");
    const listed = asRow(await ctx.call("backup.list" as never, { limit: 5 }));
    const rows = Array.isArray(listed?.["backups"]) ? (listed["backups"] as unknown[]) : [];
    if (id && rows.some((r) => asRow(r)?.["backupId"] === id)) return id;
  } catch (e) {
    const why = e instanceof VyreErr ? e.error.message : e instanceof Error ? e.message : "unknown error";
    return failWith(ctx.trace.traceId, "validation.precondition_failed", `An update takes a backup first, and the backup could not be taken, so nothing was changed: ${why}`, { step: "backup" });
  }
  return failWith(ctx.trace.traceId, "validation.precondition_failed", "An update takes a backup first, and the backup did not finish, so nothing was changed. Check Console, Data, Backups.", { step: "backup" });
}

export async function apply(ctx: UpdateCtx, input: { to?: string }) {
  return exclusiveOperation(ctx, () => applyNow(ctx, input));
}
async function applyNow(ctx: UpdateCtx, input: { to?: string }) {
  const d = need(ctx);
  const runId = ctx.run ?? mint("run");
  const state = readState(ctx);
  const channel = channelOf(state);
  const from = await d.installer.current();

  // 1. the signed manifest; a bad signature stops everything here
  const manifest = await fetchVerified(ctx, channel);
  const release = manifest.server;
  if (input.to !== undefined) {
    if (!parseVersion(input.to)) return failWith(ctx.trace.traceId, "validation.bad_input", "That is not a version.", { errors: ["to: not a version"] });
    if (input.to !== release.version) return failWith(ctx.trace.traceId, "validation.precondition_failed", `Only the newest release on the ${channel} channel can be installed, and that is ${release.version}.`, { newest: release.version });
  }
  if (compareVersions(release.version, from) <= 0) return failWith(ctx.trace.traceId, "validation.precondition_failed", `The server is already on ${from}, which is the newest on the ${channel} channel.`, { current: from });

  // 2. backup first
  const backupId = await backupFirst(ctx, runId);

  // 3. install and prove it is healthy, or put the old version back
  const started = ctx.now();
  ctx.emit("update.started" as never, `entity/${release.version}`, { from, to: release.version });
  let reason = "";
  try {
    await d.installer.install(release, channel);
    if (!(await d.installer.healthy())) reason = "the new version did not pass its health check";
  } catch (e) {
    if (operationBusy(e)) return failWith(ctx.trace.traceId, 'validation.precondition_failed', 'Another server update or rollback is running. No rollback was attempted. Wait for it to finish.');
    reason = e instanceof Error ? e.message : "the install did not finish";
  }
  const seconds = Math.max(0, Math.round((ctx.now() - started) / 1000));
  if (reason === "") {
    recordHistory(ctx, { id: runId, at: started, from, to: release.version, result: "ok", seconds, backupId });
    ctx.emit("update.completed" as never, `entity/${release.version}`, { from, to: release.version });
    return { runId };
  }
  try {
    await d.installer.switchTo(from);
    if (!(await d.installer.healthy())) reason = `${reason}; the previous version did not come back healthy either`;
  } catch (e) {
    reason = `${reason}; putting ${from} back failed: ${e instanceof Error ? e.message : "unknown error"}`;
  }
  recordHistory(ctx, { id: runId, at: started, from, to: release.version, result: "failed", seconds, backupId, reason });
  ctx.emit("update.failed" as never, `entity/${release.version}`, { to: release.version, reason });
  return { runId };
}

export async function rollback(ctx: UpdateCtx, input: { to: string }) {
  return exclusiveOperation(ctx, () => rollbackNow(ctx, input));
}
async function rollbackNow(ctx: UpdateCtx, input: { to: string }) {
  const d = need(ctx);
  const runId = ctx.run ?? mint("run");
  if (!parseVersion(input.to)) return failWith(ctx.trace.traceId, "validation.bad_input", "That is not a version.", { errors: ["to: not a version"] });
  const from = await d.installer.current();
  if (input.to === from) return failWith(ctx.trace.traceId, "validation.precondition_failed", `The server is already on ${from}.`, { current: from });
  const kept = await d.installer.previous();
  if (!kept.includes(input.to)) {
    return failWith(ctx.trace.traceId, "validation.not_found", `Version ${input.to} is not kept on this server. Versions you can go back to: ${kept.length ? kept.join(", ") : "none"}.`, { kept });
  }
  const started = ctx.now();
  try {
    await d.installer.switchTo(input.to);
  } catch (e) {
    if (operationBusy(e)) return failWith(ctx.trace.traceId, 'validation.precondition_failed', 'Another server update or rollback is running. Wait for it to finish.');
    return failWith(ctx.trace.traceId, "internal.unexpected", `The roll back did not finish: ${e instanceof Error ? e.message : "unknown error"}. The server may still be on ${from}.`, { from, to: input.to });
  }
  if (!(await d.installer.healthy())) {
    // try to leave the server as it was rather than on a version that is not answering
    try { await d.installer.switchTo(from); } catch { /* the error below already says the state is unknown */ }
    return failWith(ctx.trace.traceId, "internal.unexpected", `Version ${input.to} did not pass its health check after the roll back. The server was put back on ${from}.`, { from, to: input.to });
  }
  const seconds = Math.max(0, Math.round((ctx.now() - started) / 1000));
  recordHistory(ctx, { id: runId, at: started, from, to: input.to, result: "rolled_back", seconds });
  ctx.emit("update.rolled_back" as never, `entity/${input.to}`, { from, to: input.to });
  return { runId };
}
