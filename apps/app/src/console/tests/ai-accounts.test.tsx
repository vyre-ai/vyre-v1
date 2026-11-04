// Console > AI > AI accounts: the one switch (with its confirm that names who moves), the Space's accounts with their state, Add account, Check now and the Spend and limits row.
// The page is mounted for real; the server is a scripted call that records every capability and its input.
import test from "node:test";
import assert from "node:assert/strict";
import { find, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { AiAccountsPage, accountState, isSpaceAccount, ownSignIns } from "../pages/AiAccounts.tsx";
import { dataWith } from "./sheet-helper.tsx";

const NAMES: Record<string, string> = { usr_maya: "Maya Chen", usr_lena: "Lena Ortiz", usr_irfad: "Irfad Imtiaz" };
const ACCOUNTS = [
  { ref: "acc_claude", driver: "anthropic", kind: "api_key", title: "Claude", mine: false, ownerId: "usr_irfad", spaceKey: true, status: "ok" },
  { ref: "acc_openai", driver: "openai", kind: "api_key", title: "OpenAI", mine: false, ownerId: "usr_maya", uses: { automations: true }, status: "failed" },
  { ref: "own_1", driver: "anthropic", kind: "subscription", title: "Claude", mine: false, ownerId: "usr_maya", status: "ok" },
  { ref: "own_2", driver: "anthropic", kind: "subscription", title: "Claude", mine: false, ownerId: "usr_lena", status: "ok" },
];

async function page(accounts: unknown[], allowedAccounts: "any" | "company") {
  const restore = installDom();
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const opened: string[] = [];
  let policy = { allowedAccounts, allowedModels: [], allowedProviders: [], labelProviders: {}, hops: { agentHops: 8, reviewLoops: 2, ciFixLoops: 2 } };
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "engine.policy.set") { policy = { ...policy, ...(input as object) }; return { ok: true }; }
    if (cap === "engine.policy.get") return policy;
    if (cap === "engine.probe_account") return { ok: true, models: 3 };
    throw new Error(`unscripted ${cap}`);
  };
  const base = createSampleConsole().data;
  const nav = { ...base.nav, openApp: (t?: { screen: string }) => { opened.push(`app:${t?.screen}`); }, openPage: (id: string) => { opened.push(`page:${id}`); } };
  const { createRoot } = await import("test-renderer");
  const root = await mount(createRoot, <ConsoleDataProvider value={dataWith({ "engine.accounts.list": { accounts }, "engine.policy.get": policy }, { call: call as never, nav: nav as never, name: (id: string) => NAMES[id] ?? id })}><AiAccountsPage /></ConsoleDataProvider>);
  return { root, calls, opened, restore };
}
const writes = (calls: Array<{ cap: string }>, cap: string) => calls.filter((c) => c.cap === cap);

test("the words: a Space account is one with a Space key or a use; a sign-in of one's own is not; each state has its reason", () => {
  assert.deepEqual(ACCOUNTS.map((a) => isSpaceAccount(a as never)), [true, true, false, false]);
  assert.deepEqual(ownSignIns(ACCOUNTS as never), ["usr_maya", "usr_lena"]);
  assert.deepEqual(accountState(ACCOUNTS[0] as never), { working: true, word: "Working", why: "" });
  assert.deepEqual(accountState(ACCOUNTS[1] as never), { working: false, word: "Needs attention", why: "The key was turned down. Add a new one in Vault." });
});

test("the page counts the people on their own sign-ins and lists the Space's accounts with Working or Needs attention and who added each", async () => {
  const { root, restore } = await page(ACCOUNTS, "any");
  try {
    const text = textOf(root);
    assert.match(text, /People can use their own AI sign-ins/);
    assert.match(text, /2 people do today/);
    assert.match(text, /The Space's AI accounts/);
    assert.match(text, /Added by Irfad Imtiaz/);
    assert.match(text, /The key was turned down\. Add a new one in Vault\. Added by Maya Chen/);
    assert.equal(textOf(find(root, "ai-acct-state-acc_claude")), "Working");
    assert.equal(textOf(find(root, "ai-acct-state-acc_openai")), "Needs attention");
    assert.equal(find(root, "ai-acct-state-own_1"), null, "a person's own sign-in is not a Space account");
    assert.ok(!/Company only/.test(text));
  } finally { restore(); }
});

test("turning the switch off asks first, names who moves, and Switch saves allowedAccounts company and reads it back", async () => {
  const { root, calls, restore } = await page(ACCOUNTS, "any");
  try {
    assert.equal(find(root, "ai-own-confirm"), null);
    await press(find(root, "ai-own-switch"));
    assert.equal(writes(calls, "engine.policy.set").length, 0, "the first press only asks");
    assert.match(textOf(find(root, "ai-own-confirm")), /2 people will switch to the Space's AI accounts: Maya, Lena\. Their agents keep running\./);
    await press(find(root, "ai-own-switch-confirm"));
    assert.deepEqual(writes(calls, "engine.policy.set").map((c) => c.input), [{ allowedAccounts: "company" }]);
    assert.ok(calls.some((c) => c.cap === "engine.policy.get"), "the policy is read back");
    assert.equal(find(root, "ai-own-confirm"), null, "the confirm closes");
  } finally { restore(); }
});

test("Cancel on the confirm saves nothing", async () => {
  const { root, calls, restore } = await page(ACCOUNTS, "any");
  try {
    await press(find(root, "ai-own-switch"));
    await press(find(root, "ai-own-cancel"));
    assert.equal(find(root, "ai-own-confirm"), null);
    assert.equal(writes(calls, "engine.policy.set").length, 0);
  } finally { restore(); }
});

test("with nobody on their own sign-in the switch turns off at once, and turning it on saves any at once", async () => {
  const quiet = await page(ACCOUNTS.slice(0, 2), "any");
  try {
    await press(find(quiet.root, "ai-own-switch"));
    assert.deepEqual(writes(quiet.calls, "engine.policy.set").map((c) => c.input), [{ allowedAccounts: "company" }]);
  } finally { quiet.restore(); }
  const off = await page(ACCOUNTS, "company");
  try {
    assert.match(textOf(off.root), /Everyone uses the Space's AI accounts/);
    await press(find(off.root, "ai-own-switch"));
    assert.deepEqual(writes(off.calls, "engine.policy.set").map((c) => c.input), [{ allowedAccounts: "any" }]);
    assert.equal(find(off.root, "ai-own-confirm"), null, "turning it on never asks");
  } finally { off.restore(); }
});

test("Add account opens Vault, the same sheet Models used", async () => {
  const { root, opened, restore } = await page(ACCOUNTS, "any");
  try { await press(find(root, "ai-add-account")); assert.deepEqual(opened, ["app:vault.layout"]); } finally { restore(); }
});

test("Check now probes that account", async () => {
  const { root, calls, restore } = await page(ACCOUNTS, "any");
  try {
    await press(find(root, "ai-acct-check-acc_openai"));
    assert.deepEqual(writes(calls, "engine.probe_account").map((c) => c.input), [{ accountRef: "acc_openai" }]);
  } finally { restore(); }
});

test("the foot row Spend and limits opens the spend page", async () => {
  const { root, opened, restore } = await page(ACCOUNTS, "any");
  try { await press(find(root, "row-ai-spend")); assert.deepEqual(opened, ["page:spend"]); } finally { restore(); }
});
