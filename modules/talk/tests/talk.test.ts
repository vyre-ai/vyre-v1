// Talk's rules with a fake Vault and host: what covers a person (own key, then the Space key, then nothing), who may set what, and that a key goes nowhere but the Vault.
import test from "node:test";
import assert from "node:assert/strict";
import { fail } from "../../../host/src/routes/errors.ts";
import * as h from "../handlers/index.ts";
import { KEY, agent, person, world } from "../fixtures/harness.ts";
import type { TalkCtx } from "../projections.ts";

const fields = (value = KEY) => [{ key: "api_key", value, secret: true }];
const refusal = (e: unknown): { code?: string; reason?: string; message?: string } => { const x = (e as { error: { code: string; details?: { reason?: string }; message: string } }).error; return { code: x.code, reason: x.details?.reason as string, message: x.message }; };
const reason = async (p: Promise<unknown>): Promise<string | undefined> => { try { await p; return "no refusal"; } catch (e) { return refusal(e).reason ?? refusal(e).code; } };
const connect = (ctx: TalkCtx, id = "k1") => h.connect(ctx, { provider: "deepgram", fields: fields(), idempotencyKey: id });
const spaceConnect = (ctx: TalkCtx, id = "s1") => h.spaceConnect(ctx, { provider: "deepgram", fields: fields(), idempotencyKey: id });

test("what covers a person: nothing, then the Space key, then their own key, which wins; turning the Space off leaves own keys working", async () => {
  const w = world({ admins: ["usr_admin"] });
  const mia = w.as(person("usr_mia"));
  const admin = w.as(person("usr_admin"));
  assert.equal((await h.status(mia, {})).source, "none");
  assert.equal(await reason(h.session(mia, {})), "no_key");

  await spaceConnect(admin);
  assert.equal((await h.status(mia, {})).source, "space");
  const viaSpace = await h.session(mia, {});
  assert.equal(viaSpace.source, "space");
  assert.equal(w.minted.at(-1)!.asker, undefined, "a Space key opens with no asker: Shared only");
  assert.equal(w.calls.filter((c) => c.cap === "vault.use" && c.by === "usr_mia").length, 0, "a member gets no Use on the Space item");

  await connect(mia);
  assert.equal((await h.status(mia, {})).source, "own");
  const viaOwn = await h.session(mia, {});
  assert.equal(viaOwn.source, "own");
  assert.equal(w.minted.at(-1)!.asker, "usr_mia");

  await h.spaceConfigure(admin, { on: false });
  assert.equal((await h.session(mia, {})).source, "own", "her own key does not care that the Space turned off");
  const noah = w.as(person("usr_noah"));
  assert.equal((await h.status(noah, {})).source, "none");
  assert.equal((await h.status(noah, {})).spaceOn, false);
  assert.equal(await reason(h.session(noah, {})), "no_key", "off means the first-press sheet again for anyone with no key of their own");
  assert.equal(w.items.some((i) => i.name === "Deepgram for this Space"), true, "turning off keeps the key");

  await h.spaceConfigure(admin, { on: true });
  assert.equal((await h.session(noah, {})).source, "space");
});

test("the Space key is Restricted before a value can be read, and a member's session never names it or returns it", async () => {
  const w = world({ admins: ["usr_admin"] });
  await spaceConnect(w.as(person("usr_admin")));
  const item = w.items.find((i) => i.scope === "shared")!;
  assert.equal(item.label, "restricted");
  const order = w.calls.map((c) => c.cap);
  assert.ok(order.indexOf("access.labels.set") < order.indexOf("vault.item.put"), "the folder is labelled before the value goes in");
  const out = await h.session(w.as(person("usr_mia")), {});
  assert.ok(!JSON.stringify(out).includes(KEY));
  assert.ok(!JSON.stringify(out).includes(item.handle));
  assert.deepEqual(out.protocols, ["bearer", "jwt.short.lived"]);
  assert.ok(out.url.startsWith("wss://api.deepgram.com/v1/listen?"));
  assert.ok(!out.url.includes("jwt.short.lived"), "the token is not in an address that could be logged");
});

