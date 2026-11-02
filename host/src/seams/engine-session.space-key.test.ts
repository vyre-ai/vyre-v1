// The Space AI key reaches a turn only as the turn's own account: the driver's authorizer asks with account set, and only then is providers.space_key.use tried after vault.use refuses. A tool call
// (a #handle in a command or a header the model wrote) asks without it and is refused, so an agent can never send the key anywhere but the provider.
import test from "node:test";
import assert from "node:assert/strict";
import { fail } from "../routes/errors.ts";
import { createEngineSessionHost } from "./engine-session.ts";
import type { Invoke } from "../invoke.ts";

const VALUE = "ocg-space-FAKEkey-0123456789abcdefGHIJ"; // secret-scan: fake
const HANDLE = "#OpenCode_Go_for_everyone";

function rig(spaceKey = true) {
  const asked: Array<{ cap: string; principal: string; actingFor?: string }> = [];
  const invoke: Invoke = async (cap, input, seed) => {
    asked.push({ cap, principal: `${seed.principal.kind}:${seed.principal.id}`, ...(seed.actingFor ? { actingFor: seed.actingFor } : {}) });
    if (cap === "vault.use") throw fail("permission.no_grant", "0".repeat(32), { message: "That needs use access to the item." });
    if (cap === "providers.space_key.use") {
      if (!spaceKey || (input as { handle: string }).handle !== HANDLE) throw fail("validation.not_found", "0".repeat(32), { message: "That is not the Space AI key." });
      return { status: "ok", output: { handle: HANDLE, itemId: "vit_space" } } as never;
    }
    throw new Error(`unscripted ${cap}`);
  };
  const reads: Array<{ handle: string; asker?: string }> = [];
  const host = createEngineSessionHost({
    invoke, space: "spc_t", lockedWaitMs: 0,
    vault: { secret: async (handle, _space, asker) => { reads.push({ handle, ...(asker ? { asker } : {}) }); return VALUE; }, signRs256: async () => "" },
  });
  return { host, asked, reads };
}

test("the turn's own account: vault.use refuses a member, the Space AI key path answers, and the value is read Shared only", async () => {
  const { host, asked, reads } = rig();
  const got = await host.source.lookup(HANDLE, { agentId: "agt_helper", asker: "usr_mia", where: "host", account: true });
  assert.deepEqual(got, { kind: "value", itemId: "vit_space", value: VALUE, spaceOnly: false, injectIntoDeployments: false });
  assert.deepEqual(asked, [
    { cap: "vault.use", principal: "agent:agt_helper", actingFor: "usr_mia" },
    { cap: "providers.space_key.use", principal: "agent:agt_helper", actingFor: "usr_mia" },
  ]);
  assert.deepEqual(reads, [{ handle: HANDLE }], "no asker: a Mine item of the member's with the same handle can never stand in");
});

test("a tool call with the same handle is refused: the Space AI key is never filled into a command, a header or a file", async () => {
  const { host, asked, reads } = rig();
  for (const where of ["host", "device", "computer"] as const) {
    const got = await host.source.lookup(HANDLE, { agentId: "agt_helper", asker: "usr_mia", where });
    assert.deepEqual(got, { kind: "denied", reason: "no_access" });
  }
  assert.ok(asked.every((a) => a.cap === "vault.use"), "the Space AI key path is not even asked");
  assert.deepEqual(reads, []);
});

test("an account that is not the Space AI key stays refused for someone without use on it", async () => {
  const { host, reads } = rig(false);
  const got = await host.source.lookup("#Robs_Own_Key", { agentId: "agt_helper", asker: "usr_mia", where: "host", account: true });
  assert.deepEqual(got, { kind: "denied", reason: "no_access" });
  assert.deepEqual(reads, []);
});
