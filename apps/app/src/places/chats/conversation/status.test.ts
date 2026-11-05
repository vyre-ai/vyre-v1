// @tsx  (the Details test renders the block view, a .tsx module)
// A turn that ended without a reply is a plain sentence with one action, never a card named after its internal status.
import test from "node:test";
import assert from "node:assert/strict";
import { installProgram, isTurnStatus, statusView, withoutAnswered, wordsFor } from "./status.ts";

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
  // never a bare "Stopped." (owner, 4 Nov 2026): the line says why, and says so when no reason was kept (l-crews stoppedWords)
  assert.deepEqual(statusView(block({ state: "cancelled", turnId: "x" })), { kind: "note", id: "b1", text: "Stopped, and no reason was recorded. Send it again." });
  assert.deepEqual(statusView(block({ state: "cancelled", turnId: "x", reason: "stop" })), { kind: "note", id: "b1", text: "Stopped because Stop was pressed." });
  assert.deepEqual(statusView(block({ state: "waiting", turnId: "x" })), { kind: "note", id: "b1", text: "Waiting for your approval." });
  assert.deepEqual(statusView(block({ state: "waiting", turnId: "x", taskId: "tsk_1" })), { kind: "approval", id: "b1", taskId: "tsk_1" }, "a hold with its task is answered in the chat");
});

const errorOf = (data: Record<string, unknown>) => { const v = statusView(block(data)); assert.equal(v.kind, "error"); return (v as { block: { data: { message: string; cause?: string; next: Array<{ key: string; label: string }>; retryable: boolean } } }).block.data; };

test("an engine that is not installed names itself and offers one Install button (no command), and a way to connect another account", () => {
  const d = errorOf({ state: "failed", turnId: "t", code: "engine.cli_missing", program: "codex" });
  assert.equal(d.message, "Codex is not installed here.");
  assert.equal(d.cause, "Vyre can set it up for you.");
  assert.deepEqual(d.next, [{ key: "install:codex", label: "Install Codex" }, { key: "connect_ai", label: "Connect an account" }]);
  assert.equal(d.retryable, false, "Install is the one way to try again: no second Retry beside it");
  assert.ok(!/npm|install -g|terminal/i.test(JSON.stringify(d)), "no command is shown");
  assert.equal(installProgram("install:codex"), "codex");
  assert.equal(installProgram("install:claude"), "claude");
  assert.equal(installProgram("install:grok"), "grok", "Grok installs the same way");
  assert.equal(installProgram("install:toString"), undefined);
  assert.equal(installProgram("connect_ai"), undefined);
  const unnamed = errorOf({ state: "failed", turnId: "t", code: "engine.cli_missing" });
  assert.deepEqual(unnamed.next, [{ key: "connect_ai", label: "Connect an account" }], "no program, nothing to install");
  assert.ok(!/execvp|sandbox-exec/.test(JSON.stringify([d, unnamed])));
});

test("an install that did not finish says why in a plain line and keeps the Install button; an engine with no build for this computer offers another account only", () => {
  const offline = errorOf({ state: "failed", turnId: "t", code: "engine.cli_missing", program: "grok", setup: "offline" });
  assert.equal(offline.message, "Grok could not be set up here.");
  assert.equal(offline.cause, "This computer could not reach the download. Check the connection, then try again.");
  assert.deepEqual(offline.next[0], { key: "install:grok", label: "Install Grok" });
  assert.equal(errorOf({ state: "failed", turnId: "t", code: "engine.cli_missing", program: "claude", setup: "checksum" }).cause, "The download did not match the expected file, so it was not used.");
  assert.equal(errorOf({ state: "failed", turnId: "t", code: "engine.cli_missing", program: "claude", setup: "disk" }).cause, "It could not be saved on this computer. Free some space, then try again.");
  assert.equal(errorOf({ state: "failed", turnId: "t", code: "engine.cli_missing", program: "claude", setup: "failed" }).cause, "The setup did not finish.");
  const unsupported = errorOf({ state: "failed", turnId: "t", code: "engine.cli_missing", program: "codex", setup: "unsupported" });
  assert.equal(unsupported.message, "Codex cannot run on this computer.");
  assert.deepEqual(unsupported.next, [{ key: "connect_ai", label: "Connect an account" }]);
});

