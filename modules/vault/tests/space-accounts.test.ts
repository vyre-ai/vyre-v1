// Space AI accounts in the Vault (owner ruling 9): an owner or admin makes a shared key pay for team chats, automations, goals or agent work, with an optional monthly cap; every member lists it
// (a handle and a name, never a value), whether team chats reach them, whether it is capped, and the models it serves. The Space AI key from before becomes one, kept for team chats, for everyone.
// The engine's use of one goes through providers.space_key.use for a member who has no Use on its item.
// @reads /modules/vault/handlers/space-accounts.ts
// @reads /modules/vault/migrations/0007_provider_uses.sql
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import * as p from "../handlers/providers.ts";
import * as sk from "../handlers/space-key.ts";
import { ADMIN, MAYA, ROB, contractErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const KEY = "sk-ant-api03-SPACE-credits-FAKE-0123456789"; // secret-scan: fake
const OCG = "ocg-live-7a1f-NEVER-IN-A-LOG-0123456789"; // secret-scan: fake
const MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5"];
let seq = 0;
const idem = (): string => `sa-${++seq}`;

/** ADMIN manages the Space; Rob is in the sales group, Maya is not; this month's spend per item is scripted in cents. */
function space(): { h: Harness; spend: Map<string, number> } {
  const h = harness();
  u.configureVault({ sinks: {}, probe: async (q) => (q.apiKey === KEY ? { ok: true, models: MODELS } : q.apiKey === OCG ? { ok: true, models: ["glm-5.3"] } : { ok: false, models: [], detail: "refused", refused: true }) });
  h.allow(ADMIN, "policy.manage");
  h.grant(ADMIN, "spc_vault", "manage");
  h.actAs("person", ADMIN);
  const spend = new Map<string, number>();
  const call = h.ctx.call.bind(h.ctx);
  h.ctx.call = async (cap, input) => {
    const body = (input ?? {}) as Json;
    if (cap === "access.groups.get") return { group: { id: body["groupId"], name: "Sales", members: body["groupId"] === "grp_sales" ? [{ kind: "person", id: ROB }] : [], managers: [], builtIn: false }, roles: [], grants: [] };
    if (cap === "engine.usage.query") return { rows: [], totals: { turns: 1, tokensIn: 0, tokensOut: 0, costMicros: (spend.get(String(body["itemId"])) ?? 0) * 10_000 } };
    return call(cap, input);
  };
  return { h, spend };
}
const done = (h: Harness): void => { u.configureVault(null); h.cleanup(); };

async function credits(h: Harness): Promise<Json> {
  const folder = (await v.foldersCreate(h.ctx, { name: "Team keys", scope: "shared", idempotencyKey: idem() })) as { folder: { id: string } };
  h.grant(ADMIN, folder.folder.id, "manage");
  const added = (await p.add(h.ctx, { providerKey: "anthropic", connection: "api_key", scope: "shared", apiKey: KEY, folderId: folder.folder.id, idempotencyKey: idem() })) as { provider: Json };
  h.grant(ADMIN, String(added.provider.itemId), "manage");
  return added.provider;
}
const listed = async (h: Harness, who: string): Promise<Json[]> => { h.actAs("person", who); const r = ((await p.list(h.ctx, {})) as { providers: Json[] }).providers; h.actAs("person", ADMIN); return r; };

test("Anthropic credits for automations: set by an admin, listed for every member with its uses, cap and models; the key reaches no one", async () => {
  const { h, spend } = space();
  const row = await credits(h);
  // before: a plain shared key, kept for whoever can Use it, and only them
  const before = (await listed(h, ADMIN)).find((x) => x.id === row.id)!;
  assert.deepEqual([before.uses, before.usesSet], [{ teamChats: { who: "everyone" }, automations: true, goals: true, agentWork: { which: "all" } }, false]);
  assert.deepEqual(await listed(h, ROB), [], "Rob has no Use on it yet");
  const set = ((await p.usesSet(h.ctx, { providerId: String(row.id), uses: { automations: true }, capCents: 5000 })) as { provider: Json }).provider;
  assert.deepEqual([set.uses, set.usesSet, set.capCents, set.capped, set.models], [{ automations: true }, true, 5000, false, MODELS]);
  assert.equal("teamChatsForMe" in set, false, "not kept for team chats");
  // now a Space account: every member lists it, never its value
  const rob = (await listed(h, ROB)).find((x) => x.id === row.id)!;
  assert.deepEqual([rob.uses, rob.capCents, rob.capped], [{ automations: true }, 5000, false]);
  assert.ok(!JSON.stringify(rob).includes(KEY));
  // the month's spend reaches the cap: capped
  spend.set(String(row.itemId), 5000);
  assert.equal((await listed(h, MAYA)).find((x) => x.id === row.id)!.capped, true);
  // the item's history says what changed
  assert.ok(h.rows(`SELECT * FROM vault_history WHERE "itemId" = ?`, String(row.itemId)).some((r) => /pays for automations, up to 50.00 a month/.test(String(r.detail))));
  done(h);
});

test("team chats for some groups: Rob in Sales reaches it, Maya does not; the engine's use follows the same rule", async () => {
  const { h } = space();
  const row = await credits(h);
  await p.usesSet(h.ctx, { providerId: String(row.id), uses: { teamChats: { who: ["grp_sales"] } } });
  assert.equal((await listed(h, ROB)).find((x) => x.id === row.id)!.teamChatsForMe, true);
  assert.equal((await listed(h, MAYA)).find((x) => x.id === row.id)!.teamChatsForMe, false);
  const handle = String(row.handle);
  h.actAs("person", ROB);
  assert.deepEqual(await sk.use(h.ctx, { handle }), { handle, itemId: row.itemId }, "a turn of Rob's runs on it without Use on the item");
  h.actAs("person", MAYA);
  assert.equal(await refusedWith(sk.use(h.ctx, { handle })), "validation.not_found");
  // kept for automations as well: the engine may use it for any turn it resolved to (the resolver decides who), and leaves a used line
  h.actAs("person", ADMIN);
  await p.usesSet(h.ctx, { providerId: String(row.id), uses: { teamChats: { who: ["grp_sales"] }, automations: true } });
  h.actAs("person", MAYA);
  assert.equal(((await sk.use(h.ctx, { handle })) as Json).itemId, row.itemId);
  assert.ok(h.rows(`SELECT * FROM vault_history WHERE "itemId" = ? AND "action" = ?`, String(row.itemId), "used").length >= 2);
  done(h);
});

test("bad uses, a Mine key and a cap that is not a whole number of cents are refused in plain words; a cap left out is kept, null removes it", async () => {
  const { h } = space();
  const row = await credits(h);
  const id = String(row.id);
  for (const uses of [{ chats: true }, { teamChats: { who: "some" } }, { teamChats: { who: [] } }, { agentWork: { which: ["usr_x"] } }, { automations: "yes" }, null]) {
    assert.equal(await refusedWith(p.usesSet(h.ctx, { providerId: id, uses })), "validation.bad_input", JSON.stringify(uses));
  }
  assert.equal(await refusedWith(p.usesSet(h.ctx, { providerId: id, uses: { goals: true }, capCents: 12.5 })), "validation.bad_input");
  const mine = ((await p.add(h.ctx, { providerKey: "anthropic", connection: "api_key", scope: "mine", apiKey: KEY, idempotencyKey: idem() })) as { provider: Json }).provider;
  assert.equal(await refusedWith(p.usesSet(h.ctx, { providerId: String(mine.id), uses: { goals: true } })), "validation.bad_input");
  await p.usesSet(h.ctx, { providerId: id, uses: { goals: true }, capCents: 100 });
  assert.equal((((await p.usesSet(h.ctx, { providerId: id, uses: { goals: true, agentWork: { which: ["agt_scout"] } } })) as { provider: Json }).provider).capCents, 100);
  assert.equal("capCents" in (((await p.usesSet(h.ctx, { providerId: id, uses: { goals: true }, capCents: null })) as { provider: Json }).provider), false);
  done(h);
});

test("the Space AI key from before is a Space account with every use on, with the models it unlocks; a Space that had one before this is moved over when the Vault is next read", async () => {
  const { h } = space();
  await sk.set(h.ctx, { providerKey: "opencode-go", apiKey: OCG, idempotencyKey: idem() });
  const row = (await listed(h, MAYA)).find((x) => x.spaceKey === true)!;
  const ALL = { teamChats: { who: "everyone" }, automations: true, goals: true, agentWork: { which: "all" } };
  assert.deepEqual([row.uses, row.usesSet, row.teamChatsForMe, row.models], [ALL, true, true, ["glm-5.3"]]);
  // a Space whose key was set before Space accounts: no uses row yet
  h.ctx.db.run(`DELETE FROM vault_provider_uses WHERE "providerId" = ?`, String(row.id));
  const again = (await listed(h, ROB)).find((x) => x.spaceKey === true)!;
  assert.deepEqual([again.uses, again.usesSet, again.teamChatsForMe], [ALL, true, true]);
  done(h);
});

test("keeps nothing: false until an owner or admin says so, listed for every member, audited with an event; a local model always keeps nothing", async () => {
  const { h } = space();
  const row = await credits(h);
  const mark = (v: boolean): Promise<unknown> => p.setKeepsNothingFor(h.ctx, { providerId: String(row.id), keepsNothing: v });
  assert.equal((await listed(h, ADMIN)).find((x) => x.id === row.id)!.keepsNothing, false, "false by default");
  const set = ((await mark(true)) as { provider: Json }).provider;
  assert.equal(set.keepsNothing, true);
  assert.equal(contractErrors("providers.set_keeps_nothing", "out", { provider: set }).length, 0);
  // a plain shared key is listed only for those who can Use it; once it is a Space account every member lists it with the flag
  await p.usesSet(h.ctx, { providerId: String(row.id), uses: { automations: true } });
  assert.equal((await listed(h, ROB)).find((x) => x.id === row.id)!.keepsNothing, true, "kept across a change of uses");
  assert.ok(h.rows(`SELECT * FROM vault_history WHERE "itemId" = ?`, String(row.itemId)).some((r) => /Marked as keeping nothing/.test(String(r.detail))));
  assert.equal(h.named("provider.keeps_nothing_changed").length, 1);
  assert.deepEqual(h.named("provider.keeps_nothing_changed")[0]?.payload, { providerId: row.id, keepsNothing: true });
  await mark(true);
  assert.equal(h.named("provider.keeps_nothing_changed").length, 1, "no change, no event");
  assert.equal(((await mark(false)) as { provider: Json }).provider.keepsNothing, false);
  assert.equal(h.named("provider.keeps_nothing_changed").length, 2);
  assert.equal(await refusedWith(p.setKeepsNothingFor(h.ctx, { providerId: String(row.id), keepsNothing: "yes" as never })), "validation.bad_input");
  // a local model keeps nothing whatever is said, and cannot be turned off
  const folder = (await v.foldersCreate(h.ctx, { name: "Local", scope: "shared", idempotencyKey: idem() })) as { folder: { id: string } };
  h.grant(ADMIN, folder.folder.id, "manage");
  const local = ((await p.add(h.ctx, { providerKey: "local", connection: "local_model", scope: "shared", address: "http://localhost:11434", folderId: folder.folder.id, idempotencyKey: idem() })) as { provider: Json }).provider;
  assert.equal(local.keepsNothing, true);
  assert.equal(await refusedWith(p.setKeepsNothingFor(h.ctx, { providerId: String(local.id), keepsNothing: false })), "validation.bad_input");
  // an account of someone's own is not the Space's to mark
  const mine = ((await p.add(h.ctx, { providerKey: "opencode-go", connection: "api_key", scope: "mine", apiKey: OCG, idempotencyKey: idem() })) as { provider: Json }).provider;
  assert.equal(mine.keepsNothing, false);
  assert.equal(await refusedWith(p.setKeepsNothingFor(h.ctx, { providerId: String(mine.id), keepsNothing: true })), "validation.bad_input");
  done(h);
});
