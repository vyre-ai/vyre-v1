// The Vault channel of an agent computer that lives on a server of the person's: a secret crosses a network link, so it goes only over a private one. The fill endpoint refuses a plain link
// before the Vault is read, a computer on this machine is unaffected, and a server whose link is not private gets no channel at all.
import test from "node:test";
import assert from "node:assert/strict";
import { createFillService } from "../handlers/fill.ts";
import type { FillLookup, FillUse } from "../handlers/fill.ts";
import { awaken } from "../handlers/lifecycle.ts";
import { bindFill, bindRemote, computerBy } from "../projections.ts";
import { asPerson, harness, INTAKE } from "../fixtures/harness.ts";

const rig = () => {
  const looked: string[] = [];
  const uses: FillUse[] = [];
  const found: FillLookup = { kind: "value", itemId: "vit_1", value: "s3cret-value" };
  const service = createFillService({ source: { lookup: async (h) => { looked.push(h); return found; } }, log: (u) => { uses.push(u); }, now: () => 1 });
  return { service, looked, uses };
};
const ask = (token: string, secure: boolean | undefined, computerId = "cmt_1") => ({ authorization: `Bearer ${token}`, body: { handle: "Mail", field: "password", computerId }, ...(secure === undefined ? {} : { secure }) });

test("a computer on a server gets its secret only over a private link; a plain link is refused before the Vault is read, and logged as refused", async () => {
  const { service, looked, uses } = rig();
  const g = await service.issue({ computerId: "cmt_1", agentId: "agt_1", asker: "usr_dana", nodeId: "srv_home" });
  const plain = await service.serve(ask(g.fillToken, false));
  assert.deepEqual([plain.status, plain.body], [403, { code: "insecure_link" }]);
  assert.equal((await service.serve(ask(g.fillToken, undefined))).status, 403, "a request that cannot say its link is private is treated as not");
  assert.deepEqual(looked, [], "nothing was read from the Vault");
  assert.deepEqual(uses.map((u) => u.outcome), ["refused", "refused"]);
  assert.ok(!JSON.stringify(uses).includes("s3cret"), "the log never holds the value");
  const ok = await service.serve(ask(g.fillToken, true));
  assert.deepEqual([ok.status, ok.body], [200, { value: "s3cret-value", itemId: "vit_1" }]);
  assert.deepEqual(looked, ["#Mail.password"]);
});

test("a computer on the Space's own machine is not held to the link rule", async () => {
  const { service } = rig();
  const g = await service.issue({ computerId: "cmt_1", agentId: "agt_1", asker: "usr_dana" });
  assert.equal((await service.serve(ask(g.fillToken, false))).status, 200);
});

test("a call on a computer on a server gets a Vault channel for its person only when the server's link is private", async () => {
  const { leaseFill } = await import("../handlers/tools/common.ts");
  for (const secure of [true, false]) {
    const p = harness({ respond: { "agents.get": (b) => ({ agent: { agentId: b["agentId"], folderId: "fld_intake", ownerId: "usr_dana" } }) } });
    const h = asPerson(p, { kind: "agent", id: INTAKE }, { actingFor: "usr_dana" });
    const issued: Array<{ nodeId?: string; asker: string }> = [];
    bindFill({ issue: async (x) => { issued.push(x); return { fillToken: "t".repeat(48), revoke() {} }; }, url: () => "http://host.docker.internal:8420/computers/fill", nodeSecure: () => secure });
    bindRemote(() => h.fake.host as never);
    const made = await (await import("../handlers/lifecycle.ts")).provision(p.ctx, { agentId: INTAKE, idempotencyKey: `k-${secure}` });
    h.ctx.db.run("UPDATE computers_computers SET node_id = ? WHERE computer_id = ?", "srv_home", made.computer.computerId);
    const row = computerBy(h.ctx.db, made.computer.computerId)!;
    const lease = await leaseFill(h.ctx, row, h.fake.host as never).catch(() => null);
    lease?.done();
    assert.deepEqual(issued.map((x) => [x.nodeId, x.asker]), secure ? [["srv_home", "usr_dana"]] : [], secure ? "a private link gets a channel, marked as a server's, for the person whose call it is" : "a plain link gets none");
    bindFill(null);
    bindRemote(null);
  }
});

test("on a computer that joined the Space the same person's next call reuses the channel within a short time (one node job, not one per call); another person's call ends it at once", async () => {
  const { leaseFill, setFillLinger } = await import("../handlers/tools/common.ts");
  const p = harness({ respond: { "agents.get": (b) => ({ agent: { agentId: b["agentId"], folderId: "fld_intake", ownerId: "usr_dana" } }) } });
  const issued: string[] = [];
  let revoked = 0;
  bindFill({ issue: async (x) => { issued.push(x.asker); return { fillToken: "t".repeat(48), revoke() { revoked++; } }; }, url: () => "http://host.docker.internal:8420/computers/fill", nodeSecure: () => true });
  bindRemote(() => p.fake.host as never);
  setFillLinger(5_000);
  try {
    const made = await (await import("../handlers/lifecycle.ts")).provision(p.ctx, { agentId: INTAKE, idempotencyKey: "k-linger" });
    p.ctx.db.run("UPDATE computers_computers SET node_id = ? WHERE computer_id = ?", "srv_home", made.computer.computerId);
    const row = computerBy(p.ctx.db, made.computer.computerId)!;
    const dana = asPerson(p, { kind: "agent", id: INTAKE }, { actingFor: "usr_dana" });
    const omar = asPerson(p, { kind: "agent", id: INTAKE }, { actingFor: "usr_omar" });
    (await leaseFill(dana.ctx, row, p.fake.host as never))!.done();
    (await leaseFill(dana.ctx, row, p.fake.host as never))!.done();
    assert.deepEqual(issued, ["usr_dana"], "two calls in a row, one channel");
    assert.equal(p.fake.named("configure").length, 1, "one node job");
    (await leaseFill(omar.ctx, row, p.fake.host as never))!.done();
    assert.deepEqual(issued, ["usr_dana", "usr_omar"]);
    assert.equal(revoked, 1, "the first person's lingering channel ended when the second person came");
  } finally { setFillLinger(null); bindFill(null); bindRemote(null); }
});
