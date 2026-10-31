// A turn that ended without a reply is a plain sentence with one action, never a card named after its internal status.
import test from "node:test";
import assert from "node:assert/strict";
import { isTurnStatus, statusView } from "./status.ts";

const block = (data: Record<string, unknown>) => ({ id: "b1", type: "turn_status", v: 1, state: "done", data, traceId: "t" }) as never;

test("a turn_status block is recognised so it is never drawn as a card", () => {
  assert.equal(isTurnStatus({ type: "turn_status" }), true);
  assert.equal(isTurnStatus({ type: "step" }), false);
});

test("no account: a plain sentence and Connect your AI, nothing internal in the text", () => {
  const v = statusView(block({ state: "failed", turnId: "trn_1", code: "no_account" }));
  assert.equal(v.kind, "error");
  if (v.kind !== "error") return;
  const d = v.block.data as { message: string; next: Array<{ key: string; label: string }>; retryable: boolean };
  assert.equal(v.block.type, "error");
  assert.equal(d.message, "Connect your AI to get replies.");
  assert.deepEqual(d.next, [{ key: "connect_ai", label: "Connect your AI" }]);
  assert.equal(d.retryable, false);
  assert.ok(!/turn.?status|no_account/i.test(JSON.stringify([d.message])));
});

test("an unknown failure is a plain sentence with Retry on its turn; a timeout says so", () => {
  const other = statusView(block({ state: "failed", turnId: "trn_2", code: "engine_error" }));
  assert.equal(other.kind === "error" && (other.block.data as { message: string }).message, "That reply did not finish.");
  assert.equal(other.kind === "error" && (other.block.data as { retryable: boolean; turnId: string }).turnId, "trn_2");
  const late = statusView(block({ state: "failed", turnId: "trn_3", code: "turn_timeout" }));
  assert.equal(late.kind === "error" && (late.block.data as { message: string }).message, "That took too long, so it was stopped.");
});

test("stopped and parked turns are quiet lines", () => {
  assert.deepEqual(statusView(block({ state: "cancelled", turnId: "x" })), { kind: "note", id: "b1", text: "Stopped." });
  assert.deepEqual(statusView(block({ state: "waiting", turnId: "x" })), { kind: "note", id: "b1", text: "Waiting for your approval." });
});
