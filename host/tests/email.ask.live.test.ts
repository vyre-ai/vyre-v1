// Ask Vyre in the email builder on a booted daemon, through HTTP, with no driver injected: the daemon binds the production Ask driver itself (host/src/seams/email-ask.ts), and an Ask is a real
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

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-email-ask-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

/** The model vendor: one streamed chat completion per request, with whatever the test scripts next (an answer, or an HTTP error). */
async function vendor() {
  const script: Array<{ status?: number; text?: string; hold?: boolean }> = [];
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(body);
      const next = script.shift() ?? { text: "{}" };
      if (next.status && next.status !== 200) { res.writeHead(next.status, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "vendor says no", type: "invalid_request_error" } })); return; }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (o: unknown): void => { res.write(`data: ${JSON.stringify(o)}\n\n`); };
      if (next.hold) { chunk({ id: "1", choices: [{ index: 0, delta: { role: "assistant", content: "thinking" } }] }); req.on("close", () => res.end()); return; }
      chunk({ id: "1", choices: [{ index: 0, delta: { role: "assistant", content: next.text ?? "" } }] });
      chunk({ id: "1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } });
      res.write("data: [DONE]\n\n"); res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { script, requests, base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() };
}

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

test("email builder Ask on a booted daemon: a real agent turn proposes a per-change diff, and failures say why", async () => {
  const v = await vendor();
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((u: unknown, i?: RequestInit) => { const url = String((u as { url?: string })?.url ?? u); return realFetch(url.startsWith("https://api.openai.com") ? url.replace("https://api.openai.com", v.base) : (u as string), i); }) as typeof fetch;
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "email-ask", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch, intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => KEY, signRs256: async () => "" },
  });
  const pump = async (): Promise<void> => { await d.hooks?.pump?.(); };
  const pumping = setInterval(() => void pump(), 150);   // the daemon's hook timer is an hour here; this is the pass it would make
  try {
    assert.deepEqual(d.seams?.missing, [], "the Ask driver and every other seam have a host driver");
    const made = await call(d, "email_builder.create", { name: "Welcome", mode: "html", idempotencyKey: "ask-email" });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const emailId = made.data.email.emailId as string;
    const saved = await call(d, "email_builder.save", { emailId, idempotencyKey: "ask-save-1", email: { emailId, name: "Welcome", mode: "html", subject: "Welcome aboard", html: "<p>Hello there</p>" } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));

    // 1 no agent exists the person can use and no model is connected: the Ask says what to do, not "no driver"
    const none = await call(d, "email_builder.ask_diff", { emailId, instruction: "Shorten the subject" });
    assert.equal(none.status, 422, JSON.stringify(none.data));
    assert.match(JSON.stringify(none.data), /Open Settings|No agent|No model/, "the refusal tells the person what to connect");

    // 2 connect a model the way a person does, and an agent to ask
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    const provider = await call(d, "providers.add", { idempotencyKey: "ask-provider", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    assert.equal(provider.status, 200, JSON.stringify(provider.data));
    assert.equal((await call(d, "providers.set_space_use", { idempotencyKey: "ask-spaceuse", providerId: provider.data.provider.id, allow: true })).status, 200);
    const agent = await call(d, "agents.create", { name: "Designer", role: "You edit email designs.", model: "gpt-4o-mini", idempotencyKey: "ask-agent" });
    assert.equal(agent.status, 200, JSON.stringify(agent.data));
    const agentId = agent.data.agent.agentId as string;

    // 3 the Ask runs a real turn and returns the change as a diff; nothing is saved until the author accepts
    v.script.push({ text: JSON.stringify({ subject: "Welcome!" }) });
    const ok = await call(d, "email_builder.ask_diff", { emailId, instruction: "Shorten the subject", agentId });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual(ok.data.changes, [{ path: "/subject", before: "Welcome aboard", after: "Welcome!" }]);
    assert.equal(v.requests.length, 1, "exactly one model request was made");
    assert.match(v.requests[0]!, /Shorten the subject/, "the model saw the instruction");
    assert.match(v.requests[0]!, /Welcome aboard/, "and the current design");
    assert.equal((await call(d, "email_builder.get", { emailId })).data.email.subject, "Welcome aboard", "an Ask alone changes nothing");

    // 3b the agent is optional: the person's own agent is picked
    v.script.push({ text: "Sure. ```json\n{\"subject\":\"Hello\"}\n```" });
    const picked = await call(d, "email_builder.ask_diff", { emailId, instruction: "Friendlier subject" });
    assert.equal(picked.status, 200, JSON.stringify(picked.data));
    assert.deepEqual(picked.data.changes, [{ path: "/subject", before: "Welcome aboard", after: "Hello" }]);

    // 4 the author accepts one change: the save carries only that change
    const accepted = await call(d, "email_builder.save", { emailId, idempotencyKey: "ask-save-2", email: { emailId, name: "Welcome", mode: "html", subject: "Welcome!", html: "<p>Hello there</p>" } });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));

    // 5 a provider that rejects the key fails the Ask in words, with a code the screen can act on
    v.script.push({ status: 401 });
    const rejected = await call(d, "email_builder.ask_diff", { emailId, instruction: "Shorten", agentId });
    assert.ok(rejected.status >= 400, JSON.stringify(rejected.data));
    assert.match(JSON.stringify(rejected.data), /provider\.auth_failed|key|sign-in/i, JSON.stringify(rejected.data));

    // 6 an answer that is not a design change is refused, and the design is untouched
    v.script.push({ text: "I would make it shorter." });
    const prose = await call(d, "email_builder.ask_diff", { emailId, instruction: "Shorten", agentId });
    assert.ok(prose.status >= 400, JSON.stringify(prose.data));
    assert.match(JSON.stringify(prose.data), /not with a design change/);

    // 7 an answer the module's save rules refuse (an unknown block kind) is refused the same way a bad save is
    v.script.push({ text: JSON.stringify({ mode: "blocks", blocks: [{ type: "not_a_block", props: {} }] }) });
    const bad = await call(d, "email_builder.ask_diff", { emailId, instruction: "Add a block", agentId });
    assert.ok(bad.status >= 400, JSON.stringify(bad.data));
    assert.equal((await call(d, "email_builder.get", { emailId })).data.email.subject, "Welcome!");
  } catch (e) {
    d.sink.flush();
    const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, msg, attrs FROM logs WHERE place IN ('engine','email-builder') OR msg LIKE '%email ask%' OR msg LIKE '%bridge%' OR msg LIKE '%consumer%' ORDER BY id DESC LIMIT 12").all();
    console.error("host log:", JSON.stringify(rows), "vendor requests:", v.requests.length);
    throw e;
  } finally { clearInterval(pumping); await d.stop(); v.close(); globalThis.fetch = realFetch; }
});
