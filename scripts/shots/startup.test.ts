// The startup report: chunk sizes, which scripts the entry loads, and the median.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chunkSizes, entryScripts, median, report } from "./startup.mjs";

function fakeDist(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dist-"));
  fs.mkdirSync(path.join(d, "_expo/static/js/web"), { recursive: true });
  fs.writeFileSync(path.join(d, "index.html"), '<html><script src="/_expo/static/js/web/entry-abc.js" defer></script></html>');
  fs.writeFileSync(path.join(d, "_expo/static/js/web/entry-abc.js"), "a".repeat(5000));
  fs.writeFileSync(path.join(d, "_expo/static/js/web/records-def.js"), "b".repeat(9000));
  return d;
}

test("chunks are listed largest first with raw and gzip sizes", () => {
  const c = chunkSizes(fakeDist());
  assert.deepEqual(c.map((x) => x.file), ["_expo/static/js/web/records-def.js", "_expo/static/js/web/entry-abc.js"]);
  assert.ok(c.every((x) => x.gzip > 0 && x.gzip < x.raw));
});

test("the entry is what index.html loads, and the report separates it from the lazy chunks", () => {
  const d = fakeDist();
  assert.deepEqual(entryScripts(d), ["_expo/static/js/web/entry-abc.js"]);
  const r = report(d);
  assert.equal(r.entryRaw, 5000);
  assert.equal(r.total, 14000);
  assert.match(r.text, /entry loads 1 script/);
});

test("the median ignores runs with no mark", () => {
  assert.equal(median([300, null, 100, 200]), 200);
  assert.equal(median([null]), null);
});
