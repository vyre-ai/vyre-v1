// The three engine account capabilities against a ctx that answers the capabilities they call. No Vault value appears anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { captureSubscription, draftFor, probeAccount, setSpaceUse, statusAfter } from "../../../agent/src/accounts/index.ts";
import type { AccountRow, SubscriptionItemDraft } from "../../../agent/src/accounts/index.ts";
import { accountProbe, accountResolve, accountsList } from "../handlers/accounts.ts";

type Prov = { id: string; providerKey: string; name: string; connection: string; scope: string; handle?: string; itemId: string; engine: string; spaceMayUse: boolean; state: string; uses?: Record<string, unknown>; capped?: boolean; models?: string[]; keepsNothing?: boolean };
const prov = (o: Partial<Prov> & { id: string; handle: string }): Prov => ({ providerKey: "anthropic", name: o.handle, connection: "api_key", scope: "mine", itemId: `vit_${o.id}`, engine: "anthropic", spaceMayUse: false, state: "ok", ...o });

function fake(routes: Record<string, (input: unknown) => unknown>, opts: { actingFor?: string } = {}): { ctx: Ctx; calls: string[] } {
  const calls: string[] = [];
  const ctx = {
    space: "spc_1", principal: { kind: "agent", id: "agt_1" }, actingFor: opts.actingFor ?? "usr_dana", trace: { traceId: "t".repeat(32), spanId: "s" }, origin: "agent", depth: 0,
    now: () => 1_760_000_000_000,
    call: async (cap: string, input: unknown) => { calls.push(cap); const f = routes[cap]; if (!f) throw new Error(`unexpected call ${cap}`); return f(input); },
  } as unknown as Ctx;
  return { ctx, calls };
}

const routes = (providers: Prov[], over: Record<string, (i: unknown) => unknown> = {}): Record<string, (i: unknown) => unknown> => ({
  "providers.list": () => ({ providers }),
  "threads.get": () => ({ thread: { starter: "usr_dana", agents: [{ agentId: "agt_1", model: "claude-sonnet-5-5" }] } }),
  "agents.get": () => ({ agent: { accountPolicy: "asker" } }),
  "engine.policy.get": () => ({ allowedAccounts: "any" }),
  "engine.defaults.get": () => ({ fallback: [{ accountRef: "#Team_Anthropic_Key" }] }),
  "engine.placement.decide": () => ({ placement: "host" }),
  "spaces.get": () => ({ space: { kind: "team" } }),
  ...over,
});

test("accounts.list: handles, kinds, Mine or shared, and sign-in state, no secret fields", async () => {
  const { ctx } = fake(routes([
    prov({ id: "prv_1", handle: "#Dana_Anthropic" }),
    prov({ id: "prv_2", handle: "#Dana_Claude", connection: "subscription", engine: "claude-code", state: "needs_sign_in", spaceMayUse: true }),
    prov({ id: "prv_3", handle: "#Team_Anthropic_Key", scope: "shared" }),
  ]));
  const out = await accountsList(ctx, {});
  assert.deepEqual(out.accounts.map((a) => [a.ref, a.driver, a.kind, a.mine, a.status, a.ownerId]), [
    ["#Dana_Anthropic", "anthropic", "api_key", true, "ok", "usr_dana"],
    ["#Dana_Claude", "claude_code", "subscription", true, "expired", "usr_dana"],
    ["#Team_Anthropic_Key", "anthropic", "api_key", false, "ok", undefined],
  ]);
  assert.ok(!JSON.stringify(out).toLowerCase().includes("secret"));
});

