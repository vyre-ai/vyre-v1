// Console > AI > What each provider may see: a sentence per provider, a sheet of label boxes per provider, a tick saves labelProviders and reads it back, and Restricted stays off for a
// provider that does not keep nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { find, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { AiSeePage, accountKeeps, mayRead, mayTakeRestricted, seeSays, withTick } from "../pages/AiSee.tsx";
import { dataWith } from "./sheet-helper.tsx";

const PROVIDERS = [
  { driver: "anthropic", kind: "api", title: "Claude", connected: true, allowed: true },
  { driver: "openai", kind: "api", title: "OpenAI", connected: true, allowed: true },
  { driver: "local", kind: "api", title: "Local", connected: true, allowed: true },
];
// the accounts an admin can mark: two of Claude (one marked), one of OpenAI, and a local model that always keeps nothing
const ACCOUNTS = [
  { ref: "#Team_Claude", driver: "anthropic", kind: "api_key", title: "Anthropic", name: "Team Claude", mine: false, status: "ok", providerId: "prv_a1" },
  { ref: "#Zero_Claude", driver: "anthropic", kind: "api_key", title: "Anthropic", name: "Zero Claude", mine: false, status: "ok", providerId: "prv_a2", keepsNothing: true },
  { ref: "#Team_OpenAI", driver: "openai", kind: "api_key", title: "OpenAI", name: "Team OpenAI", mine: false, status: "ok", providerId: "prv_o1" },
  { ref: "#Local", driver: "local", kind: "api_key", title: "Local", mine: false, status: "ok", providerId: "prv_l1", keepsNothing: true },
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
    if (cap === "providers.set_keeps_nothing") return { provider: {} };
    throw new Error(`unscripted ${cap}`);
  };
  const { createRoot } = await import("test-renderer");
  const root = await mount(createRoot, <ConsoleDataProvider value={dataWith({ "engine.policy.get": policy, "engine.providers.list": { providers: PROVIDERS }, "engine.accounts.list": { accounts: ACCOUNTS } }, { call: call as never })}><AiSeePage /></ConsoleDataProvider>);
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
  assert.equal(mayTakeRestricted(ACCOUNTS as never, "openai"), false);
  assert.equal(mayTakeRestricted(ACCOUNTS as never, "anthropic"), true, "one marked account is enough");
  assert.equal(mayTakeRestricted([], "local"), true);
  assert.deepEqual(ACCOUNTS.map((a) => accountKeeps(a as never)), [false, true, false, true]);
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
    assert.match(textOf(root), /Restricted data only goes to accounts that keep nothing\./);
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
    assert.match(textOf(find(root, "see-sheet")), /Only accounts that keep nothing/);
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

const disabled = (n: ReturnType<typeof find>): unknown => {  const p = (n?.props ?? {}) as { "aria-disabled"?: boolean; disabled?: boolean; accessibilityState?: { disabled?: boolean } }; return p["aria-disabled"] ?? p.disabled ?? p.accessibilityState?.disabled; };
const saves = (calls: Array<{ cap: string; input: Record<string, unknown> }>) => calls.filter((c) => c.cap === "providers.set_keeps_nothing").map((c) => c.input);

test("a provider with an account that keeps nothing can take Restricted; one without cannot", async () => {
  const { root, restore } = await page({ restricted: ["local"] });
  try {
    await press(find(root, "row-see-anthropic"));
    assert.notEqual(disabled(find(root, "see-tick-anthropic-restricted")), true);
    await press(find(root, "see-done"));
    await press(find(root, "row-see-openai"));
    assert.equal(disabled(find(root, "see-tick-openai-restricted")), true);
  } finally { restore(); }
});

test("each account has the switch: pressing it saves the flag for that account; the sheet names it plainly", async () => {
  const { root, calls, restore } = await page({});
  try {
    await press(find(root, "row-see-openai"));
    assert.match(textOf(find(root, "see-sheet")), /Team OpenAI/);
    assert.match(textOf(find(root, "see-sheet")), /This account keeps nothing \(zero data retention\)/);
    await press(find(root, "see-keeps-prv_o1"));
    assert.deepEqual(saves(calls), [{ providerId: "prv_o1", keepsNothing: true }]);
    await press(find(root, "see-done"));
    await press(find(root, "row-see-anthropic"));
    await press(find(root, "see-keeps-prv_a1"));
    assert.deepEqual(saves(calls).at(-1), { providerId: "prv_a1", keepsNothing: true });
  } finally { restore(); }
});

test("a local model shows the switch on and locked", async () => {
  const { root, calls, restore } = await page({});
  try {
    await press(find(root, "row-see-local"));
    const sw = find(root, "see-keeps-prv_l1");
    assert.equal(disabled(sw), true);
    assert.equal((sw?.props as { "aria-checked"?: boolean })["aria-checked"], true);
    await press(sw);
    assert.deepEqual(saves(calls), []);
  } finally { restore(); }
});

test("turning off the last account that keeps nothing takes the provider off Restricted first, then saves the flag", async () => {
  const { root, calls, restore } = await page({ restricted: ["local", "anthropic"] });
  try {
    await press(find(root, "row-see-anthropic"));
    await press(find(root, "see-keeps-prv_a2"));
    assert.deepEqual(calls.filter((c) => c.cap === "engine.policy.set" || c.cap === "providers.set_keeps_nothing").map((c) => [c.cap, c.input]), [
      ["engine.policy.set", { labelProviders: { restricted: ["local"] } }],
      ["providers.set_keeps_nothing", { providerId: "prv_a2", keepsNothing: false }],
    ]);
  } finally { restore(); }
});
