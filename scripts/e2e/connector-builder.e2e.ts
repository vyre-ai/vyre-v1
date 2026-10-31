// The real end to end run of "Add to Automations": a booted daemon, the REAL Claude CLI on a Claude setup token as the person's AI subscription, a real app key in the Vault, the real app API
// (GET only), and a person's side played by this script: it presses Add to Automations, reads what the agent says, taps its options, approves the publish, and then checks through the API that the
// connector is live, bound to the Vault item, its reads are tested and the step picker lists its actions.
//
// NOT part of any CI glob. Run by hand:
//   set -a; source /Users/irfad/Claude/simba/secrets/.env.simba; set +a
//   node --import tsx --import ./scripts/shots/rn-alias.mjs scripts/e2e/connector-builder.e2e.ts fathom   (or resend)
// Secrets: the token and the app key come from the environment, go into the Vault through its write capability and nowhere else. Every line this script prints or saves is scrubbed of both.
// Writes: the daemon's network seam answers only GET to the app's API host. Any other request aborts the run.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../../host/src/platform/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";
import type { SeamFetch } from "../../host/src/seams/ports.ts";
import { connectorSteps } from "../../apps/app/src/places/automations/catalog/model.ts";
import { connectorOpening } from "../../apps/app/src/places/vault/itemenv/automations.ts";

const APPS = {
  fathom: { name: "Fathom", host: "api.fathom.ai", env: "MLA_FATHOM_API_KEY", reads: [/meeting/i, /team/i, /member/i], write: /webhook|send|create/i, stepTitle: /Fathom: List meetings/i },
  resend: { name: "Resend", host: "api.resend.com", env: "MLA_RESEND_API_KEY", reads: [/domain/i, /api.?key/i, /audience/i], write: /send/i, stepTitle: /Resend/i },
} as const;
type AppKey = keyof typeof APPS;

const which = (process.argv[2] ?? "fathom") as AppKey;
const app = APPS[which];
if (!app) throw new Error(`unknown app ${which}`);
const TOKEN = process.env["VYRE_TEST_CLAUDE_SETUP_TOKEN"] ?? "";
const APP_KEY = process.env[app.env] ?? "";
if (!TOKEN || !APP_KEY) throw new Error("load the vault env first: VYRE_TEST_CLAUDE_SETUP_TOKEN and the app key are required");
const OUT = process.env["E2E_OUT"] ?? `/private/tmp/claude-501/-Users-irfad-Claude/244d818f-f61b-4448-8728-ddfc2a911874/scratchpad/e2e-connector${which === "fathom" ? "" : `-${which}`}`;
fs.mkdirSync(OUT, { recursive: true });

const scrub = (s: string): string => s.split(TOKEN).join("[token]").split(APP_KEY).join("[app key]").replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, "[token]");
const lines: string[] = [];
const say = (who: string, text: string): void => { const l = `**${who}** ${scrub(text)}`; lines.push(l); console.log(l.slice(0, 400)); };
const save = (): void => { fs.writeFileSync(path.join(OUT, "transcript.md"), `# Add to Automations, real run on ${app.name}\n\n${lines.join("\n\n")}\n`); };

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const core = bootCore();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-e2e-connector-"));
core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
fs.copyFileSync(core.file, path.join(dir, "events.db"));
core.close();

const requests: { method: string; url: string }[] = [];
let violation = "";
// the network seam: GET to the app's API host, nothing else
const seamFetch: SeamFetch = async (url, init) => {
  const method = String(init?.method ?? "GET").toUpperCase();
  requests.push({ method, url: url.replace(/\?.*/, "") });
  if (method !== "GET" || new URL(url).hostname !== app.host) { violation = `${method} ${url}`; throw new Error(`e2e guard: ${method} ${url} is not a GET to ${app.host}`); }
  const r = await fetch(url, init as RequestInit);
  return { status: r.status, text: () => r.text(), arrayBuffer: () => r.arrayBuffer() };
};

const d: Daemon = await startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
  platform: fakePlatform({ os: process.platform === "darwin" ? "darwin" : "linux", hostname: "e2e-connector", free: 80e9, commands: {
    [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
  } }),
  fetch: caddyFetch, seams: { fetch: seamFetch },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
});

let keys = 0;
async function call(cap: string, input: Record<string, unknown> = {}): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ idempotencyKey: `e2e-${cap}-${++keys}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
async function ok(cap: string, input: Record<string, unknown> = {}): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(cap, input);
  if (r.status !== 200) throw new Error(`${cap}: ${scrub(JSON.stringify(r.data))}`);
  return r.data;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** What the host logged lately (warnings and engine lines), scrubbed: the first place to look when the agent does not answer. */
function hostLines(n = 80): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs ORDER BY id DESC LIMIT ?").all(n) as { level: number; place?: string; cap?: string; msg: string; attrs?: string }[];
  return scrub(rows.reverse().map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 300)}`).join("\n"));
}

