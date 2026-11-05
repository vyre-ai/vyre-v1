// Going back to Connect your AI: the card says who is connected, can switch to another account (the old one is removed once the new one is in) and can disconnect (the step opens again).
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "./test-dom.ts";
import { ConnectAiCard } from "./ConnectAiCard.tsx";
import { accountLine, afterRemoval } from "./connect-change.ts";
import type { CapCall } from "../shell/session/caps.ts";

const CODEX = { id: "prv_codex", providerKey: "codex", name: "OpenAI", scope: "mine" };
const rec = (opts: { removeFails?: boolean } = {}) => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const call = (async (cap: string, input: unknown) => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "providers.list") return { providers: [CODEX, { id: "prv_team", providerKey: "anthropic", name: "Anthropic", scope: "shared" }] };
    if (cap === "providers.add") return { provider: { id: "prv_claude" } };
    if (cap === "providers.remove") { if (opts.removeFails) throw new Error("Only the owner may remove this."); return { ok: true }; }
    throw new Error(`no ${cap}`);
  }) as unknown as CapCall;
  return { calls, call };
};

test("the words and the rule: an account reads as its name, and with none left the step opens again", () => {
  assert.equal(accountLine({ providerKey: "codex", name: "OpenAI" }), "ChatGPT (Codex)");
  assert.equal(accountLine({ providerKey: "claude-code", name: "x", itemName: "Dana Claude Max" }), "Dana Claude Max");
  assert.equal(afterRemoval([]), "reopen");
  assert.equal(afterRemoval([CODEX]), "stay");
});

test("reopened after picking Codex, the card shows it and the shared team key is not listed as mine", async () => {
  const restore = installDom();
  try {
    const r = rec();
    const root = await mount(createRoot, <ConnectAiCard call={r.call} connected onConnected={() => undefined} />);
    await flush();
    assert.ok(textOf(find(root, "ai-account-prv_codex")).includes("ChatGPT (Codex)"));
    assert.equal(find(root, "ai-account-prv_team"), null, "a shared key is the Space's, not this person's to switch");
    assert.ok(find(root, "ai-change") && find(root, "ai-switch-prv_codex") && find(root, "ai-remove-prv_codex"));
  } finally { restore(); }
});

test("switch from Codex to a Claude key: the new account is added, then the old one is removed, and nothing is left half-connected", async () => {
  const restore = installDom();
  try {
    const r = rec();
    const got: string[] = [];
    const root = await mount(createRoot, <ConnectAiCard call={r.call} connected onConnected={(id) => got.push(id)} />);
    await flush();
    await press(find(root, "ai-switch-prv_codex"));
    assert.ok(find(root, "ai-tiles") && find(root, "ai-keep"), "the sign-in choices show, with a way to keep what is there");
    await press(find(root, "ai-use-key"));
    await press(find(root, "row-ai-provider-anthropic"));
    const field = find(root, "ai-key-field");
    await typeInto(field, "sk-ant-api03-" + "a".repeat(40));
    await press(find(root, "ai-key-save"));
    await flush(); await flush();
    assert.deepEqual(got, ["prv_claude"]);
    assert.deepEqual(r.calls.filter((c) => c.cap === "providers.add" || c.cap === "providers.remove").map((c) => c.cap), ["providers.add", "providers.remove"], "add first, remove second: a failed sign-in never leaves the person with nothing");
    assert.equal(r.calls.find((c) => c.cap === "providers.remove")!.input["providerId"], "prv_codex");
    assert.ok(textOf(find(root, "ai-note")).includes("Switched from ChatGPT (Codex)"));
  } finally { restore(); }
});

test("if the old account cannot be removed, the new one stays and the card says why", async () => {
  const restore = installDom();
  try {
    const r = rec({ removeFails: true });
    const root = await mount(createRoot, <ConnectAiCard call={r.call} connected onConnected={() => undefined} />);
    await flush();
    await press(find(root, "ai-switch-prv_codex")); await press(find(root, "ai-use-key")); await press(find(root, "row-ai-provider-anthropic"));
    await typeInto(find(root, "ai-key-field"), "sk-ant-api03-" + "b".repeat(40));
    await press(find(root, "ai-key-save")); await flush(); await flush();
    assert.match(textOf(find(root, "ai-note")), /new account is connected\. ChatGPT \(Codex\) could not be removed: Only the owner may remove this\./);
  } finally { restore(); }
});

