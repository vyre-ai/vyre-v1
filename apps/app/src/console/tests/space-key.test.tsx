// Console, Models and providers, Space AI key: the one guided step (pick the provider, paste the key, Vyre checks it and shows the models it unlocks), what a set key shows, and that the key is
// never read back onto the page. The server is a scripted call; the page is mounted for real.
import test from "node:test";
import assert from "node:assert/strict";
import { find, installDom, mount, press, textOf, typeInto } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { SpaceKey, keyHeadline, keyProviders, modelsLine } from "../pages/SpaceKey.tsx";
import { useLine } from "../pages/Spend.tsx";
import { dataWith } from "./sheet-helper.tsx";

const KEY = "ocg-live-7a1f-NEVER-ON-A-PAGE-0123456789"; // secret-scan: fake
const CATALOG = { providers: [
  { key: "anthropic", name: "Anthropic", connections: ["api_key"], modelsSource: "", engine: "anthropic" },
  { key: "claude-code", name: "Claude Code", connections: ["subscription"], modelsSource: "", engine: "claude-code" },
  { key: "opencode-go", name: "OpenCode Go", connections: ["api_key"], modelsSource: "", engine: "opencode-go" },
  { key: "custom-acme", name: "Acme", connections: ["api_key"], modelsSource: "", engine: "custom", custom: true },
] };
const SET = { set: true, providerKey: "opencode-go", name: "OpenCode Go", providerId: "prv_space", models: ["glm-5.3", "kimi-k3", "deepseek-v4-pro", "mimo-v2.5-pro"], state: "ok", setBy: "usr_olivia", setAt: 1, checkedAt: 1, mayManage: true };

async function page(answer: (cap: string, input: Record<string, unknown>) => unknown) {
  const restore = installDom();
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => { calls.push({ cap, input: input as Record<string, unknown> }); return answer(cap, input as Record<string, unknown>); };
  const { createRoot } = await import("test-renderer");
  const root = await mount(createRoot, <ConsoleDataProvider value={dataWith({}, { call: call as never })}><SpaceKey /></ConsoleDataProvider>);
  return { root, calls, restore };
}

test("the providers a Space AI key can be: API-key ones, OpenCode Go first, no sign-ins and no custom endpoints", () => {
  assert.deepEqual(keyProviders(CATALOG.providers as never).map((p) => p.key), ["opencode-go", "anthropic"]);
  assert.equal(keyHeadline({ set: false, models: [], mayManage: true }), "No Space AI key");
  assert.equal(keyHeadline(SET as never), "OpenCode Go covers everyone");
  assert.equal(keyHeadline({ ...SET, state: "failing" } as never), "The OpenCode Go key stopped working");
  assert.equal(modelsLine(SET.models), "glm-5.3, kimi-k3, deepseek-v4-pro and 1 more");
  assert.equal(useLine({ turns: 1, tokensIn: 900, tokensOut: 1600, costMicros: 0 }), "1 turn · 3k tokens");
});

test("one step: choose OpenCode Go, paste the key, Vyre checks it and the page shows what it unlocks; the key is never shown back", async () => {
  let stored = false;
  const { root, calls, restore } = await page((cap, input) => {
    if (cap === "providers.catalog") return CATALOG;
    if (cap === "providers.space_key.get") return stored ? SET : { set: false, models: [], mayManage: true };
    if (cap === "providers.space_key.set") { assert.deepEqual([input.providerKey, input.apiKey], ["opencode-go", KEY]); assert.ok(typeof input.idempotencyKey === "string"); stored = true; return SET; }
    throw new Error(`unscripted ${cap}`);
  });
  try {
    assert.match(textOf(root), /No Space AI key/);
    assert.match(textOf(root), /OpenCode Go/, "OpenCode Go is the provider picked first");
    await typeInto(find(root, "space-key-value"), KEY);
    await press(find(root, "space-key-save"));
    await new Promise((r) => setTimeout(r, 30));
    const text = textOf(root);
    assert.equal(calls.filter((c) => c.cap === "providers.space_key.set").length, 1);
    assert.match(text, /OpenCode Go works\. It covers everyone now/);
    assert.match(text, /OpenCode Go covers everyone/);
    assert.match(text, /glm-5\.3, kimi-k3, deepseek-v4-pro and 1 more/);
    assert.ok(!text.includes(KEY), "the key is not on the page after saving");
    assert.equal(find(root, "space-key-value"), null, "the field is gone once the key is set");
    assert.ok(find(root, "space-key-replace") && find(root, "space-key-remove"), "replace and remove are offered");
  } finally { restore(); }
});

test("a refused key says why and nothing is set; removing asks once more", async () => {
  const { root, calls, restore } = await page((cap) => {
    if (cap === "providers.catalog") return CATALOG;
    if (cap === "providers.space_key.get") return { set: false, models: [], mayManage: true };
    if (cap === "providers.space_key.set") throw Object.assign(new Error("OpenCode Go did not accept that key. Check it and try again"), { code: "provider.auth_failed" });
    throw new Error(`unscripted ${cap}`);
  });
  try {
    await typeInto(find(root, "space-key-value"), "wrong");
    await press(find(root, "space-key-save"));
    await new Promise((r) => setTimeout(r, 30));
    assert.match(textOf(root), /did not accept that key/);
    assert.match(textOf(root), /No Space AI key/);
    assert.equal(calls.filter((c) => c.cap === "providers.space_key.remove").length, 0);
  } finally { restore(); }
  const set = await page((cap) => (cap === "providers.catalog" ? CATALOG : cap === "providers.space_key.get" ? SET : { set: false, models: [], mayManage: true }));
  try {
    await press(find(set.root, "space-key-remove"));
    assert.equal(set.calls.filter((c) => c.cap === "providers.space_key.remove").length, 0, "the first press only asks");
    await press(find(set.root, "space-key-remove-yes"));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(set.calls.filter((c) => c.cap === "providers.space_key.remove").length, 1);
  } finally { set.restore(); }
});

test("someone who may not manage it sees what covers everyone and no way to change it", async () => {
  const { root, restore } = await page((cap) => (cap === "providers.catalog" ? CATALOG : { ...SET, mayManage: false }));
  try {
    assert.match(textOf(root), /OpenCode Go covers everyone/);
    for (const id of ["space-key-value", "space-key-save", "space-key-replace", "space-key-remove"]) assert.equal(find(root, id), null, id);
  } finally { restore(); }
});

test("a key pasted under the wrong provider is caught before saving, and one press switches to the right one", async () => {
  const { root, calls, restore } = await page((cap) => (cap === "providers.space_key.get" ? { set: false, models: [], mayManage: true } : cap === "providers.catalog" ? CATALOG : {}));
  try {
    assert.equal(find(root, "space-key-switch"), null);
    // OpenCode Go is first: an Anthropic key pasted under it is named
    await typeInto(find(root, "space-key-value"), "sk-ant-api03-0123456789");
    assert.match(textOf(root), /This looks like an Anthropic key \(it starts with sk-ant-\), not OpenCode Go\./);
    await press(find(root, "space-key-switch"));
    assert.ok(!/This looks like/.test(textOf(root)), "switched to Anthropic, the warning goes");
    assert.equal(calls.filter((c) => c.cap === "providers.space_key.set").length, 0, "nothing was saved by the warning");
  } finally { restore(); }
});
