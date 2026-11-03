// The Space AI key in the engine: where it stands in the account order (own wins, company policy, a member with no account, a removed key), the models a turn on it runs, and a model that ran out of
// usage (greyed in the picker with its time, the meter full, cleared by the next answer). Real SQLite for the limit rows; the Vault and the vendor are scripted stand-ins.
import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../../../manifests/engine.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { onAccountFailure, resolveAccount } from "../../../agent/src/accounts/index.ts";
import type { AccountRow, ResolveRequest } from "../../../agent/src/accounts/index.ts";
import type { DriverEvent, EngineSession, SessionSpec } from "../../../agent/src/turn-engine/types.ts";
import { accountResolve, accountsList } from "../handlers/accounts.ts";
import { modelsList } from "../handlers/extra/models.ts";
import { MODEL_REST_MS, modelLimits, recordModelLimit, usageGet } from "../handlers/usage.ts";
import { ensureExtra } from "../handlers/extra/schema.ts";
import { fitModel, withSpaceKeyTurns } from "../space-key-turns.ts";
import { harness, NOW } from "../fixtures/harness.ts";
import { ensure } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

const row = (o: Partial<AccountRow> & { ref: string }): AccountRow => ({
  driver: "anthropic", provider: "anthropic", kind: "api_key", title: o.ref, mine: false, ownerId: null, status: "ok", lastProbeAt: null, spaceMayUse: false, ...o,
});
const SPACE = row({ ref: "#OpenCode_Go_for_everyone", driver: "opencode_go", provider: "opencode-go", title: "OpenCode Go", spaceKey: true });
const DANA = row({ ref: "#Dana_Anthropic", mine: true, ownerId: "usr_dana" });
const DANA_SUB = row({ ref: "sub_dana", kind: "subscription", driver: "claude_code", provider: "claude-code", mine: true, ownerId: "usr_dana", spaceMayUse: true });
const TEAM = row({ ref: "#Team_Anthropic_Key" });
const BACKUP = row({ ref: "#Backup_Key" });
const base = (over: Partial<ResolveRequest> = {}): ResolveRequest => ({
  starter: "usr_dana", trigger: "message", agent: { accountPolicy: "asker", provider: "anthropic" }, backupRefs: [], policy: "any", accounts: [DANA, SPACE, TEAM], onServer: true, ...over,
});
const pick = (r: ReturnType<typeof resolveAccount>) => [r.accountRef, r.payer, r.reason];

test("own wins: the payer's own account pays first, the Space AI key only after it", () => {
  assert.deepEqual(pick(resolveAccount(base())), ["#Dana_Anthropic", "usr_dana", "starter"]);
  assert.equal(resolveAccount(base({ accounts: [DANA_SUB, DANA, SPACE] })).accountRef, "sub_dana");
  const failing = resolveAccount(base({ accounts: [{ ...DANA, status: "failed" }, SPACE] }));
  assert.deepEqual(pick(failing), ["#OpenCode_Go_for_everyone", "usr_dana", "starter"], "a broken own key falls to the Space AI key");
  assert.equal(failing.unblock?.why, "failed", "and its owner still hears their key broke");
});

test("a member with no account of their own runs on the Space AI key, and the turn is theirs", () => {
  const r = resolveAccount(base({ starter: "usr_mia", accounts: [DANA, SPACE] }));
  assert.deepEqual(pick(r), ["#OpenCode_Go_for_everyone", "usr_mia", "starter"]);
  const steered = resolveAccount(base({ steerer: "usr_noah", accounts: [DANA, SPACE] }));
  assert.deepEqual(pick(steered), ["#OpenCode_Go_for_everyone", "usr_noah", "steerer"], "whoever steers pays, on the Space key");
  // an agent whose model is another provider's still gets the key: the turn runs on a model the key serves (space-key-turns.ts)
  assert.equal(resolveAccount(base({ starter: "usr_mia", agent: { accountPolicy: "asker", provider: "openai" }, accounts: [SPACE] })).accountRef, "#OpenCode_Go_for_everyone");
});

