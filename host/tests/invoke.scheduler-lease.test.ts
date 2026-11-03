// A Personal Space on several computers (lane l-multidevice): a send, post or payment inside a scheduled step runs only on the computer that holds the schedule lease at that moment. Elsewhere the
// call is refused before its handler, with the reason the Run waits on (modules/runs parks the step and the holder resumes it). A write that is not outward, and an outward act a person makes
// outside a step, are not held back.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { NOT_SCHEDULING_COMPUTER, createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { CtxSeed } from "../src/invoke.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const cap = (name: string, effects: string): CapabilityDef => ({
  v: 1, name, summary: "s", input: { type: "object" }, output: { type: "object" }, errors: [], resource: { type: "space" }, permission: null, level: "view",
  risk: "low", effects, emits: [], idempotency: "natural", surfaces: {}, examples: [],
} as unknown as CapabilityDef);

function world(holder: boolean) {
  const s = new AccessSnapshot();
  s.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  const ran: string[] = [];
  const invoke = createInvoke({
    caps: indexCapabilities([cap("mail.send", "outward"), cap("notes.save", "write")]),
    validateInput: () => [], authorize: (req) => authorize(s, req),
    handler: (name) => async () => { ran.push(name); return { ok: true }; },
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })), publish: () => undefined, now: () => 1_000,
    scheduledHere: () => holder,
  });
  return { invoke, ran };
}
const seed: CtxSeed = { space: "spc_1", principal: { kind: "person", id: "usr_dana" } };
const step: CtxSeed = { ...seed, step: { automationId: "aut_weekly", nodeId: "send", defHash: "h1" } };

test("off the lease holder a scheduled step's send is refused before it runs, with the reason the Run waits on", async () => {
  const w = world(false);
  await assert.rejects(() => w.invoke("mail.send", {}, step), (e: unknown) => {
    const err = (e as { error?: { code?: string; retryable?: boolean; details?: { reason?: string } } }).error;
    return err?.code === "internal.unavailable" && err.retryable === true && err.details?.reason === NOT_SCHEDULING_COMPUTER;
  });
  assert.deepEqual(w.ran, [], "nothing was sent");
  assert.equal((await w.invoke("notes.save", {}, step)).status, "ok", "a write that is not outward goes on");
  assert.equal((await w.invoke("mail.send", {}, seed)).status, "ok", "a person's own send outside a scheduled step goes on");
  assert.deepEqual(w.ran, ["notes.save", "mail.send"]);
});

test("on the lease holder the send runs", async () => {
  const w = world(true);
  assert.equal((await w.invoke("mail.send", {}, step)).status, "ok");
  assert.deepEqual(w.ran, ["mail.send"]);
});
