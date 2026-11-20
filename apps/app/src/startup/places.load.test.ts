// A place's module is loaded once and kept (startup/places.ts loadPlace, loadedPlace): the page's warm-up and the shell's own draw share one load, and a place that is loaded is drawn with nothing to wait for.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPlace, loadedPlace, registerPlace } from "./places.ts";

test("two asks for a place make one load, and the loaded module is then at hand", async () => {
  let calls = 0;
  const mod = { default: () => null };
  registerPlace("vault", () => {
    calls += 1;
    return Promise.resolve(mod as never);
  });
  assert.equal(loadedPlace("vault"), undefined);
  const [a, b] = await Promise.all([loadPlace("vault"), loadPlace("vault")]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  assert.equal(loadedPlace("vault"), a);
  await loadPlace("vault");
  assert.equal(calls, 1, "kept");
});

test("a load that fails is not kept: the next ask tries again", async () => {
  let calls = 0;
  registerPlace("settings", () => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ default: () => null } as never);
  });
  await assert.rejects(loadPlace("settings"), /offline/);
  assert.equal(loadedPlace("settings"), undefined);
  await new Promise((r) => setImmediate(r));
  await loadPlace("settings");
  assert.equal(calls, 2);
  assert.ok(loadedPlace("settings"));
});
