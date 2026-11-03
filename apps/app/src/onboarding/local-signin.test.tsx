// "Use the sign-in on this computer" (owner decision D2, 3 Nov 2026): in a Personal Space the Connect AI card offers the Claude Code and Codex sign-ins already on this computer before a
// fresh sign-in; a Team Space never does. Pressing one starts the sign-in with local and finishes it at once.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press } from "./test-dom.ts";
import { ConnectAiCard } from "./ConnectAiCard.tsx";
import { LOCAL_SIGNINS, takeLocalSignin } from "../ai-signin/flow.ts";
import type { CapCall } from "../shell/session/caps.ts";

const recorder = () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const call = (async (cap: string, input: unknown) => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "providers.subscription_start") return { flowId: "sub_l", instruction: "Using the Codex sign-in on this computer.", needsCode: false };
    if (cap === "providers.subscription_complete") return { provider: { id: "prv_local" } };
    throw new Error(`no ${cap}`);
  }) as unknown as CapCall;
  return { calls, call };
};

test("a Personal Space offers the sign-ins on this computer first; a Team Space does not", () => {
  assert.deepEqual(LOCAL_SIGNINS.map((o) => o.button), ["Use the Claude Code sign-in on this computer", "Use the Codex sign-in on this computer"]);
  const personal = renderToStaticMarkup(<ConnectAiCard call={recorder().call} local onConnected={() => undefined} />);
  assert.ok(personal.includes('data-testid="ai-local-claude-code"') && personal.includes('data-testid="ai-local-codex"'));
  assert.ok(personal.indexOf("ai-local-claude-code") < personal.indexOf("ai-sub-claude-code"), "before a fresh sign-in");
  const team = renderToStaticMarkup(<ConnectAiCard call={recorder().call} onConnected={() => undefined} />);
  assert.ok(!team.includes("ai-local-"));
});

test("pressing it starts the sign-in with local, finishes it at once and hands back the account", async () => {
  const r = recorder();
  assert.deepEqual(await takeLocalSignin(r.call as never, "codex", "k1"), { id: "prv_local" });
  assert.deepEqual(r.calls.map((c) => [c.cap, c.input]), [["providers.subscription_start", { providerKey: "codex", idempotencyKey: "k1", local: true }], ["providers.subscription_complete", { flowId: "sub_l" }]]);
  const restore = installDom();
  try {
    const r2 = recorder();
    const got: string[] = [];
    const root = await mount(createRoot, <ConnectAiCard call={r2.call} local onConnected={(id) => got.push(id)} />);
    await press(find(root, "ai-local-codex"));
    await flush();
    assert.deepEqual(got, ["prv_local"]);
    assert.equal(r2.calls[0]!.input["local"], true);
  } finally { restore(); }
});

test("on a Mac the Claude Code button says the Keychain will ask once; Codex and other computers say nothing more", async () => {
  const { KEYCHAIN_NOTE, localNote, onMacDevice } = await import("../ai-signin/flow.ts");
  assert.equal(KEYCHAIN_NOTE, "Your Mac will ask once; choose Always Allow.");
  assert.equal(localNote("claude-code", true), KEYCHAIN_NOTE);
  assert.equal(localNote("codex", true), null);
  assert.equal(localNote("claude-code", false), null);
  assert.equal(onMacDevice({ platform: "MacIntel" }), true);
  assert.equal(onMacDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1) AppleWebKit/605.1.15" }), true);
  assert.equal(onMacDevice({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }), false);
  const mac = renderToStaticMarkup(<ConnectAiCard call={recorder().call} local mac onConnected={() => undefined} />).replaceAll("&#x27;", "'");
  assert.ok(mac.includes('data-testid="ai-local-note-claude-code"') && mac.includes(KEYCHAIN_NOTE));
  assert.ok(!mac.includes("ai-local-note-codex"));
  assert.ok(!renderToStaticMarkup(<ConnectAiCard call={recorder().call} local mac={false} onConnected={() => undefined} />).includes("ai-local-note-"));
});
