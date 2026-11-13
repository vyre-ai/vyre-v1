// The id list the product and the tests share must be the contracts' own list, and must tell an id from a word.
import test from "node:test";
import assert from "node:assert/strict";
import { id } from "../../manifests/_common.ts";
import { ID_PREFIXES, isRawId, rawIdsIn, withoutRawIds } from "../id-shapes.ts";

test("ID_PREFIXES is every prefix the contracts mint, and no other (plus out)", () => {
  const minted = Object.values(id).map((s) => /^\^([a-z]+)_/.exec((s as { pattern?: string }).pattern ?? "")?.[1]).filter((p): p is string => p !== undefined);
  assert.deepEqual([...new Set([...minted, "out"])].sort(), [...ID_PREFIXES].sort());
});

test("an id is found whole, in a sentence and in a run of text; a word is not", () => {
  assert.equal(isRawId("usr_ec028017ceefaf270b"), true);
  assert.equal(isRawId("agt_01a1d244cc8f49678f4eeecfb5b1c309"), true);
  assert.equal(isRawId("fld_01a1d27b165742ddb20032cbd182aaf9"), true);
  assert.equal(isRawId("Maya Chen"), false);
  assert.equal(isRawId("user_name"), false);
  assert.deepEqual(rawIdsIn("Spring launch fld_01a1d27b165742ddb20032cbd182aaf9 Launch on usr_5b6f9d9e0e318704d0 done"), ["fld_01a1d27b165742ddb20032cbd182aaf9", "usr_5b6f9d9e0e318704d0"]);
  assert.deepEqual(rawIdsIn("run_all_tests and rec_ord"), [], "words with an underscore are not ids");
  assert.equal(withoutRawIds("Launch on usr_5b6f9d9e0e318704d0 now"), "Launch on now");
});
