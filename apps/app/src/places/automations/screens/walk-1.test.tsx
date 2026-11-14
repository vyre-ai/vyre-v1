// The walk, part 1 of 4: an Automation of each of these step kinds opens with its step form and nothing is written (the kinds are every key of manifests/steps-core.ts, plus one per connector family).
import test from "node:test";
import assert from "node:assert/strict";
import { walk } from "./walk-kit.tsx";

test("an Automation of each of these step kinds opens with its form and writes nothing: ai, approval, call_automation, code, collect, connector_requ", async () => {
  assert.deepEqual(await walk(["ai", "approval", "call_automation", "code", "collect", "connector_request", "create_task", "group_by", "http_request"]), [], "no kind writes on open");
});