test("the order: thread pin, agent key, own accounts, the Space AI key, then the fallback lists", () => {
  assert.equal(resolveAccount(base({ threadAccountRef: "#Team_Anthropic_Key" })).accountRef, "#Team_Anthropic_Key");
  assert.equal(resolveAccount(base({ agent: { accountPolicy: "key", accountKey: "#Team_Anthropic_Key" } })).accountRef, "#Team_Anthropic_Key");
  const keyed = resolveAccount(base({ agent: { accountPolicy: "key", accountKey: "#Team_Anthropic_Key" }, accounts: [{ ...TEAM, status: "failed" }, SPACE, BACKUP], backupRefs: ["#Backup_Key"] }));
  assert.equal(keyed.accountRef, "#OpenCode_Go_for_everyone", "after the agent's key, before the backups");
  const r = resolveAccount(base({ starter: "usr_mia", accounts: [SPACE, BACKUP], backupRefs: ["#Backup_Key"], agent: { accountPolicy: "asker", accountFallback: ["#Backup_Key"] } }));
  assert.equal(r.accountRef, "#OpenCode_Go_for_everyone");
  assert.deepEqual(r.tried.map((t) => t.ref), ["#OpenCode_Go_for_everyone"]);
  // a task: its step key, then the Space AI key (every use on, owner ruling 9), then its backup
  assert.equal(resolveAccount(base({ trigger: "task", stepKey: "#Team_Anthropic_Key" })).accountRef, "#Team_Anthropic_Key");
  assert.equal(resolveAccount(base({ trigger: "task", starter: "usr_mia", accounts: [SPACE, BACKUP], backupRefs: ["#Backup_Key"] })).accountRef, "#OpenCode_Go_for_everyone");
});

test("Company accounts only: personal accounts are skipped, so everyone runs on the Space AI key", () => {
  const r = resolveAccount(base({ policy: "company", accounts: [DANA, DANA_SUB, SPACE] }));
  assert.deepEqual(pick(r), ["#OpenCode_Go_for_everyone", "usr_dana", "starter"]);
  assert.deepEqual(r.tried.filter((t) => !t.used).map((t) => t.why), ["policy_company", "policy_company"]);
});

test("a removed or failing Space AI key falls through cleanly to the backups, else to an Unblock", () => {
  const gone = resolveAccount(base({ starter: "usr_mia", accounts: [DANA, BACKUP], backupRefs: ["#Backup_Key"] }));
  assert.equal(gone.accountRef, "#Backup_Key", "no Space AI key row any more: the backup");
  const none = resolveAccount(base({ starter: "usr_mia", accounts: [DANA] }));
  assert.deepEqual([none.allowed, none.accountRef, none.unblock?.why, none.unblock?.to], [false, null, "no_account", "usr_mia"]);
  const failing = resolveAccount(base({ starter: "usr_mia", accounts: [{ ...SPACE, status: "failed" }, BACKUP], backupRefs: ["#Backup_Key"] }));
  assert.equal(failing.accountRef, "#Backup_Key");
  assert.equal(failing.unblock, undefined, "a member is not asked to fix the Space's key");
  const out = onAccountFailure(base({ starter: "usr_mia", accounts: [SPACE, BACKUP], backupRefs: ["#Backup_Key"] }), "#OpenCode_Go_for_everyone", { code: "provider.rate_limited" });
  assert.equal(out.action === "use" && out.accountRef, "#Backup_Key", "out of usage: the next account takes the turn");
});

test("a Mine row that claims to be the Space AI key is never a Space key", () => {
  const forged = row({ ref: "#Rob_Key", mine: true, ownerId: "usr_rob", spaceKey: true });
  const r = resolveAccount(base({ starter: "usr_mia", accounts: [forged] }));
  assert.equal(r.allowed, false);
});

// ---- the engine handlers over providers.list

const PROVIDERS = [
  { id: "prv_space", providerKey: "opencode-go", name: "OpenCode Go", connection: "api_key", scope: "shared", handle: "#OpenCode_Go_for_everyone", itemId: "vit_space", itemName: "OpenCode Go for everyone", engine: "opencode-go", spaceMayUse: true, state: "ok", spaceKey: true, models: ["glm-5.3", "kimi-k3", "deepseek-v4-pro"] },
];

function ctxWith(over: Record<string, (input: Record<string, unknown>) => unknown>, threads = [{ threadId: "thr_1", starter: "usr_mia", agents: [{ agentId: "agt_1", mode: "lead" as const, model: "claude-sonnet-5-5" }] }]) {
  const h = harness({ principal: { kind: "person", id: "usr_mia" }, threads });
  ensure(h.db);
  ensureExtra(h.db);
  const ctx: EngineCtx = {
    ...h.ctx,
    async call(cap, input) {
      const f = over[cap];
      if (f) return f((input ?? {}) as Record<string, unknown>);
      if (cap === "providers.list") return { providers: PROVIDERS };
      if (cap === "providers.space_key.get") return { set: true, models: ["glm-5.3", "kimi-k3", "deepseek-v4-pro"], mayManage: false };
      if (cap === "agents.get") return { agent: { accountPolicy: "asker" } };
      if (cap === "engine.policy.get") return { allowedAccounts: "any" };
      if (cap === "engine.defaults.get") return { fallback: [] };
      if (cap === "engine.placement.decide") return { placement: "host" };
      if (cap === "spaces.get") return { space: { kind: "team" } };
      if (cap === "settings.get") throw new Error("no setting");
      return h.ctx.call(cap, input);
    },
  };
  return { h, ctx };
}
const out = (cap: string) => manifest.capabilities!.find((c) => c.name === cap)!.output;

