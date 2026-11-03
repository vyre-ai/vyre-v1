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
