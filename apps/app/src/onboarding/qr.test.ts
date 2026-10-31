import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { toMatrix, versionFor } from "./qr.ts";

const hex = (bits: number[]): string => { let s = ""; for (let i = 0; i < bits.length; i += 4) s += parseInt(bits.slice(i, i + 4).concat([0, 0, 0]).slice(0, 4).join(""), 2).toString(16); return s; };
const sha = (text: string): string => createHash("sha256").update(hex((toMatrix(text) ?? []).flat().map((x) => (x ? 1 : 0)))).digest("hex").slice(0, 24);

test("the version grows with the text and stops at 10", () => {
  assert.equal(versionFor(1), 1);
  assert.equal(versionFor(17), 1);
  assert.equal(versionFor(18), 2);
  assert.equal(versionFor(271), 10);
  assert.equal(versionFor(272), 0);
  assert.equal(toMatrix("x".repeat(272)), null);
  assert.equal(toMatrix("hi")!.length, 21);
});

test("the three finder squares, the timing lines and the dark module are in place", () => {
  const m = toMatrix("https://x.vyre.run/pair#c=ABCD-1234")!;
  const n = m.length;
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
    for (let d = 0; d < 7; d++) assert.ok(m[r0]![c0 + d] && m[r0 + 6]![c0 + d] && m[r0 + d]![c0] && m[r0 + d]![c0 + 6], "finder ring");
    assert.ok(m[r0 + 3]![c0 + 3], "finder centre");
    assert.ok(!m[r0 + 1]![c0 + 1] && !m[r0 + 5]![c0 + 5], "finder gap");
  }
  for (let i = 8; i < n - 8; i++) assert.equal(m[6]![i], i % 2 === 0, "timing row");
  assert.ok(m[n - 8]![8], "dark module");
});

// Matrices checked against an independent encoder (toqr) for the same text and mask: one per version.
const VECTORS = [
  { v: 1, text: "Vyr1", sha: "ef504da47f94354b9606eea6" },
  { v: 2, text: "ahovcjqxelszgnubipwd", sha: "1044233b669650b1ae643466" },
  { v: 3, text: "ahovcjqxelszgnubipwdkryfmtahovcjqxelszgn", sha: "83070f5bce530ecbdd432f26" },
  { v: 5, text: "ahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkr", sha: "e447d6864e8cf65a8d166537" },
  { v: 7, text: "ahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxel", sha: "1244557ee2a5f76cfee9103a" },
  { v: 10, text: "ahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnub", sha: "7db3861fabeadaaf2b778560" },
];
test("the bytes, error correction, masking and format bits match an independent encoder", () => {
  for (const x of VECTORS) { assert.equal((toMatrix(x.text)!.length - 17) / 4, x.v); assert.equal(sha(x.text), x.sha, `version ${x.v}`); }
});
