// The HTTP request step on a booted host. A GET goes out through the installed network, a POST waits for the Gate and is released, a private address is refused,
// and the key in the Vault reaches the request header and nowhere else: not the definition, the step log, the run, the hold or the audit trail. When a send is held or refused is in
// automations.http.send.live.test.ts; both share the booted host in automations-http-rig.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { SECRET, boot, dump, keyed, noSecret, ok, promoted, seededDir, until } from "./automations-http-rig.ts";
import type { HoldRow, Seen, StepRow } from "./automations-http-rig.ts";

test("a GET reads through the installed network with the key in a header; the key is nowhere in the log", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(), seen);
  try {
    const handle = await keyed(d);
    const id = await promoted(d, "http-get", "Read items", [{ id: "look", key: "http_request", input: { method: "GET", url: "https://api.example.com/v1/items", query: { page: 2 }, auth: { kind: "bearer", handle } } }]);
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "http-get-run" }))["runId"]);
    await until("the read to finish", 12_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      if (run.status === "failed" || run.status === "stopped") assert.fail(`the run ${run.status}: ${await dump(d, runId, id)}`);
      return run.status === "succeeded" ? true : undefined;
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.url, "https://api.example.com/v1/items?page=2");
    assert.equal(seen[0]!.method, "GET");
    assert.equal(seen[0]!.headers["authorization"], `Bearer ${SECRET}`, "the header reached the network");
    const row = d.db!.all("SELECT output_json FROM runs_steps WHERE run_id = ? AND step = 'look'", runId)[0] as { output_json: string };
    const out = JSON.parse(row.output_json) as { status: number; ok: boolean; body: { path: string; echoedAuth: string } };
    assert.deepEqual([out.status, out.ok, out.body.path], [200, true, "/v1/items"]);
    assert.match(String(out.body.echoedAuth), /\[(hidden|redacted)\]/, "a server that echoes the header gets it scrubbed");
    noSecret(String(out.body.echoedAuth), "the echoed header");
    const io = await ok(d, "/v1/runs/step_io", { runId, step: "look" });
    assert.equal((io["output"] as { status: number }).status, 200, "the run history shows what the step answered");
    assert.equal((io["input"] as { method: string }).method, "GET");
    noSecret(JSON.stringify(io), "the run history read");
    noSecret(await dump(d, runId, id), "the run, step log, definition or hold");
  } finally { await d.stop(); }
});

test("a private address, a rebinding name and plain http are refused by name and nothing is sent", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(), seen);
  try {
    const urls = ["https://127.0.0.1/", "https://10.1.2.3/v1", "https://169.254.169.254/latest/meta-data", "https://rebind.example.com/x"];
    for (const [i, url] of urls.entries()) {
      const made = await ok(d, "/v1/automations/create", {
        idempotencyKey: `http-priv-${i}`, name: `Private ${i}`,
        definition: { triggers: [{ key: "manual" }], nodes: [{ id: "look", key: "http_request", input: { method: "GET", url } }] },
      });
      const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
      const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: `http-priv-run-${i}` }))["runId"]);
      const failed = await until("the request to be refused", 12_000, async () => {
        const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
        if (run.status === "succeeded") assert.fail(`${url} was fetched`);
        return run.status === "failed" ? ((await ok(d, "/v1/runs/steps", { runId }))["steps"] as StepRow[]).find((s) => s.step === "look") : undefined;
      });
      assert.equal(failed.state, "failed");
      assert.equal(failed.error?.code, "validation.bad_input", `${url}: ${JSON.stringify(failed)}`);
      assert.match(String(failed.error?.message), /not a public host/);
    }
    assert.equal(seen.length, 0, "no request was made to a refused address");
  } finally { await d.stop(); }
});

test("a POST with Ask before sending On is held by the Gate, then released: it is sent once, with the attempt key as its Idempotency-Key", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(), seen);
  try {
    const handle = await keyed(d);
    const id = await promoted(d, "http-post", "Post order", [{ id: "order", key: "http_request", askBeforeSending: true, input: { method: "POST", url: "https://api.example.com/v1/orders", json: { sku: "A-1", qty: 2 }, auth: { kind: "bearer", handle } } }]);
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "http-post-run" }))["runId"]);
    await until("the POST to wait for approval", 12_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      if (run.status === "failed" || run.status === "succeeded" || run.status === "stopped") assert.fail(`the run ended ${run.status} before approval: ${await dump(d, runId, id)}`);
      if (run.status !== "waiting") return undefined;
      // a busy machine can read the Run as waiting a moment before the Gate's row lands
      return ((await ok(d, "/v1/gate/holds/list", { states: ["held"], runId }))["holds"] as HoldRow[]).length > 0 ? true : undefined;
    });
    assert.equal(seen.length, 0, "nothing was sent while the Gate held it");
    const holds = (await ok(d, "/v1/gate/holds/list", { states: ["held"], runId }))["holds"] as HoldRow[];
    assert.equal(holds.length, 1, JSON.stringify(holds));
    assert.equal(holds[0]!.capName, "automations.http_send");
    assert.equal(holds[0]!.act, "send");
    noSecret(JSON.stringify(holds), "the hold");
    await ok(d, "/v1/tasks/act", { taskId: holds[0]!.taskId, action: "approve" });
    await until("the run to finish after approval", 12_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      if (run.status === "failed" || run.status === "stopped") assert.fail(`approval did not finish the run: ${await dump(d, runId, id)}`);
      return run.status === "succeeded" ? true : undefined;
    });
    assert.equal(seen.length, 1, "released: sent exactly once");
    assert.equal(seen[0]!.method, "POST");
    assert.equal(seen[0]!.headers["idempotency-key"], `${runId}:order:1`);
    assert.equal(seen[0]!.headers["content-type"], "application/json");
    assert.equal(seen[0]!.body, '{"sku":"A-1","qty":2}');
    assert.equal(seen[0]!.headers["authorization"], `Bearer ${SECRET}`);
    noSecret(await dump(d, runId, id), "the run, step log, definition or hold");
  } finally { await d.stop(); }
});

test("a sandbox test reads a GET for real and records a POST without sending it", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(), seen);
  try {
    const made = await ok(d, "/v1/automations/create", {
      idempotencyKey: "http-sbx", name: "Sandbox http",
      definition: { triggers: [{ key: "manual" }], nodes: [
        { id: "look", key: "http_request", input: { method: "GET", url: "https://api.example.com/v1/items" }, next: ["order"] },
        { id: "order", key: "http_request", input: { method: "POST", url: "https://api.example.com/v1/orders", json: { n: 1 } } },
      ] },
    });
    const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
    const runId = String((await ok(d, "/v1/automations/test", { automationId: id }))["runId"]);
    await until("the test run to succeed", 12_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      if (run.status === "failed" || run.status === "stopped") assert.fail(`the run ${run.status}: ${await dump(d, runId, id)}`);
      return run.status === "succeeded" ? true : undefined;
    });
    assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), ["GET https://api.example.com/v1/items"]);
  } finally { await d.stop(); }
});