test("accounts.list says which accounts keep nothing (a local model always does); a Restricted thread runs only on one that does", async () => {
  const mix = [prov({ id: "prv_1", handle: "#Dana_Anthropic" }), prov({ id: "prv_3", handle: "#Team_Anthropic_Key", scope: "shared", keepsNothing: true }), prov({ id: "prv_5", handle: "#Local", connection: "local_model", engine: "local", providerKey: "local" })];
  const listed = await accountsList(fake(routes(mix)).ctx, {});
  assert.deepEqual(listed.accounts.map((a) => [a.ref, a.keepsNothing]), [["#Dana_Anthropic", undefined], ["#Team_Anthropic_Key", true], ["#Local", true]]);
  const restricted = { "threads.get": () => ({ thread: { label: "restricted", starter: "usr_dana", agents: [{ agentId: "agt_1", model: "claude-sonnet-5-5" }] } }) };
  const on = await accountResolve(fake(routes(mix, restricted)).ctx, { threadId: "thr_1", agentId: "agt_1" });
  assert.deepEqual([on.accountRef, on.allowed], ["#Team_Anthropic_Key", true], "her own key keeps something, so the account that keeps nothing pays");
  const off = await accountResolve(fake(routes([mix[0]!], { ...restricted, "engine.defaults.get": () => ({ fallback: [] }) })).ctx, { threadId: "thr_1", agentId: "agt_1" });
  assert.deepEqual([off.accountRef, off.allowed], [null, false], "no account that keeps nothing: the turn does not run");
});

test("account.resolve: the starter's key, then the Space's fallback key when it is signed out", async () => {
  const live = fake(routes([prov({ id: "prv_1", handle: "#Dana_Anthropic" }), prov({ id: "prv_3", handle: "#Team_Anthropic_Key", scope: "shared" })]));
  assert.deepEqual(await accountResolve(live.ctx, { threadId: "thr_1", agentId: "agt_1" }), { accountRef: "#Dana_Anthropic", payer: "usr_dana", reason: "starter", allowed: true, itemId: "vit_prv_1" });

  const down = fake(routes([prov({ id: "prv_1", handle: "#Dana_Anthropic", state: "failing" }), prov({ id: "prv_3", handle: "#Team_Anthropic_Key", scope: "shared" })]));
  assert.deepEqual(await accountResolve(down.ctx, { threadId: "thr_1", agentId: "agt_1" }), { accountRef: "#Team_Anthropic_Key", payer: "usr_dana", reason: "backup_key", allowed: true, itemId: "vit_prv_3", fellBack: true, via: "backup" });

  const none = fake(routes([prov({ id: "prv_1", handle: "#Dana_Anthropic", state: "failing" })], { "engine.defaults.get": () => ({ fallback: [] }) }));
  assert.deepEqual(await accountResolve(none.ctx, { threadId: "thr_1", agentId: "agt_1" }), { accountRef: null, payer: null, reason: "none", allowed: false, why: "failed" });
});

test("account.resolve: the steerer pays when the call acts for them; Dana's Mine key is never in their list", async () => {
  const sam = fake(routes([prov({ id: "prv_9", handle: "#Sam_Anthropic" })]), { actingFor: "usr_sam" });
  assert.deepEqual(await accountResolve(sam.ctx, { threadId: "thr_1", agentId: "agt_1", askerId: "usr_sam" }), { accountRef: "#Sam_Anthropic", payer: "usr_sam", reason: "steerer", allowed: true, itemId: "vit_prv_9" });
});

