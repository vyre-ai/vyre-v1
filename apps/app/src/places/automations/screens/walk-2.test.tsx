// The walk, part 2 of 4: an Automation of each of these step kinds opens with its step form and nothing is written (the kinds are every key of manifests/steps-core.ts, plus one per connector family).
import test from "node:test";
import assert from "node:assert/strict";
import { walk } from "./walk-kit.tsx";

test("an Automation of each of these step kinds opens with its form and writes nothing: if, loop, parallel, paths, post_message, records.create, rec", async () => {
  assert.deepEqual(await walk(["if", "loop", "parallel", "paths", "post_message", "records.create", "records.find", "records.relate", "records.update"]), [], "no kind writes on open");
});
