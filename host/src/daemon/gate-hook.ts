// The Space's Gate hook for the invoke pipeline (ARCH 4.4 step 5, 4.6; spec 2.14). It joins the pipeline to the Gate module without importing it: every question and every parked call goes
// through the capabilities the Gate module serves, called as the Space itself.
//   applies  does a Gate hold this call? gate.effective_rule decides by the strictest of the Space rule, the owner floor and the agent's own rule (a person's own act skips it unless the act
//            is a human-too kind). An answer that cannot be had stops the call: a send never goes out because the Gate was unreachable.
//   park     gate.park stores the exact call (with the payload hash below) and opens the Approve task; the hold's task id goes back to the caller.
//   verify   the sealed approval token tasks.act minted must carry the hash of exactly this call, for this caller, and not be past its expiry. gate.release then re-invokes the parked
//            call as its original caller with that token (CallOpts.approvalToken and .onBehalfOf, honoured by the pipeline for gate.release alone).
// The daemon wraps this hook with withGateNesting, so one approval covers one send and not its provider call.
import { canonical, sha256b64 } from "../../../kernel/src/seal/index.ts";
import { evalExpr, parseExpr } from "../../../lib/expr/expr.ts";
import { fail } from "../routes/errors.ts";
import type { CtxSeed, GateHook } from "../invoke.ts";
import type { CapabilityDef } from "../../../packages/contracts/src/types.ts";
import type { ScopedDb } from "../../../packages/contracts/src/ctx.ts";

export interface GateHookDeps {
  /** Call a capability as the Space itself (its owner, origin "gate"), through the whole pipeline. */
  call(cap: string, input: unknown, trace?: { traceId: string; spanId: string }): Promise<unknown>;
  /** ctx.seal.unseal: opens the approval token. */
  unseal(s: { keyId: string; nonce: string; bytes: string }): Uint8Array;
  now(): number;
  /**
   * Conditions a module answers itself, by the function name in a capability's `when` (for example `git.is_protected(input.branch)`, which needs the folder's git settings). The
   * expression language has no such functions, so the Gate asks the module; an evaluator that throws counts as holding, like an unreadable expression.
   */
  evaluators?: Record<string, (input: unknown, seed: Pick<CtxSeed, "principal">) => boolean | Promise<boolean>>;
  /** The held row an approval names (the host owns modules.db): who asked, whom for, run and thread, the stored payload hash and its state. Null when there is none. */
  hold(id: string): { state: string; principalKind: string; principalId: string; actingFor?: string | undefined; run?: string | undefined; thread?: string | undefined; payloadHash: string } | null;
}

/** What an approval is bound to: this capability and version, this input and the caller and whom it acts for: a resumed call runs as exactly that ask-time pair, so an approval can never widen what the caller may do. gate.park stores it; the token carries it; verify recomputes it. */
export function payloadHash(cap: Pick<CapabilityDef, "name" | "v">, input: unknown, seed: Pick<CtxSeed, "principal" | "actingFor">): string {
  return sha256b64(canonical({ cap: cap.name, v: cap.v, input, principal: { kind: seed.principal.kind, id: seed.principal.id }, actingFor: seed.actingFor ?? null }));
}

const unb64url = (s: string): string => Buffer.from(s, "base64url").toString("utf8");

/**
 * The capability's own `when` (spec 2.14): the Gate asks only when the expression holds for this call, over `actor` (who calls) and `input`. No `when` means always. An expression the
 * evaluator cannot read or run counts as holding: a send is asked about, never let through because a condition was unreadable.
 */
export function whenHolds(when: string | undefined, input: unknown, seed: Pick<CtxSeed, "principal">): boolean {
  if (when === undefined) return true;
  try {
    const v: unknown = evalExpr(parseExpr(when), { values: { actor: { kind: seed.principal.kind, id: seed.principal.id }, input: input ?? {} } });
    return v === null || v === undefined ? true : Boolean(v);
  } catch { return true; }
}

/** `fn.name(input.field)`: a condition the module behind `fn.name` evaluates. */
const MODULE_WHEN = /^\s*([a-z_]+\.[a-z_]+)\(\s*input(?:\.[A-Za-z_]+)*\s*\)\s*$/;

