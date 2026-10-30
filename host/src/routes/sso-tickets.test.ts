// The one-use tickets a finished SSO sign-in leaves for the page: spent once, only for the provider that made them, gone after two minutes.
import test from "node:test";
import assert from "node:assert/strict";
import { createSsoTickets } from "./sso-signin.ts";

test("a ticket is spent once and only for its own provider", () => {
  const t = createSsoTickets(() => 1000);
  const a = t.make("google", "ana@firm.test");
  assert.equal(t.take("microsoft", a), null);
  assert.equal(t.take("google", a), null, "a wrong-provider try burns the ticket");
  const b = t.make("google", "ana@firm.test");
  assert.deepEqual(t.take("google", b), { email: "ana@firm.test" });
  assert.equal(t.take("google", b), null);
});

test("a ticket dies after two minutes and a made-up one is nothing", () => {
  let now = 1000;
  const t = createSsoTickets(() => now);
  const a = t.make("google", "ana@firm.test");
  now += 2 * 60_000 + 1;
  assert.equal(t.take("google", a), null);
  assert.equal(t.take("google", "nope"), null);
});
