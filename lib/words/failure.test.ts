// The words for a failed turn: one sentence per cause, shared by the chat's failure line and a goal's check-in, with no code in any sentence.
import test from "node:test";
import assert from "node:assert/strict";
import { FAILURE_WORDS, failureClause, failureWhy, lower } from "./failure.ts";
import { looksLikeCode } from "./errors.ts";

test("every cause has a plain sentence: a capital, a full stop, no id, code or tool name", () => {
  for (const [code, w] of Object.entries(FAILURE_WORDS)) {
    assert.match(w.what, /^[A-Z].*[.]$/, code);
    assert.equal(looksLikeCode(w.what), false, `${code}: ${w.what}`);
    assert.equal(looksLikeCode(w.fix), false, `${code}: ${w.fix}`);
    if (w.fix !== "") assert.match(w.fix, /^[A-Z].*[.]$/, code);
  }
});

test("who can fix it decides what a wake-up does: the person, the limit, or time", () => {
  assert.equal(failureWhy("engine.vault_locked").cause, "person");
  assert.equal(failureWhy("engine.signin_missing").cause, "person");
  assert.equal(failureWhy("provider.auth_failed").cause, "person");
  assert.equal(failureWhy("provider.rate_limited").cause, "limit");
  assert.equal(failureWhy("host_lost").cause, "transient");
  assert.equal(failureWhy("provider.network").cause, "transient");
  // a code Vyre has no words for still reads plainly, and is tried again like a passing trouble
  assert.equal(failureWhy("engine.something_new").cause, "other");
  assert.equal(failureWhy("engine.something_new").what, "Something went wrong that Vyre has no words for yet.");
  assert.equal(failureWhy("provider.something_new").cause, "transient");
  assert.equal(failureWhy(undefined).what, "It ended without writing a check-in.");
});

test("a clause follows a colon: lower case, no full stop, no code", () => {
  assert.equal(failureClause("engine.vault_locked"), "your Vault key is not on this server");
  assert.equal(failureClause("provider.rate_limited"), "your AI account reached its usage limit");
  assert.equal(lower("Your"), "your");
});
