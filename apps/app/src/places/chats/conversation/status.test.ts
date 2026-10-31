// A turn that ended without a reply is a plain sentence with one action, never a card named after its internal status.
import test from "node:test";
import assert from "node:assert/strict";
import { installCommand, isTurnStatus, statusView } from "./status.ts";

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
  assert.deepEqual(statusView(block({ state: "waiting", turnId: "x", taskId: "tsk_1" })), { kind: "approval", id: "b1", taskId: "tsk_1" }, "a hold with its task is answered in the chat");
});

const errorOf = (data: Record<string, unknown>) => { const v = statusView(block(data)); assert.equal(v.kind, "error"); return (v as { block: { data: { message: string; cause?: string; next: Array<{ key: string; label: string }>; retryable: boolean } } }).block.data; };

test("an engine that is not installed names itself, offers the exact install command, and a way to connect another account", () => {
  const d = errorOf({ state: "failed", turnId: "t", code: "engine.cli_missing", program: "codex" });
  assert.equal(d.message, "Codex is not installed here.");
  assert.equal(d.cause, "Run npm install -g @openai/codex, then try again.");
  assert.deepEqual(d.next, [{ key: "install:codex", label: "Install Codex" }, { key: "connect_ai", label: "Connect an account" }]);
  assert.equal(installCommand("install:codex"), "npm install -g @openai/codex");
  assert.equal(installCommand("install:claude"), "npm install -g @anthropic-ai/claude-code");
  assert.equal(installCommand("install:grok"), undefined);
  assert.equal(installCommand("connect_ai"), undefined);
  const unnamed = errorOf({ state: "failed", turnId: "t", code: "engine.cli_missing" });
  assert.deepEqual(unnamed.next, [{ key: "connect_ai", label: "Connect an account" }], "no program, no command to offer");
  assert.ok(!/execvp|sandbox-exec/.test(JSON.stringify([d, unnamed])));
});

test("a locked Vault is an Unlock card, not a failed reply; an unreadable one gives the reason the Vault gave", () => {
  const locked = errorOf({ state: "failed", turnId: "t", code: "engine.vault_locked" });
  assert.equal(locked.message, "Your Vault is locked.");
  assert.deepEqual(locked.next, [{ key: "unlock_vault", label: "Unlock" }]);
  const unreadable = errorOf({ state: "failed", turnId: "t", code: "engine.vault_unreadable", reason: "provider.unavailable" });
  assert.equal(unreadable.message, "Your Vault could not be read just now.");
  assert.equal(unreadable.cause, "The Vault answered: provider.unavailable.");
  assert.equal(unreadable.retryable, true);
});

test("a line the engine added to the chat reads as a quiet note", () => {
  assert.deepEqual(statusView(block({ state: "note", text: "Codex is not installed here, so Claude answered." })), { kind: "note", id: "b1", text: "Codex is not installed here, so Claude answered." });
});