test("every member sees the Space AI key as the provider it is, not a special option, and a turn resolves to it", async () => {
  const { ctx } = ctxWith({});
  const listed = await accountsList(ctx, {} as never);
  assert.deepEqual(validate(out("engine.accounts.list"), listed, "", {}), []);
  assert.deepEqual(listed.accounts.map((a) => [a.ref, a.driver, a.title, "name" in a, a.spaceKey]), [["#OpenCode_Go_for_everyone", "opencode_go", "OpenCode Go", false, true]]);
  // the chat's model is one the key serves, or Automatic: it fits (owner ruling 9)
  const served = ctxWith({}, [{ threadId: "thr_1", starter: "usr_mia", agents: [{ agentId: "agt_1", mode: "lead" as const, model: "glm-5.3" }] }]).ctx;
  const r = await accountResolve(served, { threadId: "thr_1", agentId: "agt_1" });
  assert.deepEqual([r.accountRef, r.payer, r.allowed, r.itemId], ["#OpenCode_Go_for_everyone", "usr_mia", true, "vit_space"], "usage is metered against the key's item and the member");
  const automatic = ctxWith({}, [{ threadId: "thr_1", starter: "usr_mia", agents: [{ agentId: "agt_1", mode: "lead" as const }] }] as never).ctx;
  assert.equal((await accountResolve(automatic, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#OpenCode_Go_for_everyone");
  // a Claude model the key does not list: the team chat runs on the key's first model, and says so (owner, 3 Nov)
  const other = await accountResolve(ctx, { threadId: "thr_1", agentId: "agt_1" });
  assert.deepEqual([other.accountRef, other.modelFallback], ["#OpenCode_Go_for_everyone", { from: "claude-sonnet-5-5", to: "glm-5.3" }]);
});

test("the model list of the Space AI key comes from the Vault's kept list, never from a member testing the key", async () => {
  const { ctx, h } = ctxWith({ "providers.test": () => { throw new Error("a member may not test the Space AI key"); } });
  const m = await modelsList(ctx, { accountRef: "#OpenCode_Go_for_everyone" });
  assert.deepEqual(validate(out("engine.models.list"), m, "", {}), []);
  assert.deepEqual(m.models.map((x) => [x.model, x.driver, x.allowed]), [["deepseek-v4-pro", "opencode_go", true], ["glm-5.3", "opencode_go", true], ["kimi-k3", "opencode_go", true]]);
  assert.equal(h.calls("providers.test").length, 0);
});

test("a model out of usage is greyed with when it comes back, its meter is full, and an unknown time rests for a while", async () => {
  const { ctx, h } = ctxWith({});
  recordModelLimit(h.db, "#OpenCode_Go_for_everyone", "glm-5.3", NOW + 3_600_000, NOW);
  recordModelLimit(h.db, "#OpenCode_Go_for_everyone", "kimi-k3", undefined, NOW);
  const m = await modelsList(ctx, { accountRef: "#OpenCode_Go_for_everyone" });
  assert.deepEqual(validate(out("engine.models.list"), m, "", {}), []);
  const by = Object.fromEntries(m.models.map((x) => [x.model, x]));
  assert.deepEqual([by["glm-5.3"]!.allowed, by["glm-5.3"]!.reason, by["glm-5.3"]!.resetsAt], [false, "usage_limit", NOW + 3_600_000]);
  assert.deepEqual([by["kimi-k3"]!.allowed, by["kimi-k3"]!.reason, by["kimi-k3"]!.resetsAt], [false, "usage_limit", undefined]);
  assert.equal(by["deepseek-v4-pro"]!.allowed, true, "the others stay usable: nothing is hidden");
  // the chat's model on the key reads full where every provider's limits show
  h.db.run("INSERT INTO engine_agent_state (thread_id, agent_id, model, provider, updated_at) VALUES (?, ?, ?, ?, ?)", "thr_1", "agt_1", "glm-5.3", "opencode-go", NOW);
  const ctxU: EngineCtx = { ...ctx, async call(cap, input) { if (cap === "engine.accounts.list") return accountsList(ctx, {} as never); return ctx.call(cap, input); } };
  const u = await usageGet(ctxU, { threadId: "thr_1", agentId: "agt_1", accountRef: "#OpenCode_Go_for_everyone" });
  assert.deepEqual(u.session, { pct: 100, resetsAt: NOW + 3_600_000 });
  assert.deepEqual(validate(out("engine.usage.get"), u, "", {}), []);
  h.advance(MODEL_REST_MS + 1);
  assert.deepEqual([...modelLimits(h.db, "#OpenCode_Go_for_everyone", NOW + MODEL_REST_MS + 1).keys()], ["glm-5.3"], "an unknown time rests MODEL_REST_MS, a known one until it");
});

test("a turn on the Space AI key runs a model the key serves; a model out of usage moves the turn to the next one, and the next answer clears it", async () => {
  const { h } = ctxWith({});
  assert.equal(fitModel("claude-sonnet-5-5", ["glm-5.3", "kimi-k3"]), "glm-5.3");
  assert.equal(fitModel("kimi-k3", ["glm-5.3", "kimi-k3"]), "kimi-k3");
  assert.equal(fitModel("kimi-k3", ["glm-5.3", "kimi-k3"], new Set(["kimi-k3"])), "glm-5.3", "a chosen model that is out gives way to one that is not");
  assert.equal(fitModel("kimi-k3", ["glm-5.3", "kimi-k3"], new Set(["glm-5.3", "kimi-k3"])), "kimi-k3", "all out: the chosen one, and its refusal goes to the next account");
  assert.equal(fitModel("claude-sonnet-5-5", []), "claude-sonnet-5-5", "no list known: the turn keeps its model");
  const opened: string[] = [];
  const script: Record<string, DriverEvent[]> = {};
  const open = async (spec: SessionSpec): Promise<EngineSession> => {
    const model = spec.agent.model ?? "";
    opened.push(model);
    return { warm: false, async *send() { for (const e of script[model] ?? []) yield e; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} };
  };
  const call = async (cap: string): Promise<unknown> => { assert.equal(cap, "providers.space_key.get"); return { set: true, models: ["glm-5.3", "kimi-k3"], mayManage: false }; };
  const wrapped = withSpaceKeyTurns(open, { call, db: h.db, now: () => NOW });
  const account = { ref: "#OpenCode_Go_for_everyone", driver: "opencode_go", provider: "opencode_go", kind: "api_key" as const, payer: "usr_mia", reason: "starter" as const, spaceKey: true, shared: true };
  const spec: SessionSpec = { threadId: "thr_1", agent: { id: "agt_1", mode: "lead", model: "claude-sonnet-5-5" }, asker: "usr_mia", turnId: "trn_1", traceId: "a".repeat(32), account };
  const drain = async (s: EngineSession): Promise<DriverEvent[]> => { const got: DriverEvent[] = []; for await (const e of s.send({} as never)) got.push(e); return got; };
  script["glm-5.3"] = [{ type: "error", code: "provider.rate_limited", message: "out of usage", resetsAt: NOW + 600_000 }];
  script["kimi-k3"] = [{ type: "text", text: "hi" }, { type: "done" }];
  const first = await drain(await wrapped(spec));
  assert.deepEqual(opened, ["glm-5.3", "kimi-k3"], "a Claude model cannot run on OpenCode Go: the first model the key serves, then the next when it is out");
  assert.deepEqual(first.map((e) => e.type), ["text", "done"], "the turn did not fail: the person got an answer");
  assert.deepEqual([...modelLimits(h.db, account.ref, NOW)], [["glm-5.3", { resetsAt: NOW + 600_000 }]], "the out model stays greyed with its time");
  opened.length = 0;
  await drain(await wrapped({ ...spec, agent: { ...spec.agent, model: "glm-5.3" } }));
  assert.deepEqual(opened, ["kimi-k3"], "while it is out, a turn that chose it starts on one that is not");
  // every model out: the refusal reaches the turn engine (it tries the next account), nothing loops
  script["kimi-k3"] = [{ type: "error", code: "provider.rate_limited", message: "out of usage" }];
  opened.length = 0;
  const all = await drain(await wrapped(spec));
  assert.deepEqual(all.map((e) => e.type), ["error"]);
  assert.ok(opened.length <= 2);
  // every model is out, so a turn that chose kimi-k3 tries it; it answers, and that clears it at once
  assert.equal(modelLimits(h.db, account.ref, NOW).has("kimi-k3"), true);
  script["kimi-k3"] = [{ type: "text", text: "back" }, { type: "done" }];
  await drain(await wrapped({ ...spec, agent: { ...spec.agent, model: "kimi-k3" } }));
  assert.equal(modelLimits(h.db, account.ref, NOW).has("kimi-k3"), false);
  // someone's own account is left alone
  opened.length = 0;
  const own = { ...spec, account: { ...account, ref: "#Dana_Anthropic", driver: "anthropic", provider: "anthropic", spaceKey: false } };
  await wrapped(own);
  assert.deepEqual(opened, ["claude-sonnet-5-5"]);
});
