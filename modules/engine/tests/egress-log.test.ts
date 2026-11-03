// The Space's internet setting as the wall's rule (wallEgress, the one builder the Windows sandbox uses too), the record of where an engine went, a refusal as an audit row, and a turn's details:
// the hosts it reached and what it was refused, for the person and thread of the turn while it ran.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_EGRESS_POLICY, ENGINE_EGRESS_HOSTS, egressPolicyOf, wallEgress, wallEgressOfRule } from "../sandbox-default.ts";
import { egressOfTurn, recordEgress } from "../egress-log.ts";
import { spaceRule } from "../runtime.ts";
import { withRule } from "../session.ts";
import { RULE_ENV, ruleFromEnv } from "../../../sandbox/src/index.ts";

const sql = () => {
  const db = new DatabaseSync(":memory:");
  return { all: (q: string, ...a: unknown[]) => db.prepare(q).all(...(a as never[])) as unknown[], run: (q: string, ...a: unknown[]) => ({ changes: Number(db.prepare(q).run(...(a as never[])).changes) }) };
};

test("wallEgress: public is the default and opens every public host; providers is the old list; a list adds its hosts to the providers; the result is plain JSON", () => {
  assert.deepEqual(DEFAULT_EGRESS_POLICY, { mode: "public", hosts: [] });
  assert.deepEqual(wallEgress().rule, { egress: "public" });
  assert.deepEqual(wallEgress({ mode: "providers", hosts: ["github.com"] }).rule, { egress: "list", allow: [...ENGINE_EGRESS_HOSTS] });
  const list = wallEgress({ mode: "list", hosts: ["github.com", "*.npmjs.org", "*", "10.0.0.1"] });
  assert.deepEqual(list.rule, { egress: "list", allow: [...ENGINE_EGRESS_HOSTS, "github.com", "*.npmjs.org"] }, "what is not a host name is dropped, the providers stay");
  for (const p of [wallEgress(), list]) assert.deepEqual(JSON.parse(JSON.stringify(p)), p, "survives a trip into the WSL VM");
  assert.deepEqual(egressPolicyOf(undefined), DEFAULT_EGRESS_POLICY);
  assert.deepEqual(egressPolicyOf({ mode: "everything" }), DEFAULT_EGRESS_POLICY);
  assert.deepEqual(wallEgressOfRule({ egress: "list", allow: ["github.com"] }), { allow: ["github.com"], rule: { egress: "list", allow: ["github.com"] } });
});

test("spaceRule reads the setting each time; withRule sets the rule last, over anything filled before it", async () => {
  let value: unknown = { mode: "providers", hosts: [] };
  const call = async (cap: string, input: unknown) => { assert.equal(cap, "settings.get"); assert.deepEqual(input, { key: "engine.egress" }); return { row: { value } }; };
  assert.equal((await spaceRule(call)).egress, "list");
  value = { mode: "public", hosts: [] };
  assert.deepEqual(await spaceRule(call), { egress: "public" }, "a change applies to the next read, no restart");
  const spec = withRule({ argv: ["claude"], env: { [RULE_ENV]: JSON.stringify({ egress: "public" }), KEY: "k" } }, { egress: "list", allow: ["api.anthropic.com"] });
  assert.deepEqual(ruleFromEnv(spec.env[RULE_ENV]), { egress: "list", allow: ["api.anthropic.com"] });
  assert.equal(spec.env["KEY"], "k");
});

test("the record: a turn's details show the hosts reached while it ran and its refusals; a refusal is an audit row of class deny for the person", async () => {
  const db = sql();
  const audits: unknown[] = [];
  const call = async (cap: string, input: unknown) => { if (cap === "audit.append") audits.push(input); return { auditId: "aud_1" }; };
  let now = 1000;
  const where = { person: "usr_dana", threadId: "thr_1" };
  recordEgress(db, call, where, { verdict: "allow", host: "github.com", port: 443, reason: "ok" }, () => now);
  recordEgress(db, call, where, { verdict: "allow", host: "registry.npmjs.org", port: 443, reason: "ok" }, () => (now = 1100));
  recordEgress(db, call, where, { verdict: "deny", host: "169.254.169.254", port: 80, reason: "private_address" }, () => (now = 1200));
  recordEgress(db, call, where, { verdict: "deny", host: "slow.example.com", port: 443, reason: "unreachable" }, () => (now = 1250));
  recordEgress(db, call, { person: "usr_ravi", threadId: "thr_1" }, { verdict: "allow", host: "ravi.example.com", port: 443, reason: "ok" }, () => 1150);
  recordEgress(db, call, where, { verdict: "allow", host: "later.example.com", port: 443, reason: "ok" }, () => 5000);
  await new Promise((r) => setImmediate(r));
  const t = egressOfTurn(db, { threadId: "thr_1", person: "usr_dana", from: 900, to: 2000 });
  assert.deepEqual(t.reached, ["github.com", "registry.npmjs.org"]);
  assert.deepEqual(t.refused, [{ host: "169.254.169.254", port: 80, reason: "private_address" }], "a host that did not answer was not refused by the policy");
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], { action: "engine.egress_denied", class: "deny", resource: { type: "thread", id: "thr_1" }, onBehalfOf: { kind: "person", id: "usr_dana" }, detail: { host: "169.254.169.254", port: 80, reason: "private_address", why: "it points to a private or local address" } });
});

test("engineAccessFor: the person's own computer gets their added folders; a Team Space server, or someone else's computer hosting the Space, gets the server rules", async () => {
  const { engineAccessFor } = await import("../runtime.ts");
  const call = (space: unknown) => async (cap: string, input: unknown) => {
    if (cap === "spaces.get") return { space };
    if (cap === "mounts.engine_folders") { assert.deepEqual(input, { person: "usr_dana" }); return { folders: [{ path: "/Users/dana/code" }, { path: 3 }] }; }
    throw new Error(cap);
  };
  assert.deepEqual(await engineAccessFor(call({ kind: "personal", owner: "usr_dana", address: { mode: "device" } }), "usr_dana"), { where: "own", folders: ["/Users/dana/code"] });
  assert.deepEqual(await engineAccessFor(call({ kind: "team", owner: "usr_dana", address: { mode: "device" } }), "usr_dana"), { where: "own", folders: ["/Users/dana/code"] }, "a Team Space on the owner's own computer");
  assert.deepEqual(await engineAccessFor(call({ kind: "team", owner: "usr_dana", address: { mode: "device" } }), "usr_ravi"), { where: "server", folders: [] }, "a member's turn on the owner's computer is not on their own computer");
  assert.deepEqual(await engineAccessFor(call({ kind: "team", owner: "usr_dana", address: { mode: "relay" } }), "usr_dana"), { where: "server", folders: [] });
});
