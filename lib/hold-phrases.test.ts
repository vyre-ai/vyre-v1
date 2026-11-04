// The hold phrases: one phrase per capability. A key written twice is silently won by the later one, which once put the old "Talk" wording over the "Voice" one.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HOLD_PHRASES } from "./hold-phrases.ts";

test("no capability has two phrases in the table, and Voice is not called Talk", () => {
  const src = fs.readFileSync(new URL("./hold-phrases.ts", import.meta.url), "utf8");
  const keys = [...src.matchAll(/"([a-z0-9_]+(?:\.[a-z0-9_]+)+)":\s*"/g)].map((m) => m[1]!);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dup, []);
  assert.match(HOLD_PHRASES["talk.space.configure"]!, /Voice/);
});
