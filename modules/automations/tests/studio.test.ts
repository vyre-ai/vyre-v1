// The Studio reads come from runs and definitions. An empty Space answers with zeros and empty lists.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bob, node } from "../fixtures/seed.ts";
import { TEMPLATES } from "../templates.ts";
import { registry } from "../../../generated/registry.ts";
import { structuralIssues } from "../handlers/defs.ts";

const DAY = 86_400_000;
const note = node("note", "records.update", { type: "contact", recordId: "rec_abc", patch: { status: "x" } });

function addRun(h: Harness, automationId: string, status: string, ago: number, over: Record<string, unknown> = {}): string {
  const id = `run_s${h.runs.length + 1}`;
  h.runs.push({ id, kind: "automation", status, owner: "usr_alice", subject: { type: "automation", id: automationId }, startedAt: h.now() - ago, ...over } as never);
  return id;
}

test("analytics is zero and empty before any run", async () => {
  const h = harness();
  const out = await h.call("automations.analytics", {}, alice);
  assert.equal(out.totals.runs, 0);
  assert.equal(out.totals.successRate, null);
  assert.equal(out.totals.medianMs, null);
  assert.deepEqual(out.automations, []);
  assert.equal(out.daily.length, 30);
  assert.ok(out.daily.every((d: { succeeded: number; failed: number }) => d.succeeded === 0 && d.failed === 0));
});

test("analytics counts the runs it can see, by status, day, automation and failing step", async () => {
  const h = harness();
  h.callee("runs.steps", () => ({ steps: [{ step: "note", state: "failed", attempt: 1, error: { code: "provider.network" } }] }));
  const a = (await h.call("automations.create", { name: "Welcome", definition: { triggers: [{ key: "manual" }], nodes: [note] } }, alice)).automation.id as string;
  const b = (await h.call("automations.create", { name: "Digest", definition: { triggers: [{ key: "manual" }], nodes: [note] } }, alice)).automation.id as string;
  addRun(h, a, "succeeded", 1_000, { endedAt: h.now() - 500, costMicros: 40 });
  addRun(h, a, "succeeded", 2_000, { endedAt: h.now() - 1_000, costMicros: 60 });
  addRun(h, a, "failed", DAY + 1_000, { endedAt: h.now() - DAY });
  addRun(h, b, "running", 3_000);
  addRun(h, b, "succeeded", 5 * DAY, { endedAt: h.now() - 5 * DAY + 3_000 });
  addRun(h, "aut_hidden", "failed", 1_000);   // a run of an automation this person cannot see
  const out = await h.call("automations.analytics", {}, alice);
  assert.deepEqual({ ...out.totals }, { runs: 5, succeeded: 3, failed: 1, stopped: 0, active: 1, costMicros: 100, successRate: 0.75, medianMs: 1_000 });
  assert.equal(out.daily.reduce((n: number, d: { succeeded: number; failed: number; other: number }) => n + d.succeeded + d.failed + d.other, 0), 5);
  assert.deepEqual(out.automations.map((x: { name: string; runs: number }) => [x.name, x.runs]), [["Welcome", 3], ["Digest", 2]]);
  assert.deepEqual(out.failures, [{ automationId: a, step: "note", code: "provider.network", count: 1 }]);
  const one = await h.call("automations.analytics", { automationId: b, days: 7 }, alice);
  assert.equal(one.windowDays, 7);
  assert.equal(one.totals.runs, 2);
});

test("analytics for an automation the caller cannot see is not found", async () => {
  const h = harness();
  const a = (await h.call("automations.create", { name: "Mine", definition: { triggers: [{ key: "manual" }], nodes: [note] } }, alice)).automation.id as string;
  await assert.rejects(h.call("automations.analytics", { automationId: a }, bob), (e) => codeOf(e) === "permission.not_found");
});

