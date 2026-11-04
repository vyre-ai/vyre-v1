// Sign-ins as accounts in the engine: one entry per account, named by its account or the person's name for it (never "Claude Code 4"); older sign-ins listed under the entry they show as; and a chat,
// an agent or a fallback that still names a handle folded into another row pays with that row.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { accountResolve, accountsList, canonical } from "../handlers/accounts.ts";

type Prov = Record<string, unknown> & { id: string; handle: string };
const sub = (o: Prov): Prov => ({ providerKey: "claude-code", name: "Claude Code", connection: "subscription", scope: "mine", itemId: `vit_${o.id}`, engine: "claude-code", spaceMayUse: false, state: "ok", ...o });

function fake(providers: Prov[], over: Record<string, (i: unknown) => unknown> = {}): Ctx {
  const routes: Record<string, (i: unknown) => unknown> = {
    "providers.list": () => ({ providers }),
    "threads.get": () => ({ thread: { starter: "usr_dana", agents: [{ agentId: "agt_1", model: "claude-sonnet-5-5" }] } }),
    "agents.get": () => ({ agent: { accountPolicy: "asker" } }),
    "engine.policy.get": () => ({ allowedAccounts: "any" }),
    "engine.defaults.get": () => ({ fallback: [] }),
    "engine.placement.decide": () => ({ placement: "host" }),
    "spaces.get": () => ({ space: { kind: "personal" } }),
    ...over,
  };
  return {
    space: "spc_1", principal: { kind: "agent", id: "agt_1" }, actingFor: "usr_dana", trace: { traceId: "t".repeat(32), spanId: "s" }, origin: "agent", depth: 0, now: () => 1_760_000_000_000,
    call: async (cap: string, input: unknown) => { const f = routes[cap]; if (!f) throw new Error(`unexpected call ${cap}`); return f(input); },
  } as unknown as Ctx;
}

// the owner's Space after this change: four Claude sign-ins whose account cannot be read (the newest that works is the entry), one Codex row that folded a second copy of its account
const OWNER = [
  sub({ id: "prv_c1", handle: "#Claude_Code", itemName: "Claude Code", displayName: "Claude Code", olderOf: "prv_c3" }),
  sub({ id: "prv_c2", handle: "#Claude_Code_2", itemName: "Claude Code 2", displayName: "Claude Code", olderOf: "prv_c3" }),
  sub({ id: "prv_c3", handle: "#Claude_Code_3", itemName: "Claude Code 3", displayName: "Claude Code" }),
  sub({ id: "prv_c4", handle: "#Claude_Code_4", itemName: "Claude Code 4", displayName: "Claude Code", olderOf: "prv_c3", state: "needs_sign_in" }),
  sub({ id: "prv_x1", handle: "#Codex", providerKey: "codex", name: "Codex", engine: "codex", itemName: "Codex", displayName: "Codex, dana@example.com", identity: "dana@example.com", aliases: ["#Codex_2"] }),
];

test("accounts.list: one entry per account, named by its account or plainly by the provider, never by a counter; older sign-ins are listed under it to be removed", async () => {
  const out = await accountsList(fake(OWNER), {});
  assert.deepEqual(out.accounts.map((a) => [a.ref, a.name]), [["#Claude_Code_3", "Claude Code"], ["#Codex", "Codex, dana@example.com"]]);
  const claude = out.accounts[0]!;
  assert.deepEqual(claude.older, [
    { ref: "#Claude_Code", providerId: "prv_c1", name: "Claude Code" },
    { ref: "#Claude_Code_2", providerId: "prv_c2", name: "Claude Code" },
    { ref: "#Claude_Code_4", providerId: "prv_c4", name: "Claude Code" },
  ]);
  assert.deepEqual(claude.aliases, ["#Claude_Code", "#Claude_Code_2", "#Claude_Code_4"], "a chat pinned to an older sign-in shows this entry");
  assert.deepEqual(out.accounts[1]!.aliases, ["#Codex_2"]);
  assert.ok(out.accounts.every((a) => !/ \d+$/.test(String(a.name))));
});

test("account.resolve: a turn with no pin runs on the entry, never on an older sign-in listed under it", async () => {
  const r = await accountResolve(fake(OWNER), { threadId: "thr_1", agentId: "agt_1" });
  assert.equal(r.accountRef, "#Claude_Code_3");
});

