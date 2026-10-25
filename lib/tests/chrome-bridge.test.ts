// The Chrome bridge's token check (P-L10_06b): compared byte by byte over the whole token with no crypto import, so a wrong token of the same length is refused as surely as a short one.
import test from "node:test";
import assert from "node:assert/strict";
import { createChromeBridge, sameToken } from "../chrome-bridge.ts";
import type { BridgeRequest, BridgeResponse } from "../chrome-bridge.ts";

test("sameToken accepts only the exact token: a wrong token of the same length, a prefix, an extension and an empty one are all refused", () => {
  assert.equal(sameToken("tok-abcdef", "tok-abcdef"), true);
  assert.equal(sameToken("tok-abcdeX", "tok-abcdef"), false, "same length, last byte differs");
  assert.equal(sameToken("Xok-abcdef", "tok-abcdef"), false, "same length, first byte differs");
  assert.equal(sameToken("tok-abcde", "tok-abcdef"), false, "a prefix");
  assert.equal(sameToken("tok-abcdefg", "tok-abcdef"), false, "an extension");
  assert.equal(sameToken("", "tok-abcdef"), false);
});

function call(bridge: ReturnType<typeof createChromeBridge>, authorization: string | undefined): { handled: boolean; status: number } {
  const req: BridgeRequest = { url: "/chrome-bridge/v1/rpc", method: "POST", headers: authorization === undefined ? {} : { authorization }, on: () => undefined, destroy: () => undefined };
  let status = 0;
  const res: BridgeResponse = { writeHead: (s) => { status = s; }, write: () => undefined, end: () => undefined, flushHeaders: () => undefined };
  return { handled: bridge.handle(req, res), status };
}

test("the bridge answers 401 to a wrong token of the same length and to no token, and passes other paths on", () => {
  const bridge = createChromeBridge({ token: "tok-secret-1" });
  assert.deepEqual(call(bridge, "Bearer tok-secret-2"), { handled: true, status: 401 });
  assert.deepEqual(call(bridge, "Bearer tok-secret"), { handled: true, status: 401 });
  assert.deepEqual(call(bridge, undefined), { handled: true, status: 401 });
  const other = createChromeBridge({ token: "t" });
  const res: BridgeResponse = { writeHead: () => undefined, write: () => undefined, end: () => undefined, flushHeaders: () => undefined };
  assert.equal(other.handle({ url: "/healthz", method: "GET", headers: {}, on: () => undefined, destroy: () => undefined }, res), false);
});
