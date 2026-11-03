// Two daemons in one process (the tests that boot two computers of one Personal Space, lane l-multidevice): a module's seam is one value per process, so the daemon that stops first must not
// unwire what the other wired after it. Before, stopping the first computer cleared the engine host the second had bound, and a chat on the second never answered ("engine_not_running").
import test from "node:test";
import assert from "node:assert/strict";
import { wireSeams } from "../src/seams/index.ts";
import type { SeamDeps, SeamSetters } from "../src/seams/index.ts";

const deps = (): SeamDeps => ({
  vault: { secret: () => Promise.reject(new Error("no vault")), signRs256: () => Promise.reject(new Error("no vault")) },
  files: { read: () => Promise.reject(new Error("no files")) },
  blobs: { put: () => Promise.reject(new Error("no blobs")) },
  members: { emails: () => Promise.resolve([]) },
  space: "spc_test",
  drivers: { setEngineHost: (d: unknown) => ({ from: (d as { tag?: string }).tag }) },
} as unknown as SeamDeps);

test("the daemon that stops first leaves the seam the later one wired; the later one clears its own", () => {
  let held: unknown = "unset";
  const setters = { setEngineHost: (h: unknown) => { held = h; } } as unknown as SeamSetters;
  const a = wireSeams(setters, { ...deps(), tag: "A" } as unknown as SeamDeps);
  const b = wireSeams(setters, { ...deps(), tag: "B" } as unknown as SeamDeps);
  assert.equal(a.owns("setEngineHost"), false, "B wired over A");
  assert.equal(b.owns("setEngineHost"), true);
  const bs = held;
  a.unwire();
  assert.equal(held, bs, "A's stop leaves B's engine host in place");
  b.unwire();
  assert.equal(held, null, "B's stop clears its own");
});

test("one daemon per process unwires as before", () => {
  let held: unknown = "unset";
  const one = wireSeams({ setEngineHost: (h: unknown) => { held = h; } } as unknown as SeamSetters, deps());
  assert.notEqual(held, "unset");
  one.unwire();
  assert.equal(held, null);
});