test("account.resolve: a chat pinned to an older sign-in still runs on it (its credential is kept and works)", async () => {
  const pinned = fake(OWNER, { "threads.get": () => ({ thread: { starter: "usr_dana", agents: [{ agentId: "agt_1", model: "claude-sonnet-5-5", accountRef: "#Claude_Code_2" }] } }) });
  assert.equal((await accountResolve(pinned, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#Claude_Code_2");
});

test("account.resolve: a thread pin, an agent's key and a fallback that name a folded handle pay with the row that kept the account", async () => {
  const codex = (o: Record<string, (i: unknown) => unknown>) => fake(OWNER, { "threads.get": () => ({ thread: { starter: "usr_dana", agents: [{ agentId: "agt_1", model: "gpt-5.5", provider: "openai", accountRef: "#Codex_2" }] } }), ...o });
  const viaPin = await accountResolve(codex({}), { threadId: "thr_1", agentId: "agt_1" });
  assert.deepEqual([viaPin.accountRef, viaPin.itemId, viaPin.allowed], ["#Codex", "vit_prv_x1", true]);

  const viaKey = fake(OWNER, { "agents.get": () => ({ agent: { accountPolicy: "key", accountKey: "#Codex_2" } }), "threads.get": () => ({ thread: { starter: "usr_dana", agents: [{ agentId: "agt_1", model: "gpt-5.5", provider: "openai" }] } }) });
  assert.equal((await accountResolve(viaKey, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#Codex");

  const viaFallback = fake([OWNER[4]!], { "agents.get": () => ({ agent: { accountPolicy: "key", accountKey: "#Gone", accountFallback: ["#Codex_2"] } }) });
  assert.equal((await accountResolve(viaFallback, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#Codex");
});

test("canonical keeps a field after a folded handle and leaves every other ref alone", () => {
  const l = { aliasOf: new Map([["#Codex_2", "#Codex"]]) };
  assert.equal(canonical(l, "#Codex_2"), "#Codex");
  assert.equal(canonical(l, "#Codex_2.credentials"), "#Codex.credentials");
  assert.equal(canonical(l, "#Other"), "#Other");
});

// ---- one list for every picker: engine.accounts.list with a place

const shared = (o: Prov): Prov => ({ providerKey: "anthropic", name: "Anthropic", connection: "api_key", scope: "shared", engine: "anthropic", spaceMayUse: true, state: "ok", itemId: `vit_${o.id}`, ...o });
const MIXED: Prov[] = [
  sub({ id: "prv_m", handle: "#My_Claude", displayName: "My Claude", models: ["claude-sonnet-5-5"] }),
  sub({ id: "prv_bad", handle: "#Old_Codex", providerKey: "codex", engine: "codex", displayName: "Codex", state: "needs_sign_in" }),
  shared({ id: "prv_t", handle: "#Team_Key", displayName: "Team key", uses: { teamChats: { who: "everyone" } }, teamChatsForMe: true, models: ["claude-sonnet-5-5", "claude-opus-5-5"] }),
  shared({ id: "prv_a", handle: "#Auto_Key", displayName: "Automation key", uses: { automations: true }, models: ["claude-sonnet-5-5"] }),
  shared({ id: "prv_c", handle: "#Capped_Key", displayName: "Capped key", uses: { teamChats: { who: "everyone" }, automations: true, agentWork: { which: "all" } }, teamChatsForMe: true, capped: true }),
];
const SERVER = { "spaces.get": () => ({ space: { kind: "team" } }) };

test("accounts.list with a place: every picker lists the same accounts, and each says whether it runs there and why not", async () => {
  const ctx = fake(MIXED, SERVER);
  const bare = (await accountsList(ctx, {})).accounts.map((a) => a.ref);
  const by = async (place: "chat" | "automation" | "agent" | "space") => (await accountsList(ctx, { place })).accounts;
  const chat = await by("chat"), auto = await by("automation"), agent = await by("agent"), space = await by("space");
  for (const list of [chat, auto, agent, space]) assert.deepEqual(list.map((a) => a.ref), bare, "the same accounts in every place");
  const row = (list: typeof chat, ref: string) => list.find((a) => a.ref === ref)!;
  // Working in the Vault, pickable in a chat; a team server needs the Space switch for it to work an automation
  assert.equal(row(chat, "#My_Claude").usable, true);
  assert.equal(row(auto, "#My_Claude").usable, false);
  assert.match(String(row(auto, "#My_Claude").why), /Let the Space run work on my subscription/);
  // a signed-out account says why everywhere
  for (const list of [chat, auto, agent, space]) { assert.equal(row(list, "#Old_Codex").usable, false); assert.match(String(row(list, "#Old_Codex").why), /Sign in/); }
  // Space accounts: kept for team chats runs a chat, not an automation; kept for automations the reverse; a capped one says so
  assert.deepEqual([row(chat, "#Team_Key").usable, row(auto, "#Team_Key").usable], [true, false]);
  assert.match(String(row(auto, "#Team_Key").why), /has not kept this account for this kind of work/);
  assert.deepEqual([row(chat, "#Auto_Key").usable, row(auto, "#Auto_Key").usable], [false, true]);
  assert.equal(row(chat, "#Capped_Key").usable, false);
  assert.match(String(row(chat, "#Capped_Key").why), /monthly cap/);
  // each one's models ride along
  assert.deepEqual(row(chat, "#Team_Key").models, ["claude-sonnet-5-5", "claude-opus-5-5"]);
  // a model narrows to accounts that list it
  const sonnet = (await accountsList(ctx, { place: "chat", model: "claude-opus-5-5" })).accounts;
  assert.equal(sonnet.find((a) => a.ref === "#Team_Key")!.usable, true);
  assert.equal(sonnet.find((a) => a.ref === "#Auto_Key")!.usable, false);
  // without a place nothing changes in the answer except the models
  assert.equal("usable" in (await accountsList(ctx, {})).accounts[0]!, false);
});
