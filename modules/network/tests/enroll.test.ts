// A computer joins the Space: join code, public key, a person's approval, a one-time credential, and revocation. Every answer is checked against the registry's schemas.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { harness, NOW } from "../fixtures/db.ts";
import { handlers } from "../handlers/index.ts";
import { fingerprintOf, nodeByCredential } from "../handlers/enroll.ts";
import { servers } from "../handlers/status.ts";

const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { $defs: Record<string, JsonSchema>; capabilities: { name: string; output: JsonSchema }[] };
const checked = (cap: string, out: unknown): void => { const c = registry.capabilities.find((x) => x.name === cap)!; assert.deepEqual(validate(c.output, out, "", registry.$defs), [], `${cap} answers in its declared shape`); };
const call = (name: string, ctx: unknown, input: unknown): Promise<any> => (handlers as unknown as Record<string, (c: unknown, i: unknown) => Promise<unknown>>)[name]!(ctx, input) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const codeOf = (e: unknown): string => (e instanceof VyreErr ? e.error.code : "other");
const b64 = (b: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)));

async function node() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
  const sign = async (serverId: string, at: number): Promise<string> => b64(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(`vyre-enroll:${serverId}:${at}`)));
  return { publicKey, sign };
}
const facts = { os: "linux", arch: "x64", docker: true, version: "1.0.0" };

