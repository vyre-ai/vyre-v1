// Phone access: the three capabilities write the ask and show what the host reported. The host does the claim over its relay link (host/tests/phone.test.ts and test/phone.access.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { harness } from "../fixtures/db.ts";
import { handlers } from "../handlers/index.ts";
import { endpoints } from "../handlers/status.ts";

const call = (name: string, ctx: unknown, input: unknown): Promise<any> => (handlers as unknown as Record<string, (c: unknown, i: unknown) => Promise<unknown>>)[name]!(ctx, input) as Promise<any>;
const codeOf = (e: unknown): string => (e instanceof VyreErr ? e.error.code : "other");
const commands = (h: ReturnType<typeof harness>) => h.ctx.db.all("SELECT kind, target, done_at FROM network_command ORDER BY id") as Array<{ kind: string; target: string; done_at: number | null }>;

test("a person claims a name: it shows as claiming, and the host is asked once", async () => {
  const h = harness();
  assert.deepEqual(await call("network.phone", h.ctx, {}), { state: "none", online: false });
  assert.deepEqual(await call("network.phone_claim", h.ctx, { name: " Alex.vyre.run ", nickname: "  Home laptop " }), { state: "claiming" });
  assert.deepEqual(await call("network.phone", h.ctx, {}), { state: "claiming", name: "alex", nickname: "Home laptop", online: false });
  const open = commands(h).filter((c) => c.kind === "phone_claim");
  assert.equal(open.length, 1);
  assert.deepEqual(JSON.parse(open[0]!.target), { name: "alex", nickname: "Home laptop" });
});

test("only a usable name is accepted", async () => {
  const h = harness();
  for (const bad of ["a", "1alex", "alex--", "al ex", "relay", "names", "x".repeat(40), ""]) {
    await assert.rejects(call("network.phone_claim", h.ctx, { name: bad }), (e) => codeOf(e) === "validation.bad_input", bad);
  }
  assert.equal(commands(h).length, 0);
});

test("the host's outcome is what the person sees: claimed shows the link, failed shows why, online follows the relay link", async () => {
  const h = harness();
  await call("network.phone_claim", h.ctx, { name: "alex" });
  h.ctx.db.run("UPDATE network_phone SET state = 'claimed', box_key = ?, reported_at = ? WHERE id = 1", "k".repeat(43), 1);
  const claimed = await call("network.phone", h.ctx, {});
  assert.deepEqual([claimed.state, claimed.url, claimed.link, claimed.online], ["claimed", "https://alex.vyre.run", `https://alex.vyre.run/#box=${"k".repeat(43)}`, false]);
  h.ctx.db.run("INSERT OR REPLACE INTO network_endpoint (kind, url, state, rtt_ms, heartbeat_at) VALUES ('relay', ?, 'healthy', 40, ?)", "wss://relay.vyre.run/v1/device", h.ctx.now());
  assert.ok(endpoints(h.ctx).some((e) => e.kind === "relay" && e.health === "healthy"));
  assert.equal((await call("network.phone", h.ctx, {})).online, true);
  h.ctx.db.run("UPDATE network_phone SET state = 'failed', detail = ? WHERE id = 1", "That name is taken. Try another.");
  const failed = await call("network.phone", h.ctx, {});
  assert.deepEqual([failed.state, failed.detail, failed.link, failed.url], ["failed", "That name is taken. Try another.", undefined, undefined]);
});

test("a computer with a phone address must release it before taking another, and release is asked of the host", async () => {
  const h = harness();
  await call("network.phone_claim", h.ctx, { name: "alex" });
  h.ctx.db.run("UPDATE network_phone SET state = 'claimed' WHERE id = 1");
  await assert.rejects(call("network.phone_claim", h.ctx, { name: "other" }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.deepEqual(await call("network.phone_claim", h.ctx, { name: "alex", nickname: "Laptop" }), { state: "claiming" }, "the same name again is a retry");
  h.ctx.db.run("UPDATE network_phone SET state = 'claimed' WHERE id = 1");
  assert.deepEqual(await call("network.phone_release", h.ctx, {}), { state: "releasing" });
  assert.ok(commands(h).some((c) => c.kind === "phone_release" && c.target === "alex"));
  assert.equal((await call("network.phone", h.ctx, {})).state, "releasing");
  const none = harness();
  assert.deepEqual(await call("network.phone_release", none.ctx, {}), { state: "none" });
  assert.equal(commands(none).length, 0);
});
