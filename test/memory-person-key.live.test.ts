// A member's private memory under her own key, on a booted Team Space server (owner ruling 3 Nov 2026, spec b7; modules/memory/personal.ts). Rubab joins with a real key bundle.
//   - Before her key was ever held here, what she tells Vyre lands under the old server seal; signing in hands her key to the server (the https door), and the background job re-seals it.
//   - With her key held, her own chat turn recalls her facts and her search finds them.
//   - With it dropped (lock), a write still lands, sealed to her public key; her turn and her search get nothing personal, and the turn's recall says why in one plain line.
//   - At rest: no file of the data directory holds her words, and no key the server keeps on disk opens her rows; her own key does.
// The "open after a Google or GitHub sign-in" wrap is turned off for this Space first: with it on, the server keeps a way to her key on disk by design (RULINGS 62, accepted risk), and memory shares it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PersonMemoryKey } from "../kernel/src/seal/index.ts";
import { wipe } from "../client/src/crypto/keys.ts";
import { boot, hostLog, seededDir, standIn } from "./memory-live-kit.ts";
import { SPACE_KEY, api, ask as askIn, door, filesHolding, join, ok, vendor } from "./member-key-kit.ts";
import { LOCKED_LINE } from "../modules/memory/personal.ts";

const OLD = "Rubab keeps her passport in the blue folder";
const NEW = "Rubab prefers calls after four in the afternoon";
const OUT = "Rubab is allergic to cashews";

/** Every memory_facts row of hers, read from the database files the way anyone with the disk could. */
function sealedRows(dir: string, person: string): Array<{ id: string; sealed: string; text: string }> {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".db"))) {
    const db = new DatabaseSync(path.join(dir, f), { readOnly: true });
    try {
      const has = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_facts'").all();
      if (has.length === 0) continue;
      return db.prepare("SELECT id, sealed, text FROM memory_facts WHERE layer = 'person' AND owner_ref = ? ORDER BY learned_at").all(person) as Array<{ id: string; sealed: string; text: string }>;
    } finally { db.close(); }
  }
  return [];
}

/** Every 32-byte value the server keeps in a file: raw, hex or base64, alone in a file or as a JSON string. */
function serverKeys(dir: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  const consider = (s: string): void => {
    const t = s.trim();
    if (/^[0-9a-f]{64}$/i.test(t)) out.push(Buffer.from(t, "hex"));
    for (const enc of ["base64", "base64url"] as const) { const b = Buffer.from(t, enc); if (b.length === 32 && /^[A-Za-z0-9+/_=-]+$/.test(t)) out.push(b); }
  };
  const walk = (p: string): void => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (!e.isFile() || f.endsWith(".db") || f.endsWith("-wal") || f.endsWith("-shm")) continue;
      const b = fs.readFileSync(f);
      if (b.length === 32) out.push(b);
      if (b.length > 4096) continue;
      const s = b.toString("utf8");
      consider(s);
      for (const m of s.matchAll(/"([A-Za-z0-9+/_=-]{40,90})"/g)) consider(m[1]!);
    }
  };
  walk(dir);
  return out;
}

