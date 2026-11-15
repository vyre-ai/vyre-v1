// "Use the sign-in on this computer" (owner decision D2, 3 Nov 2026): in a Personal Space the Connect AI card offers the Claude Code and Codex sign-ins already on this computer before a
// fresh sign-in; a Team Space never does. Pressing one starts the sign-in with local and finishes it at once.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "./test-dom.ts";
import { ConnectAiCard } from "./ConnectAiCard.tsx";
import { LOCAL_SIGNINS, takeLocalSignin } from "../ai-signin/flow.ts";
import type { CapCall } from "../shell/session/caps.ts";

const recorder = (present: { claudeCode: boolean; codex: boolean } = { claudeCode: true, codex: true }) => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const call = (async (cap: string, input: unknown) => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "providers.local_signins") return present;
    if (cap === "providers.subscription_start")
      return { flowId: "sub_l", instruction: "Using the Codex sign-in on this computer.", needsCode: false };
    if (cap === "providers.subscription_complete") return { provider: { id: "prv_local" } };
    throw new Error(`no ${cap}`);
  }) as unknown as CapCall;
  return { calls, call };
};

const shown = async (present: { claudeCode: boolean; codex: boolean }, local = true) => {
  const r = recorder(present);
  const root = await mount(
    createRoot,
    <ConnectAiCard call={r.call} {...(local ? { local: true } : {})} onConnected={() => undefined} />,
  );
  await flush();
  return { r, root };
};

test('an "on this computer" row shows only for a sign-in that is there, first and primary; with none the card is the three sign-in rows; a Team Space never asks', async () => {
  assert.deepEqual(
    LOCAL_SIGNINS.map((o) => o.button),
    ["Use Claude on this computer", "Use ChatGPT on this computer"],
  );
  const restore = installDom();
  try {
    const both = await shown({ claudeCode: true, codex: true });
    assert.ok(find(both.root, "ai-local-claude-code") && find(both.root, "ai-local-codex"), "both");
    const text = textOf(both.root);
    assert.ok(
      text.indexOf("Use Claude on this computer") < text.indexOf("Sign in with Claude"),
      "before a fresh sign-in",
    );
    const one = await shown({ claudeCode: false, codex: true });
    assert.equal(find(one.root, "ai-local-claude-code"), null);
    assert.ok(find(one.root, "ai-local-codex"), "one");
    const none = await shown({ claudeCode: false, codex: false });
    assert.equal(find(none.root, "ai-local-claude-code"), null);
    assert.equal(find(none.root, "ai-local-codex"), null);
    for (const k of ["claude-code", "codex", "grok"])
      assert.ok(find(none.root, `ai-sub-${k}`), `the ${k} sign-in row stays`);
    const team = await shown({ claudeCode: true, codex: true }, false);
    assert.equal(find(team.root, "ai-local-claude-code"), null);
    assert.ok(!team.r.calls.some((c) => c.cap === "providers.local_signins"), "a Team Space does not ask");
    // before the answer is known, and when the read fails, nothing "on this computer" is offered
    const failing = (async () => {
      throw new Error("no");
    }) as unknown as CapCall;
    const bad = await mount(createRoot, <ConnectAiCard call={failing} local onConnected={() => undefined} />);
    await flush();
    assert.equal(find(bad, "ai-local-codex"), null);
  } finally {
    restore();
  }
});

test("pressing it starts the sign-in with local, finishes it at once and hands back the account", async () => {
  const r = recorder();
  assert.deepEqual(await takeLocalSignin(r.call as never, "codex", "k1"), { id: "prv_local" });
  assert.deepEqual(
    r.calls.map((c) => [c.cap, c.input]),
    [
      ["providers.subscription_start", { providerKey: "codex", idempotencyKey: "k1", local: true }],
      ["providers.subscription_complete", { flowId: "sub_l" }],
    ],
  );
  const restore = installDom();
  try {
    const r2 = recorder();
    const got: string[] = [];
    const root = await mount(createRoot, <ConnectAiCard call={r2.call} local onConnected={(id) => got.push(id)} />);
    await flush();
    await press(find(root, "ai-local-codex"));
    await flush();
    assert.deepEqual(got, ["prv_local"]);
    assert.equal(r2.calls.find((c) => c.cap === "providers.subscription_start")!.input["local"], true);
  } finally {
    restore();
  }
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
  const restore = installDom();
  try {
    const mac = (await shownMac(true)).root;
    assert.ok(find(mac, "ai-local-note-claude-code") && textOf(mac).includes("Always Allow"));
    assert.equal(find(mac, "ai-local-note-codex"), null);
    assert.equal(find((await shownMac(false)).root, "ai-local-note-claude-code"), null);
  } finally {
    restore();
  }
});

async function shownMac(mac: boolean) {
  const r = recorder();
  const root = await mount(createRoot, <ConnectAiCard call={r.call} local mac={mac} onConnected={() => undefined} />);
  await flush();
  return { r, root };
}