test("Disconnect removes the account, says so, and with none left tells the step to open again; Keep what I have goes back", async () => {
  const restore = installDom();
  try {
    const r = rec();
    let reopened = 0;
    const root = await mount(createRoot, <ConnectAiCard call={r.call} connected onConnected={() => undefined} onDisconnected={() => { reopened++; }} />);
    await flush();
    await press(find(root, "ai-switch-prv_codex")); await press(find(root, "ai-keep"));
    assert.ok(find(root, "ai-account-prv_codex"), "Keep what I have returns to the connected view");
    await press(find(root, "ai-remove-prv_codex")); await flush();
    assert.equal(r.calls.find((c) => c.cap === "providers.remove")!.input["providerId"], "prv_codex");
    assert.equal(reopened, 1);
    assert.ok(textOf(find(root, "ai-note")).includes("Disconnected ChatGPT (Codex)."));
  } finally { restore(); }
});

test("picking Codex on a computer without the Codex program says so in the card, with the fix, before moving on; Pick another AI goes back to the choices, Keep it anyway moves on", async () => {
  const restore = installDom();
  try {
    const calls: string[] = [];
    const call = (async (cap: string, input: unknown) => {
      calls.push(cap);
      if (cap === "providers.subscription_start") return { flowId: "f1", instruction: "Using the Codex sign-in on this computer.", needsCode: false };
      if (cap === "providers.subscription_complete") return { provider: { id: "prv_x" } };
      if (cap === "providers.list") return { providers: [{ id: "prv_x", providerKey: "codex", name: "OpenAI", scope: "mine" }] };
      if (cap === "engine.providers.list") return { providers: [{ driver: "codex", allowed: false, reason: "Codex is not installed on this computer. Install it, or pick another AI." }] };
      throw new Error(`no ${cap} ${JSON.stringify(input)}`);
    }) as unknown as CapCall;
    const got: string[] = [];
    const root = await mount(createRoot, <ConnectAiCard call={call} local onConnected={(id) => got.push(id)} />);
    await press(find(root, "ai-local-codex")); await flush(); await flush();
    assert.deepEqual(got, [], "the step does not move on while the program is missing");
    assert.match(textOf(find(root, "ai-problem")), /Codex is not installed on this computer\. Install it, or pick another AI\./);
    await press(find(root, "ai-pick-another")); await flush();
    assert.ok(find(root, "ai-tiles"), "back to the choices");
    await press(find(root, "ai-local-codex")); await flush(); await flush();
    await press(find(root, "ai-continue-anyway")); await flush();
    assert.deepEqual(got, ["prv_x"]);
  } finally { restore(); }
});

test("switching to an account that cannot run here: Keep it anyway still removes the one it replaces", async () => {
  const restore = installDom();
  try {
    const calls: Array<{ cap: string; input: unknown }> = [];
    const call = (async (cap: string, input: unknown) => {
      calls.push({ cap, input });
      if (cap === "providers.list") return { providers: [{ id: "prv_codex", providerKey: "codex", name: "OpenAI", scope: "mine" }, { id: "prv_new", providerKey: "claude-code", name: "Claude", scope: "mine" }] };
      if (cap === "providers.subscription_start") return { flowId: "f", instruction: "x", needsCode: false };
      if (cap === "providers.subscription_complete") return { provider: { id: "prv_new" } };
      if (cap === "engine.providers.list") return { providers: [{ driver: "claude_code", allowed: false, reason: "Claude is not installed on this computer. Install it, or pick another AI." }] };
      if (cap === "providers.remove") return { ok: true };
      throw new Error(`no ${cap}`);
    }) as unknown as CapCall;
    const root = await mount(createRoot, <ConnectAiCard call={call} local connected onConnected={() => undefined} />);
    await flush();
    await press(find(root, "ai-switch-prv_codex")); await press(find(root, "ai-local-claude-code")); await flush(); await flush();
    assert.ok(!calls.some((c) => c.cap === "providers.remove"), "nothing removed while the person decides");
    await press(find(root, "ai-continue-anyway")); await flush(); await flush();
    assert.deepEqual(calls.filter((c) => c.cap === "providers.remove").map((c) => (c.input as { providerId: string }).providerId), ["prv_codex"]);
  } finally { restore(); }
});
