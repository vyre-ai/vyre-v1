// Console > AI > What each provider may see: a sentence per provider, a sheet of label boxes per provider, a tick saves labelProviders and reads it back, and Restricted stays off for a
// provider that does not keep nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { find, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { AiSeePage, KEEPS_NOTHING, mayRead, seeSays, withTick } from "../pages/AiSee.tsx";
import { dataWith } from "./sheet-helper.tsx";

const PROVIDERS = [
  { driver: "anthropic", kind: "api", title: "Claude", connected: true, allowed: true },
  { driver: "openai", kind: "api", title: "OpenAI", connected: true, allowed: true },
  { driver: "local", kind: "api", title: "Local", connected: true, allowed: true },
];
const UNIVERSE = ["anthropic", "openai", "local"];

async function page(labelProviders: Record<string, string[]>) {
  const restore = installDom();
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  let policy = { allowedAccounts: "any", allowedModels: [], allowedProviders: [], labelProviders, hops: { agentHops: 8, reviewLoops: 2, ciFixLoops: 2 } };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "engine.policy.set") { policy = { ...policy, ...(input as object) }; return { ok: true }; }
    if (cap === "engine.policy.get") return policy;
    throw new Error(`unscripted ${cap}`);
  };
  const { createRoot } = await import("test-renderer");
  const root = await mount(createRoot, <ConsoleDataProvider value={dataWith({ "engine.policy.get": policy, "engine.providers.list": { providers: PROVIDERS } }, { call: call as never })}><AiSeePage /></ConsoleDataProvider>);
  return { root, calls, restore };
}
const sets = (calls: Array<{ cap: string; input: Record<string, unknown> }>) => calls.filter((c) => c.cap === "engine.policy.set").map((c) => c.input);

test("the sentence for a provider: Everything, Everything except one, Only the few, Nothing", () => {
  const lp = { restricted: ["local"], confidential: ["local"], internal: ["local", "anthropic"], public: ["anthropic"] };
  assert.equal(seeSays({}, "openai"), "Everything");
  assert.equal(seeSays({ restricted: ["anthropic"] }, "openai"), "Everything except Restricted");
  assert.equal(seeSays(lp, "anthropic"), "Only Public, Internal");
  assert.equal(seeSays({ public: [], internal: [], confidential: [], restricted: [] }, "openai"), "Nothing");
  assert.equal(mayRead({}, "restricted", "openai"), true);
  assert.equal(KEEPS_NOTHING.has("openai"), false);
});

test("a tick adds or removes the provider and a label every provider may read goes back to no entry", () => {
  assert.deepEqual(withTick({}, UNIVERSE, "restricted", "openai", false), { restricted: ["anthropic", "local"] });
  assert.deepEqual(withTick({ restricted: ["anthropic", "local"] }, UNIVERSE, "restricted", "openai", true), {});
});

test("one row per provider, in plain words, with the muted line about Restricted", async () => {
  const { root, restore } = await page({ restricted: ["local"] });
  try {
    assert.equal(textOf(find(root, "row-see-anthropic")).includes("Everything except Restricted"), true);
    assert.equal(textOf(find(root, "row-see-local")).includes("Everything"), true);
    assert.match(textOf(root), /Restricted data only goes to providers that keep nothing\./);
  } finally { restore(); }
});

test("a tap opens the sheet and unticking Internal saves labelProviders with the provider out of it, read back", async () => {
  const { root, calls, restore } = await page({});
  try {
    assert.equal(find(root, "see-sheet"), null);
    await press(find(root, "row-see-openai"));
    assert.match(textOf(find(root, "see-sheet")), /What OpenAI may see/);
    await press(find(root, "see-tick-openai-internal"));
    assert.deepEqual(sets(calls), [{ labelProviders: { internal: ["anthropic", "local"] } }]);
    assert.ok(calls.some((c) => c.cap === "engine.policy.get"), "read back");
    await press(find(root, "see-done"));
    assert.equal(find(root, "see-sheet"), null);
    assert.match(textOf(find(root, "row-see-openai")), /Everything except Internal/);
  } finally { restore(); }
});

test("Restricted is off for a provider that keeps something: disabled once it is not allowed, with the reason", async () => {
  const { root, restore } = await page({ restricted: ["local"] });
  try {
    await press(find(root, "row-see-openai"));
    assert.match(textOf(find(root, "see-sheet")), /Only providers that keep nothing/);
    const box = find(root, "see-tick-openai-restricted");
    assert.equal((box?.props as { disabled?: boolean })["aria-disabled"] ?? (box?.props as { disabled?: boolean }).disabled, true);
  } finally { restore(); }
});

test("a keep-nothing provider can take Restricted and the tick saves it", async () => {
  const { root, calls, restore } = await page({ restricted: ["anthropic"] });
  try {
    await press(find(root, "row-see-local"));
    await press(find(root, "see-tick-local-restricted"));
    assert.deepEqual(sets(calls), [{ labelProviders: { restricted: ["anthropic", "local"] } }]);
  } finally { restore(); }
});
