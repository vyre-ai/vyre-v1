// The browser run needs Chrome and the spike workflow (s7.web.spike.mjs); this file keeps its sources under a test in the normal run.
// @reads spikes/sync-c/web/worker.js
// @reads spikes/sync-c/web/s7.web.spike.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");

test("the web spike wraps the VFS before setting a key and checks both failure modes", () => {
  const w = read("./worker.js");
  assert.match(w, /sqlite3mc_vfs_create/);
  assert.match(w, /PRAGMA key=/);
  assert.match(w, /no_key/);
  assert.match(w, /wrong_key/);
  assert.match(w, /plaintext_in_opfs/);
});
test("the runner script serves cross-origin isolation headers and asserts the 16 ms budget", () => {
  const s = read("./s7.web.spike.mjs");
  assert.match(s, /cross-origin-opener-policy/);
  assert.match(s, /reactive_p99_ms < 16/);
});