test("Team server: a member's memory is sealed under her own key; recalled with it, locked without, re-sealed from the old seal, closed at rest", async () => {
  const stub = await vendor();
  const dir = seededDir();
  const d = await boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  try {
    assert.equal((await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) })).status, 204);
    const ep = await ok(d, d.token, "providers.custom_add", { name: "Stub Go", baseUrl: stub.base, apiKey: SPACE_KEY, scope: "mine" });
    await ok(d, d.token, "providers.space_key.set", { providerKey: ep.endpoint.key, apiKey: SPACE_KEY });
    await ok(d, d.token, "access.policies.set", { key: "vault.open_after_provider_sign_in", scope: "space", value: false });
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;
    const rubab = await join(d, "rubab");
    const remember = (token: string, text: string) => ok(d, token, "memory.propose_fact", { text, agentId, sourceKind: "manual", sourceRef: "typed" });
    const settle = () => d.hooks!.runPeriodic("memory.personal_keys");

    // 1. before her key was ever held here: the old server seal
    await remember(rubab.token, OLD);
    assert.match(sealedRows(dir, rubab.personId)[0]!.sealed, /^\{/, "the server seal of before");

    // 2. she signs in: the key is handed over, and the job re-seals her row to her own key
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey)).status, 204);
    const oldValue = sealedRows(dir, rubab.personId)[0]!.sealed;
    await settle();
    assert.match(sealedRows(dir, rubab.personId)[0]!.sealed, /^pm1\.o\./, "re-sealed to her own key");
    assert.deepEqual(filesHolding(dir, Buffer.from(oldValue)), [], "the old sealed value is gone from every file");

    // 3. with her key held: her own write, her search, her own turn's recall
    await remember(rubab.token, NEW);
    const found = await ok(d, rubab.token, "memory.search", { q: "calls in the afternoon", mode: "keyword" });
    assert.ok((found.hits as Array<{ text: string }>).some((h) => h.text.includes("calls after four")), JSON.stringify(found));
    assert.equal(found.locked, undefined);
    const turn = await askIn(d, agentId, rubab, "when does Rubab prefer calls?");
    assert.ok(turn.reply.includes(NEW), `her turn recalls it: ${turn.reply.slice(0, 600)}`);

    // 4. her key dropped (lock): a write still lands, sealed to her public key; nothing personal comes back, and the turn says why
    assert.equal((await door(d, rubab.token, "lock")).status, 204);
    await remember(rubab.token, OUT);
    assert.match(sealedRows(dir, rubab.personId).at(-1)!.sealed, /^pm1\.p\./, "sealed to her public key with no private key at hand");
    const none = await ok(d, rubab.token, "memory.search", { q: "calls in the afternoon cashews", mode: "keyword" });
    assert.deepEqual(none.hits, []);
    assert.equal(none.locked, LOCKED_LINE);
    const locked = await askIn(d, agentId, rubab, "when does Rubab prefer calls, and what is she allergic to?");
    assert.ok(!locked.reply.includes(NEW) && !locked.reply.includes(OUT), "nothing personal reached the turn");
    assert.ok(locked.reply.includes("Private memory locked") && locked.reply.includes(LOCKED_LINE), `the turn is told why: ${locked.reply.slice(0, 800)}`);

    // 5. at rest: her words are in no file, and no key the server keeps opens her rows; hers does. (NEW was recalled into her chat, and the stand-in model repeats its prompt in its reply,
    //    so it is in that chat message, which is chat storage, not memory; OLD and OUT never entered a chat.)
    d.sink.flush();
    for (const words of [OLD, OUT]) assert.deepEqual(filesHolding(dir, Buffer.from(words)), [], `"${words}" is in no file in the clear`);
    const rows = sealedRows(dir, rubab.personId);
    assert.equal(rows.length, 3);
    const keys = serverKeys(dir);
    assert.ok(keys.length >= 2, `the server's key files were found (${keys.length})`);
    const aad = `vyre:memory:v1|${rubab.personId}`;
    for (const r of rows) {
      assert.equal(r.text, "");
      for (const k of keys) assert.throws(() => PersonMemoryKey.from(k).open(r.sealed, aad), "a server key does not open her row");
    }
    const hers = PersonMemoryKey.from(rubab.personKey);
    assert.deepEqual(rows.map((r) => hers.open(r.sealed, aad)), [OLD, NEW, OUT], "her own key opens every row");
    assert.ok(!hostLog(d).includes(NEW));

    // 6. signed in again: the job re-seals the offline write, and it is recalled
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey)).status, 204);
    await settle();
    assert.ok(sealedRows(dir, rubab.personId).every((r) => r.sealed.startsWith("pm1.o.")));
    const back = await api(d, rubab.token, "memory.search", { q: "allergic cashews", mode: "keyword" });
    assert.ok((back.data.hits as Array<{ text: string }>).some((h) => h.text.includes("cashews")), JSON.stringify(back.data));
    wipe(rubab.personKey);
  } finally {
    await d.stop();
    await stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
