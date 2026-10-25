// sync.push (ARCH 5.4): apply a device's outbox ops in order, each as its own capability call, merging concurrent field edits by the field's policy.
// Retrying is exact: the first result of an opId is the result of every later push of it, so a dropped connection, a repeated batch or a half-applied batch all end in the same place.
// A refusal (permission, label, lock, hold, validation) is a result: it goes to `rejected` with the values to copy out. A failure that may pass (timeout, provider, internal) stops the batch,
// so the ops after it are neither applied nor refused and the device sends them again.
import { VyreErr } from "../../../../packages/contracts/src/errors.ts";
import type { VyreError } from "../../../../packages/contracts/src/types.ts";
import { clampHlc, formatHlc, parseHlc } from "../../../../lib/hlc.ts";
import { MAX_PUSH_OPS } from "../../protocol.ts";
import type { ConflictNotice, Op, PushReq, PushRes, RejectedOp } from "../../protocol.ts";
import { pullError } from "../pull/errors.ts";
import { decideField } from "./merge.ts";
import type { FieldDecision } from "./merge.ts";
import type { InvokeCall, OpOutcome, PushDeps, PushWho } from "./types.ts";

const TRANSIENT = new Set(["rate_limit", "provider", "timeout", "internal"]);
const group = (code: string): string => code.split(".")[0] ?? "";

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The `fields` of a patch op, or null when the op is not a patch of one row. */
export function patchFields(op: Op): Record<string, unknown> | null {
  if (!op.entity || !op.id || !isObj(op.input)) return null;
  const f = op.input["fields"];
  return isObj(f) ? f : null;
}

function verr(code: VyreError["code"], message: string, traceId: string, details?: Record<string, unknown>): VyreError {
  return { code, message, retryable: false, traceId, next: [{ kind: "edit_input", label: "Copy your change out and try again" }], ...(details ? { details } : {}) };
}

/** What the idempotency key stands for: the same opId with other content is a different request, never a quiet second write. */
const opContent = (op: Op) => ({ cap: op.cap, v: op.v, entity: op.entity ?? null, id: op.id ?? null, input: op.input, baseSeq: op.baseSeq, after: op.after ?? null });

