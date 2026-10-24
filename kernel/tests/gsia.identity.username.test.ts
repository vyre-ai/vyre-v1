import test from "node:test";
import assert from "node:assert/strict";
import { personUrl, legacyRedirect, publicCard, checkUsername, normalizeUsername } from "../src/identity/username.ts";
import { newRecoveryCode, base32 } from "../src/identity/code.ts";

test("the person address is vyre.run/u/<name>, and the old host redirects", () => {
  assert.equal(personUrl("alex"), "https://vyre.run/u/alex");
  assert.deepEqual(legacyRedirect("alex.vyre.run"), { status: 301, location: "https://vyre.run/u/alex" });
  assert.equal(legacyRedirect("app.vyre.run"), null);
  assert.equal(legacyRedirect("relay.vyre.run"), null);
  assert.equal(legacyRedirect("names.vyre.run"), null);
  assert.equal(legacyRedirect(undefined), null);
  const hidden = publicCard({ name: "alex", id: "per_abc", discoverable: false });
  assert.equal(hidden.private, true);
  assert.equal("id" in hidden, false, "a private card says nothing but the name");
  const open = publicCard({ name: "alex", id: "per_abc", discoverable: true, github: { login: "alex-studio" } });
  assert.deepEqual(open.private === false && [open.url, open.github, open.id], ["https://vyre.run/u/alex", "alex-studio", "per_abc"]);
  assert.throws(() => checkUsername("api"), (e: unknown) => (e as { code?: string }).code === "bad_input");
  assert.throws(() => checkUsername("a"), (e: unknown) => (e as { code?: string }).code === "bad_input");
  assert.equal(normalizeUsername("  Alex.vyre.run "), "alex");
});

test("the recovery code is 26 base32 characters in groups of four, and base32 is RFC 4648 lowercase", () => {
  assert.match(newRecoveryCode(), /^([a-z2-7]{4}-){6}[a-z2-7]{2}$/);
  assert.notEqual(newRecoveryCode(), newRecoveryCode());
  assert.equal(base32(new TextEncoder().encode("foobar")), "mzxw6ytboi");
  assert.equal(newRecoveryCode((n) => new Uint8Array(n)), "aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aa");
});
