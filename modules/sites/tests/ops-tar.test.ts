// Reading a file out of a tar, with the writer the sites runner already has (r42-sites-run, slice 5).
import test from "node:test";
import assert from "node:assert/strict";
import { untarFirst } from "../ops/tarread.ts";
import { tarFiles } from "../handlers/tar.ts";

test("the first file comes back whole, whatever its size", () => {
  for (const n of [0, 1, 511, 512, 513, 5000]) {
    const data = new Uint8Array(n).map((_, i) => i % 251);
    const out = untarFirst(tarFiles([{ path: "vyre-backup.gz", data }]));
    assert.deepEqual(out && Array.from(out), Array.from(data), `size ${n}`);
  }
});

test("with two files the first is the one returned", () => {
  const out = untarFirst(
    tarFiles([
      { path: "a", data: new TextEncoder().encode("first") },
      { path: "b", data: new TextEncoder().encode("second") },
    ]),
  );
  assert.equal(new TextDecoder().decode(out ?? new Uint8Array()), "first");
});

test("a tar with nothing, a cut tar and rubbish give null", () => {
  assert.equal(untarFirst(new Uint8Array(0)), null);
  assert.equal(untarFirst(new Uint8Array(1024)), null);
  const whole = tarFiles([{ path: "a", data: new Uint8Array(2000) }]);
  assert.equal(untarFirst(whole.subarray(0, 700)), null);
  assert.equal(untarFirst(new Uint8Array(600).fill(65)), null);
});