test("a key goes to the check and the Vault and nowhere else: no event, log, row or output holds it, and a failed key is never stored", async () => {
  const w = world({ admins: ["usr_admin"] });
  const mia = w.as(person("usr_mia"));
  w.answers.check = fail("provider.auth_failed", "0".repeat(32), { message: "Deepgram did not accept that key." });
  await assert.rejects(() => connect(mia, "bad"));
  assert.equal(w.items.length, 0);
  assert.equal(w.calls.filter((c) => c.cap === "vault.item.put").length, 0);
  w.answers.check = null;
  const out = await connect(mia, "good");
  assert.equal(w.items[0]!.value, KEY);
  assert.equal(w.items[0]!.scope, "mine");
  const around = JSON.stringify([out, w.events, w.logs, [...w.db.rows.get("talk_prefs")!.values()], [...w.db.rows.get("talk_space")!.values()]]);
  assert.ok(!around.includes(KEY));
});

test("replacing a key keeps the one item; removing it brings back what covers everyone else", async () => {
  const w = world({ admins: ["usr_admin"] });
  const mia = w.as(person("usr_mia"));
  const admin = w.as(person("usr_admin"));
  await spaceConnect(admin);
  await connect(mia, "first");
  await h.connect(mia, { provider: "deepgram", fields: fields("dg_second_key"), idempotencyKey: "second" });
  assert.equal(w.items.filter((i) => i.scope === "mine").length, 1);
  assert.equal(w.items.find((i) => i.scope === "mine")!.value, "dg_second_key");
  assert.equal((await h.disconnect(mia, {})).source, "space");
  await h.spaceDisconnect(admin, {});
  assert.equal(w.items.length, 0);
  assert.equal((await h.status(mia, {})).source, "none");
});

test("agents: they change a person's own choices for that person, never add a key, never open a session", async () => {
  const w = world();
  const helper = w.as(agent("agt_assistant"), { actingFor: "usr_mia" });
  const out = await h.configure(helper, { language: "es" });
  assert.equal(out.language, "es");
  assert.equal((await h.status(w.as(person("usr_mia")), {})).language, "es", "the person's own row changed");
  await assert.rejects(() => connect(helper), (e) => refusal(e).code === "permission.no_grant");
  await assert.rejects(() => spaceConnect(helper), (e) => refusal(e).code === "permission.no_grant");
  await assert.rejects(() => h.session(helper, {}), (e) => refusal(e).code === "permission.no_grant");
  await assert.rejects(() => h.status(w.as(agent("agt_alone")), {}), (e) => refusal(e).code === "auth.unauthenticated");
});

test("an agent asks for a key by posting the card, naming no value, in the chat it is in", async () => {
  const w = world();
  const helper = w.as(agent("agt_assistant"), { actingFor: "usr_mia", thread: "thr_1" });
  await h.askKey(helper, { scope: "space" });
  const post = w.calls.find((c) => c.cap === "chat.post")!.input as { threadId: string; blocks: { type: string; data: unknown }[] };
  assert.equal(post.threadId, "thr_1");
  assert.deepEqual(post.blocks[0], { type: "talk_key", v: 1, data: { provider: "deepgram", scope: "space" } });
  await assert.rejects(() => h.askKey(w.as(agent("agt_assistant"), { actingFor: "usr_mia" }), {}), (e) => refusal(e).code === "validation.precondition_failed");
});

test("choices: an unknown language or model is refused with what there is, off is said plainly, and mayManage follows policy.manage", async () => {
  const w = world({ admins: ["usr_admin"] });
  const mia = w.as(person("usr_mia"));
  await assert.rejects(() => h.configure(mia, { language: "tlh" }), (e) => /Spanish/.test(refusal(e).message ?? ""));
  await assert.rejects(() => h.configure(mia, { model: "gpt-9" }), (e) => /Nova 3/.test(refusal(e).message ?? ""));
  await assert.rejects(() => h.configure(mia, { provider: "elevenlabs" }), (e) => /not known/.test(refusal(e).message ?? ""));
  await h.configure(mia, { on: false });
  assert.equal(await reason(h.session(mia, {})), "off");
  assert.equal((await h.status(mia, {})).mayManage, false);
  assert.equal((await h.status(w.as(person("usr_admin")), {})).mayManage, true);
});

test("a stored key the provider stopped taking marks the Space row failing, and a check that cannot reach the provider changes nothing", async () => {
  const w = world({ admins: ["usr_admin"] });
  const admin = w.as(person("usr_admin"));
  await spaceConnect(admin);
  w.answers.mint = fail("provider.network", "0".repeat(32));
  await assert.rejects(() => h.spaceCheck(admin, {}));
  assert.equal((await h.spaceStatus(admin, {})).state, "ok");
  w.answers.mint = fail("provider.auth_failed", "0".repeat(32));
  assert.equal((await h.spaceCheck(admin, {})).state, "failing");
  w.answers.mint = null;
  assert.equal((await h.spaceCheck(admin, {})).state, "ok");
});
