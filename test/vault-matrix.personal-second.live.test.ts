// The Vault matrix (test/support/vault-matrix.ts), a Personal Space on two computers (lane l-multidevice): two daemons and a real relay. What the owner saves on one computer, in every scope,
// reaches the other and is used there (a chat, an automation's AI step, the value itself) with only the password they typed on that computer; a Mine item saved while the first computer's key was
// locked (sealed to their public key) opens on the second. Sharing with other people is refused in plain words on both. The relay carries no value in the clear.
import test from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "../relay/node/server.js";
import { OWNER, boot, firstComputer, seen, stageSecond } from "./peers-kit.mjs";
import { FAKE_CLI, IMPOSSIBLE, PASSWORD, api, chatUse, door, fakeProvider, save, sha12, stepUse } from "./support/vault-matrix.ts";
import type { Rig } from "./support/vault-matrix.ts";
import { makeBundle } from "../client/src/crypto/keys.ts";
import path from "node:path";

test("Vault matrix, a Personal Space on two computers: saved on one, used on the other with no second unlock, in every scope", { timeout: 120_000 }, async () => {
  const relay = createRelay();
  const base = await relay.listen();
  const p = fakeProvider();
  const engine = { engineCli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)], apiFetch: p.apiFetch }, providerFetch: p.apiFetch, documentNetwork: { fetch: p.apiFetch, lookup: async () => ["93.184.216.34"] } };
  let A: any = null, B: any = null;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows: string[] = ["| scope | saved on the first computer | used on the second (chat, AI step, value) | shared |", "|---|---|---|---|"];
  const failures: string[] = [];
  try {
    const first = await firstComputer(base);
    A = first.A;
    // the owner's real key bundle, as their client made it
    const made = await makeBundle(PASSWORD, "recovery-code-matrix", { argon: { memoryKiB: 8, iterations: 1, parallelism: 1 }, spaceId: A.space });
    const { personKey, ...keys } = made;
    A.db.run("UPDATE identity_accounts SET keys_json = ? WHERE person_id = 'usr_olivia'", JSON.stringify(keys));
    const { dirB } = await stageSecond(A, first.dirA);
    await A.stop();
    A = await boot(first.dirA, ["--relay", base, "--peer-name", "Office iMac"], engine);
    B = await boot(dirB, ["--space", "spc_staged", "--relay", base, "--peer-name", "Home laptop"], engine);
    for (const d of [A, B]) assert.equal((await door(d, OWNER, "unlock", personKey, true)).status, 204);
    const rigA = { kind: "personal", d: A, p, people: {}, admin: OWNER, endpoint: "opencode-go" } as unknown as Rig, rigB = { kind: "personal", d: B, p, people: {}, admin: OWNER, endpoint: "opencode-go" } as unknown as Rig;
    const saved: Array<[string, Awaited<ReturnType<typeof save>>]> = [];
    for (const scope of ["mine", "group", "space"] as const) saved.push([scope, await save(rigA, { token: OWNER }, `two-${scope}`, scope, {})]);
    // the first computer's key is locked (the app closed there); a Mine item saved now is sealed to the owner's public key
    assert.equal((await door(A, OWNER, "lock", undefined, true)).status, 204);
    saved.push(["mine, saved while locked", await save(rigA, { token: OWNER }, "two-locked", "mine", {})]);
    await A.peers.tick(); await B.peers.tick();
    await B.peers.sync.round(); await A.peers.sync.round(); await B.peers.sync.round();
    for (const [scope, s] of saved) {
      if (!s.saved) { failures.push(`${scope}: not saved (${s.o.line ?? ""})`); rows.push(`| ${scope} | RED | - | - |`); continue; }
      const chat = await chatUse(rigB, OWNER, s.saved.ai.handle);
      const step = await stepUse(rigB, OWNER, s.saved.ai.handle);
      const value = await api(B, OWNER, "vault.item.reveal", { itemId: s.saved.itemId });
      const used = chat.got === sha12(s.saved.ai.value) && step.got === sha12(s.saved.ai.value) && value.data?.fields?.[0]?.value === s.saved.value;
      const sharedOk = scope === "group" || scope === "space" ? s.shared?.ok === false && s.shared.line === IMPOSSIBLE.personalShare : true;
      rows.push(`| ${scope} | green | ${used ? "green" : "RED"} | ${scope === "group" || scope === "space" ? (sharedOk ? "green (plain no)" : "RED") : "n/a"} |`);
      if (!used) failures.push(`${scope}: on the second computer chat ${chat.got ?? chat.line}, step ${step.got ?? step.line}, value ${value.status} ${value.message ?? ""}`);
      if (!sharedOk) failures.push(`${scope}: sharing said ${JSON.stringify(s.shared)}`);
    }
    // the space AI key: a Personal Space has none; the line says what to do instead
    const key = await save(rigA, { token: OWNER }, "two-key", "space_ai_key", {});
    rows.push(`| space_ai_key | ${key.o.ok ? "saved" : `plain no: ${key.o.line}`} | - | - |`);
    if (!key.o.ok && !/Team Space/.test(key.o.line ?? "")) failures.push(`space AI key: ${key.o.line}`);
    const values = saved.flatMap(([, s]) => (s.saved ? [s.saved.value, s.saved.ai.value] : []));
    assert.ok(!seen.some((frame: unknown) => values.some((v) => String(frame).includes(v))), "no value crossed the relay in the clear");
  } finally {
    process.stdout.write(`${rows.join("\n")}\n`);
    await B?.stop(); await A?.stop(); await relay.close?.();
  }
  assert.equal(failures.length, 0, failures.join("\n"));
});
