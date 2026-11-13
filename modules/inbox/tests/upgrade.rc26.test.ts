// The upgrade from rc.26 (contract P2, section 4): a database made by the rc.26 Inbox (fixtures/rc26-inbox.sql: rows left by that tag's own handlers, on the tables its migrations 0001 to 0004 make) is
// brought forward by the host's real migration runner and then started by this build. Counts and flags carry over as the contract says, the old columns are untouched, and starting it twice changes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { migrate } from "../../../host/src/daemon/hosttables.ts";
import { openDb } from "../../../host/src/daemon/sqlite.ts";
import type { HostDb } from "../../../host/src/daemon/sqlite.ts";
import { registerStateKind, stateSeamOf } from "../../../host/src/seams/state.ts";
import { DANA, harness, LEE } from "../fixtures/harness.ts";
import { markRead } from "../handlers/index.ts";
import { periodic } from "../impl.ts";
import { conversationKind, thingOf } from "../state.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/rc26-inbox.sql", import.meta.url));
const NOW = 1_760_000_000_000;
const TRACE = "0123456789abcdef0123456789abcdef";
const MAYA = "usr_maya01";
const JONAS = "usr_jonas1";

/** What an rc.26 server holds: the first four Inbox migrations run by the host, then the rows rc.26's handlers left. */
function rc26(): HostDb {
  const root = mkdtempSync(join(tmpdir(), "rc26-"));
  try {
    mkdirSync(join(root, "modules/inbox/migrations"), { recursive: true });
    for (const f of ["0001_inbox.sql", "0002_inbox_private.sql", "0003_campaign_removed.sql", "0004_inbox_party.sql"])
      copyFileSync(join(REPO, "modules/inbox/migrations", f), join(root, "modules/inbox/migrations", f));
    const db = openDb(":memory:");
    migrate(db, root, () => NOW);
    for (const line of readFileSync(FIXTURE, "utf8").split("\n")) if (line.startsWith("INSERT ")) db.exec(line);
    return db;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const legacyColumns = (db: HostDb): string =>
  JSON.stringify([
    db.all(`SELECT * FROM inbox_conversation ORDER BY id`),
    db.all(`SELECT id, "conversationId", kind, direction, at, unread FROM inbox_item ORDER BY id`),
    db.all(`SELECT * FROM inbox_follow ORDER BY id`),
  ]);
const stateDump = (db: HostDb): string =>
  JSON.stringify(
    ["state_person", "state_thing", "state_count", "inbox_flag"].map((t) =>
      db.all(`SELECT * FROM ${t} ORDER BY rowid`),
    ),
  );

test("an rc.26 Inbox is brought forward: counts and flags carry over, and starting it twice changes nothing", async () => {
  const db = rc26();
  assert.equal(
    (db.all(`SELECT COUNT(*) AS n FROM inbox_item`)[0] as { n: number }).n,
    9,
    "the rc.26 data is all there",
  );
  assert.deepEqual(
    db.all(`SELECT name FROM pragma_table_info('inbox_item') WHERE name = 'arrival'`),
    [],
    "rc.26 had no arrival number",
  );
  const before = legacyColumns(db);

  // the real upgrade: the host runs every migration it has not run
  const ran = migrate(db, REPO, () => NOW);
  assert.ok(ran.some((r) => r.module === "inbox" && r.file === "0005_inbox_state.sql"));
  assert.ok(ran.some((r) => r.module === "state" && r.file === "0001_state.sql"));
  assert.ok(
    !ran.some((r) => r.module === "inbox" && r.file !== "0005_inbox_state.sql"),
    "the rc.26 migrations are not run again",
  );

  // this build starts: the Inbox's module-start job
  const h = harness({ contacts: [{ ...LEE }, { ...DANA, owner: JONAS }], people: [MAYA, JONAS] });
  h.ctx.db = scopedDb("inbox", db, TRACE);
  registerStateKind(db, conversationKind);
  await periodic["inbox.state_backfill"].run(h.ctx);

  const state = stateSeamOf(h.ctx.db, () => NOW);
  const ids = Object.fromEntries(
    (db.all(`SELECT id, address FROM inbox_conversation`) as { id: string; address: string }[]).map((r) => [
      r.address,
      r.id,
    ]),
  );
  const unread = (who: string, address: string) => state.stateOf(who, [thingOf(ids[address]!)])[0]!.unread;
  for (const who of [MAYA, JONAS]) {
    // Pat Lee: two mails read, one mail and a text unread: unread from the oldest unread, for everyone who can see the shared inbox
    assert.equal(unread(who, "pat@acme.test"), 2, `${who}: Pat's mail and text that nobody had read`);
    assert.equal(unread(who, "dana@fox.test"), 2, `${who}: both of Dana's`);
    assert.equal(unread(who, "who@nowhere.test"), 1, `${who}: the stranger's unread mail (our reply is not an entry)`);
    assert.equal(unread(who, "old@nowhere.test"), 0, `${who}: read in full, so no badge for old mail`);
  }
  assert.deepEqual(state.counts(MAYA, ["mailbox:mbx_shared"]), [
    { scope: "mailbox:mbx_shared", things: 3, entries: 5 },
  ]);
  assert.deepEqual(state.counts(JONAS, ["mailbox:mbx_shared"]), [
    { scope: "mailbox:mbx_shared", things: 3, entries: 5 },
  ]);
  assert.deepEqual(state.verify({ deep: true }).problems, [], "every stored number equals its recount");
  assert.deepEqual(
    db.all(`SELECT arrival FROM inbox_item ORDER BY at, id`).map((r) => (r as { arrival: number }).arrival),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    "every item was numbered in the order it was filed",
  );
  assert.equal(db.all(`SELECT 1 FROM state_person WHERE done_at IS NOT NULL`).length, 0, "Done starts empty");
  assert.equal(legacyColumns(db), before, "the old read flags and counts are untouched");

  // starting it again changes nothing
  const once = stateDump(db);
  await periodic["inbox.state_backfill"].run(h.ctx);
  assert.equal(stateDump(db), once);
  assert.deepEqual(
    migrate(db, REPO, () => NOW),
    [],
    "and the migrations have nothing left to run",
  );
});

test("after the upgrade the first reads are each person's own", async () => {
  const db = rc26();
  migrate(db, REPO, () => NOW);
  const h = harness({ contacts: [{ ...LEE }, { ...DANA, owner: JONAS }], people: [MAYA, JONAS] });
  h.ctx.db = scopedDb("inbox", db, TRACE);
  registerStateKind(db, conversationKind);
  await periodic["inbox.state_backfill"].run(h.ctx);
  const pat = (db.all(`SELECT id FROM inbox_conversation WHERE address = 'pat@acme.test'`)[0] as { id: string }).id;
  markRead(h.as({ kind: "person", id: MAYA }), { conversationId: pat });
  const state = stateSeamOf(h.ctx.db, () => NOW);
  assert.equal(state.stateOf(MAYA, [thingOf(pat)])[0]!.unread, 0);
  assert.equal(state.stateOf(JONAS, [thingOf(pat)])[0]!.unread, 2, "Jonas still has his two");
});

test("the server is killed halfway through the backfill: the next start finishes it, to the same result as one clean run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rc26-kill-"));
  try {
    const file = join(dir, "modules.db");
    // a data folder made by the rc.26 build, carried forward by the host's migrations, on disk
    const first = rc26();
    first.exec(`VACUUM INTO '${file}'`);
    first.close();
    let db = openDb(file);
    migrate(db, REPO, () => NOW);
    const start = (conn: HostDb) => {
      const h = harness({ contacts: [{ ...LEE }, { ...DANA, owner: JONAS }], people: [MAYA, JONAS] });
      h.ctx.db = scopedDb("inbox", conn, TRACE);
      registerStateKind(conn, conversationKind);
      return h;
    };
    // the process dies while the third conversation is being written
    const ids = (db.all(`SELECT id FROM inbox_conversation ORDER BY id`) as { id: string }[]).map((r) => r.id);
    db.exec(`CREATE TRIGGER killed BEFORE INSERT ON state_person WHEN NEW.id = '${ids[2]}' BEGIN SELECT RAISE(ABORT, 'killed'); END`);
    await assert.rejects(() => periodic["inbox.state_backfill"].run(start(db).ctx), /killed/);
    assert.equal(db.all(`SELECT 1 FROM inbox_flag`).length, 0, "not marked done");
    assert.ok((db.all(`SELECT 1 FROM state_person`) as unknown[]).length > 0, "and part of it was written");
    db.close();
    // the next start
    db = openDb(file);
    db.exec(`DROP TRIGGER killed`);
    await periodic["inbox.state_backfill"].run(start(db).ctx);
    const after = stateDump(db);
    // one clean run on the same data
    const clean = rc26();
    migrate(clean, REPO, () => NOW);
    await periodic["inbox.state_backfill"].run(start(clean).ctx);
    const byAddress = (conn: HostDb) =>
      JSON.stringify(
        conn.all(
          `SELECT p.person AS person, c.address AS address, p.read_upto AS read_upto, p.unread AS unread FROM state_person p JOIN inbox_conversation c ON c.id = p.id ORDER BY 1, 2`,
        ),
      );
    assert.equal(byAddress(db), byAddress(clean), "the same places for everyone");
    assert.deepEqual(stateSeamOf(scopedDb("inbox", db, TRACE), () => NOW).verify({ deep: true }).problems, []);
    await periodic["inbox.state_backfill"].run(start(db).ctx);
    assert.equal(stateDump(db), after, "and a third start changes nothing");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
