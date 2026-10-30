import test from "node:test";
import assert from "node:assert/strict";
import { boundedScope } from "../../kernel/src/seal/scope.ts";
import { createCtxSeal } from "../src/ctx/seal.ts";

test("a scope stays short and valid whatever the ids are, and still tells the ids apart", () => {
  const longSpace = `spc_${"a".repeat(195)}`;   // the longest id the Personal Space allows (199 characters)
  const realSpace = `spc_${"0123456789abcdef".repeat(2)}`;
  for (const prefix of ["files.blob", "files.changeset"]) {
    for (const space of [longSpace, realSpace, "spc_personal"]) {
      const scope = boundedScope(prefix, space, `blb_${"f".repeat(80)}`);
      assert.ok(scope.length <= 64, `${scope.length} characters`);
      assert.match(scope, /^[a-z][a-z0-9_.:-]{0,63}$/i);
      // ctx.seal takes it
      const seal = createCtxSeal({ key: new Uint8Array(32).fill(7), keyId: "k" });
      assert.deepEqual(seal!.unseal(seal!.seal(new Uint8Array([1, 2, 3]), scope)), new Uint8Array([1, 2, 3]));
    }
  }
  assert.equal(boundedScope("files.blob", realSpace, "blb_1"), boundedScope("files.blob", realSpace, "blb_1"));
  assert.notEqual(boundedScope("files.blob", realSpace, "blb_1"), boundedScope("files.blob", realSpace, "blb_2"));
  assert.notEqual(boundedScope("files.blob", realSpace, "blb_1"), boundedScope("files.blob", longSpace, "blb_1"));
  assert.notEqual(boundedScope("files.blob", "ab", "c"), boundedScope("files.blob", "a", "bc"), "the parts do not run together");
  assert.throws(() => boundedScope("x".repeat(60), "a"));
});
