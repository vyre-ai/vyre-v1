// Ask Vyre on a form's source on a booted daemon, through HTTP, with no driver injected: the daemon binds the production Ask driver itself (host/src/seams/email-ask.ts, the same driver as the email builder), and an Ask is a real
// agent turn (chat, agents, engine, the OpenAI API driver, the Vault key, spend) run as the person asking. The only thing simulated is the model vendor: requests to api.openai.com are sent to a
// local server that streams a chat completion, so the proof covers everything from the HTTP call to the diff. The failure cases are real too: no agent model connected, a provider that rejects
// the key, a bad answer, and a stopped Ask.
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { vendor } from "../../fixtures/model-vendor.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-forms-ask-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

test("form Ask on a booted daemon: a real agent turn proposes a per-field source diff, and failures say why", async () => {
  const v = await vendor();
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((u: unknown, i?: RequestInit) => { const url = String((u as { url?: string })?.url ?? u); return realFetch(url.startsWith("https://api.openai.com") ? url.replace("https://api.openai.com", v.base) : (u as string), i); }) as typeof fetch;
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "forms-ask", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch, intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const pumping = setInterval(() => void d.hooks?.pump?.(), 150);
  try {
    assert.deepEqual(d.seams?.missing, [], "the form Ask driver and every other seam have a host driver");
    const made = await call(d, "forms.create", { name: "Ask me", recordType: "contact", kind: "public", idempotencyKey: "fa-form" });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const formId = made.data.form.formId as string;
    const fields = await call(d, "forms.fields_set", { formId, fields: [{ field: "email", mode: "ask" }, { field: "name", mode: "ask" }] });
    assert.equal(fields.status, 200, JSON.stringify(fields.data));
    const HTML = '<vyre-field name="email"></vyre-field>';
    assert.equal((await call(d, "forms.design_set", { formId, html: HTML, css: ".a{color:red}" })).status, 200);

    // 1 no agent and no model: the Ask says what to connect
    const none = await call(d, "forms.ask_diff", { formId, instruction: "Add a heading" });
    assert.equal(none.status, 422, JSON.stringify(none.data));
    assert.match(JSON.stringify(none.data), /Open Settings|No agent|No model/);

    // 2 a model and an agent, connected as a person does
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const provider = await call(d, "providers.add", { idempotencyKey: "fa-provider", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    assert.equal(provider.status, 200, JSON.stringify(provider.data));
    assert.equal((await call(d, "providers.set_space_use", { idempotencyKey: "fa-spaceuse", providerId: provider.data.provider.id, allow: true })).status, 200);
    const agent = await call(d, "agents.create", { name: "Builder", role: "You edit forms.", model: "gpt-4o-mini", idempotencyKey: "fa-agent" });
    assert.equal(agent.status, 200, JSON.stringify(agent.data));
    const agentId = agent.data.agent.agentId as string;

    // 3 a real turn: the model saw the instruction, the current source and the questions; the proposal is a per-field diff and nothing is saved
    v.script.push({ text: JSON.stringify({ html: '<h1>Get in touch</h1>\n<vyre-field name="email"></vyre-field>\n<vyre-field name="name"></vyre-field>' }) });
    const ok = await call(d, "forms.ask_diff", { formId, instruction: "Add a heading and place the name", agentId });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual(ok.data.changes, [{ path: "/html", before: HTML, after: '<h1>Get in touch</h1>\n<vyre-field name="email"></vyre-field>\n<vyre-field name="name"></vyre-field>' }]);
    assert.equal(v.requests.length, 1);
    assert.match(v.requests[0]!, /Add a heading and place the name/); assert.match(v.requests[0]!, /vyre-field/); assert.match(v.requests[0]!, /questions/);
    assert.equal((await call(d, "forms.get", { formId })).data.html, HTML, "asking saves nothing");

    // 4 the agent is optional
    v.script.push({ text: "```json\n{\"css\":\".a{color:blue}\"}\n```" });
    const picked = await call(d, "forms.ask_diff", { formId, instruction: "Make it blue" });
    assert.equal(picked.status, 200, JSON.stringify(picked.data));
    assert.deepEqual(picked.data.changes, [{ path: "/css", before: ".a{color:red}", after: ".a{color:blue}" }]);

    // 5 an unsafe proposal is refused as the agent's; a prose answer and a vendor failure say why
    v.script.push({ text: JSON.stringify({ html: "<script>alert(1)</script>" }) });
    const unsafe = await call(d, "forms.ask_diff", { formId, instruction: "Add a script", agentId });
    assert.equal(unsafe.status, 422, JSON.stringify(unsafe.data));
    assert.match(JSON.stringify(unsafe.data), /The agent's HTML is not valid/);
    v.script.push({ text: "I would add a heading." });
    assert.match(JSON.stringify((await call(d, "forms.ask_diff", { formId, instruction: "x", agentId })).data), /not with a design change/);
    v.script.push({ status: 401 });
    const rejected = await call(d, "forms.ask_diff", { formId, instruction: "x", agentId });
    assert.ok(rejected.status >= 400); assert.match(JSON.stringify(rejected.data), /provider\.auth_failed|key|sign-in/i);

    // 6 Cancel while the model is still thinking
    v.script.push({ hold: true });
    const before = v.requests.length;
    const pending = call(d, "forms.ask_diff", { formId, instruction: "Rewrite everything", agentId });
    const started = Date.now();
    while (v.requests.length === before) { if (Date.now() - started > 20_000) throw new Error("the model request never started"); await new Promise((r) => setTimeout(r, 50)); }
    const cancel = await call(d, "forms.ask_cancel", { formId });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.data)); assert.equal(cancel.data.cancelled, 1);
    const stopped = await pending;
    assert.ok(stopped.status >= 400 && /cancelled/i.test(JSON.stringify(stopped.data)), JSON.stringify(stopped.data));
    assert.equal((await call(d, "forms.ask_cancel", { formId })).data.cancelled, 0);
    assert.equal((await call(d, "forms.get", { formId })).data.html, HTML, "nothing was ever saved by an Ask");
  } finally { clearInterval(pumping); await d.stop(); v.close(); globalThis.fetch = realFetch; }
});
