import test from "node:test";
import assert from "node:assert/strict";
import { aiDataPageFor } from "../../shell/providers/console.tsx";

test("Models and providers mounts a real Console page", () => {
  const page = aiDataPageFor("models");
  assert.ok(page);
  assert.ok(aiDataPageFor("spend"));
  assert.ok(aiDataPageFor("usage"));
  assert.ok(aiDataPageFor("logging"));
  assert.ok(aiDataPageFor("review"));
  assert.ok(aiDataPageFor("incidents"));
  assert.ok(aiDataPageFor("aipolicy"));
  assert.equal(aiDataPageFor("not-ai-data"), null);
});
