// Check 5: E2E rows ride as ciphertext the server orders but cannot read.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Server, Client, direct } from "./sync.mjs";
import { NodeDb, e2eKeys, metric } from "./adapters.mjs";
import { DocSync, rebuild } from "./docsync.mjs";
import crypto from "node:crypto";

const MARK = "PRIVATE-CHAT-xyzzy-8841";
test("server stores only ciphertext; owner devices decrypt; second user and granted outsider get nothing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s5-")); const file = path.join(dir, "srv.db");
  const s = new Server(file); const pk = crypto.randomBytes(32); const keys = e2eKeys(pk);
  const D1 = await new Client({ dev: "d1", person: "alice", db: new NodeDb(), e2eKeys: keys }).init();
  await D1.edit("chat1", { body: MARK + " hello", title: "plain-title" }, { e2e: true });
  const dm = new DocSync(D1, "mem1", { e2e: true }); dm.text().insert(0, "memory " + MARK); await dm.flush();
  await D1.push(direct(s, "alice"));
  // server cannot read: no plaintext in tables or in the db/wal files
  s.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const dump = JSON.stringify(s.p("SELECT * FROM rows").all()) + JSON.stringify(s.p("SELECT * FROM events").all()) + JSON.stringify(s.p("SELECT * FROM field_history").all());
  assert.ok(!dump.includes(MARK) && !dump.includes("plain-title"));
  const raw = fs.readFileSync(file); assert.ok(!raw.includes(MARK), "plaintext on server disk");
  // server still orders: monotonic seq, hlc in the clear, LWW across two owner devices without reading
  const D2 = await new Client({ dev: "d2", person: "alice", db: new NodeDb(), e2eKeys: keys }).init();
  await D2.bootstrap(direct(s, "alice")); await D2.edit("chat1", { body: "newer " + MARK }, { e2e: true }); await D2.push(direct(s, "alice"));
  await D1.pull(direct(s, "alice")); assert.equal((await D1.read("chat1")).body, "newer " + MARK);
  assert.equal(s.p("SELECT COUNT(*) c FROM field_history WHERE id='chat1'").get().c, 1); // loser kept, as ciphertext
  const seqs = s.p("SELECT seq FROM events ORDER BY seq").all().map((r) => r.seq); assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  // second device bootstraps and decrypts the e2e doc
  const dm2 = new DocSync(D2, "mem1", { e2e: true }); await dm2.absorb(); assert.equal(dm2.text().toString(), "memory " + MARK);
  // another user: even with an explicit grant the server will not deliver e2e rows to a non-owner
  s.grant("bob", "chat1"); s.grant("bob", "mem1");
  const B = await new Client({ dev: "b", person: "bob", db: new NodeDb(), e2eKeys: e2eKeys(crypto.randomBytes(32)) }).init();
  await B.bootstrap(direct(s, "bob")); await B.pull(direct(s, "bob"));
  assert.equal(await B.rowCount(), 0); assert.equal((await B.db.all("SELECT * FROM docs")).length, 0);
  // and a stolen ciphertext is useless without the key / tampered ciphertext fails authentication
  const bad = e2eKeys(crypto.randomBytes(32)); const row = s.p("SELECT * FROM rows WHERE id='chat1' AND field='body'").get();
  assert.throws(() => bad.dec(JSON.parse(row.v), row.key, row.nonce));
  const tampered = Buffer.from(JSON.parse(row.v), "base64"); tampered[0] ^= 1;
  assert.throws(() => keys.dec(tampered.toString("base64"), row.key, row.nonce));
  assert.deepEqual(rebuild(s, "mem1", keys).getText("body").toString(), "memory " + MARK);
  metric("s5.e2e", { server_plaintext_found: false, owner_decrypts: true, outsider_rows: 0, tamper_detected: true, ordering_without_reading: true });
});
