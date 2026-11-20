// An agent's scheduled command or worker runs with the site's production keys, so every door that makes one is held for an agent when the site stores Vault keys, and only then (r42-sites-run).
// The real Gate conditions (host/src/daemon/gate-hook.ts moduleWhens) over a real SQLite with the sites migrations and the real siteFacts: an agent is held, a person goes through, a site with no Vault row goes through.
// @reads ../../sites/migrations/0001_sites_core.sql
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { moduleWhens } from "../../../host/src/daemon/gate-hook.ts";
import { siteFacts } from "../../sites/impl.ts";
import type { CtxSeed } from "../../../host/src/invoke.ts";

function world() {
  const raw = new DatabaseSync(":memory:");
  const dir = new URL("../../sites/migrations/", import.meta.url);
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) raw.exec(fs.readFileSync(new URL(f, dir), "utf8"));
  const db = {
    all: (q: string, ...a: unknown[]) => raw.prepare(q).all(...(a as never[])),
    run: (q: string, ...a: unknown[]) => ({ changes: Number(raw.prepare(q).run(...(a as never[])).changes) }),
  };
  const site = (id: string): void =>
    void db.run("INSERT INTO sites_site (id, name, kind, owner, state, service_principal, created_at, updated_at) VALUES (?, 'S', 'app', 'usr_1', 'ready', 'svc_1', 1, 1)", id);
  site("sit_keys");
  site("sit_plain");
  site("sit_none");
  db.run("INSERT INTO sites_env (site_id, name, vault_handle, injected) VALUES ('sit_keys', 'STRIPE_KEY', '#Stripe.key', 0)");
  db.run("INSERT INTO sites_env (site_id, name, vault_handle, injected, plain) VALUES ('sit_plain', 'MODE', '', 0, 'calm')");
  const when = moduleWhens(new Map([["sites", { siteFacts }]]), () => db as never, async () => null) as Record<string, (input: unknown, seed: CtxSeed) => boolean | Promise<boolean>>;
  const agent = { principal: { kind: "agent", id: "agt_1" } } as unknown as CtxSeed;
  const person = { principal: { kind: "person", id: "usr_1" } } as unknown as CtxSeed;
  return { when, agent, person };
}

const OPS = (siteId: string, action: string, args: Record<string, unknown> = {}) => ({ siteId, action, args });

test("sites.job_create and sites.service_add (plain calls): an agent is held on a site with Vault keys, a person and a site with none go through", async () => {
  const w = world();
  for (const gate of ["sites.run_gate"]) {
    const input = (id: string) => ({ siteId: id, name: "x", command: "node a.js", schedule: "@daily" });
    assert.equal(await w.when[gate]!(input("sit_keys"), w.agent), true, "agent, keys");
    assert.equal(await w.when[gate]!(input("sit_keys"), w.person), false, "person");
    assert.equal(await w.when[gate]!(input("sit_none"), w.agent), false, "no env rows");
    assert.equal(await w.when[gate]!(input("sit_plain"), w.agent), false, "plain values are no key");
    assert.equal(await w.when[gate]!(input("sit_missing"), w.agent), true, "a site that cannot be read holds");
  }
});

test("sites.job_update (plain): held only when the command changes", async () => {
  const w = world();
  const g = w.when["sites.run_update_gate"]!;
  assert.equal(await g({ siteId: "sit_keys", jobId: "job_a", command: "node b.js" }, w.agent), true);
  assert.equal(await g({ siteId: "sit_keys", jobId: "job_a", enabled: false }, w.agent), false, "pausing changes no command");
  assert.equal(await g({ siteId: "sit_keys", jobId: "job_a", name: "Renamed" }, w.agent), false);
  assert.equal(await g({ siteId: "sit_keys", jobId: "job_a", command: "node b.js" }, w.person), false);
  assert.equal(await g({ siteId: "sit_none", jobId: "job_a", command: "node b.js" }, w.agent), false);
});

test("sites.ops: job_create, worker_add and a job_update that changes the command are held for an agent on a site with keys; a person, a site with no keys, and every other action go through", async () => {
  const w = world();
  const g = w.when["sites.ops_gate"]!;
  for (const a of [OPS("sit_keys", "job_create", { name: "x", command: "node a.js", schedule: "@daily" }), OPS("sit_keys", "worker_add", { name: "q", command: "node w.js" }), OPS("sit_keys", "job_update", { command: "node b.js" })]) {
    assert.equal(await g(a, w.agent), true, `${a.action} agent, keys`);
    assert.equal(await g(a, w.person), false, `${a.action} person`);
    assert.equal(await g({ ...a, siteId: "sit_none" }, w.agent), false, `${a.action} no keys`);
    assert.equal(await g({ ...a, siteId: "sit_plain" }, w.agent), false, `${a.action} plain only`);
  }
  for (const a of ["logs", "metrics", "jobs", "job_run", "job_cancel", "job_runs", "job_delete", "worker_restart", "worker_stop", "worker_remove", "backups", "backup_create", "backup_pin", "backup_download", "backup_delete"])
    assert.equal(await g(OPS("sit_keys", a), w.agent), false, `${a} is not held`);
  assert.equal(await g(OPS("sit_keys", "job_update", { enabled: false }), w.agent), false, "pausing a job changes no command");
});

test("sites.ops backup_restore replaces the live database: held for any agent, whether or not the site stores keys; a person goes through", async () => {
  const w = world();
  const g = w.when["sites.ops_gate"]!;
  for (const id of ["sit_keys", "sit_none", "sit_plain"]) assert.equal(await g(OPS(id, "backup_restore"), w.agent), true, id);
  assert.equal(await g(OPS("sit_keys", "backup_restore"), w.person), false);
});
