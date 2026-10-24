// The Space's Gate hook for the invoke pipeline (ARCH 4.4 step 5, 4.6; spec 2.14). It joins the pipeline to the Gate module without importing it: every question and every parked call goes
// through the capabilities the Gate module serves, called as the Space itself.
//   applies  does a Gate hold this call? gate.effective_rule decides by the strictest of the Space rule, the owner floor and the agent's own rule (a person's own act skips it unless the act
//            is a human-too kind). An answer that cannot be had stops the call: a send never goes out because the Gate was unreachable.
//   park     gate.park stores the exact call (with the payload hash below) and opens the Approve task; the hold's task id goes back to the caller.
//   verify   the sealed approval token tasks.act minted must carry the hash of exactly this call, for this caller, and not be past its expiry. gate.release then re-invokes the parked
//            call as its original caller with that token (CallOpts.approval and .as, honoured by the pipeline for gate.release alone).
// The daemon wraps this hook with withGateNesting, so one approval covers one send and not its provider call.
import { createHash } from "node:crypto";
import { fail } from "../routes/errors.ts";
import type { CtxSeed, GateHook } from "../invoke.ts";
import type { CapabilityDef } from "../../../packages/contracts/src/types.ts";

export interface GateHookDeps {
  /** Call a capability as the Space itself (its owner, origin "gate"), through the whole pipeline. */
  call(cap: string, input: unknown): Promise<unknown>;
  /** ctx.seal.unseal: opens the approval token. */
  unseal(s: { keyId: string; nonce: string; bytes: string }): Uint8Array;
  now(): number;
}

/** JSON with the keys of every object in order, so the same call always hashes the same. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/** What an approval is bound to: this capability and version, this input, the caller and whom it acts for. gate.park stores it; the token carries it; verify recomputes it. */
export function payloadHash(cap: Pick<CapabilityDef, "name" | "v">, input: unknown, seed: Pick<CtxSeed, "principal" | "actingFor">): string {
  return createHash("sha256").update(canonical({ cap: cap.name, v: cap.v, input, principal: { kind: seed.principal.kind, id: seed.principal.id }, actingFor: seed.actingFor ?? null })).digest("hex");
}

const unb64url = (s: string): string => Buffer.from(s, "base64url").toString("utf8");

export function createGateHook(d: GateHookDeps): GateHook {
  return {
    async applies(cap, _input, seed) {
      const act = cap.gate?.act;
      if (!act || act === "none") return null;
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
      const r = (await d.call("gate.park", input)) as { taskId?: unknown; runId?: unknown } | null;
      if (typeof r?.taskId !== "string") throw fail("internal.unavailable", a.traceId, { message: "Approvals are not available right now.", details: { cap: a.cap.name } });
      return typeof r.runId === "string" ? { taskId: r.taskId, runId: r.runId } : { taskId: r.taskId };
    },
    verify(token, a) {
      if (!token.startsWith("apv_")) return false;
      try {
        const sealed = JSON.parse(unb64url(token.slice(4))) as { keyId: string; nonce: string; bytes: string };
        const claims = JSON.parse(new TextDecoder().decode(d.unseal(sealed))) as { v?: unknown; hash?: unknown; exp?: unknown };
        return claims.v === 1 && typeof claims.exp === "number" && claims.exp >= d.now() && claims.hash === payloadHash(a.cap, a.input, a.seed);
      } catch { return false; }
    },
  };
}
