// Ids draw their random bytes from a pooled buffer (one system call per 4 KiB, not per id): the format, the time order and the uniqueness are what they were.
import test from "node:test";
import assert from "node:assert/strict";
import { isUuid, mintId, mintRecordId, mintUuid, timeOf } from "../ids.ts";

test("an id keeps its format: version-4 marker, variant, 48 bits of time first, prefix and record shapes", () => {
  const now = 1_794_947_541_232;
  for (let i = 0; i < 2000; i++) {
    const u = mintUuid(now);
    assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(timeOf(`dec_${u}`), now);
    assert.ok(isUuid(u));
  }
  assert.match(mintId("evt"), /^evt_[0-9a-f-]{36}$/);
  assert.match(mintRecordId(), /^rec_[0-9a-f]{32}$/);
});

test("a caller's own random source is used as before, so a test can pin an id", () => {
  const fixed = (n: number): Uint8Array => new Uint8Array(n).fill(0xab);
  assert.equal(mintUuid(0, fixed), mintUuid(0, fixed));
  assert.equal(mintUuid(0, fixed), "00000000-0000-4bab-abab-abababababab");
});

test("a million ids in one millisecond have no repeat (the pool hands each byte out once, across every refill)", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1_000_000; i++) seen.add(mintUuid(1_700_000_000_000));
  assert.equal(seen.size, 1_000_000);
});
