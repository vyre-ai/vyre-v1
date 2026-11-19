import test from "node:test";
import assert from "node:assert/strict";
import { RETIRE_RELAY_WORKER_JS } from "./relay-worker-boot.ts";

// the text runs in a page's inline script: it must parse, and it must carry the one-reload guard and the relay-only match
test("the retire statement parses as script and reloads at most once per tab, and only touches the relay's own worker", () => {
  assert.doesNotThrow(() => new Function(`return function(){${RETIRE_RELAY_WORKER_JS}return;}`));
  assert.match(RETIRE_RELAY_WORKER_JS, /vyre:retired/);
  assert.ok(RETIRE_RELAY_WORKER_JS.includes("/__vyre\\/sw\\.js$/"));
  assert.match(RETIRE_RELAY_WORKER_JS, /^fetch\("\/__vyre\/info\.json"/);
});
