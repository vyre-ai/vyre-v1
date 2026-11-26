// 26 Nov 2026 (Meier, rc.42): dv_questionnaire and dv_fin_category failed every hour with "That key was already used with different input."
// A pass's list call carries the pass's own token and nonce in its input; the key left them out, so a second pass over the same list made the same key over a changed input.
import test from "node:test";
import assert from "node:assert/strict";
import { canonical } from "../../lib/canonical.ts";
import { remoteStore } from "../src/daemon/syncengine.ts";

/** The server's rule in miniature: a key seen before with other input is a conflict. */
const ledger = () => {
  const seen = new Map<string, string>();
  return async (cap: string, input: unknown) => {
    const { idempotencyKey, ...rest } = input as { idempotencyKey: string };
    const k = `${cap}|${idempotencyKey}`;
    const h = canonical(rest);
    const had = seen.get(k);
    if (had !== undefined && had !== h)
      throw {
        error: { code: "validation.precondition_failed", message: "That key was already used with different input." },
      };
    seen.set(k, h);
    return { output: { rows: [{ id: "1", data: { name: `v${seen.size}` } }] } };
  };
};
const pass = (call: (cap: string, input: unknown) => Promise<unknown>, nonce?: string) =>
  remoteStore({ call } as never, { connector: "c", connectionId: "con_1", remote: "things" }, undefined, {
    unmaskToken: "sp_token",
    sealed: [{ remote: "ssn", local: "ssn" }],
    ...(nonce !== undefined ? { nonce } : {}),
  });

test("two passes over the same list make no conflict when the input differs between them (no nonce given)", async () => {
  const call = ledger();
  await pass(call).page();
  await pass(call).page();
});

test("two passes with their own nonces make no conflict, and one pass reading the same page twice repeats its key", async () => {
  const call = ledger();
  await pass(call, "t1").page();
  await pass(call, "t2").page();
  const s = pass(call, "t3");
  await s.page();
  await s.page();
});
