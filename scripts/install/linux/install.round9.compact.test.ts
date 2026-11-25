// vyre-server compact: the node program it runs (COMPACT_JS, read out of the script) on a real events.db: it reports what it would drop, builds events.db.compact without the kept answers of the rerun
// capabilities, copies every other table whole, ends with a file that gives pages back (auto_vacuum incremental), and refuses (leaving nothing behind) when its own checks fail. The list of caps it drops is the
// registry's own `rerun` list.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { LogStore } from "../../../kernel/src/log/index.ts";
import { SCHEMA } from "../../../kernel/src/log/schema.ts";
import registry from "../../../generated/registry.json" with { type: "json" };

const script = fs.readFileSync(new URL("./vyre-server", import.meta.url), "utf8");
const JS = /^COMPACT_JS='([^']*)'$/m.exec(script)?.[1] ?? "";
const CAPS = /^RERUN_CAPS="([^"]*)"$/m.exec(script)?.[1] ?? "";
const run = (dir: string, mode: string, caps = CAPS) =>
  spawnSync(process.execPath, ["--no-warnings", "-e", JS, mode, caps], {
    env: { ...process.env, COMPACT_DIR: dir },
    encoding: "utf8",
  });

function legacyFile(dir: string): DatabaseSync {
  const db = new DatabaseSync(path.join(dir, "events.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA); // no auto_vacuum: a file made before incremental vacuum
  new LogStore({ db, space: "sp_1" });
  const put = db.prepare("INSERT INTO idempotency (key, principal, cap, result, at) VALUES (?, 'usr_a', ?, ?, ?)");
  const big = new TextEncoder().encode("x".repeat(60_000));
  const small = new TextEncoder().encode("{}");
  db.exec("BEGIN");
  for (let i = 0; i < 300; i++) put.run(`r${i}`, "connectors.read", big, Date.now());
  for (let i = 0; i < 40; i++) put.run(`w${i}`, "records.update", small, Date.now());
  db.exec("COMMIT");
  return db;
}

test("the script's list of caps to drop is the registry's rerun list", () => {
  const caps = (registry as { capabilities?: Array<{ name: string; rerun?: boolean }> }).capabilities ?? [];
  const want = caps
    .filter((c) => c.rerun === true)
    .map((c) => c.name)
    .sort();
  assert.ok(want.length >= 1, "the registry names at least one rerun capability");
  assert.deepEqual(CAPS.split(",").sort(), want);
});

test("report says what would go and changes nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-compact-"));
  const db = legacyFile(dir);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  const before = fs.statSync(path.join(dir, "events.db")).size;
  const r = run(dir, "report");
  assert.equal(r.status, 0, r.stderr);
  const kv = Object.fromEntries(
    r.stdout
      .trim()
      .split("\n")
      .map((l) => l.split(" ") as [string, string]),
  );
  assert.equal(Number(kv["rows"]), 340);
  assert.ok(Number(kv["drop"]) >= 300 * 60_000, "the kept answers of connectors.read");
  assert.ok(Number(kv["keep"]) < 1000);
  assert.equal(Number(kv["auto_vacuum"]), 0, "a legacy file");
  assert.equal(fs.statSync(path.join(dir, "events.db")).size, before);
  assert.ok(!fs.existsSync(path.join(dir, "events.db.compact")));
});

test("run builds a smaller file that keeps every other row and gives pages back, and leaves the old file alone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-compact-"));
  const db = legacyFile(dir);
  for (let i = 0; i < 25; i++) db.exec(`INSERT INTO log_meta (key, value) VALUES ('probe${i}', 'v')`);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  const old = path.join(dir, "events.db");
  const oldBytes = fs.readFileSync(old);
  const r = run(dir, "run");
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /\nok\n$/);
  assert.deepEqual(fs.readFileSync(old), oldBytes, "the old file is byte for byte as it was");
  const n = new DatabaseSync(path.join(dir, "events.db.compact"), { readOnly: true });
  const cnt = (sql: string) => Number((n.prepare(sql).get() as { n: number }).n);
  assert.equal(
    cnt("SELECT count(*) AS n FROM idempotency"),
    40,
    "the kept answers of the read call are gone, the others stay",
  );
  assert.equal(cnt("SELECT count(*) AS n FROM idempotency WHERE cap = 'connectors.read'"), 0);
  assert.equal(cnt("SELECT count(*) AS n FROM log_meta"), 26);
  assert.equal(
    Number((n.prepare("PRAGMA auto_vacuum").get() as { auto_vacuum: number }).auto_vacuum),
    2,
    "the new file gives pages back",
  );
  assert.equal((n.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check, "ok");
  assert.ok(fs.statSync(path.join(dir, "events.db.compact")).size < fs.statSync(old).size / 10);
  n.close();
  // a file the server can open: the log store takes it and its chain is intact
  fs.copyFileSync(path.join(dir, "events.db.compact"), path.join(dir, "again.db"));
  const store = new LogStore({ db: new DatabaseSync(path.join(dir, "again.db")), space: "sp_1" });
  assert.equal(store.verify().ok, true);
  store.close();
  execFileSync("true");
});
