// A learning pass never changes an account's state (rc.17 integration, lead 3 Nov). Memory learns after every turn and reads the account's model list to pick its cheapest model; that read
// is passive (engine.models.list with probe: false), so it never asks the vendor. And providers.test itself marks an account failing only when the vendor refuses the key (401 or 403): a
// vendor it cannot reach is "couldn't check" and the state stays. Real handlers of three modules (memory's pass, the engine's model list and account resolution, the Vault's providers),
// wired by hand; only the vendor is a stand-in.
import test from "node:test";
import assert from "node:assert/strict";
import { capture } from "../modules/memory/handlers/facts.ts";
import { harness as memoryHarness } from "../modules/memory/fixtures/harness.ts";
import { modelsList } from "../modules/engine/handlers/extra/models.ts";
import { accountResolve } from "../modules/engine/handlers/accounts.ts";
import { resetLiveModels } from "../modules/engine/live-models.ts";
import { harness as engineHarness } from "../modules/engine/fixtures/harness.ts";
import type { EngineCtx } from "../modules/engine/projections.ts";
import * as v from "../modules/vault/handlers/index.ts";
import * as u from "../modules/vault/handlers/use.ts";
import * as p from "../modules/vault/handlers/providers.ts";
import { MAYA, SECRET, harness as vaultHarness } from "../modules/vault/fixtures/harness.ts";
import type { Ctx } from "../packages/contracts/src/ctx.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
const THREAD = "thr_learn_vendor";
const AGENT = "agt_intake";

/** A Space with one shared Anthropic key, an engine and a memory that reach it, and a vendor that answers whatever `vendor` says. */
async function world(vendor: { answer: () => Promise<{ ok: boolean; models: string[]; detail?: string; refused?: boolean }> }) {
  resetLiveModels();
  const vh = vaultHarness();
  const folder = String(out(out(await v.foldersCreate(vh.ctx, { name: "Team keys", scope: "shared", idempotencyKey: "lv-folder" })).folder).id);
  const row = out(out(await p.add(vh.ctx, { providerKey: "anthropic", connection: "api_key", scope: "shared", apiKey: SECRET, folderId: folder, idempotencyKey: "lv-key" })).provider);
  const handle = String(row.handle);
  let probes = 0;
  u.configureVault({ sinks: {}, probe: async () => { probes++; return vendor.answer(); } });

  const eh = engineHarness();
  const vault = (cap: string, input: unknown): Promise<unknown> | null =>
    cap === "providers.list" ? p.list(vh.ctx, {}) : cap === "providers.test" ? p.test(vh.ctx, input as { providerId: string }) : null;
  const engine: EngineCtx = { ...eh.ctx, call: async (cap: string, input: unknown) => (await vault(cap, input)) ?? eh.ctx.call(cap, input) };

  const complete: string[] = [];
  const mh = memoryHarness({
    principal: { kind: "person", id: MAYA },
    respond: {
      "threads.get": () => ({ thread: { kind: "chat", starter: MAYA, agents: [{ agentId: AGENT, mode: "lead" }], members: [{ kind: "person", id: MAYA }] } }),
      "agents.get": () => ({ agent: { folderId: "fld_intake", ownerId: MAYA, captureMode: "auto" } }),
      "chat.messages.list": () => ({ messages: [{ messageId: "msg_1", threadSeq: 1, author: { kind: "person", id: MAYA }, body: "I prefer short answers in the morning, please remember that." }], hasMore: false }),
      "engine.models.list": (i) => modelsList(engine, i as never),
      "engine.complete": (i) => { complete.push(String(i["model"])); return { text: "{\"ops\":[]}", tokensIn: 900, tokensOut: 40 }; },
    },
  });

  /** The next turn's account, as engine.account.resolve answers it for the agent that runs on this key. */
  const nextTurn = async () => {
    const ctx = {
      space: "spc_1", principal: { kind: "agent", id: AGENT }, actingFor: MAYA, trace: { traceId: "t".repeat(32), spanId: "s" }, origin: "agent", depth: 1, now: () => 1_760_000_000_000,
      call: async (cap: string, input: unknown) => {
        const r = await vault(cap, input);
        if (r !== null) return r;
        const routes: Record<string, unknown> = {
          "threads.get": { thread: { starter: MAYA, agents: [{ agentId: AGENT, model: "claude-sonnet-5-5" }] } },
          "agents.get": { agent: { accountPolicy: "key", accountKey: handle } },
          "engine.policy.get": { allowedAccounts: "any" },
          "engine.defaults.get": { fallback: [] },
          "engine.placement.decide": { placement: "host" },
          "spaces.get": { space: { kind: "team" } },
        };
        if (!(cap in routes)) throw new Error(`unexpected call ${cap}`);
        return routes[cap];
      },
    } as unknown as Ctx;
    return accountResolve(ctx, { threadId: THREAD, agentId: AGENT, askerId: MAYA });
  };
  const state = async (): Promise<string> => String(out((out(await p.list(vh.ctx, {})).providers as Json[])[0]).state);
  const learn = () => capture(mh.ctx, { threadId: THREAD, reason: "turn", agentId: AGENT, account: { ref: handle, driver: "anthropic", kind: "api_key", payer: MAYA } } as never);
  const done = (): void => { u.configureVault(null); vh.cleanup(); };
  return { handle, engine, complete, learn, nextTurn, state, probes: () => probes, done };
}

const unreachable = { answer: async () => ({ ok: false, models: [] as string[], detail: "The provider could not be reached." }) };

test("a learning pass against a vendor it cannot reach leaves the account usable, and the next turn resolves it", async () => {
  const w = await world(unreachable);
  try {
    const learned = await w.learn();
    assert.equal(learned.via, "model", JSON.stringify(learned));
    assert.deepEqual(w.complete, ["claude-haiku-5-5"], "the pass ran on the cheap model it knows for the driver");
    assert.equal(w.probes(), 0, "the learning pass asked no vendor");
    assert.equal(await w.state(), "ok");
    const next = await w.nextTurn();
    assert.deepEqual([next.accountRef, next.payer, next.allowed], [w.handle, MAYA, true], "the next turn runs on the key");
  } finally { w.done(); }
});

test("the model menu against a vendor it cannot reach says it couldn't check and leaves the account usable; only a refused key marks it failing", async () => {
  let refuse = false;
  const w = await world({ answer: async () => (refuse ? { ok: false, models: [], detail: "The provider did not accept this key.", refused: true } : unreachable.answer()) });
  try {
    await modelsList(w.engine, { accountRef: w.handle });
    assert.equal(w.probes(), 1, "the menu asks the vendor");
    assert.equal(await w.state(), "ok", "a vendor that cannot be reached says nothing about the key");
    assert.equal((await w.nextTurn()).allowed, true);
    refuse = true;
    await modelsList(w.engine, { accountRef: w.handle });
    assert.equal(await w.state(), "failing", "the vendor refused the key");
    assert.equal((await w.nextTurn()).allowed, false);
  } finally { w.done(); }
});