test("a join code admits nothing by itself: the computer waits, is approved once, gets one credential, and can be removed", async () => {
  const h = harness();
  const n = await node();
  const made = await call("network.server_join_code", h.ctx, {});
  const asked = await call("network.enroll", h.ctx, { code: made.code, publicKey: n.publicKey, name: "Office Linux box", facts });
  checked("network.enroll", asked);
  assert.equal(asked.state, "pending");
  assert.match(asked.fingerprint, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(asked.fingerprint, await fingerprintOf(n.publicKey), "the computer can print the same eight characters");
  assert.ok(h.events.some((e) => e.name === "network.server_requested"));
  // waiting: listed with its facts, not healthy, no credential
  const row = servers(h.ctx).find((s) => s.serverId === asked.serverId)!;
  assert.deepEqual([row.enrollment, row.state, row.fingerprint, row.facts?.docker], ["pending", "down", asked.fingerprint, true]);
  const poll1 = await call("network.enroll_status", h.ctx, { serverId: asked.serverId, at: NOW, signature: await n.sign(asked.serverId, NOW) });
  checked("network.enroll_status", poll1);
  assert.deepEqual([poll1.state, poll1.credential], ["pending", undefined]);
  // a person approves; the next poll hands over the credential once
  const ok = await call("network.server_approve", h.ctx, { serverId: asked.serverId });
  checked("network.server_approve", ok);
  const poll2 = await call("network.enroll_status", h.ctx, { serverId: asked.serverId, at: NOW + 1, signature: await n.sign(asked.serverId, NOW + 1) });
  assert.equal(poll2.state, "approved"); assert.match(poll2.credential, /^vcc_[0-9a-f]{48}$/);
  assert.deepEqual(await nodeByCredential(h.ctx, poll2.credential), { serverId: asked.serverId });
  assert.equal(await nodeByCredential(h.ctx, "vcc_wrong"), null);
  const stored = JSON.stringify(h.raw.rows("network_server"));
  assert.ok(!stored.includes(poll2.credential), "only its hash is stored");
  // removal ends it at once
  assert.deepEqual(await call("network.server_remove", h.ctx, { serverId: asked.serverId }), { removed: true });
  assert.equal(await nodeByCredential(h.ctx, poll2.credential), null, "the credential no longer works");
  assert.ok(!servers(h.ctx).some((s) => s.serverId === asked.serverId));
});

test("a code works once, expires, and a wrong one is the same refusal as a used one", async () => {
  const h = harness();
  const n = await node();
  const made = await call("network.server_join_code", h.ctx, {});
  await call("network.enroll", h.ctx, { code: made.code, publicKey: n.publicKey, name: "A", facts });
  const again = await node();
  for (const code of [made.code, "VYRE-NOPE-NOPE"]) await assert.rejects(call("network.enroll", h.ctx, { code, publicKey: again.publicKey, name: "B", facts }), (e: unknown) => codeOf(e) === "auth.invalid_code");
  const late = await call("network.server_join_code", h.ctx, {});
  h.raw.run("UPDATE network_join SET expires_at = ? WHERE code = ?", NOW - 1, late.code);
  await assert.rejects(call("network.enroll", h.ctx, { code: late.code, publicKey: again.publicKey, name: "C", facts }), (e: unknown) => codeOf(e) === "auth.invalid_code");
  const fresh = await call("network.server_join_code", h.ctx, {});
  await assert.rejects(call("network.enroll", h.ctx, { code: fresh.code, publicKey: "AAAA", name: "D", facts }), (e: unknown) => codeOf(e) === "validation.bad_input");
});

test("only the computer that holds the key can ask about its row: a wrong, stale or someone else's signature is refused", async () => {
  const h = harness();
  const mine = await node(), other = await node();
  const made = await call("network.server_join_code", h.ctx, {});
  const asked = await call("network.enroll", h.ctx, { code: made.code, publicKey: mine.publicKey, name: "Mine", facts });
  const bad = (input: unknown) => assert.rejects(call("network.enroll_status", h.ctx, input), (e: unknown) => codeOf(e) === "auth.invalid_code");
  await bad({ serverId: asked.serverId, at: NOW, signature: await other.sign(asked.serverId, NOW) });
  await assert.doesNotReject(call("network.enroll_status", h.ctx, { serverId: asked.serverId, at: NOW, signature: await mine.sign(asked.serverId, NOW) }));
  await bad({ serverId: asked.serverId, at: NOW - 6 * 60_000, signature: await mine.sign(asked.serverId, NOW - 6 * 60_000) });
  await bad({ serverId: asked.serverId, at: NOW, signature: await mine.sign("srv_other", NOW) });
  await bad({ serverId: "srv_missing", at: NOW, signature: await mine.sign("srv_missing", NOW) });
});

test("declining ends a waiting computer; approval and decline need a waiting one", async () => {
  const h = harness();
  const n = await node();
  const asked = await call("network.enroll", h.ctx, { code: (await call("network.server_join_code", h.ctx, {})).code, publicKey: n.publicKey, name: "Nope", facts });
  checked("network.server_decline", await call("network.server_decline", h.ctx, { serverId: asked.serverId }));
  assert.ok(!servers(h.ctx).some((s) => s.serverId === asked.serverId), "a declined computer is not listed");
  await assert.rejects(call("network.server_approve", h.ctx, { serverId: asked.serverId }), (e: unknown) => codeOf(e) === "validation.precondition_failed");
  const poll = await call("network.enroll_status", h.ctx, { serverId: asked.serverId, at: NOW, signature: await n.sign(asked.serverId, NOW) });
  assert.deepEqual([poll.state, poll.credential], ["declined", undefined]);
});

test("a personal computer is approved only by the person whose code it used", async () => {
  const h = harness();
  const n = await node();
  const made = await call("network.my_computer_code", h.ctx, {});
  assert.equal(h.raw.rows("network_join").find((r) => r["code"] === made.code)?.["scope"], "personal");
  const asked = await call("network.enroll", h.ctx, { code: made.code, publicKey: n.publicKey, name: "My Mac", facts: { os: "darwin", arch: "arm64", docker: false, version: "1.0.0" } });
  const mineRow = servers(h.ctx).find((s) => s.serverId === asked.serverId)!;
  assert.equal(mineRow.owner, h.ctx.principal.id);
  assert.equal(mineRow.facts?.docker, false, "Docker is optional on a personal computer");
  const stranger = { ...h.ctx, principal: { kind: "person" as const, id: "usr_stranger" } };
  await assert.rejects(call("network.my_computer_approve", stranger, { serverId: asked.serverId }), (e: unknown) => codeOf(e) === "validation.not_found");
  checked("network.my_computer_approve", await call("network.my_computer_approve", h.ctx, { serverId: asked.serverId }));
});

test("two enrolls at once with one code give one waiting computer and one refusal", async () => {
  const h = harness();
  const [a, b] = [await node(), await node()];
  const made = await call("network.server_join_code", h.ctx, {});
  const results = await Promise.allSettled([
    call("network.enroll", h.ctx, { code: made.code, publicKey: a.publicKey, name: "A", facts }),
    call("network.enroll", h.ctx, { code: made.code, publicKey: b.publicKey, name: "B", facts }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(codeOf(lost.reason), "auth.invalid_code");
  assert.equal(servers(h.ctx).filter((s) => s.enrollment === "pending").length, 1, "one pending row");
});

test("a captured signed status request cannot be replayed: each one must be later than the last accepted", async () => {
  const h = harness();
  const n = await node();
  const asked = await call("network.enroll", h.ctx, { code: (await call("network.server_join_code", h.ctx, {})).code, publicKey: n.publicKey, name: "Mac", facts });
  const waiting = { serverId: asked.serverId, at: NOW, signature: await n.sign(asked.serverId, NOW) };
  assert.equal((await call("network.enroll_status", h.ctx, waiting)).state, "pending");
  await call("network.server_approve", h.ctx, { serverId: asked.serverId });
  const refused = (input: unknown) => assert.rejects(call("network.enroll_status", h.ctx, input), (e: unknown) => codeOf(e) === "auth.invalid_code");
  await refused(waiting);   // the waiting poll, captured and replayed right after approval
  await refused({ serverId: asked.serverId, at: NOW - 1, signature: await n.sign(asked.serverId, NOW - 1) });
  const real = await call("network.enroll_status", h.ctx, { serverId: asked.serverId, at: NOW + 1, signature: await n.sign(asked.serverId, NOW + 1) });
  assert.match(real.credential, /^vcc_/);
  await refused({ serverId: asked.serverId, at: NOW + 1, signature: await n.sign(asked.serverId, NOW + 1) });   // and that one, replayed, gets nothing
});

test("a lost approval reply heals itself: a fresh signed request after approval gets a new credential and the old one stops", async () => {
  const h = harness();
  const n = await node();
  const asked = await call("network.enroll", h.ctx, { code: (await call("network.server_join_code", h.ctx, {})).code, publicKey: n.publicKey, name: "Mac", facts });
  await call("network.server_approve", h.ctx, { serverId: asked.serverId });
  const first = await call("network.enroll_status", h.ctx, { serverId: asked.serverId, at: NOW + 1, signature: await n.sign(asked.serverId, NOW + 1) });
  const second = await call("network.enroll_status", h.ctx, { serverId: asked.serverId, at: NOW + 2, signature: await n.sign(asked.serverId, NOW + 2) });
  assert.match(second.credential, /^vcc_/);
  assert.notEqual(second.credential, first.credential);
  assert.equal(await nodeByCredential(h.ctx, first.credential), null, "the old credential no longer works");
  assert.deepEqual(await nodeByCredential(h.ctx, second.credential), { serverId: asked.serverId });
  assert.equal(JSON.stringify(h.raw.rows("network_server")).includes(second.credential), false, "only a hash is stored");
});

test("your own server: a nickname on the code names it, it is listed for you with what it runs on, and you can take it out", async () => {
  const h = harness();
  const n = await node();
  const made = await call("network.my_computer_code", h.ctx, { nickname: "  home-box " });
  assert.match(made.code, /^VYRE-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const asked = await call("network.enroll", h.ctx, { code: made.code, publicKey: n.publicKey, name: "ubuntu-8gb-fsn1", facts });
  const mine = await call("network.my_computers", h.ctx, {});
  assert.deepEqual(mine.computers.map((c: { name: string; enrollment: string; fingerprint: string; facts: { docker: boolean } }) => [c.name, c.enrollment, c.fingerprint, c.facts.docker]), [["home-box", "pending", asked.fingerprint, true]], "the nickname wins over the host name");
  assert.deepEqual(await call("network.my_computer_approve", h.ctx, { serverId: asked.serverId }), { state: "approved" });
  assert.equal((await call("network.my_computers", h.ctx, {})).computers[0].enrollment, "approved");
  const other = { ...h.ctx, principal: { kind: "person", id: "usr_other" } };
  assert.deepEqual((await call("network.my_computers", other, {})).computers, [], "someone else's server is not listed");
  await assert.rejects(() => call("network.my_computer_remove", other, { serverId: asked.serverId }), (e) => codeOf(e) === "validation.not_found");
  assert.deepEqual(await call("network.my_computer_remove", h.ctx, { serverId: asked.serverId }), { removed: true });
  assert.deepEqual((await call("network.my_computers", h.ctx, {})).computers, []);
  assert.equal(await nodeByCredential(h.ctx, "vcc_x"), null);
});
