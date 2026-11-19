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

import { TarFirst, TooBig } from "../ops/tarread.ts";

function feed(t: TarFirst, tar: Uint8Array, step: number): void {
  for (let i = 0; i < tar.length; i += step) t.push(tar.subarray(i, i + step));
}

test("streaming: the first file comes back whole however the tar is cut into chunks", () => {
  for (const step of [1, 7, 512, 513, 100000])
    for (const n of [0, 1, 511, 513, 4000]) {
      const data = new Uint8Array(n).map((_, i) => i % 249);
      const t = new TarFirst(10_000);
      feed(t, tarFiles([{ path: "vyre-backup.gz", data }]), step);
      assert.deepEqual(Array.from(t.result() ?? []), Array.from(data), `step ${step} size ${n}`);
    }
});

test("streaming: a file over the cap is refused at its header, before any of it is kept", () => {
  const t = new TarFirst(1000);
  const tar = tarFiles([{ path: "x", data: new Uint8Array(5000) }]);
  assert.throws(
    () => t.push(tar.subarray(0, 512)),
    (e: unknown) => e instanceof TooBig && e.size === 5000,
  );
  assert.equal(t.result(), null);
});

test("streaming: never holds more than the cap, and a cut tar gives null", () => {
  const t = new TarFirst(3000);
  const tar = tarFiles([{ path: "x", data: new Uint8Array(3000) }]);
  feed(t, tar.subarray(0, 2000), 300);
  assert.equal(t.done, false);
  assert.equal(t.result(), null);
});

test("streaming in parts: every part is the size asked but the last, the parts join to the file, and nothing larger is held", () => {
  for (const step of [1, 100, 512, 4096])
    for (const n of [0, 1, 299, 300, 301, 1000]) {
      const data = new Uint8Array(n).map((_, i) => i % 247);
      const t = new TarFirst(10_000, 300);
      const parts: Uint8Array[] = [];
      const tar = tarFiles([{ path: "x", data }]);
      for (let i = 0; i < tar.length; i += step) {
        t.push(tar.subarray(i, i + step));
        parts.push(...t.takeParts());
      }
      parts.push(...t.takeParts());
      const lens = parts.map((p) => p.length);
      assert.ok(
        lens.slice(0, -1).every((l) => l === 300),
        `step ${step} size ${n}: ${lens.join(",")}`,
      );
      assert.ok(lens.length === 0 || (lens.at(-1) as number) <= 300);
      assert.deepEqual(
        parts.flatMap((p) => Array.from(p)),
        Array.from(data),
      );
    }
});
