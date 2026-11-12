// One reading of where a key goes: the Gate, the card's lookup, the test read's plan and the HTTP step read the same host from the same odd inputs.
import test from "node:test";
import assert from "node:assert/strict";
import { approvableHost, hostOfUrl, keyReadHost, keyReadUrl } from "../../../lib/key-target.ts";
import { planSafeTest } from "../connector-test.ts";

const CASES: [unknown, string | null][] = [
  [{ path: "/v1/x", domains: ["api.notely.example"] }, "api.notely.example"],
  [{ path: "/v1/x", domains: ["API.Notely.Example."] }, "api.notely.example"],
  [{ path: "/v1/x", domains: ["under_score.notely.example"] }, "under_score.notely.example"],
  [{ path: "/v1/x", domains: ["[2001:db8::1]"] }, "[2001:db8::1]"],
  [{ path: "https://api.notely.example:8443/v1", domains: ["api.notely.example"] }, "api.notely.example"],
  [{ path: "http://api.notely.example/v1", domains: ["api.notely.example"] }, null],
  [{ path: "https://user:pw@api.notely.example/v1", domains: ["api.notely.example"] }, null],
  [{ path: "v1/x", domains: ["api.notely.example"] }, null],
  [{ path: "/v1/x", domains: [] }, null],
  ["nothing", null],
];

test("the test read's host is read one way: the shared function, and the plan the sender uses, agree", () => {
  for (const [input, want] of CASES) {
    assert.equal(keyReadHost(input), want, JSON.stringify(input));
    const url = keyReadUrl(input);
    if (want === null) { assert.equal(url, null, JSON.stringify(input)); continue; }
    assert.equal(hostOfUrl(url!), want);
    const i = input as { path: string; domains: string[] };
    const plan = planSafeTest({ method: "GET", path: i.path, domains: i.domains, vaultItemId: "#K" });
    if (plan.ok) assert.equal(hostOfUrl(plan.plan.url), want, `the sender's plan reads the same host for ${JSON.stringify(input)}`);
  }
});

test("an approved host is spelt the same way the request is read", () => {
  assert.equal(approvableHost("API.Notely.Example."), "api.notely.example");
  assert.equal(approvableHost("https://api.notely.example/v1"), "api.notely.example");
  assert.equal(approvableHost("[2001:db8::1]"), "[2001:db8::1]");
  assert.equal(approvableHost("not a host"), null);
});

test("a connector's wildcard domain is kept and covers names under it, as the connector port reads it", async () => {
  const { approvableHost, hostCovers } = await import("../../../lib/key-target.ts");
  assert.equal(approvableHost("*.Acme.example"), "*.acme.example");
  assert.equal(approvableHost("*.com"), null, "a wildcard over a bare top-level name is refused");
  assert.equal(approvableHost("*."), null);
  assert.equal(hostCovers("*.acme.example", "api.acme.example"), true);
  assert.equal(hostCovers("*.acme.example", "a.b.acme.example"), true);
  assert.equal(hostCovers("*.acme.example", "acme.example"), false, "the wildcard does not cover the name itself");
  assert.equal(hostCovers("*.acme.example", "evilacme.example"), false);
  assert.equal(hostCovers("api.acme.example", "api.acme.example"), true);
  assert.equal(hostCovers("", "x.example"), false);
});