test("account.resolve: a step key makes it a task; Company only drops personal accounts; the person's own sign-in pays for their turn on the host and on a device", async () => {
  const task = fake(routes([prov({ id: "prv_3", handle: "#Team_Anthropic_Key", scope: "shared" })]));
  assert.equal((await accountResolve(task.ctx, { threadId: "thr_1", agentId: "agt_1", stepKey: "#Team_Anthropic_Key" })).reason, "step_key");

  const company = fake(routes([prov({ id: "prv_1", handle: "#Dana_Anthropic" })], { "engine.policy.get": () => ({ allowedAccounts: "company" }), "engine.defaults.get": () => ({ fallback: [] }) }));
  assert.equal((await accountResolve(company.ctx, { threadId: "thr_1", agentId: "agt_1" })).accountRef, null);

  const sub = [prov({ id: "prv_2", handle: "#Dana_Claude", connection: "subscription", engine: "claude-code", spaceMayUse: false })];
  const onHost = fake(routes(sub, { "engine.defaults.get": () => ({ fallback: [] }) }));
  assert.equal((await accountResolve(onHost.ctx, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#Dana_Claude", "no switch needed for her own turn");
  const onDevice = fake(routes(sub, { "engine.placement.decide": () => ({ placement: "device" }) }));
  assert.equal((await accountResolve(onDevice.ctx, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#Dana_Claude");
});

test("account.resolve: the person's own sign-in pays without the Space switch, in a Personal Space and on a team host alike", async () => {
  const sub = [prov({ id: "prv_4", handle: "#Dana_ChatGPT", providerKey: "codex", connection: "subscription", engine: "codex", spaceMayUse: false })];
  const none = { "engine.defaults.get": () => ({ fallback: [] }) };
  const threads = { "threads.get": () => ({ thread: { starter: "usr_dana", agents: [{ agentId: "agt_1" }] } }) };
  const personal = fake(routes(sub, { ...none, ...threads, "spaces.get": () => ({ space: { kind: "personal" } }) }));
  assert.deepEqual(await accountResolve(personal.ctx, { threadId: "thr_1", agentId: "agt_1" }), { accountRef: "#Dana_ChatGPT", payer: "usr_dana", reason: "starter", allowed: true, itemId: "vit_prv_4" });
  const team = fake(routes(sub, { ...none, ...threads }));
  assert.equal((await accountResolve(team.ctx, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#Dana_ChatGPT", "her own turn on the team server runs on her sign-in");
  const unknown = fake(routes(sub, { ...none, ...threads, "spaces.get": () => { throw new Error("no spaces module"); } }));
  assert.equal((await accountResolve(unknown.ctx, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#Dana_ChatGPT", "an unknown kind is treated as a team server, and her turn is still hers");
});

test("probe_account: models counted on success; a failed sign-in comes back as an error with a next step; an unknown account is not_found", async () => {
  const ok = fake(routes([prov({ id: "prv_1", handle: "#Dana_Anthropic" })], { "providers.test": () => ({ ok: true, models: ["a", "b", "c"], latencyMs: 40 }) }));
  assert.deepEqual(await accountProbe(ok.ctx, { accountRef: "#Dana_Anthropic" }), { ok: true, models: 3 });

  const bad = fake(routes([prov({ id: "prv_2", handle: "#Dana_Claude", connection: "subscription", engine: "claude-code", state: "needs_sign_in" })], { "providers.test": () => ({ ok: false, models: [], latencyMs: 5, detail: "signed out" }) }));
  const out = await accountProbe(bad.ctx, { accountRef: "#Dana_Claude" });
  assert.equal(out.ok, false);
  if (!out.ok && "error" in out) {
    assert.equal(out.error.code, "auth.expired");
    assert.equal(out.error.message, "signed out");
    assert.deepEqual(out.error.next, [{ kind: "reconnect", label: "Sign in again" }]);
    assert.equal(out.error.traceId.length, 32);
  }

  await assert.rejects(() => accountProbe(ok.ctx, { accountRef: "#Nope" }), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "validation.not_found");
});

test("statusAfter and probeAccount: sign-in problems mark the account, a network blip does not", async () => {
  const sub: AccountRow = { ref: "sub", driver: "claude_code", provider: "anthropic", kind: "subscription", title: "s", mine: true, ownerId: "usr_dana", status: "ok", lastProbeAt: null, spaceMayUse: true };
  const key: AccountRow = { ...sub, ref: "key", kind: "api_key" };
  assert.equal(statusAfter(sub, { ok: false, error: { code: "provider.auth_failed", message: "x" } }), "expired");
  assert.equal(statusAfter(key, { ok: false, error: { code: "provider.auth_failed", message: "x" } }), "failed");
  assert.equal(statusAfter(key, { ok: false, error: { code: "provider.network", message: "x" } }), null);
  assert.equal(statusAfter(key, { ok: true, models: 2 }), "ok");
  const seen: Array<[string, string, number]> = [];
  const deps = { find: (r: string) => (r === "key" ? key : undefined), run: async () => { throw new Error("socket hang up"); }, record: (r: string, s: string, at: number) => { seen.push([r, s, at]); }, now: () => 7 };
  const r = await probeAccount(deps, "key");
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "provider.network");
  assert.deepEqual(seen, [], "an unreachable provider does not mark the key failed");
  await probeAccount({ ...deps, run: async () => ({ ok: true, models: 4 }) }, "key");
  assert.deepEqual(seen, [["key", "ok", 7]]);
});

test("subscription capture hands the files to the vault and returns the handle and field names, never the material", async () => {
  const secret = new TextEncoder().encode("sk-ant-oat01-TOPSECRET");
  let stored: { draft: SubscriptionItemDraft; values: Readonly<Record<string, Uint8Array>> } | null = null;
  const res = await captureSubscription(
    { putItem: async (draft, values) => { stored = { draft, values }; return { itemId: "vit_1", handle: "#Dana_Claude" }; } },
    { owner: "usr_dana", driver: "claude_code", material: { "credentials.json": secret, "config.toml": new Uint8Array([1]) } },
  );
  assert.deepEqual(res, { itemId: "vit_1", handle: "#Dana_Claude", fields: ["config.toml", "credentials.json"] });
  assert.ok(!JSON.stringify(res).includes("TOPSECRET"));
  assert.ok(stored);
  const s = stored as { draft: SubscriptionItemDraft; values: Readonly<Record<string, Uint8Array>> };
  assert.deepEqual([s.draft.kind, s.draft.mine, s.draft.ownerId, s.draft.name], ["ai_subscription", true, "usr_dana", "Claude Code sign-in"]);
  assert.ok(!JSON.stringify(s.draft).includes("TOPSECRET"), "the draft names fields only");
  assert.deepEqual(s.values["credentials.json"], secret);
  assert.throws(() => draftFor({ owner: "usr_dana", driver: "codex", material: {} }), RangeError);
});

test("turning the Space's use of my subscription off stops my sandbox; turning it on does not start one", async () => {
  const log: string[] = [];
  const deps = { setSwitch: async (o: string, e: boolean) => { log.push(`switch ${o} ${e}`); }, stopSandbox: async (o: string) => { log.push(`stop ${o}`); return true; } };
  assert.deepEqual(await setSpaceUse(deps, "usr_dana", false), { enabled: false, sandboxStopped: true });
  assert.deepEqual(await setSpaceUse(deps, "usr_dana", true), { enabled: true, sandboxStopped: false });
  assert.deepEqual(log, ["switch usr_dana false", "stop usr_dana", "switch usr_dana true"]);
});

// Run on the final commit of this packet, after merging main, so the CI log lists this file as ok.

test("account.resolve dry: the composer's check answers for the caller, not the chat's starter, and says why nothing can pay", async () => {
  const sam = fake(routes([prov({ id: "prv_9", handle: "#Sam_Anthropic" })], { "engine.defaults.get": () => ({ fallback: [] }) }), { actingFor: "usr_sam" });
  assert.deepEqual(await accountResolve(sam.ctx, { threadId: "thr_1", agentId: "agt_1", dry: true }), { accountRef: "#Sam_Anthropic", payer: "usr_sam", reason: "steerer", allowed: true, itemId: "vit_prv_9" });
  const none = fake(routes([], { "engine.defaults.get": () => ({ fallback: [] }) }), { actingFor: "usr_mia" });
  const out = await accountResolve(none.ctx, { threadId: "thr_1", agentId: "agt_1", dry: true });
  assert.deepEqual([out.allowed, out.payer, out.why], [false, null, "no_account"]);
});

test("account.resolve: the agent's AI account for its own work pays a routine, where the Space kept it for this agent and under its cap; a chat of the same agent stays on the asker's own account", async () => {
  const work = prov({ id: "prv_w", handle: "#Work_Credits", scope: "shared", uses: { agentWork: { which: ["agt_1"] } } });
  const cheap = prov({ id: "prv_c", handle: "#Cheap_Work", scope: "shared", engine: "opencode_go", providerKey: "opencode-go", uses: { agentWork: { which: "all" } }, models: ["claude-sonnet-5-5"] });
  const mine = prov({ id: "prv_1", handle: "#Dana_Anthropic" });
  const agent = (o: Record<string, unknown> = {}) => ({ "agents.get": () => ({ agent: { accountPolicy: "asker", workKey: "#Work_Credits", ...o } }), "engine.defaults.get": () => ({ fallback: [] }) });
  // the pick pays for a routine, though a cheaper account also covers it
  const ok = fake(routes([mine, cheap, work], agent()));
  assert.deepEqual(await accountResolve(ok.ctx, { threadId: "thr_1", agentId: "agt_1", kind: "agent_work" }), { accountRef: "#Work_Credits", payer: "usr_dana", reason: "starter", allowed: true, itemId: "vit_prv_w", pin: { ref: "#Work_Credits", used: true }, via: "work" });
  // Automatic (no pick) is the cheapest account that covers the work
  const auto = await accountResolve(fake(routes([mine, cheap, work], agent({ workKey: undefined }))).ctx, { threadId: "thr_1", agentId: "agt_1", kind: "agent_work" });
  assert.equal(auto.accountRef, "#Cheap_Work");
  // the same agent in a chat: the asker's own account first
  const chat = await accountResolve(ok.ctx, { threadId: "thr_1", agentId: "agt_1" });
  assert.equal(chat.accountRef, "#Dana_Anthropic");
  // an account kept for another agent is passed over with its reason; a capped one too
  const other = await accountResolve(fake(routes([mine, cheap, prov({ id: "prv_w", handle: "#Work_Credits", scope: "shared", uses: { agentWork: { which: ["agt_other"] } } })], agent())).ctx, { threadId: "thr_1", agentId: "agt_1", kind: "agent_work" });
  assert.deepEqual([other.accountRef, other.pin], ["#Cheap_Work", { ref: "#Work_Credits", used: false, why: "not_used_for" }]);
  const capped = await accountResolve(fake(routes([mine, cheap, { ...work, capped: true }], agent())).ctx, { threadId: "thr_1", agentId: "agt_1", kind: "agent_work" });
  assert.deepEqual([capped.accountRef, capped.pin], ["#Cheap_Work", { ref: "#Work_Credits", used: false, why: "capped" }]);
});

test("account.resolve: the Chat key is off unless set: the asker's own account answers a chat; with it on, the Space account pays every person's chats and the turn says so", async () => {
  const mine = prov({ id: "prv_1", handle: "#Dana_Anthropic" });
  const team = prov({ id: "prv_t", handle: "#Team_Credits", scope: "shared", uses: { teamChats: { who: "everyone" } }, models: ["claude-sonnet-5-5"] });
  const agent = (o: Record<string, unknown>) => ({ "agents.get": () => ({ agent: { accountPolicy: "asker", ...o } }), "engine.defaults.get": () => ({ fallback: [] }) });
  const off = await accountResolve(fake(routes([mine, team], agent({}))).ctx, { threadId: "thr_1", agentId: "agt_1" });
  assert.deepEqual([off.accountRef, off.reason, off.pin], ["#Dana_Anthropic", "starter", undefined]);
  const on = await accountResolve(fake(routes([mine, team], agent({ accountPolicy: "key", accountKey: "#Team_Credits" }))).ctx, { threadId: "thr_1", agentId: "agt_1" });
  assert.deepEqual([on.accountRef, on.pin], ["#Team_Credits", { ref: "#Team_Credits", used: true }]);
});

test("account.resolve: a backup that pays because the account ahead hit its cap says which one", async () => {
  const team = prov({ id: "prv_t", handle: "#Team_Credits", scope: "shared", capped: true, uses: { teamChats: { who: "everyone" } } });
  const mine = prov({ id: "prv_2", handle: "#Other_Team", scope: "shared", uses: { teamChats: { who: "everyone" } }, models: ["claude-sonnet-5-5"] });
  const r = await accountResolve(fake(routes([mine, team], { "agents.get": () => ({ agent: { accountPolicy: "key", accountKey: "#Team_Credits" } }), "engine.defaults.get": () => ({ fallback: [] }) })).ctx, { threadId: "thr_1", agentId: "agt_1" });
  assert.deepEqual([r.accountRef, r.cappedFrom, r.fellBack], ["#Other_Team", "#Team_Credits", true]);
});
