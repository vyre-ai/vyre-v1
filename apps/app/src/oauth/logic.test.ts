import test from "node:test";
import assert from "node:assert/strict";
import { completeCallback, describeFailure, readCallback } from "./logic.ts";
import { CapError } from "../shell/session/caps.ts";
import type { CapCall } from "../shell/session/caps.ts";

const err = (code: string, message = "server words", details?: Record<string, unknown>) => new CapError({ code, message, traceId: "t".repeat(32), status: 400, ...(details ? { details } : {}) });

test("the address is read once and bounded", () => {
  assert.deepEqual(readCallback("?state=oas_abc&code=xyz&extra=1"), { state: "oas_abc", code: "xyz", error: null });
  assert.deepEqual(readCallback("?state=oas_abc&error=access_denied"), { state: "oas_abc", code: null, error: "access_denied" });
  assert.deepEqual(readCallback("?state=" + "s".repeat(500) + "&code=" + "c".repeat(5000)), { state: null, code: null, error: null }, "an absurd value is not read");
  assert.deepEqual(readCallback(""), { state: null, code: null, error: null });
});

test("a code finishes the sign-in as the signed-in person; a declined sign-in sends the error, never a code", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const call: CapCall = async (cap, input) => { calls.push({ cap, input }); return { connectionId: "con_1" }; };
  assert.deepEqual(await completeCallback(call, { state: "oas_1", code: "code-1", error: null }), { kind: "connected", connectionId: "con_1" });
  await completeCallback(call, { state: "oas_2", code: "must-not-travel", error: "access_denied" });
  assert.deepEqual(calls, [{ cap: "connections.complete_auth", input: { state: "oas_1", code: "code-1" } }, { cap: "connections.complete_auth", input: { state: "oas_2", error: "access_denied" } }]);
});

test("nothing is sent without a state or without a code or error", async () => {
  let sent = 0;
  const call: CapCall = async () => { sent++; return {}; };
  assert.equal((await completeCallback(call, { state: null, code: "c", error: null })).kind, "failed");
  assert.equal((await completeCallback(call, { state: "oas_1", code: null, error: null })).kind, "failed");
  assert.equal(sent, 0);
});

test("every outcome is told in its own words: declined, expired or used, someone else's, locked vault, provider, removed, unreachable", () => {
  const msg = (e: unknown) => { const o = describeFailure(e); assert.equal(o.kind, "failed"); return o as Extract<ReturnType<typeof describeFailure>, { kind: "failed" }>; };
  assert.deepEqual(describeFailure(err("validation.precondition_failed", "x", { reason: "declined" })), { kind: "declined" });
  assert.match(msg(err("auth.invalid_code")).message, /expired or was already used/);
  assert.match(msg(err("permission.no_grant")).message, /started by someone else/);
  const locked = msg(err("auth.unauthenticated", "Your vault is locked on this computer. Unlock it."));
  assert.equal(locked.message, "Your vault is locked"); assert.match(locked.cause, /locked on this computer/);
  assert.match(msg(err("provider.auth_failed", "The app did not accept the sign-in.")).cause, /did not accept/);
  assert.match(msg(err("validation.not_found")).message, /removed while you signed in/);
  const offline = msg(new TypeError("Failed to fetch"));
  assert.equal(offline.retryable, true); assert.match(offline.message, /reach the Space/);
  for (const e of [err("auth.invalid_code"), err("permission.no_grant"), err("provider.network")]) assert.equal(msg(e).retryable, false, "a spent sign-in is started again, not retried");
  assert.equal(msg(err("auth.invalid_code")).traceId, "t".repeat(32));
});
