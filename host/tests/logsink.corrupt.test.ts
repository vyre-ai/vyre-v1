// A logs.db that a power loss or a forced restart left malformed must never stop a Space from starting: it is moved aside and a fresh one is made.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLogSink } from "../src/daemon/daemon.ts";

test("a malformed logs.db is moved aside with its journals, a fresh one opens, and the move is its first line", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-logs-"));
  const file = path.join(dir, "logs.db");
  fs.writeFileSync(file, Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(4096, 0x5a)]));
  fs.writeFileSync(`${file}-wal`, "x");
  const sink = openLogSink(file, () => 1_700_000_000_000, "tok");
  const aside = fs.readdirSync(dir).filter((f) => f.startsWith("logs.db.corrupt-"));
  // the failed open may have made a -shm beside the -wal; everything of the old file goes aside together
  for (const f of ["logs.db.corrupt-1700000000000", "logs.db.corrupt-1700000000000-wal"]) assert.ok(aside.includes(f), f);
  assert.ok(!fs.existsSync(`${file}-wal`) || fs.statSync(`${file}-wal`).size !== 1, "the old journal is not left beside the new file");
  sink.log({ space: "-", level: 30, msg: "after", place: "test" });
  sink.flush();
  const msgs = (sink.db.prepare("SELECT msg FROM logs ORDER BY id").all() as { msg: string }[]).map((r) => r.msg);
  assert.equal(msgs[0], "logs.reset");
  assert.ok(msgs.includes("after"));
  sink.close();
});

test("a healthy logs.db is opened as it is", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-logs-"));
  const file = path.join(dir, "logs.db");
  const first = openLogSink(file, Date.now, "tok");
  first.log({ space: "-", level: 30, msg: "kept", place: "test" });
  first.flush();
  first.close();
  const again = openLogSink(file, Date.now, "tok");
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes("corrupt")), []);
  assert.ok((again.db.prepare("SELECT msg FROM logs").all() as { msg: string }[]).some((r) => r.msg === "kept"));
  again.close();
});
