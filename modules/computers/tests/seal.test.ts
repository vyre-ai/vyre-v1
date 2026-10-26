// The sealed profile format (handlers/seal.ts): it opens with the right key and computer, and refuses a wrong key, another computer's file, a cut file and chunks swapped or dropped.
import test from "node:test";
import assert from "node:assert/strict";
import { tarFiles } from "../../../sandbox/src/tar.ts";
import { openBytes, sealBytes, tarEntries } from "../handlers/seal.ts";

const key = (n: number): Uint8Array => new Uint8Array(32).fill(n);
const big = (): Uint8Array => Uint8Array.from({ length: 20 * 1024 * 1024 }, (_, i) => (i * 31) & 255);

test("a profile opens with the same key and computer, small, empty and across chunks", () => {
  for (const plain of [new Uint8Array(0), new TextEncoder().encode("cookies and logins"), big()]) {
    const back = openBytes(sealBytes(plain, key(1), "cmt_a"), key(1), "cmt_a");
    assert.ok(Buffer.from(plain).equals(back));
  }
});

test("the sealed text holds none of the plaintext", () => {
  const sealed = sealBytes(new TextEncoder().encode("PROFILE-MARKER cookie=abc"), key(1), "cmt_a");
  assert.ok(!sealed.includes("PROFILE-MARKER") && !sealed.includes("cookie"));
});

test("a wrong key, another computer's id, a cut file, dropped or swapped chunks are refused", () => {
  const sealed = sealBytes(big(), key(1), "cmt_a");
  const lines = sealed.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 3);
  assert.throws(() => openBytes(sealed, key(2), "cmt_a"));
  assert.throws(() => openBytes(sealed, key(1), "cmt_b"));
  assert.throws(() => openBytes(`${lines.slice(0, 2).join("\n")}\n`, key(1), "cmt_a"), "cut after chunk 2");
  assert.throws(() => openBytes(`${[lines[0], lines[2]].join("\n")}\n`, key(1), "cmt_a"), "a chunk dropped");
  assert.throws(() => openBytes(`${[lines[1], lines[0], lines[2]].join("\n")}\n`, key(1), "cmt_a"), "chunks swapped");
  assert.throws(() => openBytes("\n", key(1), "cmt_a"), "nothing at all");
});

test("an emptied volume reads as a tar of nothing, a profile with files does not", () => {
  assert.equal(tarEntries(tarFiles([])), 0);
  assert.equal(tarEntries(new Uint8Array(1024)), 0);
  const file = (p: string) => ({ path: p, data: new TextEncoder().encode("x"), mode: 0o600, uid: 10001, gid: 10001, mtime: 1 });
  assert.equal(tarEntries(tarFiles([file("Default/Cookies"), file("marker.txt")])), 2);
});