async function appliesWhen(d: Pick<GateHookDeps, "evaluators">, when: string | undefined, input: unknown, seed: Pick<CtxSeed, "principal">): Promise<boolean> {
  const fn = when === undefined ? undefined : MODULE_WHEN.exec(when)?.[1];
  const evaluate = fn === undefined ? undefined : d.evaluators?.[fn];
  if (!evaluate) return whenHolds(when, input, seed);
  try { return await evaluate(input, seed); } catch { return true; }
}

interface Claims { v?: unknown; hash?: unknown; exp?: unknown; hold?: unknown }
function claimsOf(d: Pick<GateHookDeps, "unseal">, token: string): Claims | null {
  if (!token.startsWith("apv_")) return null;
  try {
    return JSON.parse(new TextDecoder().decode(d.unseal(JSON.parse(unb64url(token.slice(4))) as { keyId: string; nonce: string; bytes: string }))) as Claims;
  } catch { return null; }
}

export function createGateHook(d: GateHookDeps): GateHook {
  return {
    async applies(cap, input, seed) {
      const act = cap.gate?.act;
      if (!act || act === "none") return null;
      if (!(await appliesWhen(d, cap.gate?.when, input, seed))) return null;
      const r = (await d.call("gate.effective_rule", { principal: { kind: seed.principal.kind, id: seed.principal.id }, act })) as { hold?: unknown } | null;
      return r?.hold === true ? { act } : null;
    },
    async park(a) {
      const input: Record<string, unknown> = {
        capName: a.cap.name, capVersion: a.cap.v, input: a.input, payloadHash: payloadHash(a.cap, a.input, a.seed), act: a.act,
        principal: { kind: a.seed.principal.kind, id: a.seed.principal.id }, decisionId: a.decisionId, idempotencyKey: a.decisionId,
      };
      if (a.seed.actingFor) input["actingFor"] = a.seed.actingFor;
      if (a.seed.run) input["runId"] = a.seed.run;
      if (a.seed.thread) input["threadId"] = a.seed.thread;
      // the park runs in the held call's trace, so gate.requested sits in the asker's event chain
      const r = (await d.call("gate.park", input, { traceId: a.traceId, spanId: "0".repeat(16) })) as { taskId?: unknown; runId?: unknown } | null;
      if (typeof r?.taskId !== "string") throw fail("internal.unavailable", a.traceId, { message: "Approvals are not available right now.", details: { cap: a.cap.name } });
      return typeof r.runId === "string" ? { taskId: r.taskId, runId: r.runId } : { taskId: r.taskId };
    },
    async resume(a) {
      const claims = claimsOf(d, a.token);
      if (!claims || typeof claims.hold !== "string") return null;
      const row = d.hold(claims.hold);
      if (!row || row.state !== "held" || row.principalId !== a.onBehalfOf || !["person", "agent", "actor", "service"].includes(row.principalKind)) return null;
      const principal = { kind: row.principalKind as "person" | "agent" | "actor" | "service", id: row.principalId };
      // the stored call must still be the one that was approved: caller, actingFor and input all feed the hash the Gate stored at park
      if (payloadHash(a.cap, a.input, { principal, actingFor: row.actingFor }) !== row.payloadHash) return null;
      return { principal, actingFor: row.actingFor, run: row.run, thread: row.thread };
    },
    verify(token, a) {
      const claims = claimsOf(d, token);
      return claims !== null && claims.v === 1 && typeof claims.exp === "number" && claims.exp >= d.now() && claims.hash === payloadHash(a.cap, a.input, a.seed);
    },
  };
}

/** The Gate's module conditions for the live modules that export one: `git.is_protected` over the git module's `isProtectedCall`. Called as the Space itself. */
export function moduleWhens(
  exports: ReadonlyMap<string, Record<string, unknown>>, db: () => ScopedDb | null, call: (cap: string, input: unknown) => Promise<unknown>,
): NonNullable<GateHookDeps["evaluators"]> {
  const fn = exports.get("git")?.["isProtectedCall"];
  if (typeof fn !== "function") return {};
  const isProtected = fn as (ctx: { db: ScopedDb; call: typeof call }, input: unknown) => Promise<boolean>;
  return { "git.is_protected": (input) => { const h = db(); return h ? isProtected({ db: h, call }, input) : true; } };
}
