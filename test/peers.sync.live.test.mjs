// Two computers of one Personal Space keep one copy between them (lane l-multidevice, increments 2 and 3): two booted daemons and a real relay node. Both hold the same data; a write on
// either reaches the other through the relay; an edit made on B while A is off waits ("changes waiting") and reaches A when A is back; a field both changed while apart ends as the later write
// on both; a file's blob follows. The relay carries ciphertext only: no row value crosses it in the clear.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRelay } from "../relay/node/server.js";
import { OWNER, boot, call, firstComputer, pause, seen, stageSecond } from "./peers-kit.mjs";

const thread = (d, id) => d.db.all("SELECT title FROM chat_thread WHERE id = ?", id)[0]?.title ?? null;

test("two computers sync through the relay: both ways, offline edits later, conflicts to the later write, blobs, ciphertext only", { timeout: 60_000 }, async () => {
  const relay = createRelay();
  const base = await relay.listen();
  let A = null, B = null;
  try {
    const first = await firstComputer(base);
    A = first.A;
    const { dirB } = await stageSecond(A, first.dirA);
    B = await boot(dirB, ["--space", "spc_staged", "--relay", base, "--peer-name", "Home laptop"]);
    assert.equal(B.space, A.space, "B starts as the same Space");
    await B.peers.tick();

    // a write on A reaches B
    A.db.run("INSERT INTO chat_thread (id, kind, title, createdAt) VALUES ('thr_sync1', 'private', 'Estate of Lee 7731', 1)");
    const got = await B.peers.sync.round();
    assert.equal(got.reached.length, 1, "B reached A through the relay");
    assert.equal(thread(B, "thr_sync1"), "Estate of Lee 7731");

    // and a write on B reaches A
    B.db.run("UPDATE chat_thread SET title = 'Estate of Lee, from the laptop' WHERE id = 'thr_sync1'");
    await A.peers.sync.round();
    assert.equal(thread(A, "thr_sync1"), "Estate of Lee, from the laptop");
    const listA = await call(A, "/v1/network/peers");
    assert.equal(listA.body.data.computers.find((c) => c.name === "Home laptop").online, true, "A saw B just now");

    // A goes off; B keeps working offline, and says what is waiting
    await A.stop(); A = null;
    await pause(5);
    B.db.run("INSERT INTO chat_thread (id, kind, title, createdAt) VALUES ('thr_offline', 'private', 'Written with A asleep', 2)");
    B.db.run("UPDATE chat_thread SET title = 'Laptop wins' WHERE id = 'thr_sync1'");
    const off = await B.peers.sync.round();
    assert.equal(off.reached.length, 0, "A is off: nothing reached");
    assert.ok(B.peers.sync.waiting() >= 2, `B says its changes are waiting (${B.peers.sync.waiting()})`);
    const listB = await call(B, "/v1/network/peers");
    assert.ok(listB.body.data.waiting >= 2, "network.peers carries the waiting count for the title bar");

    // A comes back, having changed the same thread earlier than B did, and a field B did not touch
    A = await boot(first.dirA, ["--relay", base, "--peer-name", "Office iMac"]);
    await A.peers.tick();
    await A.peers.sync.round();
    await A.peers.sync.round();
    assert.equal(thread(A, "thr_offline"), "Written with A asleep", "the offline edit reached A once it was back");
    assert.equal(thread(A, "thr_sync1"), "Laptop wins");
    assert.equal(B.peers.sync.waiting(), 0, "nothing is waiting once A took it");

    // a conflict: both change the title while apart; the later write wins on both, whichever syncs first
    A.db.run("UPDATE chat_thread SET title = 'Office version' WHERE id = 'thr_sync1'");
    await pause(10);
    B.db.run("UPDATE chat_thread SET title = 'Laptop version' WHERE id = 'thr_sync1'");
    await A.peers.sync.round();
    await B.peers.sync.round();
    assert.equal(thread(A, "thr_sync1"), "Laptop version");
    assert.equal(thread(B, "thr_sync1"), "Laptop version");

    // the same name made on both computers while apart: both survive, the later keeps the name, and the clash is listed in Settings
    const market = (d, id) => {
      const cols = d.db.all("PRAGMA table_info(agents_marketplaces)");
      const vals = cols.map((c) => (c.name === "id" ? id : c.name === "name" ? "Team tools" : /INT/i.test(c.type) ? 1 : "x"));
      d.db.run(`INSERT INTO agents_marketplaces (${cols.map((c) => `"${c.name}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...vals);
    };
    market(A, "mkt_office");
    await pause(10);
    market(B, "mkt_laptop");
    await A.peers.sync.round();
    await B.peers.sync.round();
    await A.peers.sync.round();
    for (const d of [A, B]) {
      assert.deepEqual(d.db.all("SELECT id, name FROM agents_marketplaces WHERE id IN ('mkt_office', 'mkt_laptop') ORDER BY id").map((r) => ({ ...r })),
        [{ id: "mkt_laptop", name: "Team tools" }, { id: "mkt_office", name: "Team tools (2)" }], "both kept, the later keeps the name, on both computers");
    }
    const clashes = await call(A, "/v1/network/peer_conflicts");
    assert.equal(clashes.status, 200, JSON.stringify(clashes.body));
    assert.ok(clashes.body.data.conflicts.some((c) => c.kind === "renamed" && c.detail.includes("Team tools (2)")), "the clash is in the sync conflicts list");

    // a file's contents follow (a blob is named by its content)
    fs.mkdirSync(path.join(first.dirA, "blobs", "ctx"), { recursive: true });
    fs.writeFileSync(path.join(first.dirA, "blobs", "ctx", "blb_peers0001"), "ciphertext of a file");
    for (let i = 0; i < 6 && !fs.existsSync(path.join(dirB, "blobs", "ctx", "blb_peers0001")); i++) await B.peers.sync.round();
    assert.equal(fs.readFileSync(path.join(dirB, "blobs", "ctx", "blb_peers0001"), "utf8"), "ciphertext of a file");

    // a stranger without a computer's token gets nothing, even through the relay
    const r = await fetch(`${A.url}/v1/peers/changes`, { method: "POST", headers: { "content-type": "application/json", authorization: "Peer vpt_" + "x".repeat(43) }, body: '{"store":"modules","since":0}' });
    assert.equal(r.status, 401);
    const bearer = await fetch(`${A.url}/v1/peers/changes`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: '{"store":"modules","since":0}' });
    assert.equal(bearer.status, 401, "a person's session is not a computer's token");

    const all = Buffer.concat(seen);
    assert.ok(seen.length > 20);
    for (const plain of ["Estate of Lee", "Written with A asleep", "Laptop version", "chat_thread", "ciphertext of a file"]) {
      assert.equal(all.includes(Buffer.from(plain)), false, `the relay never carries "${plain}" in the clear`);
    }
  } finally {
    await B?.stop();
    await A?.stop();
    await relay.close();
  }
});
