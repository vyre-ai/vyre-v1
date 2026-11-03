// The HTTP request step on a booted host, its second file: when a send is held or refused. An automation not given the key cannot use its handle; Ask before sending Off or unset
// sends a POST at once; a Space rule holds it anyway; a GET is a read and never held. The first file is automations.http.live.test.ts; both share automations-http-rig.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { boot, dump, keyed, noSecret, ok, postNode, promoted, seededDir, sendOutcome, until } from "./automations-http-rig.ts";
import type { Seen, StepRow } from "./automations-http-rig.ts";

test("an automation that was not given the key cannot use its handle: the request is refused and nothing is sent", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(bootCore), seen);
  try {
    const handle = await keyed(d);
    const id = await promoted(d, "http-nokey", "No key", [{ id: "look", key: "http_request", input: { method: "GET", url: "https://api.example.com/v1/items", auth: { kind: "bearer", handle } } }], false);
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "http-nokey-run" }))["runId"]);
    const failed = await until("the run to fail", 12_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      if (run.status === "succeeded") assert.fail("a run without the key used it");
      return run.status === "failed" ? ((await ok(d, "/v1/runs/steps", { runId }))["steps"] as StepRow[]).find((s) => s.step === "look") : undefined;
    });
    assert.equal(failed.error?.code, "permission.no_grant");
    assert.equal(seen.length, 0);
    noSecret(await dump(d, runId, id), "the failed run");
  } finally { await d.stop(); }
});

test("Ask before sending Off, or unset, sends a POST at once with no hold", async () => {
  for (const [name, ask] of [["off", false], ["unset", undefined]] as const) {
    const seen: Seen[] = [];
    const d = await boot(seededDir(bootCore), seen);
    try {
      const handle = await keyed(d);
      const id = await promoted(d, `http-ask-${name}`, `Ask ${name}`, postNode(handle, ask));
      assert.equal(await sendOutcome(d, id, `http-ask-${name}-run`), "sent");
      assert.equal(seen.length, 1, "sent exactly once");
      assert.equal(seen[0]!.method, "POST");
    } finally { await d.stop(); }
  }
});

test("a Space rule that requires approval for sends holds a POST even when the step is Off", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(bootCore), seen);
  try {
    const handle = await keyed(d);
    const id = await promoted(d, "http-ask-rule", "Ask rule", postNode(handle, false));
    await ok(d, "/v1/gate/rules/set", { act: "send", scope: "space", mode: "hold" });
    assert.equal(await sendOutcome(d, id, "http-ask-rule-run"), "held");
    assert.equal(seen.length, 0, "nothing was sent while the rule held it");
  } finally { await d.stop(); }
});

test("a GET is a read: it is never held, whatever the setting", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(bootCore), seen);
  try {
    const handle = await keyed(d);
    const id = await promoted(d, "http-ask-get", "Ask get", [{ id: "look", key: "http_request", askBeforeSending: true, input: { method: "GET", url: "https://api.example.com/v1/items", auth: { kind: "bearer", handle } } }]);
    assert.equal(await sendOutcome(d, id, "http-ask-get-run"), "sent");
    assert.equal(seen.length, 1);
  } finally { await d.stop(); }
});
