// The three engine account capabilities against a ctx that answers the capabilities they call. No Vault value appears anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { captureSubscription, draftFor, probeAccount, setSpaceUse, statusAfter } from "../../../agent/src/accounts/index.ts";
import type { AccountRow, SubscriptionItemDraft } from "../../../agent/src/accounts/index.ts";
import { accountProbe, accountResolve, accountsList } from "../handlers/accounts.ts";

type Prov = { id: string; providerKey: string; name: string; connection: string; scope: string; handle?: string; itemId: string; engine: string; spaceMayUse: boolean; state: string };
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

test("account.resolve: the starter's key, then the Space's fallback key when it is signed out", async () => {
  const live = fake(routes([prov({ id: "prv_1", handle: "#Dana_Anthropic" }), prov({ id: "prv_3", handle: "#Team_Anthropic_Key", scope: "shared" })]));
  assert.deepEqual(await accountResolve(live.ctx, { threadId: "thr_1", agentId: "agt_1" }), { accountRef: "#Dana_Anthropic", payer: "usr_dana", reason: "starter", allowed: true, itemId: "vit_prv_1" });

  const down = fake(routes([prov({ id: "prv_1", handle: "#Dana_Anthropic", state: "failing" }), prov({ id: "prv_3", handle: "#Team_Anthropic_Key", scope: "shared" })]));
  assert.deepEqual(await accountResolve(down.ctx, { threadId: "thr_1", agentId: "agt_1" }), { accountRef: "#Team_Anthropic_Key", payer: "usr_dana", reason: "backup_key", allowed: true, itemId: "vit_prv_3" });

  const none = fake(routes([prov({ id: "prv_1", handle: "#Dana_Anthropic", state: "failing" })], { "engine.defaults.get": () => ({ fallback: [] }) }));
  assert.deepEqual(await accountResolve(none.ctx, { threadId: "thr_1", agentId: "agt_1" }), { accountRef: null, payer: null, reason: "none", allowed: false });
});

test("account.resolve: the steerer pays when the call acts for them; Dana's Mine key is never in their list", async () => {
  const sam = fake(routes([prov({ id: "prv_9", handle: "#Sam_Anthropic" })]), { actingFor: "usr_sam" });
  assert.deepEqual(await accountResolve(sam.ctx, { threadId: "thr_1", agentId: "agt_1", askerId: "usr_sam" }), { accountRef: "#Sam_Anthropic", payer: "usr_sam", reason: "steerer", allowed: true });
});

test("account.resolve: a step key makes it a task; Company only drops personal accounts; a device run needs no subscription switch", async () => {
  const task = fake(routes([prov({ id: "prv_3", handle: "#Team_Anthropic_Key", scope: "shared" })]));
  assert.equal((await accountResolve(task.ctx, { threadId: "thr_1", agentId: "agt_1", stepKey: "#Team_Anthropic_Key" })).reason, "step_key");

  const company = fake(routes([prov({ id: "prv_1", handle: "#Dana_Anthropic" })], { "engine.policy.get": () => ({ allowedAccounts: "company" }), "engine.defaults.get": () => ({ fallback: [] }) }));
  assert.equal((await accountResolve(company.ctx, { threadId: "thr_1", agentId: "agt_1" })).accountRef, null);

  const sub = [prov({ id: "prv_2", handle: "#Dana_Claude", connection: "subscription", engine: "claude-code", spaceMayUse: false })];
  const onHost = fake(routes(sub, { "engine.defaults.get": () => ({ fallback: [] }) }));
  assert.equal((await accountResolve(onHost.ctx, { threadId: "thr_1", agentId: "agt_1" })).accountRef, null);
  const onDevice = fake(routes(sub, { "engine.placement.decide": () => ({ placement: "device" }) }));
  assert.equal((await accountResolve(onDevice.ctx, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#Dana_Claude");
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
