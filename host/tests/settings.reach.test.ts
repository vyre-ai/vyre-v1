// A Space setting changed through the real settings capability reaches the module that acts on it: the payload settings.set_space emits is the one each module's consumer keeps its copy
// from. Before this, gate_policy, tasks_policy, automations_policy and scheduler_api_policy had no writer, so these settings changed nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { harness as settingsHarness } from "../../modules/settings/fixtures/db.ts";
import { handlers } from "../../modules/settings/impl.ts";
import { harness as gateHarness } from "../../modules/gate/fixtures/db.ts";
import { consumers as gate } from "../../modules/gate/impl.ts";
import { readPolicy as gatePolicy } from "../../modules/gate/projections.ts";
import { harness as tasksHarness } from "../../modules/tasks/fixtures/db.ts";
import { consumers as tasks } from "../../modules/tasks/impl.ts";
import { readPolicy as tasksPolicy } from "../../modules/tasks/projections.ts";
import { harness as autoHarness } from "../../modules/automations/fixtures/db.ts";
import { consumers as automations } from "../../modules/automations/impl.ts";
import { readPolicy as autoPolicy } from "../../modules/automations/projections.ts";
import { harness as schedHarness } from "../../modules/scheduler-api/fixtures/db.ts";
import { consumers as scheduler } from "../../modules/scheduler-api/impl.ts";
import { readPolicy as schedPolicy } from "../../modules/scheduler-api/projections.ts";

async function changed(key: string, value: unknown): Promise<Record<string, unknown>> {
  const h = settingsHarness();
  await handlers["settings.set_space"](h.as("usr_omar", { admin: true }), { key, value });
  const ev = h.events.find((e) => e.name === "settings.changed");
  assert.ok(ev, `${key} was announced`);
  return ev.payload as Record<string, unknown>;
}

test("gate: a change through settings.set_space moves the Gate's timeout", async () => {
  const h = gateHarness();
  await gate["gate.settings_sync"].run({ db: h.db } as never, { payload: await changed("gate.timeout_hours", 6) });
  assert.equal(gatePolicy(h.db).timeoutHours, 6);
});

test("tasks: a change through settings.set_space moves the task rules", async () => {
  const h = tasksHarness();
  await tasks["tasks.settings_sync"].run({ db: h.db } as never, { payload: await changed("tasks.require_human_approver", true) });
  assert.equal(tasksPolicy(h.db).requireHumanApprover, true);
});

test("automations: a change through settings.set_space moves the import rule", async () => {
  const h = autoHarness();
  await automations["automations.settings_sync"].run({ db: h.db } as never, { payload: await changed("automations.run_automations_on_import", true) });
  assert.equal(autoPolicy(h.db).runOnImport, true);
});

test("scheduler: a change through settings.set_space moves the missed window", async () => {
  const h = schedHarness();
  await scheduler["scheduler.settings_sync"].run({ db: h.db } as never, { payload: await changed("scheduler.missed_window_minutes", 5) });
  assert.equal(schedPolicy(h.db).missedWindowMs, 300_000);
});