test("a locked Vault is an Unlock card, not a failed reply; an unreadable one gives the reason the Vault gave", () => {
  const locked = errorOf({ state: "failed", turnId: "t", code: "engine.vault_locked" });
  assert.equal(locked.message, "Your sign-ins are locked on this server.");
  assert.deepEqual(locked.next, [{ key: "unlock_vault", label: "Unlock" }]);
  const unreadable = errorOf({ state: "failed", turnId: "t", code: "engine.vault_unreadable", reason: "provider.unavailable" });
  assert.equal(unreadable.message, "Your Vault could not be read just now.");
  assert.equal(unreadable.cause, "The Vault answered: provider.unavailable.");
  assert.equal(unreadable.retryable, true);
});

test("a line the engine added to the chat reads as a quiet note", () => {
  assert.deepEqual(statusView(block({ state: "note", text: "Codex is not installed here, so Claude answered." })), { kind: "note", id: "b1", text: "Codex is not installed here, so Claude answered." });
});

const msg = (id: string, kind: "agent" | "person", authorId: string, body: string, blocks: unknown[] = []) => ({ messageId: id, author: { kind, id: authorId }, body, blocks }) as never;
const failed = (id: string, agent = "agt_a") => msg(id, "agent", agent, "", [{ id: `b_${id}`, type: "turn_status", v: 1, data: { state: "failed", turnId: `trn_${id}`, code: "engine.cli_error" } }]);

test("a failure the same agent has answered leaves; a newer failure replaces it; a failure someone talked past stays", () => {
  const ids = (l: readonly { messageId: string }[]) => l.map((m) => m.messageId);
  const reply = msg("reply", "agent", "agt_a", "Rivers carry water.");
  assert.deepEqual(ids(withoutAnswered([msg("ask", "person", "usr_a", "Hi"), failed("f1"), reply] as never)), ["ask", "reply"], "the retry worked: the card has left and the reply stands alone");
  assert.deepEqual(ids(withoutAnswered([msg("ask", "person", "usr_a", "Hi"), failed("f1"), failed("f2")] as never)), ["ask", "f2"], "the retry failed too: one card");
  assert.deepEqual(ids(withoutAnswered([failed("f1"), msg("next", "person", "usr_a", "Never mind"), reply] as never)), ["f1", "next", "reply"]);
  assert.deepEqual(ids(withoutAnswered([failed("f1"), msg("other", "agent", "agt_b", "Me too")] as never)), ["f1", "other"], "another agent's reply answers nothing");
  const kept = msg("kept", "agent", "agt_a", "The words", [{ id: "b", type: "turn_status", v: 1, data: { state: "failed", turnId: "t", code: "engine.post_failed" } }]);
  assert.deepEqual(ids(withoutAnswered([kept, reply] as never)), ["kept", "reply"], "a failure that kept the reply's words is not dropped");
  const none = [reply] as never;
  assert.equal(withoutAnswered(none), none, "nothing to drop: the same array");
});

test("Details has something real before the turn is read", () => {
  const v = statusView({ id: "b", type: "turn_status", v: 1, traceId: "", data: { state: "failed", turnId: "trn_1", code: "engine.cli_error" } } as never);
  assert.ok(v.kind === "error");
  assert.deepEqual((v.block.data as { steps: unknown }).steps, [["Code", "engine.cli_error"], ["Reply", "trn_1"]]);
});

