// @nocache  (these tests start real processes)
// The model lists of the subscription engines (agent/src/drivers/cli/models.ts): each vendor CLI is asked the way its own app asks it, through the opener's launcher and the Vault fill, as a
// turn would run. The parsers read what the pinned binaries really answered (recorded on box B, 3 Nov 2026); the processes are host/tests/fixtures/fake-cli-driver/fake-models-cli.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createLocalLauncher } from "../src/drivers/cli/index.ts";
import { ModelListError, claudeModels, codexModel, grokModels, grokTitle } from "../src/drivers/cli/models.ts";
import { createSessionOpener } from "../src/drivers/open/index.ts";
import type { OpenAccount } from "../src/drivers/open/index.ts";
import { ctx } from "../src/drivers/api/testing.ts";
import type { Lookup, ValueSource } from "../src/vault-use/index.ts";

const FAKE = fileURLToPath(new URL("../../host/tests/fixtures/fake-cli-driver/fake-models-cli.mjs", import.meta.url));
const TOKEN = "sk-ant-oat01-MODELSlistTOKEN0123456789abcdef"; // secret-scan: fake
const FILES = JSON.stringify({ ".codex/auth.json": JSON.stringify({ tokens: { access_token: "codex-access-MODELS-0123456789abcdef" } }) });
const GROK = JSON.stringify({ ".grok/auth.json": JSON.stringify({ token: "grok-session-MODELS-0123456789abcdef" }) });
const value = (v: string, itemId: string): Lookup => ({ kind: "value", itemId, value: v, spaceOnly: false, injectIntoDeployments: false });
const VAULT: Record<string, Lookup> = { "#Dana_Claude.setup_token": value(TOKEN, "vit_c"), "#Dana_Codex.credentials": value(FILES, "vit_x"), "#Dana_Grok.credentials": value(GROK, "vit_g") };
const acct = (ref: string, driver: string): OpenAccount => ({ ref, driver, kind: "subscription", payer: "dana" });

function rig(scenario = "") {
  const seen: { argv: string[]; env: Record<string, string> }[] = [];
  const local = createLocalLauncher({ wrap: (argv) => [process.execPath, FAKE, ...argv], baseEnv: { PATH: process.env["PATH"] ?? "", FAKE_MODELS: scenario } });
  const used: unknown[] = [];
  const source: ValueSource = { lookup: async (h) => VAULT[h] ?? { kind: "unknown" } };
  const opener = createSessionOpener({
    source, reportMiss: () => undefined, apiContext: () => ctx(), onUsed: (e) => { used.push(e.used); },
    launcher: { async spawn(spec) { seen.push({ argv: [...spec.argv], env: { ...spec.env } }); return local.spawn(spec); } },
    mcp: { async mint() { throw new Error("a model list mints no MCP session"); }, async close() { /* none */ } },
  });
  return { opener, seen, used };
}

test("Codex: the parser reads model/list as the pinned 0.166.0 answers it (hidden left out, efforts and the default kept)", () => {
  // trimmed from the real answer of `codex app-server` model/list on box B
  const real = { id: "gpt-6.1-sol", model: "gpt-6.1-sol", upgrade: null, displayName: "GPT-6.1-Sol", description: "Latest workhorse model for coding and everyday work.", hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }, { reasoningEffort: "medium", description: "" }, { reasoningEffort: "high", description: "" }, { reasoningEffort: "xhigh", description: "" }, { reasoningEffort: "max", description: "" }, { reasoningEffort: "ultra", description: "" }],
    defaultReasoningEffort: "low", inputModalities: ["text", "image"], isDefault: true };
  assert.deepEqual(codexModel(real), { id: "gpt-6.1-sol", title: "GPT-6.1-Sol", isDefault: true, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "low" });
  assert.equal(codexModel({ ...real, hidden: true }), null);
  assert.equal(codexModel({ displayName: "No id" }), null);
});