type Msg = { id: string; threadSeq: number; author?: { kind?: string }; body?: string; blocks?: { type: string; id?: string; blockId?: string; state?: string; data?: any }[] };   // eslint-disable-line @typescript-eslint/no-explicit-any

async function main(): Promise<void> {
  try {
    // ---- the person's setup: Vault unlocked, their Claude setup token as the AI subscription, the app key as an api_key item
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    if (unlock.status !== 204) throw new Error(`unlock ${unlock.status}`);
    const accounts = (await ok("vault.folders.create", { name: "Accounts", scope: "mine" })).folder.id as string;
    const flow = await ok("providers.subscription_start", { providerKey: "claude-code" });
    await ok("vault.item.put", { folderId: accounts, name: "Claude setup", kind: "ai_subscription", fields: [{ key: "setup_token", value: TOKEN, secret: true }] });
    const provider = (await ok("providers.subscription_complete", { flowId: flow.flowId })).provider;
    await ok("providers.set_space_use", { providerId: provider.id, allow: true });
    const keysFolder = (await ok("vault.folders.create", { name: "Keys", scope: "mine" })).folder.id as string;
    const item = (await ok("vault.item.put", { folderId: keysFolder, name: app.name, kind: "api_key", fields: [{ key: "api_key", value: APP_KEY, secret: true }] })).item;
    say("setup", `Vault: AI account ${provider.providerKey} (${provider.state}); item ${item.name} handle ${item.handle}`);
    await ok("engine.pool.status");

    // ---- the agent is the person's assistant; the button path: an Ask on the Vault item with the opening message and its title
    const agentId = (await ok("agents.create", { name: "Assistant", role: "You are the person's assistant." })).agent.agentId as string;
    const first = connectorOpening({ name: app.name, handle: item.handle });
    const title = `Add ${app.name} to Automations`;
    const thread = (await ok("chat.start", { kind: "ask", agentIds: [agentId], scopeType: "vault_item", scopeId: item.id, first, title })).thread.threadId as string;
    say("person", first);
    await ok("threads.set_mode", { threadId: thread, mode: "auto" });

    // ---- the person's side: read what the agent says, answer its questions like a person
    const seen = new Set<string>();
    const answered = new Set<string>();
    let published = false, lastNew = Date.now();
    const deadline = Date.now() + 14 * 60_000;
    while (Date.now() < deadline && !published) {
      await Promise.race([d.hooks?.pump?.(), sleep(5000)]);
      if (violation) throw new Error(`a write was attempted: ${scrub(violation)}`);
      const msgs = ((await ok("chat.messages.list", { threadId: thread })).messages as Msg[]);
      for (const m of msgs) {
        if (seen.has(m.id) || m.author?.kind !== "agent") continue;
        seen.add(m.id); lastNew = Date.now();
        const blocks = m.blocks ?? [];
        if ((m.body ?? "") !== "") say("agent", m.body!);
        for (const b of blocks) {
          const data = b.data ?? {};
          if (b.type === "checklist") say("agent card", `${data.title}: ${(data.items ?? []).map((i: { text: string; done: boolean }) => `${i.done ? "[x]" : "[ ]"} ${i.text}`).join("; ")}`);
          else if (b.type === "question") say("agent options", `${data.prompt} :: ${(data.options ?? []).map((o: { key: string; label: string; detail?: string }) => `${o.key}=${o.label}${o.detail ? ` (${o.detail})` : ""}`).join(" | ")}`);
          else if (b.type === "tool_call") say("agent tool", `${data.name ?? "?"} ${JSON.stringify(data.input ?? {}).slice(0, 260)}`);
          else if (b.type === "tool_result") say("agent tool result", `${data.ok === false ? "failed" : "ok"} ${JSON.stringify(data.content ?? data.result ?? data).slice(0, 260)}`);
          else say("agent block", b.type);
        }
      }
      for (const m of msgs) for (const b of m.blocks ?? []) {
        const id = b.blockId ?? b.id;
        if (b.type !== "question" || !id || answered.has(id) || b.state === "done" || b.data?.answer !== undefined) continue;
        const data = b.data ?? {}; const opts = (data.options ?? []) as { key: string; label: string; detail?: string }[];
        let pick: string[];
        if (data.mode === "single") {
          const go = opts.find((o) => /publish|use it|yes|continue/i.test(o.label)) ?? opts[0];
          pick = go ? [go.key] : [];
        } else {
          const reads = opts.filter((o) => /read/i.test(o.detail ?? "") && app.reads.some((re) => re.test(o.label))).slice(0, 3);
          const readsAny = reads.length > 0 ? reads : opts.filter((o) => /read/i.test(o.detail ?? "")).slice(0, 2);
          const write = opts.find((o) => /write/i.test(o.detail ?? "") && app.write.test(o.label));
          pick = [...readsAny, ...(write ? [write] : [])].map((o) => o.key);
        }
        answered.add(id);
        say("person", `taps ${pick.map((k) => opts.find((o) => o.key === k)?.label ?? k).join(", ") || "(nothing)"}`);
        await ok("chat.answer_block", { threadId: thread, blockId: id, answer: { keys: pick } });
        lastNew = Date.now();
      }
      const live = ((await ok("connectors.list", { state: "live" })).connectors as { key: string; builtin: boolean }[]).filter((c) => !c.builtin);
      if (live.length > 0) published = true;
      if (!published && Date.now() - lastNew > 150_000) { fs.writeFileSync(path.join(OUT, "host-log.txt"), hostLines(400)); throw new Error(`the agent went quiet for 150 seconds; the host log is in ${path.join(OUT, "host-log.txt")}`); }
      await sleep(1500);
    }
    if (!published) throw new Error("no connector was published before the deadline");
    // the agent still has to bind and confirm: give it a minute
    await sleep(1000);
    for (let i = 0; i < 60; i++) { await d.hooks?.pump?.(); const c = (await ok("connections.list", {})).connections as unknown[]; if (c.length > 0) break; await sleep(2000); }
    for (let i = 0; i < 20; i++) { await d.hooks?.pump?.(); await sleep(1500); }
    const finalMsgs = ((await ok("chat.messages.list", { threadId: thread })).messages as Msg[]);
    for (const m of finalMsgs) if (m.author?.kind === "agent" && !seen.has(m.id)) { seen.add(m.id); if (m.body) say("agent", m.body); }

    // ---- assertions through the API
    const fail = (why: string): never => { say("RESULT", `FAILED: ${why}`); save(); throw new Error(why); };
    const connectors = (await ok("connectors.list", { state: "live" })).connectors as { key: string; title: string; builtin: boolean; domains: string[]; actions: string[]; version: string }[];
    const built = connectors.find((c) => !c.builtin);
    if (!built) return fail("no live connector of its own");
    if (!built.domains.includes(app.host)) fail(`domains ${built.domains.join(",")}`);
    const conns = (await ok("connections.list", {})).connections as { connectionId: string; connector: string; state: string; handles: string[] }[];
    const conn = conns.find((c) => c.connector === built.key);
    if (!conn) return fail("no connection for the connector");
    if (!conn.handles.some((h) => h.startsWith(item.handle))) fail(`connection handles ${conn.handles.join(",")} do not name ${item.handle}`);
    const modules = new DatabaseSync(path.join(dir, "modules.db"), { readOnly: true });
    const levels = modules.prepare("SELECT action_key, level FROM automations_connector_level").all() as { action_key: string; level: string }[];
    modules.close();
    const tested = levels.filter((l) => l.level === "tested").map((l) => l.action_key);
    if (tested.length === 0) fail("no read action was recorded tested");
    const steps = connectorSteps({ connectors }, { connections: conns });
    if (steps.length === 0) fail("the step picker lists nothing from this connector");
    const usage = (await ok("automations.vault_usage", { handle: item.handle })).uses;
    say("RESULT", `PASSED. connector ${built.key} v${built.version} live, domains ${built.domains.join(",")}, connection ${conn.state} bound to ${conn.handles.join(",")}; tested ${tested.join(", ")}; picker rows: ${steps.map((s) => s.title).join("; ")}; GETs sent: ${requests.length}; writes attempted: 0; vault_usage rows ${JSON.stringify(usage).length > 2 ? "present" : "none yet"}`);
    if (!steps.some((s) => app.stepTitle.test(s.title))) say("NOTE", `no picker row matched ${app.stepTitle}`);
    d.sink.flush();
    const logs = JSON.stringify(new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT msg, attrs FROM logs").all());
    if (logs.includes(TOKEN) || logs.includes(APP_KEY)) fail("a secret is in the host logs");
    save();
    if (/sk-ant/.test(fs.readFileSync(path.join(OUT, "transcript.md"), "utf8"))) throw new Error("the transcript holds a token");
  } catch (e) {
    say("ERROR", e instanceof Error ? e.message : String(e));
    save();
    process.exitCode = 1;
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
}
await main();
