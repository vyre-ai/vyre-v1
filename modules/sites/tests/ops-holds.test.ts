// What a person reads when an agent's site operation is held: the restore, a scheduled command and a worker each have their own words, and the plain calls behind them are held for an agent (r42-sites-run).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HOLD_PHRASES } from "../../../lib/hold-phrases.ts";
import { OUTWARD_ACTS } from "../../../lib/grants.ts";
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
  assert.equal(
    holdShort("sites.ops", { siteId: "sit_a", action: "backup_download", id: "bkp_a" }),
    "download a copy of the site's whole database",
  );
});

test("every held site-operation call has words in the table", () => {
  for (const n of [
    "sites.ops",
    "sites.job_create",
    "sites.job_update",
    "sites.service_add",
    "sites.backup_restore",
    "sites.backup_download",
  ])
    assert.ok(HOLD_PHRASES[n], n);
});

test("sites.ops, and the plain calls behind its held actions, name the key-class Gate conditions (evaluated in modules/gate/tests/sites-ops-holds.test.ts)", () => {
  assert.deepEqual(gate("sites.ops"), { act: "deploy", when: "sites.ops_gate(input)" });
  assert.deepEqual(gate("sites.job_create"), { act: "deploy", when: "sites.run_gate(input)" });
  assert.deepEqual(gate("sites.service_add"), { act: "deploy", when: "sites.run_gate(input)" });
  assert.deepEqual(gate("sites.job_update"), { act: "deploy", when: "sites.run_update_gate(input)" });
  assert.equal(gate("sites.backup_restore")?.when, "actor.kind != 'person'");
  assert.deepEqual(gate("sites.backup_download"), { act: "secret_export", when: "actor.kind != 'person'" });
  // the calls that change no command are not held
  for (const n of [
    "sites.job_run",
    "sites.job_cancel",
    "sites.job_delete",
    "sites.service_restart",
    "sites.service_stop",
    "sites.backup_create",
  ])
    assert.equal(gate(n), undefined, n);
});

test("none of the site-operation holds is under an outward act, so a person's turn grant to email or post can never lift a scheduled command, a worker or a restore", () => {
  for (const n of [
    "sites.ops",
    "sites.job_create",
    "sites.job_update",
    "sites.service_add",
    "sites.backup_restore",
    "sites.backup_download",
  ]) {
    const act = gate(n)?.act;
    assert.ok(act !== undefined && act !== "none", `${n} has a hold`);
    assert.ok(!OUTWARD_ACTS.has(act), `${n}: ${act} is an outward act`);
  }
});