// Every code a turn can fail with, read from the code that raises it, has words that say what happened: its own, or its family's (sandbox, provider). "That reply did not finish." is only for an
// error Vyre has no code for. A new code without words fails here, so the live rc.14 report (a generic line for a known code) cannot come back.
test("every code a turn can fail with says what happened", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { wordsFor } = await import("./status.ts");
  const repo = path.resolve(import.meta.dirname, "../../../../../..");
  const roots = ["agent/src/drivers", "agent/src/turn-engine", "agent/src/pool", "sandbox/src", "modules/engine/session.ts", "modules/engine/sandbox.ts", "modules/engine/mcp-bridge.ts", "modules/engine/runnable-account.ts", "modules/engine/sandbox-default.ts", "host/src/seams/engine-session.ts"];
  const files = (r: string): string[] => {
    const at = path.join(repo, r);
    if (r.endsWith(".ts")) return [at];
    return (fs.readdirSync(at, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts") && !f.includes(".test.") && !f.split(path.sep).includes("tests")).map((f) => path.join(at, f));
  };
  const raised = /(?:(?:DriverError|SandboxError|LaunchError|coded)\(\s*|code:\s*|return\s+|\?\s*|:\s*)"((?:engine|provider|sandbox)\.[a-z_]+)"/g;
  const codes = new Set<string>();
  for (const r of roots) for (const f of files(r)) for (const m of fs.readFileSync(f, "utf8").matchAll(raised)) codes.add(m[1]!);
  assert.ok(codes.has("sandbox.unavailable") && codes.has("engine.cli_missing") && codes.has("provider.auth_failed"), "the scan finds the codes it should");
  const generic = [...codes].filter((c) => wordsFor(c).message === "That reply did not finish.");
  assert.deepEqual(generic, [], `codes with no words: ${generic.join(", ")}`);
});

test("sandbox.unavailable says the engine cannot run safely here and offers an API key", () => {
  const v = statusView(block({ state: "failed", turnId: "trn_9", code: "sandbox.unavailable" }));
  assert.equal(v.kind, "error");
  if (v.kind !== "error") return;
  const d = v.block.data as { message: string; cause?: string; next: Array<{ key: string; label: string }>; retryable: boolean };
  assert.equal(d.message, "This engine cannot run safely on this computer yet.");
  assert.match(d.cause ?? "", /sandbox/);
  assert.deepEqual(d.next, [{ key: "connect_ai", label: "Use an API key" }]);
  assert.equal(d.retryable, false);
});

test("the chat line for a locked sign-in carries Unlock: it opens the same sheet as the banner", async () => {
  const { statusView } = await import("./status.ts");
  const v = statusView({ id: "b1", type: "turn_status", v: 1, data: { state: "key_locked", text: "Your sign-ins are locked on this server, so the Space AI key answered." } } as never);
  assert.deepEqual(v, { kind: "wait", id: "b1", text: "Your sign-ins are locked on this server, so the Space AI key answered.", action: { key: "unlock_vault", label: "Unlock" } });
});

test("no model works: one plain card that says what to do, with Open AI accounts and no code in the words", () => {
  const w = wordsFor("engine.no_model_works");
  assert.equal(w.message, "None of your AI accounts can answer right now.");
  assert.deepEqual(w.next, [{ key: "connect_ai", label: "Open AI accounts" }]);
  assert.doesNotMatch(`${w.message} ${w.cause ?? ""}`, /engine\.|--/);
});

test("no model to run on: the chat says Pick a model for the account, with one button that opens the Model menu; the provider's raw JSON is not the Reason", async () => {
  const { statusView } = await import("./status.ts");
  const v = statusView({ id: "b1", type: "turn_status", v: 1, data: { state: "failed", turnId: "trn_1", code: "engine.no_model_picked", detail: "Pick a model for Saqib's OpenCode." } } as never) as { kind: "error"; block: { data: { message: string; next: Array<{ key: string; label: string }> } } };
  assert.equal(v.block.data.message, "Pick a model for Saqib's OpenCode.");
  assert.deepEqual(v.block.data.next, [{ key: "pick_model", label: "Pick a model" }]);
});

test("Details: Reason is one plain sentence and the provider's raw words sit in their own row, never as the Reason", async () => {
  const { turnDetail } = await import("./actions.ts");
  const raw = '{"message":"`model` must be a non-empty string","type":"invalid_request_error","param":"model"}';
  const data = { call: async () => ({ what: { turn: { startedAt: 1, endedAt: 3001, model: "", error: { code: "provider.bad_request", message: raw }, traceId: "t".repeat(32), ranOn: [] }, machine: "device", denials: [], paid: "My OpenAI" } }) } as never;
  const rows = await turnDetail(data, "trn_1");
  assert.deepEqual(rows.find((r) => r[0] === "Reason"), ["Reason", "Your AI provider refused this request."]);
  assert.deepEqual(rows.find((r) => r[0] === "Provider said"), ["Provider said", raw]);
  const odd = await turnDetail({ call: async () => ({ what: { turn: { startedAt: 1, model: "", error: { code: "x.unknown", message: '{"a":1}' }, traceId: "t".repeat(32) }, machine: "device", denials: [] } }) } as never, "trn_2");
  assert.ok(!/^\s*\{/.test(String(odd.find((r) => r[0] === "Reason")?.[1])), "a code with no words of its own never shows raw JSON as the Reason");
});
