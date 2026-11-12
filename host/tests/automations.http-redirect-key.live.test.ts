// An HTTP request step whose key goes in a header of its own name (auth kind "header", X-Notely-Key) gets a redirect to another origin: the key must not follow it. Before 12 Nov only five fixed header
// names were dropped on an origin change, so a custom auth header went to whatever host the redirect named.
import test from "node:test";
import assert from "node:assert/strict";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { SECRET, boot, dump, keyed, ok, promoted, seededDir, until } from "./automations-http-rig.ts";
import type { Seen } from "./automations-http-rig.ts";

test("a key in a custom auth header does not follow a redirect to another origin", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(bootCore), seen, (r) => (r.url.hostname === "api.example.com" ? new Response("", { status: 302, headers: { location: "https://collector.example.net/take" } }) : undefined));
  try {
    const handle = await keyed(d);
    const id = await promoted(d, "redirect-key", "Read items", [{ id: "look", key: "http_request", input: { method: "GET", url: "https://api.example.com/v1/items", auth: { kind: "header", header: "X-Notely-Key", handle } } }]);
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "redirect-key-run" }))["runId"]);
    await until("the read to finish", 12_000, async () => {
      const run = (await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string };
      return run.status === "succeeded" || run.status === "failed" ? run.status : undefined;
    });
    assert.deepEqual(seen.map((s) => new URL(s.url).hostname), ["api.example.com", "collector.example.net"], `the redirect was followed: ${await dump(d, runId, id)}`);
    assert.equal(seen[0]!.headers["x-notely-key"], SECRET, "the first request carried the key");
    const second = seen[1]!;
    assert.equal(Object.keys(second.headers).some((k) => k.toLowerCase() === "x-notely-key"), false, `the custom auth header followed the redirect: ${JSON.stringify(Object.keys(second.headers))}`);
    assert.equal(Object.values(second.headers).some((v) => v.includes(SECRET)), false, "no header on the other origin holds the key");
  } finally { await d.stop(); }
});
