// A Vault item an Automation uses goes to Trash: the next Run fails on that step with a line that names the item, so a person knows which key to bring back, and the line holds no value.
import test from "node:test";
import assert from "node:assert/strict";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { boot, dump, keyed, noSecret, ok, promoted, seededDir, until } from "./automations-http-rig.ts";
import type { Seen, StepRow } from "./automations-http-rig.ts";

test("a Run whose Vault item is in Trash fails with a line that names the item", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(bootCore), seen);
  try {
    const handle = await keyed(d);
    const id = await promoted(d, "missing-key", "Read items", [{ id: "look", key: "http_request", title: "Read items", input: { method: "GET", url: "https://api.example.com/v1/items", auth: { kind: "bearer", handle } } }]);
    const items = (await ok(d, "/v1/vault/items/list", {}))["items"] as { id: string; name?: string }[];
    await ok(d, "/v1/vault/item/delete", { itemId: items.find((i) => i.name === "Acme")!.id });
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "missing-key-run" }))["runId"]);
    await until("the run to fail", 12_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      if (run.status === "succeeded") assert.fail(`the run succeeded without its key: ${await dump(d, runId, id)}`);
      return run.status === "failed" ? true : undefined;
    });
    const steps = (await ok(d, "/v1/runs/steps", { runId }))["steps"] as StepRow[];
    const look = steps.find((s) => s.step === "look");
    assert.equal(look?.state, "failed");
    assert.match(String(look?.error?.message), new RegExp(`${handle.split(".")[0]}\\b`), `the line names the item: ${JSON.stringify(look)}`);
    // the words a person reads did not change when a gone (or hidden) key went from 422 to 404: the same line, now under permission.not_found
    assert.equal(look?.error?.message, `There is no Vault item ${handle.split(".")[0]} that you can use. Check it is still in the Vault, or ask for the key.`, JSON.stringify(look));
    assert.equal(look?.error?.code, "permission.not_found", JSON.stringify(look));
    assert.equal(seen.length, 0, "nothing was sent without the key");
    noSecret(await dump(d, runId, id), "the failed run");
  } finally { await d.stop(); }
});