async function applyOp(d: PushDeps, who: PushWho, op: Op): Promise<OpOutcome> {
  const parsed = parseHlc(op.hlc);
  if (!parsed) return { kind: "rejected", error: verr("validation.bad_input", "The change has no usable clock.", op.traceId), copyOut: op.input };
  const hlc = formatHlc(clampHlc(parsed, d.now()).hlc);
  const call = (input: unknown): InvokeCall => ({
    cap: op.cap, v: op.v, input, ...(op.entity !== undefined ? { entity: op.entity } : {}), ...(op.id !== undefined ? { id: op.id } : {}),
    principal: who.person, deviceId: who.device, traceId: op.traceId, idempotencyKey: op.opId, hlc,
  });
  const run = async (input: unknown): Promise<{ kind: "applied"; seq: number } | { kind: "held"; taskId: string } | { kind: "rejected"; error: VyreError }> => {
    try {
      return await d.invoke(call(input));
    } catch (e) {
      if (e instanceof VyreErr && !TRANSIENT.has(group(e.error.code))) return { kind: "rejected", error: e.error };
      throw e;
    }
  };

  const fields = patchFields(op);
  if (!fields || !op.entity || !op.id || !Object.keys(fields).length) {
    const r = await run(op.input);
    return r.kind === "rejected" ? { kind: "rejected", error: r.error, copyOut: op.input } : r.kind === "held" ? r : { kind: "applied", seq: r.seq, conflicts: [], lost: [] };
  }

  const entity = op.entity, id = op.id;
  const clocks = await d.clocks(entity, id);
  const clamped = clampHlc(parsed, d.now()).hlc;
  const decisions: FieldDecision[] = [];
  for (const [field, value] of Object.entries(fields)) {
    const afterOp = op.after?.[field];
    decisions.push(decideField({
      field, policy: d.policy(entity, field), value, base: op.baseSeq[field], cur: clocks[field], hlc: clamped, actor: who.person,
      afterSeq: afterOp !== undefined ? await d.appliedSeq(afterOp) : undefined,
    }));
  }
  const refused = decisions.find((x) => x.action === "refuse");
  if (refused) {
    return { kind: "rejected", error: verr("validation.unsupported", "Long text is edited in the document, not as a field change.", op.traceId, { field: refused.field }), copyOut: fields };
  }
  const winning: Record<string, unknown> = {};
  for (const x of decisions) if (x.action === "apply") winning[x.field] = fields[x.field];

  let seq = Math.max(0, ...Object.values(clocks).map((c) => c.seq));
  if (Object.keys(winning).length) {
    const r = await run({ ...(op.input as Record<string, unknown>), fields: winning });
    if (r.kind === "rejected") return { kind: "rejected", error: r.error, copyOut: fields };
    if (r.kind === "held") return r;
    seq = r.seq;
  }

  const conflicts: ConflictNotice[] = [];
  const lost: string[] = [];
  for (const x of decisions) {
    if (x.action === "lose") {
      lost.push(x.field);
      await d.history({ entity, id, field: x.field, value: fields[x.field], hlc, actor: who.person, seq: x.winner.seq, reason: "lww_loser" });
    } else if (x.action === "apply" && x.displaced) {
      await d.history({ entity, id, field: x.field, value: x.displaced.v, hlc: x.displaced.hlc, actor: x.displaced.actor, seq: x.displaced.seq, reason: "lww_loser" });
    } else if (x.action === "conflict") {
      const conflictId = await d.openConflict({
        entity, id, field: x.field, ours: x.ours.v, theirs: x.theirs, base: x.base, oursActor: x.ours.actor, theirsActor: who.person,
        opId: op.opId, traceId: op.traceId, deviceId: who.device, plainChoice: d.restricted(entity, x.field),
      });
      conflicts.push({ id: conflictId, entity, rowId: id, field: x.field, state: "open", opId: op.opId });
    }
  }
  return { kind: "applied", seq, conflicts, lost };
}

export async function pushOps(d: PushDeps, who: PushWho, req: PushReq, traceId: string): Promise<PushRes> {
  if (req.ops.length > MAX_PUSH_OPS) throw pullError("validation.too_large", `A push carries at most ${MAX_PUSH_OPS} changes.`, traceId);
  if (d.deviceRevoked && (await d.deviceRevoked(who.person, who.device))) throw pullError("auth.device_revoked", "This device was revoked. Its copy is removed.", traceId);
  if ((await d.epochOf(who.person)) > req.epoch) throw pullError("auth.device_revoked", "This device was revoked. Its copy is removed.", traceId);
  const res: PushRes = { applied: [], rejected: [], conflicts: [], held: [], serverHlc: d.hlc() };
  for (const op of req.ops) {
    let out: OpOutcome;
    try {
      out = await d.once(who.person, op.cap, op.opId, opContent(op), () => applyOp(d, who, op));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "idem_conflict") {
        res.rejected.push({ opId: op.opId, error: { code: "validation.duplicate", message: "That change id was already used for a different change." }, copyOut: op.input } satisfies RejectedOp);
        continue;
      }
      // A failure that may pass: stop here, the device sends this op and the rest again. Only a first-op failure is surfaced as the request failing.
      if (!res.applied.length && !res.rejected.length && !res.held.length) throw e;
      break;
    }
    if (out.kind === "applied") { res.applied.push({ opId: op.opId, seq: out.seq }); res.conflicts.push(...out.conflicts); }
    else if (out.kind === "held") res.held.push({ opId: op.opId, taskId: out.taskId });
    else res.rejected.push({ opId: op.opId, error: { code: out.error.code, message: out.error.message, details: out.error.details }, copyOut: out.copyOut });
  }
  res.serverHlc = d.hlc();
  return res;
}
