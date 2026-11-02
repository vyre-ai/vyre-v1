// The Allow screen and its doors: what it says, what it marks as the app's own words, and what a link may and may not do.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AllowScreen, CAN_DO, SELF_DECLARED, STOPS, endedWords, framed } from "./AllowScreen.tsx";
import { requestFrom } from "./AllowRoute.tsx";
import { routeDesktopLink } from "../shell/session/desktop.ts";

const never = (): Promise<unknown> => new Promise(() => undefined);

test("before the request is read it says Opening, and never offers Allow", () => {
  const html = renderToStaticMarkup(<AllowScreen call={never} requestId="oar_1" me="Dana" />);
  assert.ok(!html.includes('data-testid="allow-allow"'));
});

test("the words hold what was decided", () => {
  assert.match(SELF_DECLARED, /calls itself\. Vyre has not checked it\./);
  assert.match(CAN_DO, /what you can here, and no more/);
  assert.match(STOPS, /Sends, posts and payments still wait for your yes/);
  assert.match(endedWords({ error: { code: "auth.expired" } }), /ended/);
  assert.match(endedWords({ error: { code: "permission.role_lacks_permission" } }), /cannot add agents/);
});

test("inside a frame nothing is offered", () => {
  const self = {};
  assert.equal(framed({ top: self, self }), false);
  assert.equal(framed({ top: {}, self }), true);
  assert.equal(framed({ self }), false);
});

test("a deep link opens Allow only with a well-formed request, and never from a sign-in link", () => {
  const base = { address: "https://northwind.vyre.run", allow: "oar_abc123" };
  assert.deepEqual(routeDesktopLink({ action: "open", params: base }), { kind: "allow", address: "https://northwind.vyre.run", request: "oar_abc123" });
  assert.deepEqual(routeDesktopLink({ action: "open", params: { ...base, allow: "javascript:alert(1)" } }), { kind: "signin", address: "https://northwind.vyre.run" });
  assert.deepEqual(routeDesktopLink({ action: "signin", params: base }), { kind: "signin", address: "https://northwind.vyre.run" });
  assert.equal(routeDesktopLink({ action: "open", params: { address: "http://evil.example", allow: "oar_abc123" } }), null, "an address that is neither https nor loopback goes nowhere");
  assert.deepEqual(routeDesktopLink({ action: "open", params: { address: "http://127.0.0.1:41800", allow: "oar_abc123" } }), { kind: "allow", address: "http://127.0.0.1:41800", request: "oar_abc123" }, "a Personal Space lives on loopback");
});

test("the web route reads one well-formed request id", () => {
  assert.equal(requestFrom("?request=oar_abc&space=https://x"), "oar_abc");
  assert.equal(requestFrom("?request=../x"), null);
  assert.equal(requestFrom(""), null);
});