test("Claude Code: the picker rows become concrete models named by the vendor, the alias kept and the Default row marking its model", () => {
  // the shape of the real `initialize` answer of Claude Code 2.1.316 on box B
  const rows = [
    { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default (recommended)", description: "Use the default model (currently Opus 5.5) · $4/$20 per Mtok", supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
    { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus", description: "Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok", supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
    { value: "fable", resolvedModel: "claude-fable-5-1", displayName: "Fable", description: "Fable 5.1 · Most capable for your hardest and longest-running tasks · $10/$50 per Mtok" },
    { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet", description: "Sonnet 5.5 · Efficient for routine tasks · $2/$10 per Mtok" },
    { value: "claude-future-9", displayName: "Claude Future 9", description: "" },
  ];
  const got = claudeModels(rows);
  assert.deepEqual(got.map((m) => [m.id, m.title, m.alias ?? null, m.isDefault === true]), [
    ["claude-opus-5-5", "Opus 5.5", "opus", true], ["claude-fable-5-1", "Fable 5.1", "fable", false], ["claude-sonnet-5-5", "Sonnet 5.5", "sonnet", false],
    ["claude-future-9", "Claude Future 9", null, false],
  ]);
  assert.ok(!got.some((m) => /latest/i.test(m.title)), "no row is called Latest anything: each says the model it is");
  assert.deepEqual(got[0]?.efforts, ["low", "medium", "high", "xhigh", "max"]);
});

test("Grok: the text of `grok models` as 1.0.70 prints it", () => {
  const real = "You are not authenticated.\n\nDefault model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-4.5\n";
  assert.deepEqual(grokModels(real), [{ id: "grok-4.6", title: "Grok 4.6", isDefault: true }, { id: "grok-4.5", title: "Grok 4.5" }]);
  assert.equal(grokTitle("grok-code-fast-1"), "Grok Code Fast 1");
});

test("each engine lists the account's own models through the opener: the sign-in filled, no MCP session, a model the catalog never heard of passed through", async () => {
  const g = rig();
  const codex = await g.opener.models(acct("#Dana_Codex", "codex"), "dana");
  assert.deepEqual(codex.map((m) => [m.id, m.title, m.isDefault === true]), [["gpt-7-nova", "GPT-7-Nova", true], ["gpt-6.1-sol", "GPT-6.1-Sol", false], ["gpt-5.5", "GPT-5.5", false]], "both pages, hidden left out");
  const claude = await g.opener.models(acct("#Dana_Claude", "claude_code"), "dana");
  assert.deepEqual(claude.map((m) => [m.id, m.title, m.alias]), [["claude-opus-6", "Opus 6", "opus"], ["claude-sonnet-5-5", "Sonnet 5.5", "sonnet"], ["claude-haiku-5-5", "Haiku 5.5", "haiku"]]);
  assert.equal(claude[0]?.isDefault, true);
  const grok = await g.opener.models(acct("#Dana_Grok", "grok"), "dana");
  assert.deepEqual(grok.map((m) => [m.id, m.isDefault === true]), [["grok-5", true], ["grok-4.6", false], ["grok-4.5", false]]);
  assert.deepEqual(g.seen.map((s) => s.argv), [["codex", "app-server"], ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"], ["grok", "models"]]);
  assert.equal(g.seen[1]?.env["CLAUDE_CODE_OAUTH_TOKEN"], TOKEN, "the sign-in reached the engine through the fill");
  assert.ok(g.seen.every((s) => !s.argv.join(" ").includes(TOKEN) && !s.argv.join(" ").includes("codex-access")), "never in an argv");
  assert.equal(g.used.length, 3, "each use of the sign-in is recorded");
});

test("an engine that fails, errors or never answers throws a plain reason, and its process ends", async () => {
  await assert.rejects(rig("fail").opener.models(acct("#Dana_Codex", "codex"), "dana"), (e) => e instanceof ModelListError && /could not reach the model list/.test(e.message));
  await assert.rejects(rig("rpcerror").opener.models(acct("#Dana_Codex", "codex"), "dana"), (e) => e instanceof ModelListError && /model list unavailable/.test(e.message));
  const started = Date.now();
  await assert.rejects(rig("hang").opener.models(acct("#Dana_Claude", "claude_code"), "dana", { timeoutMs: 400 }), (e) => e instanceof ModelListError && /in time/.test(e.message));
  assert.ok(Date.now() - started < 5_000, "gave up and ended the process");
  await assert.rejects(rig().opener.models({ ref: "#K", driver: "anthropic", kind: "api_key" }, "dana"), /not a CLI engine/);
});
