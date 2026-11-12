// The AI step on a booted host. The daemon, the engine, the OpenAI API driver and the Vault are real; only the model vendor is a local stand-in (fixtures/model-vendor.ts).
// A Personal automation answers on its owner's own key, a Space automation on a Space-shared key, an output schema is enforced, a reviewer holds the answer, and the key is nowhere but the vendor request.
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { vendor } from "../../fixtures/model-vendor.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
// the Vault's key check asks the stand-in vendor for real, as it asks a real provider: a Space account then lists the models it serves (the runner's "accept" check lists none)
delete process.env["VYRE_TEST_KEY_CHECK"];
const KEY = "sk-test-aistep-0123456789abcdef"; // secret-scan: fake
/** An agent with a model, as a person sets one up: an AI step runs on its agent's model (a step with no model runs on the key's default: modules/engine/first-model.ts). */
const writer = async (d: Daemon, tag: string, model = "openai/gpt-4o-mini"): Promise<string> => String((await ok(d, "agents.create", { idempotencyKey: `ai-writer-${tag}`, name: `Writer ${tag}`, role: "You write short answers.", model, computer: false })).agent.agentId);

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-ai-step-"));
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
async function ok(d: Daemon, cap: string, input: unknown): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, input);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function until<T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
/** What the host logged at warn level or above, so a step that fails for no visible reason says why. */
function hostLog(d: Daemon): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE level >= 40 ORDER BY id DESC LIMIT 12").all() as Array<{ level: number; place: string | null; cap: string | null; msg: string; attrs: string | null }>;
  return JSON.stringify(rows.map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 400)}`));
}
const noKey = (text: string, where: string): void => assert.equal(text.includes(KEY), false, `the key is in ${where}`);

async function world() {
  const v = await vendor();
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((u: unknown, i?: RequestInit) => { const url = String((u as { url?: string })?.url ?? u); return realFetch(url.startsWith("https://api.openai.com") ? url.replace("https://api.openai.com", v.base) : (u as string), i); }) as typeof fetch;
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "ai-step", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch, intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const pumping = setInterval(() => void d.hooks?.pump?.(), 150);   // the daemon's hook timer is an hour here; this is the pass it would make
  return { v, d, stop: async () => { clearInterval(pumping); globalThis.fetch = realFetch; await d.stop(); v.close(); } };
}

async function unlock(d: Daemon): Promise<void> {
  const r = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  assert.equal(r.status, 204);
}

async function finished(d: Daemon, runId: string, want: "succeeded" | "failed"): Promise<{ status: string; steps: Array<{ step: string; state: string; error?: { code?: string; message?: string } }> }> {
  return until(`the run to be ${want}`, 15_000, async () => {
    const run = (await ok(d, "runs.get", { runId })).run as { status: string };
    if (run.status === want) return { status: run.status, steps: (await ok(d, "runs.steps", { runId })).steps };
    if (run.status === "failed" || run.status === "succeeded" || run.status === "stopped") assert.fail(`the run ended ${run.status}, not ${want}: ${JSON.stringify(await ok(d, "runs.steps", { runId }))}`);
    return undefined;
  });
}
const outputOf = (d: Daemon, runId: string, step: string): any => JSON.parse((d.db!.all("SELECT output_json FROM runs_steps WHERE run_id = ? AND step = ?", runId, step)[0] as { output_json: string }).output_json);   // eslint-disable-line @typescript-eslint/no-explicit-any
const everything = async (d: Daemon, runId: string, id: string): Promise<string> => [
  JSON.stringify(await ok(d, "runs.get", { runId })), JSON.stringify(await ok(d, "runs.steps", { runId })), JSON.stringify(await ok(d, "automations.get", { automationId: id })),
  JSON.stringify(d.db!.all("SELECT * FROM runs_steps WHERE run_id = ?", runId)), JSON.stringify(d.db!.all("SELECT * FROM engine_step_turns")), JSON.stringify(d.db!.all("SELECT * FROM engine_usage")),
].join("\n");

test("a Personal AI step answers on its owner's own key, with no tools, and the key is only in the vendor request", async () => {
  const w = await world();
  try {
    await unlock(w.d);
    await ok(w.d, "providers.add", { idempotencyKey: "ai-mine", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    const agentId = await writer(w.d, "personal");
    const made = await ok(w.d, "automations.create", { idempotencyKey: "ai-personal", name: "Say hello", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", input: { agentId, prompt: "Say hello to the person in the input.", inputs: { name: "Dana" } } }] } });
    const id = String(made.automation.id);
    const on = await call(w.d, "automations.set_enabled", { automationId: id, enabled: true });
    assert.equal(on.status, 200, JSON.stringify(on.data));
    w.v.script.push({ text: "Hello Dana!" });
    const runId = String((await ok(w.d, "automations.run", { automationId: id, idempotencyKey: "ai-personal-run", })).runId);
    await finished(w.d, runId, "succeeded");
    const out = outputOf(w.d, runId, "ask");
    assert.equal(out.text, "Hello Dana!");
    assert.match(out.keyUsed, /^#/, "the key is named by handle");
    assert.equal(w.v.requests.length, 1);
    const sent = JSON.parse(w.v.requests[0]!) as { messages: Array<{ role: string; content: unknown }>; tools?: unknown[] };
    assert.match(JSON.stringify(sent.messages), /Say hello to the person in the input\./);
    assert.match(JSON.stringify(sent.messages), /Dana/, "the mapped input is in the prompt");
    assert.ok(!sent.tools || sent.tools.length === 0, "the model was offered no tools");
    assert.equal((sent as { model?: string }).model, "gpt-4o-mini", "the step runs on its agent's model");
    assert.equal(w.v.auth[0], `Bearer ${KEY}`, "the key reached the vendor");
    noKey(await everything(w.d, runId, id), "the run, step log, definition, kept turn or usage");
    const usage = await ok(w.d, "engine.usage.query", { by: "agent" });
    assert.deepEqual(usage.rows.map((r: { key: string }) => r.key), [agentId], "counted to the agent it ran as");
    assert.equal(usage.totals.turns, 1);
    // a step test (sandbox) uses the recorded sample and asks nothing
    const tested = await ok(w.d, "automations.test", { automationId: id });
    await finished(w.d, String(tested.runId), "succeeded");
    assert.equal(w.v.requests.length, 1, "a test run asks the vendor nothing");
    assert.equal(outputOf(w.d, String(tested.runId), "ask").text, "A sample answer.");
  } finally { await w.stop(); }
});

test("an output schema is enforced: a wrong answer fails the step by name and a right one comes back as data", async () => {
  const w = await world();
  try {
    await unlock(w.d);
    await ok(w.d, "providers.add", { idempotencyKey: "ai-mine2", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    const schema = { type: "object", required: ["score"], properties: { score: { type: "integer", minimum: 0, maximum: 10 } } };
    const agentId = await writer(w.d, "schema");
    const made = await ok(w.d, "automations.create", { idempotencyKey: "ai-schema", name: "Score", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", title: "Scorer", input: { agentId, prompt: "Score it", outputSchema: schema }, onError: { mode: "fail" } }] } });
    const id = String(made.automation.id);
    await ok(w.d, "automations.set_enabled", { automationId: id, enabled: true });
    w.v.script.push({ text: '{"score": 42}' });
    const bad = String((await ok(w.d, "automations.run", { automationId: id, idempotencyKey: "ai-schema-run-1" })).runId);
    const failed = await finished(w.d, bad, "failed");
    const step = failed.steps.find((s) => s.step === "ask")!;
    assert.equal(step.error?.code, "validation.bad_input", JSON.stringify(step) + hostLog(w.d));
    assert.match(String(step.error?.message), /AI step "Scorer" answered, but the answer does not match its output schema/);
    w.v.script.push({ text: 'Here: {"score": 7}' });
    const good = String((await ok(w.d, "automations.run", { automationId: id, idempotencyKey: "ai-schema-run-2" })).runId);
    await finished(w.d, good, "succeeded");
    assert.deepEqual(outputOf(w.d, good, "ask").data, { score: 7 });
    noKey(await everything(w.d, good, id), "the run");
  } finally { await w.stop(); }
});

test("a reviewer holds the answer as a task; accepting it lets the Run go on without asking the model again", async () => {
  const w = await world();
  try {
    await unlock(w.d);
    await ok(w.d, "providers.add", { idempotencyKey: "ai-mine3", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    const agentId = await writer(w.d, "review");
    const made = await ok(w.d, "automations.create", {
      idempotencyKey: "ai-review", name: "Review me",
      definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", input: { agentId, prompt: "Draft it" }, ai: { reviewer: { kind: "person", id: "usr_olivia" } } }] },
    });
    const id = String(made.automation.id);
    await ok(w.d, "automations.set_enabled", { automationId: id, enabled: true });
    w.v.script.push({ text: "The draft." });
    const runId = String((await ok(w.d, "automations.run", { automationId: id, idempotencyKey: "ai-review-run" })).runId);
    const taskId = await until("the review task", 15_000, async () => {
      const run = (await ok(w.d, "runs.get", { runId })).run as { status: string };
      if (run.status === "failed" || run.status === "succeeded") assert.fail(`the run ended ${run.status} before the review: ${JSON.stringify(await ok(w.d, "runs.steps", { runId }))}`);
      if (run.status !== "waiting") return undefined;
      const row = w.d.db!.all("SELECT task_id FROM runs_waits WHERE run_id = ?", runId)[0] as { task_id?: string } | undefined;
      return row?.task_id ?? undefined;
    });
    assert.equal(w.v.requests.length, 1);
    await ok(w.d, "tasks.act", { taskId, action: "approve" });
    await finished(w.d, runId, "succeeded");
    assert.equal(outputOf(w.d, runId, "ask").text, "The draft.");
    assert.equal(w.v.requests.length, 1, "the answer was kept: waking the step did not ask the vendor again");
  } finally { await w.stop(); }
});

test("a Personal AI step with no account of its own is refused when turned on, and says what to add", async () => {
  const w = await world();
  try {
    const made = await ok(w.d, "automations.create", { idempotencyKey: "ai-none", name: "No key", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", input: { prompt: "Hi" } }] } });
    const on = await call(w.d, "automations.set_enabled", { automationId: String(made.automation.id), enabled: true });
    assert.equal(on.status, 422, JSON.stringify(on.data));
    assert.match(JSON.stringify(on.data), /own AI account/);
    assert.match(JSON.stringify(on.data), /AI settings/);
  } finally { await w.stop(); }
});

test("a Space AI step runs as its service on the Space AI key, and refuses a key that belongs to one person", async () => {
  const w = await world();
  try {
    await unlock(w.d);
    const mine = await ok(w.d, "providers.add", { idempotencyKey: "ai-own", providerKey: "openai", connection: "api_key", apiKey: `${KEY}-own`, scope: "mine", name: "My OpenAI" });
    const made = await ok(w.d, "automations.create", { idempotencyKey: "ai-space", name: "Team answer" });
    const id = String(made.automation.id);
    const serviceId = `svc_${id.slice(4)}`;
    // the Space AI key: checked with the provider at once, which keeps its model list, and a step on it runs on the first model the key lists
    const sk = await ok(w.d, "providers.space_key.set", { idempotencyKey: "ai-space-key", providerKey: "openai", apiKey: KEY });
    assert.ok((sk.models as string[]).length > 0, JSON.stringify(sk));
    const handle = String(sk.providerId);
    await ok(w.d, "automations.update", { automationId: id, definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", input: { prompt: "Say hi" }, ai: { keyId: handle } }] } });
    await ok(w.d, "automations.promote", { automationId: id, confirm: true });
    await ok(w.d, "access.share", { idempotencyKey: "ai-share-space", resource: { type: "space", id: "spc_core" }, subject: { kind: "service", id: serviceId }, level: "view" });
    await ok(w.d, "automations.set_enabled", { automationId: id, enabled: true });
    w.v.script.push({ text: "Hi from the team key." });
    const runId = String((await ok(w.d, "automations.run", { automationId: id, idempotencyKey: "ai-space-run" })).runId);
    await finished(w.d, runId, "succeeded");
    assert.equal(outputOf(w.d, runId, "ask").text, "Hi from the team key.");
    assert.equal(w.v.auth[0], `Bearer ${KEY}`);
    const usage = await ok(w.d, "engine.usage.query", { by: "person" });
    assert.ok(usage.rows.some((r: { key: string }) => r.key === serviceId), "the turn is counted against the automation's service");
    noKey(await everything(w.d, runId, id), "the Space run");
    // a key that belongs to one person cannot be the Space automation's
    await ok(w.d, "automations.set_enabled", { automationId: id, enabled: false });
    await ok(w.d, "automations.update", { automationId: id, definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", input: { prompt: "Say hi" }, ai: { keyId: String(mine.provider.id) } }] } });
    const refused = await call(w.d, "automations.set_enabled", { automationId: id, enabled: true });
    assert.equal(refused.status, 422, JSON.stringify(refused.data));
    assert.match(JSON.stringify(refused.data), /belongs to one person/);
    assert.match(JSON.stringify(refused.data), /Space-shared AI key/);
    await ok(w.d, "automations.update", { automationId: id, definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", input: { prompt: "Say hi" } }] } });
    // a step with no key of its own runs on Automatic (l-aipick): the Space AI account kept for automations, here the team key; with none kept it is refused (modules/automations/tests/defs.test.ts)
    const bare = await call(w.d, "automations.set_enabled", { automationId: id, enabled: true });
    assert.equal(bare.status, 200, JSON.stringify(bare.data));
    w.v.script.push({ text: "Hi on Automatic." });
    const seen = w.v.auth.length;
    const autoRun = String((await ok(w.d, "automations.run", { automationId: id, idempotencyKey: "ai-space-auto-run" })).runId);
    await finished(w.d, autoRun, "succeeded");
    assert.equal(outputOf(w.d, autoRun, "ask").text, "Hi on Automatic.");
    assert.equal(w.v.auth[seen], `Bearer ${KEY}`, "Automatic picks the Space key that pays for automations");
  } finally { await w.stop(); }
});

test("a restricted record read by records.find follows the chat label rule into the AI step: nothing is sent, and a public record goes through", async () => {
  const w = await world();
  try {
    await unlock(w.d);
    await ok(w.d, "providers.add", { idempotencyKey: "ai-lbl", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    const agentId = await writer(w.d, "label");
    const secret = await ok(w.d, "records.create", { idempotencyKey: "lbl-secret", type: "note_board", fields: { title: "Client X settlement" } });
    const plain = await ok(w.d, "records.create", { idempotencyKey: "lbl-plain", type: "note_board", fields: { title: "Lunch order" } });
    await ok(w.d, "access.labels.set", { resource: { type: "record", id: secret.record.id }, label: "restricted" });
    const def = (title: string) => ({ triggers: [{ key: "manual" }], nodes: [
      { id: "find", key: "records.find", input: { type: "note_board", filter: { field: "title", op: "eq", value: title } }, next: ["ask"] },
      { id: "ask", key: "ai", input: { agentId, prompt: "Summarise the notes.", inputs: { notes: "{{ steps.find.out.rows }}" } } },
    ] });
    const bad = String((await ok(w.d, "automations.create", { idempotencyKey: "ai-label-1", name: "Secret", definition: def("Client X settlement") })).automation.id);
    await ok(w.d, "automations.set_enabled", { automationId: bad, enabled: true });
    const run1 = String((await ok(w.d, "automations.run", { automationId: bad, idempotencyKey: "ai-label-run-1" })).runId);
    const failed = await finished(w.d, run1, "failed");
    const step = failed.steps.find((s) => s.step === "ask")!;
    assert.equal(step.error?.code, "permission.provider_label", JSON.stringify(step) + hostLog(w.d));
    assert.match(String(step.error?.message), /records in its input/);
    assert.equal(w.v.requests.length, 0, "nothing went to the provider");
    const good = String((await ok(w.d, "automations.create", { idempotencyKey: "ai-label-2", name: "Plain", definition: def("Lunch order") })).automation.id);
    await ok(w.d, "automations.set_enabled", { automationId: good, enabled: true });
    w.v.script.push({ text: "A lunch order." });
    const run2 = String((await ok(w.d, "automations.run", { automationId: good, idempotencyKey: "ai-label-run-2" })).runId);
    await finished(w.d, run2, "succeeded");
    assert.equal(w.v.requests.length, 1);
    assert.match(w.v.requests[0]!, /Lunch order/);
    assert.equal(w.v.requests[0]!.includes("settlement"), false);
    void plain;
  } finally { await w.stop(); }
});

test("a step that runs as an agent uses that agent's model on the owner's key", async () => {
  const w = await world();
  try {
    await unlock(w.d);
    await ok(w.d, "providers.add", { idempotencyKey: "ai-mine-agent", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    const agentId = String((await ok(w.d, "agents.create", { idempotencyKey: "ai-agent-model", name: "Writer", role: "You write short answers.", model: "openai/gpt-4o" })).agent.agentId);
    const made = await ok(w.d, "automations.create", { idempotencyKey: "ai-as-agent", name: "As agent", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", input: { prompt: "Say hi.", agentId } }] } });
    const id = String(made.automation.id);
    assert.equal((await call(w.d, "automations.set_enabled", { automationId: id, enabled: true })).status, 200);
    w.v.script.push({ text: "Hi." });
    const runId = String((await ok(w.d, "automations.run", { automationId: id, idempotencyKey: "ai-as-agent-run" })).runId);
    await finished(w.d, runId, "succeeded");
    assert.equal((JSON.parse(w.v.requests.at(-1)!) as { model?: string }).model, "gpt-4o", "the agent's own model");
  } finally { await w.stop(); }
});

test("an agent-less AI step on an API key that lists chat models runs on the default nobody chose: the balanced pick from the key's own list, never written to the step", async () => {
  const w = await world();
  try {
    await unlock(w.d);
    await ok(w.d, "providers.add", { idempotencyKey: "ai-mine-default", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    const made = await ok(w.d, "automations.create", { idempotencyKey: "ai-default", name: "Default model", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", input: { prompt: "Say hi." } }] } });
    const id = String(made.automation.id);
    assert.equal((await call(w.d, "automations.set_enabled", { automationId: id, enabled: true })).status, 200);
    w.v.script.push({ text: "Hi." });
    const runId = String((await ok(w.d, "automations.run", { automationId: id, idempotencyKey: "ai-default-run" })).runId);
    await finished(w.d, runId, "succeeded");
    // the key lists gpt-4o-mini and gpt-4o; the balanced tier for OpenAI is the plain flagship (modules/engine/first-model.ts)
    assert.equal((JSON.parse(w.v.requests.at(-1)!) as { model?: string }).model, "gpt-4o", "the default from the key's list");
    assert.doesNotMatch(JSON.stringify((await ok(w.d, "automations.get", { automationId: id })).automation), /gpt-4o/, "the default is never written to the step");
  } finally { await w.stop(); }
});

test("an agent-less AI step on an API key that lists no chat model fails its Run in plain words: nothing reaches the vendor, and the notice carries the words", async () => {
  const w = await world();
  try {
    await unlock(w.d);
    w.v.models.splice(0, w.v.models.length, "whisper-1", "dall-e-3", "text-embedding-3-small");   // a key that serves only speech, image and embedding models
    await ok(w.d, "providers.add", { idempotencyKey: "ai-mine-nomodel", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    const made = await ok(w.d, "automations.create", { idempotencyKey: "ai-nomodel", name: "No model", definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", input: { prompt: "Say hi." } }] } });
    const id = String(made.automation.id);
    // nothing new is refused at turn-on tonight (rc.27 brings the model choice)
    assert.equal((await call(w.d, "automations.set_enabled", { automationId: id, enabled: true })).status, 200);
    const before = w.v.requests.length;
    const runId = String((await ok(w.d, "automations.run", { automationId: id, idempotencyKey: "ai-nomodel-run" })).runId);
    const done = await finished(w.d, runId, "failed");
    const failed = JSON.stringify(done.steps);
    assert.match(failed, /This AI step has no model\. Give it an agent that has a model, or set a model on its agent\./, failed);
    assert.doesNotMatch(failed, /could not answer this step/);
    assert.equal(w.v.requests.length, before, "nothing was sent");
    const notes = await until("the failed-Run notice", 10_000, async () => {
      const n = ((await ok(w.d, "notifications.list", { limit: 50 })).notifications as { kind?: string; title?: string; subject?: { id?: string } }[]).filter((x) => x.kind === "run.failed" && x.subject?.id === runId);
      return n.length > 0 ? n : undefined;
    });
    assert.match(String(notes[0]?.title), /This AI step has no model/);
  } finally { await w.stop(); }
});

test("a Space AI step that names an agent with a model starts its Run: a step row within 10 seconds", async () => {
  const w = await world();
  try {
    await unlock(w.d);
    const agentId = await writer(w.d, "space-agent");
    const sk = await ok(w.d, "providers.space_key.set", { idempotencyKey: "ai-space-key-2", providerKey: "openai", apiKey: KEY });
    const made = await ok(w.d, "automations.create", { idempotencyKey: "ai-space-agent", name: "Team agent answer" });
    const id = String(made.automation.id);
    await ok(w.d, "automations.update", { automationId: id, definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", input: { agentId, prompt: "Say hi" }, ai: { keyId: String(sk.providerId) } }] } });
    await ok(w.d, "automations.promote", { automationId: id, confirm: true });
    await ok(w.d, "access.share", { idempotencyKey: "ai-share-space-2", resource: { type: "space", id: "spc_core" }, subject: { kind: "service", id: `svc_${id.slice(4)}` }, level: "view" });
    await ok(w.d, "automations.set_enabled", { automationId: id, enabled: true });
    w.v.script.push({ text: "Hi from the agent." });
    const runId = String((await ok(w.d, "automations.run", { automationId: id, idempotencyKey: "ai-space-agent-run" })).runId);
    await until("a step row", 10_000, async () => ((await ok(w.d, "runs.steps", { runId })).steps as unknown[]).length > 0 ? true : undefined);
  } finally { await w.stop(); }
});

test("a Space AI step that names an agent with a model, on a Space-shared key, starts its Run: a step row within 10 seconds", async () => {
  const w = await world();
  try {
    await unlock(w.d);
    const agentId = await writer(w.d, "shared-agent");
    const folder = await ok(w.d, "vault.folders.create", { name: "AI keys", scope: "shared", idempotencyKey: "ai-folder-3" });
    const team = await ok(w.d, "providers.add", { idempotencyKey: "ai-team-3", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "shared", name: "Team OpenAI", folderId: folder.folder.id });
    const made = await ok(w.d, "automations.create", { idempotencyKey: "ai-shared-agent", name: "Shared agent answer" });
    const id = String(made.automation.id);
    const serviceId = `svc_${id.slice(4)}`;
    await ok(w.d, "automations.update", { automationId: id, definition: { triggers: [{ key: "manual" }], nodes: [{ id: "ask", key: "ai", input: { agentId, prompt: "Say hi" }, ai: { keyId: String(team.provider.id) } }] } });
    await ok(w.d, "automations.promote", { automationId: id, confirm: true });
    await ok(w.d, "access.share", { idempotencyKey: "ai-share-space-3", resource: { type: "space", id: "spc_core" }, subject: { kind: "service", id: serviceId }, level: "view" });
    await ok(w.d, "access.share", { idempotencyKey: "ai-share-key-3", resource: { type: "vault_item", id: String(team.provider.itemId) }, subject: { kind: "service", id: serviceId }, level: "use" });
    await ok(w.d, "automations.set_enabled", { automationId: id, enabled: true });
    w.v.script.push({ text: "Hi from the agent." });
    const runId = String((await ok(w.d, "automations.run", { automationId: id, idempotencyKey: "ai-shared-agent-run" })).runId);
    await until("a step row", 10_000, async () => ((await ok(w.d, "runs.steps", { runId })).steps as unknown[]).length > 0 ? true : undefined);
  } finally { await w.stop(); }
});
