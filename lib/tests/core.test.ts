import test from "node:test";
import assert from "node:assert/strict";
import { mintUuid, mintId, isUuid, timeOf } from "../ids.ts";
import { canonical } from "../canonical.ts";
import { segments, spaceOf, covers, containedPrefix } from "../urn.ts";

test("ids: time-prefixed, sortable as text, version nibble 4, timeOf reads the minute back", () => {
  const a = mintUuid(1_700_000_000_000), b = mintUuid(1_700_000_000_001);
  assert.ok(isUuid(a) && isUuid(b));
  assert.ok(a.slice(0, 13) < b.slice(0, 13), "later ms sorts later");
  assert.equal(timeOf(a), 1_700_000_000_000);
  assert.equal(timeOf(mintId("evt", 5)), 5);
  assert.ok(mintId("gr").startsWith("gr_"));
  assert.equal(timeOf("not an id"), null);
  assert.throws(() => mintUuid(-1), RangeError);
  assert.throws(() => mintUuid(2 ** 48), RangeError);
});

test("ids: an injected random source makes the id reproducible", () => {
  const rand = (n: number) => new Uint8Array(n).fill(0xab);
  assert.equal(mintUuid(0, rand), mintUuid(0, rand));
  assert.match(mintUuid(0, rand), /^00000000-0000-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("canonical: sorted keys, no whitespace, undefined dropped", () => {
  assert.equal(canonical({ b: 1, a: [true, null, "x"], c: undefined }), '{"a":[true,null,"x"],"b":1}');
  assert.equal(canonical({ z: { y: 2, x: 1 } }), '{"z":{"x":1,"y":2}}');
  assert.equal(canonical([undefined]), "[null]");
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
});

test("canonical: refuses what would let two values share a hash", () => {
  assert.throws(() => canonical(NaN), TypeError);
  assert.throws(() => canonical(Infinity), TypeError);
  assert.throws(() => canonical(new Date()), TypeError);
  assert.throws(() => canonical(new Map()), TypeError);
  assert.throws(() => canonical(() => 1), TypeError);
  assert.throws(() => canonical(1n), TypeError);
});

test("urn: segments refuse path tricks", () => {
  assert.deepEqual(segments("vyre://s1/records/r1"), ["s1", "records", "r1"]);
  assert.equal(spaceOf("vyre://s1/files/f"), "s1");
  for (const bad of ["http://x", "vyre://s1/../x", "vyre://s1/%2e/x", "vyre://s1//x", "vyre://s1/a\\b", "vyre://s1/a./b", "vyre://s1/a\u0000b"]) assert.equal(segments(bad), null, bad);
});

test("urn: a selector covers its own depth and below, * is exactly one segment", () => {
  assert.equal(covers("vyre://s1/records", "vyre://s1/records/r1"), true);
  assert.equal(covers("vyre://s1/records/r1", "vyre://s1/records"), false);
  assert.equal(covers("vyre://s1/*/r1", "vyre://s1/files/r1/v2"), true);
  assert.equal(covers("vyre://s1/*", "vyre://s2/records"), false);
  assert.equal(containedPrefix("vyre://s1/files/a/b", "vyre://s1/files/a"), true);
  assert.equal(containedPrefix("vyre://s1/files/a", "vyre://s1/*"), true);
  assert.equal(containedPrefix("vyre://s1/files", "vyre://s1/files/a"), false);
  assert.equal(containedPrefix("vyre://s1/*", "vyre://s1/files"), false, "a wildcard is not inside a fixed name");
  assert.equal(containedPrefix("vyre://s1/*/a", "vyre://s1/files"), false);
});
