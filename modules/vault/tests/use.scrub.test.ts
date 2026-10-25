// The output scrubber (P-L7_10; ARCH 6.11): a value is removed from a stream in its plain form and in base64 (any alignment, standard and url-safe), url-encoded, JSON-escaped and hex form; whatever is left is
// found by `leaks`, and a miss is reported as vault.scrub_miss. Property test over many random values and positions.
// @reads /modules/vault/handlers/use.ts
import test from "node:test";
import assert from "node:assert/strict";
import { forms, leaks, reportScrubMiss, scrub } from "../handlers/use.ts";
import { harness } from "../fixtures/harness.ts";

// a small deterministic generator, so a failure names its seed
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./+=:@ !?\"'&%";
const valueOf = (r: () => number): string => Array.from({ length: 8 + Math.floor(r() * 24) }, () => ALPHABET[Math.floor(r() * ALPHABET.length)]!).join("");
const junk = (r: () => number, n: number): string => Array.from({ length: n }, () => "the quick output "[Math.floor(r() * 17)]!).join("");

const ENCODERS: Record<string, (value: string, r: () => number) => string> = {
  plain: (v, r) => `${junk(r, 5)}${v}${junk(r, 7)}`,
  base64: (v, r) => Buffer.from(`${junk(r, Math.floor(r() * 3) + 1)}${v}${junk(r, Math.floor(r() * 3) + 1)}`).toString("base64"),
  base64url: (v, r) => Buffer.from(`${junk(r, Math.floor(r() * 3) + 1)}${v}${junk(r, Math.floor(r() * 3) + 1)}`).toString("base64url"),
  urlencoded: (v, r) => `?token=${encodeURIComponent(v)}&${junk(r, 4)}`,
  json: (v, r) => JSON.stringify({ k: junk(r, 3), secret: v }),
  hex: (v, r) => `${Buffer.from(junk(r, 3)).toString("hex")}${Buffer.from(v).toString("hex")}`,
};

for (const [name, encode] of Object.entries(ENCODERS)) {
  test(`scrub property: ${name} copies of a value are removed, at any position`, () => {
    const r = rng(name.length * 7919);
    for (let i = 0; i < 300; i++) {
      const value = valueOf(r);
      const text = `out: ${encode(value, r)} done`;
      const secrets = [{ handle: "#Dana_Lawmatics.api_key", value }];
      const cleaned = scrub(text, secrets);
      assert.ok(cleaned.replaced > 0, `seed ${i}: ${name} copy of ${value} was not found in ${text}`);
      assert.ok(!cleaned.text.includes(value), `seed ${i}: plain value left`);
      assert.deepEqual(leaks(cleaned.text, secrets), [], `seed ${i}: ${name} form left in ${cleaned.text}`);
      assert.ok(cleaned.text.includes("[#Dana_Lawmatics.api_key]"));
    }
  });
}

test("scrub leaves ordinary text and short values alone", () => {
  assert.deepEqual(scrub("nothing secret here", [{ handle: "#a", value: "sk-live-12345" }]), { text: "nothing secret here", replaced: 0 });
  assert.deepEqual(scrub("the cat sat", [{ handle: "#a", value: "cat" }]), { text: "the cat sat", replaced: 0 });
  assert.deepEqual(forms("ab"), [], "a value under four characters has no forms to look for");
});

test("two secrets in one stream both go, longest form first", () => {
  const a = "sk-live-AAAA-1111", b = "pw:Zx9-Zx9-Zx9";
  const text = `A=${a} B=${Buffer.from(b).toString("base64")} A again ${encodeURIComponent(a)}`;
  const cleaned = scrub(text, [{ handle: "#a", value: a }, { handle: "#b", value: b }]);
  assert.equal(cleaned.text, "A=[#a] B=[#b] A again [#a]");
  assert.equal(cleaned.replaced, 3);
});

test("a form the scrubber does not know is a miss: leaks cannot see it, and the filler reports it as vault.scrub_miss", async () => {
  const value = "sk-live-9f3a-NEVER-IN-A-LOG";
  const reversed = [...value].reverse().join("");
  const cleaned = scrub(`result ${reversed}`, [{ handle: "#a", value }]);
  assert.equal(cleaned.replaced, 0, "a reversed copy is not a form the scrubber knows");
  const h = harness();
  assert.deepEqual(await reportScrubMiss(h.ctx, { itemId: "vit_abc", place: "terminal", traceId: "b".repeat(32) }), { ok: true });
  assert.equal(h.named("vault.scrub_miss").length, 1);
  assert.ok(!h.everything().includes(value));
  h.cleanup();
});
