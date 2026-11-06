// A signed-in person's Vault is always usable (owner ruling 6 Nov): a fresh sign-in can run a turn that needs a Vault credential at once, and so can the next launch, with no password and no unlock step.
// The client half (sign-in keeps the key, relaunch restores it) is test/vault.always-usable.test.ts; this half is the node: the engine session host reading the Vault.
import test from "node:test";
import assert from "node:assert/strict";
import { createEngineSessionHost } from "../src/seams/engine-session.ts";

const who = { agentId: "agt_1", asker: "usr_1", where: "host" as const, account: true };


test("with no key on the server the turn says exactly what is missing, and never asks for an unlock", async () => {
  const host = createEngineSessionHost({
    invoke: (async () => ({ status: "ok", output: { itemId: "vit_1" } })) as never,
    vault: { secret: async () => { throw new Error("Your vault key is locked on this computer."); } } as never,
    space: "spc_1", lockedWaitMs: 0,
  });
  await assert.rejects(host.source.lookup("#Dana_Claude.credentials", who), (e: { code?: string; message?: string }) =>
    e.code === "engine.vault_locked" && /Vault key is not on this server/.test(e.message ?? "") && !/unlock/i.test(e.message ?? ""));
});

test("a Vault read that fails because the key is not on this node is the key-missing case, tries to bring the key back once, and then reads", async () => {
  let held = false; let reads = 0; let rehands = 0;
  const h = createEngineSessionHost({
    invoke: (async () => ({ status: "ok", output: { itemId: "vit_1" } })) as never,
    vault: { secret: async () => { reads++; if (!held) throw new Error("The Vault is not live on this server."); return "CREDENTIAL"; } } as never,
    space: "spc_1", keyHeld: () => held, rehand: async () => { rehands++; held = true; return true; },
  });
  const r = await h.source.lookup("#Dana_Claude.credentials", who);
  assert.equal(r.kind, "value");
  assert.deepEqual([reads, rehands], [2, 1]);
});

test("a read with no way to bring the key back reports the key-missing code and words; any other failure names the item and what failed, never a bare could-not-be-read", async () => {
  const logs: string[] = [];
  const missing = createEngineSessionHost({
    invoke: (async () => ({ status: "ok", output: { itemId: "vit_1" } })) as never,
    vault: { secret: async () => { throw new Error("The Vault is not live on this server."); } } as never,
    space: "spc_1", keyHeld: () => false, lockedWaitMs: 0, log: (m) => logs.push(m),
  });
  await assert.rejects(missing.source.lookup("#Dana_Claude.credentials", who), (e: { code?: string }) => e.code === "engine.vault_locked");
  const other = createEngineSessionHost({
    invoke: (async () => ({ status: "ok", output: { itemId: "vit_1" } })) as never,
    vault: { secret: async () => { throw new Error("The vault service is not running."); } } as never,
    space: "spc_1", keyHeld: () => true,
  });
  await assert.rejects(other.source.lookup("#Dana_Claude.credentials", who), (e: { code?: string; message?: string }) =>
    e.code === "engine.vault_unreadable" && /Dana_Claude/.test(e.message ?? "") && /read failed \(Error\)/.test(e.message ?? "") && !/not running/.test(e.message ?? "") && e.message !== "The Vault could not be read.");
});

test("an item no key can open is said as itself: Your Codex sign-in can't be opened on this device, with the account, so the chat can offer the sign-in", async () => {
  const h = createEngineSessionHost({
    invoke: (async () => ({ status: "ok", output: { itemId: "vit_1" } })) as never,
    vault: { secret: async () => { throw Object.assign(new Error("This sign-in can't be opened on this device. Sign in again."), { code: "vault.item_unopenable" }); } } as never,
    space: "spc_1", keyHeld: () => true,
  });
  await assert.rejects(h.source.lookup("#Codex_irfad47_icloud_com.credentials", who), (e: { code?: string; message?: string }) =>
    e.code === "engine.signin_unopenable" && /^Your Codex sign-in can't be opened on this device\. Sign in to Codex again\./.test(e.message ?? "") && /\[account Codex_irfad47_icloud_com\]/.test(e.message ?? ""));
});
