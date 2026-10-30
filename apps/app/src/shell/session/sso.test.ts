import test from "node:test";
import assert from "node:assert/strict";
import { ssoStartUrl, takeSsoReturn } from "./sso.ts";

test("the start address names the provider and where to come back to", () => {
  assert.equal(ssoStartUrl("https://space.firm.test/", "google", "https://space.firm.test/app"), "https://space.firm.test/auth/sso/google/start?return=https%3A%2F%2Fspace.firm.test%2Fapp");
});

test("a finished sign-in leaves the ticket in the fragment; it is read once and cleared from the address bar", () => {
  const seen: string[] = [];
  assert.deepEqual(takeSsoReturn({ hash: "#sso_code=abc%20d&sso_provider=google", pathname: "/app", search: "?x=1" }, (u) => seen.push(u)), { code: "abc d", provider: "google" });
  assert.deepEqual(seen, ["/app?x=1"]);
  assert.deepEqual(takeSsoReturn({ hash: "#sso_error=refused", pathname: "/", search: "" }, (u) => seen.push(u)), { error: true });
  assert.equal(takeSsoReturn({ hash: "#other=1", pathname: "/", search: "" }, () => { throw new Error("nothing to clear"); }), null);
  assert.equal(takeSsoReturn(undefined, () => undefined), null);
});