test("dependencies list what definitions name, who uses it, and what is missing or off", async () => {
  const h = harness({ calls: { "connections.list": () => ({ connections: [{ connectionId: "con_live1" }] }) } });
  const target = (await h.call("automations.create", { name: "Target", definition: { triggers: [{ key: "manual" }], nodes: [note] } }, alice)).automation.id as string;
  await h.call("automations.create", {
    name: "Caller",
    definition: {
      triggers: [{ key: "form_submit", filter: { formId: "frm_intake1" } }],
      nodes: [
        node("sub", "call_automation", { automationId: target }, { next: ["gone", "mail"] }),
        node("gone", "call_automation", { automationId: "aut_missing1" }),
        node("mail", "send_email", { mailboxId: "mbx_main1", to: ["a@b.c"], subject: "Hi", body: "Hi" }, { next: ["req"] }),
        node("req", "connector_request", { connector: "stripe", action: "ping", connectionId: "con_old1" }),
      ],
    },
  }, alice);
  const out = await h.call("automations.dependencies", {}, alice);
  assert.equal(out.automations, 2);
  const by = (kind: string, ref: string) => out.items.find((i: { kind: string; ref: string }) => i.kind === kind && i.ref === ref);
  assert.equal(by("automation", target).problem, "off");
  assert.deepEqual(by("automation", target).usedBy.map((u: { name: string; stepIds: string[] }) => [u.name, u.stepIds]), [["Caller", ["sub"]]]);
  assert.equal(by("automation", "aut_missing1").problem, "missing");
  assert.equal(by("connection", "con_old1").problem, "missing");
  assert.equal(by("mailbox", "mbx_main1").problem, null);
  assert.equal(by("form", "frm_intake1").usedBy[0].stepIds.length, 0);
  assert.equal((await h.call("automations.dependencies", {}, bob)).items.length, 0);
});

test("every template is built from catalogue steps and makes a Personal Draft", async () => {
  const stepKeys = new Set(registry.steps.map((s) => s.key));
  const triggerKeys = new Set(registry.triggers.map((x) => x.key));
  assert.ok(TEMPLATES.length >= 4);
  for (const t of TEMPLATES) {
    assert.ok(t.definition.nodes.every((n) => stepKeys.has(n.key)), `${t.key} uses an unknown step`);
    assert.ok(t.definition.triggers.every((x) => triggerKeys.has(x.key)), `${t.key} uses an unknown trigger`);
    assert.deepEqual(structuralIssues(t.definition).filter((i) => i.severity === "error"), [], `${t.key} is malformed`);
    assert.ok(t.setUp.length > 0);
  }
  const h = harness();
  const listed = await h.call("automations.templates.list", {}, alice);
  assert.deepEqual(listed.templates.map((t: { key: string }) => t.key), TEMPLATES.map((t) => t.key));
  const made = await h.call("automations.templates.use", { templateKey: "approval_before_sending" }, alice);
  assert.equal(made.automation.kind, "personal");
  assert.equal(made.automation.status, "draft");
  assert.equal(made.automation.name, "Approval before sending");
  assert.deepEqual(made.automation.definition.nodes.map((n: { key: string }) => n.key), ["approval", "if", "send_email", "stop"]);
  await assert.rejects(h.call("automations.templates.use", { templateKey: "nope" }, alice), (e) => codeOf(e) === "validation.not_found");
});

test("Ask before sending is accepted on a sending step and refused on one that does not send", async () => {
  const h = harness();
  const send = node("mail", "send_email", { mailboxId: "mbx_main1", to: ["a@b.c"], subject: "Hi", body: "Hi" }, { askBeforeSending: true });
  const ok = await h.call("automations.validate", { definition: { triggers: [{ key: "manual" }], nodes: [send] } }, alice);
  assert.deepEqual(ok.issues.filter((i: { message: string }) => /Ask before sending/.test(i.message)), []);
  const bad = await h.call("automations.validate", { definition: { triggers: [{ key: "manual" }], nodes: [{ ...note, askBeforeSending: false }] } }, alice);
  assert.ok(bad.issues.some((i: { message: string; nodeId?: string }) => /Ask before sending applies only/.test(i.message) && i.nodeId === "note"));
});
