// The computers of one Personal Space (lane l-multidevice): the list Settings shows, and the person's answer to a new computer that asks to use the Space. The host writes the rows
// (test/peers.enrol.live.test.mjs runs the whole join on two booted daemons); here each handler is checked against the registry's schemas with rows the host would write.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { harness, NOW } from "../fixtures/db.ts";
import { handlers } from "../handlers/index.ts";
import { PEER_AWAKE_MS } from "../handlers/peers.ts";

const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { $defs: Record<string, JsonSchema>; capabilities: { name: string; output: JsonSchema }[] };
const checked = (cap: string, out: unknown): void => { const c = registry.capabilities.find((x) => x.name === cap)!; assert.deepEqual(validate(c.output, out, "", registry.$defs), [], `${cap} answers in its declared shape`); };
const call = (name: string, ctx: unknown, input: unknown): Promise<any> => (handlers as unknown as Record<string, (c: unknown, i: unknown) => Promise<unknown>>)[name]!(ctx, input) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const codeOf = (e: unknown): string => (e instanceof VyreErr ? e.error.code : "other");

function space() {
  const h = harness();
  h.raw.run("INSERT INTO network_peer (id, name, platform, kind, route, relay, token_hash, added_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", "peer_a", "Office iMac", "darwin", "computer", "a".repeat(26), "wss://relay.vyre.run", "h1", NOW - 10_000, NOW - 10_000);
  h.raw.run("INSERT INTO network_peer (id, name, platform, kind, route, relay, token_hash, added_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", "peer_b", "Home laptop", "darwin", "computer", "b".repeat(26), "wss://relay.vyre.run", "h2", NOW - 5_000, NOW - PEER_AWAKE_MS - 1);
  h.raw.run("INSERT INTO network_peer_self (id, peer_id, waiting, synced_at) VALUES (?, ?, ?, ?)", 1, "peer_a", 3, NOW - 4_000);
  return h;
}
const request = (h: ReturnType<typeof harness>, id: string, expires = NOW + 60_000) =>
  h.raw.run("INSERT INTO network_peer_request (id, name, platform, code, poll_hash, ask_hash, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, "Travel laptop", "win32", "418 207", "p", "a", "pending", NOW, expires);

test("the list names this computer and says which others are awake and when each was last seen", async () => {
  const h = space();
  const out = await call("network.peers", h.ctx, {});
  checked("network.peers", out);
  assert.deepEqual([out.waiting, out.syncedAt], [3, NOW - 4_000], "the changes this computer still has to hand over, and when it last reached another");
  assert.deepEqual(out.computers.map((c: { name: string; self: boolean; online: boolean }) => [c.name, c.self, c.online]), [["Office iMac", true, true], ["Home laptop", false, false]]);
  assert.equal(out.computers[1].lastSeenAt, NOW - PEER_AWAKE_MS - 1);
});

test("a waiting computer is listed with its code until the person allows or declines it, and only once", async () => {
  const h = space();
  request(h, "preq_1");
  request(h, "preq_old", NOW - 1);
  const listed = await call("network.peer_requests", h.ctx, {});
  checked("network.peer_requests", listed);
  assert.deepEqual(listed.requests.map((r: { requestId: string; code: string }) => [r.requestId, r.code]), [["preq_1", "418 207"]], "an expired request is not offered");
  const ok = await call("network.peer_allow", h.ctx, { requestId: "preq_1" });
  checked("network.peer_allow", ok);
  assert.equal(h.raw.rows("network_peer_request").find((r) => r["id"] === "preq_1")!["state"], "allowed");
  await assert.rejects(call("network.peer_decline", h.ctx, { requestId: "preq_1" }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(call("network.peer_allow", h.ctx, { requestId: "preq_old" }), (e) => codeOf(e) === "validation.precondition_failed");
  await assert.rejects(call("network.peer_allow", h.ctx, { requestId: "preq_none" }), (e) => codeOf(e) === "validation.not_found");
  request(h, "preq_2");
  const no = await call("network.peer_decline", h.ctx, { requestId: "preq_2" });
  checked("network.peer_decline", no);
  assert.equal((await call("network.peer_requests", h.ctx, {})).requests.length, 0);
});

test("removing a computer ends its token, and this computer cannot remove itself", async () => {
  const h = space();
  await assert.rejects(call("network.peer_remove", h.ctx, { peerId: "peer_a" }), (e) => codeOf(e) === "validation.precondition_failed");
  const out = await call("network.peer_remove", h.ctx, { peerId: "peer_b" });
  checked("network.peer_remove", out);
  assert.equal(out.removed, true);
  const b = h.raw.rows("network_peer").find((r) => r["id"] === "peer_b")!;
  assert.equal(b["token_hash"], null);
  assert.deepEqual((await call("network.peers", h.ctx, {})).computers.map((c: { name: string }) => c.name), ["Office iMac"]);
  assert.equal((await call("network.peer_remove", h.ctx, { peerId: "peer_b" })).removed, false);
});
