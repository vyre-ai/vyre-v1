// A step title written by a person or an agent is cut to its sentence by one linear scan (r-review, 19 Nov: the pattern it replaced took 15 s on 200 KB of "(").
import test from "node:test";
import assert from "node:assert/strict";
import { withoutTrailingParens } from "../flow-sentence.ts";

test("a trailing parenthetical goes, and nothing else does", () => {
  assert.equal(withoutTrailingParens("Send the welcome email (to the client)"), "Send the welcome email");
  assert.equal(withoutTrailingParens("Send the welcome email (to the client)  "), "Send the welcome email");
  assert.equal(withoutTrailingParens("Send (the) welcome email"), "Send (the) welcome email");
  assert.equal(withoutTrailingParens("Send it (a (b))"), "Send it (a (b))", "a nested one is left whole, as before");
  assert.equal(withoutTrailingParens("No parens"), "No parens");
  assert.equal(withoutTrailingParens("("), "(");
});

test("hostile input is linear: 200 KB of open brackets, and of 'a (' pairs, answers in well under a second", () => {
  for (const bad of ["(".repeat(200_000), "a (".repeat(70_000) + ")", " ".repeat(200_000) + "(x)"]) {
    const t0 = Date.now();
    withoutTrailingParens(bad);
    assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
  }
});
