// What a person reads when an agent's site operation is held: the restore, a scheduled command and a worker each have their own words, and the plain calls behind them are held for an agent (r42-sites-run).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HOLD_PHRASES } from "../../../lib/hold-phrases.ts";
import { holdShort, holdTitle } from "../../../lib/hold-words.ts";

interface Cap {
  name: string;
  gate?: { act?: string; when?: string };
}
const caps = (
  JSON.parse(fs.readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as {
    capabilities: Cap[];
  }
).capabilities;
const gate = (n: string): Cap["gate"] => caps.find((c) => c.name === n)?.gate;

test("a held restore through sites.ops reads as the restore, a held job as a command with the site's keys, a held worker as a worker", () => {
  assert.equal(
    holdShort("sites.ops", { siteId: "sit_a", action: "backup_restore", id: "bkp_a" }),
    "put back a site's database from a backup, replacing what is in it now",
  );
  assert.match(
    holdShort("sites.ops", { siteId: "sit_a", action: "job_create", args: {} }),
    /schedule a command that runs with the site's keys/,
  );
  assert.match(holdShort("sites.ops", { siteId: "sit_a", action: "job_update", id: "job_a" }), /schedule a command/);
  assert.match(
    holdShort("sites.ops", { siteId: "sit_a", action: "worker_add", args: {} }),
    /start a worker that runs with the site's keys/,
  );
  assert.match(holdTitle("sites.ops", { action: "backup_restore" }), /put back a site's database/i);
});

test("every held site-operation call has words in the table", () => {
  for (const n of ["sites.ops", "sites.job_create", "sites.job_update", "sites.service_add", "sites.backup_restore"])
    assert.ok(HOLD_PHRASES[n], n);
});

test("sites.ops holds an agent for exactly the actions that run its code or replace the database, and a person is never held", () => {
  const g = gate("sites.ops");
  assert.equal(g?.act, "delete");
  const w = g?.when ?? "";
  assert.match(w, /^actor\.kind != 'person' and \(/);
  for (const a of ["backup_restore", "job_create", "job_update", "worker_add"])
    assert.ok(w.includes(`input.action == '${a}'`), a);
  for (const a of [
    "logs",
    "metrics",
    "jobs",
    "job_run",
    "job_cancel",
    "worker_restart",
    "backups",
    "backup_create",
    "backup_pin",
  ])
    assert.ok(!w.includes(`'${a}'`), `${a} is not held`);
});

test("the plain calls behind the held actions are held for a non-person too, so no other door runs agent text with the site's keys", () => {
  for (const n of ["sites.job_create", "sites.job_update", "sites.service_add"])
    assert.equal(gate(n)?.when, "actor.kind != 'person'", n);
  assert.equal(gate("sites.backup_restore")?.when, "actor.kind != 'person'");
});
