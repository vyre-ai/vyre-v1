// A CLI sign-in this computer cannot run (no sandbox for it here, engine.providers.list says why) reads as what it needs, not "Working". An API key and a CLI that can run keep their state.
import test from "node:test";
import assert from "node:assert/strict";
import { cliDriverOf, needsWords } from "./model.ts";

const NEEDS = "Needs a sandbox Vyre cannot set up on this computer yet. Use an API key for now.";
const engines = [
  { driver: "claude_code", kind: "cli", allowed: false, reason: NEEDS },
  { driver: "codex", kind: "cli", allowed: true },
  { driver: "anthropic", kind: "api", allowed: false, reason: "restricted records may not go to this provider." },
];

test("a CLI sign-in that cannot run here says what it needs", () => {
  assert.equal(needsWords({ engine: "claude-code", connection: "subscription" }, engines), NEEDS);
  assert.equal(needsWords({ engine: "codex", connection: "subscription" }, engines), null, "a CLI that can run keeps its state");
  assert.equal(needsWords({ engine: "anthropic", connection: "api_key" }, engines), null, "an API key is not a CLI engine, and a policy reason is not a need");
  assert.equal(cliDriverOf({ engine: "grok", connection: "subscription" }), "grok");
  assert.equal(cliDriverOf({ engine: "anthropic", connection: "api_key" }), null);
});

test("This computer on the Windows desktop app says how the AI runs there; elsewhere nothing", async () => {
  const { PERSONAL_WINDOWS_LINE, engineLine } = await import("../../settings/computers-model.ts");
  assert.equal(engineLine({ desktop: true, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/131.0" }), PERSONAL_WINDOWS_LINE);
  assert.equal(PERSONAL_WINDOWS_LINE, "Personal: the AI can read this computer like Claude Code does; it can only change your added folders.");
  assert.equal(engineLine({ desktop: false, userAgent: "Mozilla/5.0 (Windows NT 10.0)" }), "", "a browser on Windows is not this computer's engine");
  assert.equal(engineLine({ desktop: true, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" }), "");
});

test("Windows: the one-time 'Set up the Windows sandbox for team chats' shows only while WSL is off", async () => {
  const { WIN_SANDBOX, winSandboxRow } = await import("../../settings/computers-model.ts");
  assert.deepEqual(winSandboxRow({ supported: true, on: false }), { kind: "offer" });
  assert.deepEqual(winSandboxRow({ supported: true, on: true }), { kind: "hidden" }, "WSL is on: nothing to set up");
  assert.deepEqual(winSandboxRow({ supported: false, on: false }), { kind: "hidden" }, "not Windows");
  assert.deepEqual(winSandboxRow(null), { kind: "hidden" }, "not the desktop app");
  assert.equal(WIN_SANDBOX.label, "Set up the Windows sandbox for team chats");
  assert.match(WIN_SANDBOX.help, /administrator consent once/);
});
