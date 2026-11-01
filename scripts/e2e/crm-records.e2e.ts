// The real end to end run of "Sync to Records": a booted daemon, the REAL Claude CLI on a Claude setup token as the person's AI subscription, the owner's GoHighLevel API key in the Vault,
// the real GoHighLevel API (GET only, one small page), and the person's side played by this script: it presses Sync to Records, reads what the agent proposes, taps Looks good, and then checks
// through the API that a connector, a connection holding only the Vault handle, record types with fields and a few records exist.
//
// NOT part of any CI glob. Run by hand:
//   set -a; source /Users/irfad/Claude/simba/secrets/.env.simba; set +a
//   node --import tsx --import ./scripts/shots/rn-alias.mjs scripts/e2e/crm-records.e2e.ts
// Secrets: the token, the GoHighLevel key and the location id come from the environment, go into the Vault through its write capability (the id into the first message as the person would say
// it) and nowhere else. Every line this script prints or saves is scrubbed of all three.
// Reads only: the network under connectors answers GET to the GoHighLevel API host and nothing else; any other request aborts the run. A list is clamped to a small page (limit 5) and, once the
// sync has been applied, to two pages, so the first pull brings in a handful of records.
// The transcript (counts, field names and the agent's questions) goes to E2E_OUT; no tool answer and no record value is written to it.
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
import { syncOpening } from "../../apps/app/src/places/records/sync/opening.ts";

const HOST = "services.leadconnectorhq.com";
// argv: [account] [mode]. account 1..4 reads GHL_TCPA_KEY_n / GHL_TCPA_LOC_n (set -a; source simba/secrets/ghl-tcpa-2026-11.env), account sales reads MLA_GHL_SALES_*.
// mode run (default): the agent syncs it; mode discover: survey and a 5-row sample through the capabilities, no apply.
const ACCOUNT = process.argv[2] ?? "sales";
const MODE = process.argv[3] ?? "run";
const TOKEN = process.env["VYRE_TEST_CLAUDE_SETUP_TOKEN"] ?? "";
const KEY = (ACCOUNT === "sales" ? process.env["MLA_GHL_SALES_API_KEY"] : process.env[`GHL_TCPA_KEY_${ACCOUNT}`]) ?? "";
const LOCATION = (ACCOUNT === "sales" ? process.env["MLA_GHL_SALES_LOCATION_ID"] : process.env[`GHL_TCPA_LOC_${ACCOUNT}`]) ?? "";
if (!TOKEN || !KEY || !LOCATION) throw new Error("load the vault env first: VYRE_TEST_CLAUDE_SETUP_TOKEN and the account's key and location id are required");
const OUT = process.env["E2E_OUT"] ?? "/private/tmp/claude-501/-Users-irfad-Claude/244d818f-f61b-4448-8728-ddfc2a911874/scratchpad/e2e-crm";
const note = (name: string): string => (MODE === "run" ? name : `${name}-${MODE}-${ACCOUNT}`);
fs.mkdirSync(OUT, { recursive: true });

const scrub = (s: string): string => [TOKEN, KEY, LOCATION].reduce((acc, v) => acc.split(v).join("[secret]"), s).replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, "[token]").replace(/pit-[0-9a-f-]{12,}/gi, "[secret]").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]").replace(/\+?\d[\d\s().-]{8,}\d/g, "[number]");
const lines: string[] = [];
const say = (who: string, text: string): void => { const l = `**${who}** ${scrub(text)}`; lines.push(l); console.log(l.slice(0, 400)); };
const save = (): void => { fs.writeFileSync(path.join(OUT, note("transcript") + ".md"), `# Sync to Records, real run on GoHighLevel (read only)\n\n${lines.join("\n\n")}\n`); };

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const core = bootCore();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-e2e-crm-"));
core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
fs.copyFileSync(core.file, path.join(dir, "events.db"));
core.close();

// ---- the guard under connectors: GET to the app's host, small pages, nothing else
const requests: { method: string; path: string }[] = [];
let violation = "";
let applied = false;
const listPages = new Map<string, number>();
const guarded = async (url: URL, o: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; link?: string; text: string }> => {
  const method = o.method.toUpperCase();
  if (method !== "GET" || url.hostname !== HOST || o.body !== undefined) { violation = `${method} ${url.hostname}${url.pathname}`; throw new Error(`e2e guard: ${method} ${url.hostname} is not a GET to ${HOST}`); }
  const u = new URL(url);
  if (u.searchParams.has("limit") || /\/(contacts|opportunities)/.test(u.pathname)) u.searchParams.set("limit", String(Math.min(Number(u.searchParams.get("limit") ?? "5"), 5)));
  requests.push({ method, path: u.pathname });
  if (applied && /\/(contacts|opportunities)\/?$/.test(u.pathname)) {
    const n = (listPages.get(u.pathname) ?? 0) + 1;
    listPages.set(u.pathname, n);
    if (n > 2) return { status: 200, text: JSON.stringify({ contacts: [], opportunities: [], meta: { total: 0 } }) };
  }
  const r = await fetch(u, { method: "GET", headers: o.headers });
  const link = r.headers.get("link");
  return { status: r.status, text: await r.text(), ...(link ? { link } : {}) };
};

const d: Daemon = await startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
  platform: fakePlatform({ os: process.platform === "darwin" ? "darwin" : "linux", hostname: "e2e-crm", free: 80e9, commands: {
    [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
  } }),
  fetch: caddyFetch, connectorNetwork: { request: guarded },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
});

let keys = 0;
let threadId = "";
async function call(cap: string, input: Record<string, unknown> = {}): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ idempotencyKey: `e2e-${cap}-${++keys}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
async function ok(cap: string, input: Record<string, unknown> = {}): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(cap, input);
  if (r.status !== 200) throw new Error(`${cap}: ${scrub(JSON.stringify(r.data)).slice(0, 400)}`);
  return r.data;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function hostLines(n = 80): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs ORDER BY id DESC LIMIT ?").all(n) as { level: number; place?: string; cap?: string; msg: string; attrs?: string }[];
  return scrub(rows.reverse().map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 300)}`).join("\n"));
}

type Msg = { id: string; author?: { kind?: string }; body?: string; blocks?: { type: string; id?: string; blockId?: string; state?: string; data?: any }[] };   // eslint-disable-line @typescript-eslint/no-explicit-any
const keyNames = (v: unknown): string => (v && typeof v === "object" ? Object.keys(v as object).join(",") : typeof v);

async function main(): Promise<void> {
  try {
    // ---- the person's setup: Vault unlocked, their Claude setup token as the AI subscription, the GoHighLevel key as an api_key item
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    if (unlock.status !== 204) throw new Error(`unlock ${unlock.status}`);
    const accounts = (await ok("vault.folders.create", { name: "Accounts", scope: "mine" })).folder.id as string;
    const flow = await ok("providers.subscription_start", { providerKey: "claude-code" });
    await ok("vault.item.put", { folderId: accounts, name: "Claude setup", kind: "ai_subscription", fields: [{ key: "setup_token", value: TOKEN, secret: true }] });
    const provider = (await ok("providers.subscription_complete", { flowId: flow.flowId })).provider;
    await ok("providers.set_space_use", { providerId: provider.id, allow: true });
    const keysFolder = (await ok("vault.folders.create", { name: "Keys", scope: "shared" })).folder.id as string;
    const item = (await ok("vault.item.put", { folderId: keysFolder, name: "GoHighLevel", kind: "api_key", fields: [{ key: "api_key", value: KEY, secret: true }] })).item;
    if (MODE === "discover") {
      // no agent: the discovery capabilities the agent uses, read-only, one small page each
      const auth = { vaultHandle: item.handle, style: "bearer", headers: { Version: "2021-07-28" } };
      const L = LOCATION;
      const paths = [`/contacts/?locationId=${L}&limit=5`, `/opportunities/search?location_id=${L}&limit=5`, `/opportunities/pipelines?locationId=${L}`, `/locations/${L}/customFields`, `/users/?locationId=${L}`, `/calendars/?locationId=${L}`, `/conversations/search?locationId=${L}&limit=5`, `/forms/?locationId=${L}&limit=5`, `/payments/orders?altId=${L}&altType=location&limit=5`, `/invoices/?altId=${L}&altType=location&limit=5&offset=0`];
      const survey = await ok("sync_specs.survey", { auth, domain: HOST, paths });
      for (const r of survey.results) say("survey", `${r.path.split("?")[0]}: status ${r.status}${r.reason ? ` (${String(r.reason).slice(0, 80)})` : ""}; lists ${(r.lists ?? []).map((l: any) => `${l.itemsAt}=${l.count} items, ${l.fields} fields`).join("; ") || "none"}${r.total !== undefined ? `; total ${r.total}` : ""}`);   // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const p of [`/contacts/?locationId=${L}&limit=5`, `/opportunities/search?location_id=${L}&limit=5`]) {
        const u = new URL(`https://${HOST}${p}`);
        const sample = await ok("sync_specs.sample", { auth, domain: HOST, path: u.pathname, query: Object.fromEntries(u.searchParams), items: 5 });
        const l = sample.shape?.lists?.[0];
        say("sample", `${u.pathname}: status ${sample.status}; ${l ? `list at ${l.itemsAt}, ${l.count} items, id ${l.idAt}, changed-at ${l.updatedAtGuess ?? "none"}; fields ${l.fields.map((f: any) => `${f.path}:${f.type}`).join(" ")}` : "no list"}; total ${sample.estimate ? sample.estimate.count : "unknown"}; cursors ${(sample.shape?.cursors ?? []).map((c: any) => c.pointer).join(",") || "none"}`);   // eslint-disable-line @typescript-eslint/no-explicit-any
      }
      say("RESULT", `DISCOVERY done for account ${ACCOUNT}: ${requests.length} GET requests to ${HOST}, no other method`);
      save();
      return;
    }
    say("setup", `Vault: AI account ${provider.providerKey} (${provider.state}); item ${item.name} handle ${item.handle}`);
    await ok("engine.pool.status");

    // ---- the assistant, with the two permissions an admin would add for this work
    const agentId = (await ok("agents.create", { name: "Assistant", role: "You are the person's assistant." })).agent.agentId as string;
    const roles = (await ok("access.roles.list", {})).roles as { id: string; name: string; builtIn: boolean; permissions: string[] }[];
    const member = roles.find((r) => r.builtIn && /member/i.test(r.name)) ?? roles.find((r) => r.builtIn && !/owner|admin/i.test(r.name));
    if (!member) throw new Error("no member role to clone");
    const builder = (await ok("access.roles.create", { name: "CRM sync builder", cloneFrom: member.id, assignableToAgents: true })).role as { id: string; permissions: string[] };
    const wanted = [...new Set([...builder.permissions, "connectors.manage", "schema.manage"])];
    const preview = await ok("access.roles.preview", { roleId: builder.id, permissions: wanted });
    await ok("access.roles.apply", { roleId: builder.id, permissions: wanted, previewHash: preview.previewHash });
    await ok("access.roles.assign", { subject: { kind: "agent", id: agentId }, roleId: builder.id });
    say("setup", "the assistant holds the CRM sync builder role (member plus connectors.manage and schema.manage)");

    // the person gives the assistant Use access to the key (without it the Vault answers "not in this Vault, or you cannot use it")
    await ok("vault.share", { resource: { type: "vault_item", id: item.id }, subject: { kind: "agent", id: agentId }, level: "use" });
    say("setup", "the person gave the assistant Use access to the Vault item");

    // ---- the button path: an Ask on the Vault item with the opening message and its title; then what the person adds in their own words
    const first = `${syncOpening({ name: "GoHighLevel", handle: item.handle })} My GoHighLevel location id is ${LOCATION}. This is a read-only first look: bring in at most a handful of contacts.`;
    const title = "Sync GoHighLevel to Records";
    const thread = threadId = (await ok("chat.start", { kind: "ask", agentIds: [agentId], scopeType: "vault_item", scopeId: item.id, first, title })).thread.threadId as string;
    say("person", first);
    await ok("threads.set_mode", { threadId: thread, mode: "auto" });

    // ---- the person's side: read what the agent says, answer its questions like a person
    const seen = new Set<string>();
    const answered = new Set<string>();
    let done = false, lastNew = Date.now(), lastTick = 0, questions = 0;
    const deadline = Date.now() + 25 * 60_000;
    while (Date.now() < deadline && !done) {
      await Promise.race([d.hooks?.pump?.(), sleep(5000)]);
      if (violation) throw new Error(`a write was attempted: ${scrub(violation)}`);
      const msgs = ((await ok("chat.messages.list", { threadId: thread })).messages as Msg[]);
      for (const m of msgs) {
        if (seen.has(m.id) || m.author?.kind !== "agent") continue;
        seen.add(m.id); lastNew = Date.now();
        if ((m.body ?? "") !== "") say("agent", m.body!.slice(0, 600));
        for (const b of m.blocks ?? []) {
          const data = b.data ?? {};
          if (b.type === "checklist") say("agent card", `${data.title}: ${(data.items ?? []).length} rows`);
          else if (b.type === "question") say("agent options", `${String(data.prompt).slice(0, 400)} :: ${(data.options ?? []).map((o: { key: string; label: string }) => `${o.key}=${o.label}`).join(" | ")}`);
          else if (b.type === "tool_call") say("agent tool", `${data.name ?? "?"} (${keyNames(data.input ?? data.args ?? data.arguments)})`);
          else if (b.type === "tool_result") { const txt = JSON.stringify(data.content ?? data.result ?? data); say("agent tool result", `${data.ok === false ? "failed" : "ok"}, ${txt.length} characters${txt.length < 260 ? `: ${txt}` : " (not saved)"}`); }
        }
      }
      for (const m of msgs) for (const b of m.blocks ?? []) {
        const id = b.blockId ?? b.id;
        if (b.type !== "question" || !id || answered.has(id) || b.state === "done" || b.data?.answer !== undefined) continue;
        const data = b.data ?? {}; const opts = (data.options ?? []) as { key: string; label: string }[];
        const go = opts.find((o) => /looks good|yes|go ahead|apply|continue|publish|start/i.test(o.label)) ?? opts.find((o) => !/change|show|add|no\b|cancel/i.test(o.label)) ?? opts[0];
        const pick = data.mode === "multi" ? opts.filter((o) => /read|contact/i.test(o.label)).slice(0, 2).map((o) => o.key) : go ? [go.key] : [];
        answered.add(id); questions++;
        say("person", `taps ${pick.map((k) => opts.find((o) => o.key === k)?.label ?? k).join(", ") || "(nothing)"}`);
        await ok("chat.answer_block", { threadId: thread, blockId: id, answer: { keys: pick } });
        lastNew = Date.now();
      }
      const types = ((await ok("sync_types.list", {})).syncedTypes as { type: string; connector: string }[]);
      if (types.length > 0 && !applied) { applied = true; say("note", `the agent applied the sync: record types ${types.map((t) => t.type).join(", ")}`); }
      if (applied) {
        const runs = ((await ok("runs.list", { kind: "connector_sync" })).runs ?? []) as { status: string }[];
        if (runs.length > 0 && runs.every((r) => r.status === "succeeded" || r.status === "failed")) done = true;
      }
      if (!done && Date.now() - lastNew > 360_000) { fs.writeFileSync(path.join(OUT, "host-log.txt"), hostLines(400)); throw new Error(`the agent went quiet for 6 minutes; the host log is in ${path.join(OUT, "host-log.txt")}`); }
      // every 30 s say what the thread holds, so a stop after the preview shows what the agent was doing (block kinds and states only, no values)
      if (Date.now() - lastTick > 30_000) {
        lastTick = Date.now();
        const kinds = new Map<string, number>();
        for (const m of msgs) for (const b of m.blocks ?? []) kinds.set(`${b.type}:${b.state ?? "-"}`, (kinds.get(`${b.type}:${b.state ?? "-"}`) ?? 0) + 1);
        say("tick", `${msgs.length} messages; blocks ${[...kinds].map(([k, n]) => `${k}x${n}`).join(" ")}; ${requests.length} GETs`);
      }
      await sleep(1500);
    }
    if (!done) throw new Error("the sync was not applied and pulled before the deadline");
    for (let i = 0; i < 20; i++) { await d.hooks?.pump?.(); await sleep(1000); }

    // ---- assertions through the API (counts and field names only)
    const fail = (why: string): never => { say("RESULT", `FAILED: ${why}`); save(); throw new Error(why); };
    const connectors = (await ok("connectors.list", { state: "live" })).connectors as { key: string; builtin: boolean; domains: string[]; actions: string[]; version: string }[];
    const built = connectors.find((c) => !c.builtin && c.key.startsWith("crm_"));
    if (!built) return fail("no live connector made from a sync spec");
    if (!built.domains.includes(HOST)) fail(`domains ${built.domains.join(",")}`);
    const conn = ((await ok("connections.list", {})).connections as { connector: string; handles: string[]; state: string }[]).find((c) => c.connector === built.key);
    if (!conn) return fail("no connection for the connector");
    if (!conn.handles.some((h) => h.startsWith(item.handle))) fail(`the connection holds ${conn.handles.join(",")}, not ${item.handle}`);
    const synced = (await ok("sync_types.list", {})).syncedTypes as { type: string; remote: string; fields: { key: string; dir: string }[] }[];
    if (synced.length === 0) return fail("no synced type");
    const described = (await ok("schema.describe", {})).types as { key: string; fields: { key: string; type: string }[] }[];
    const lines2: string[] = [];
    let total = 0;
    for (const t of synced) {
      const status = await ok("sync_types.status", { type: t.type });
      const q = (await ok("records.query", { type: t.type, limit: 50 })) as { rows?: unknown[]; records?: unknown[] };
      const n = (q.rows ?? q.records ?? []).length;
      total += n;
      const def = described.find((x) => x.key === t.type);
      lines2.push(`${t.type} (from ${t.remote}): ${n} records, state ${status.state}, fields ${(def?.fields ?? []).map((f) => `${f.key}:${f.type}`).join(" ")}; directions ${t.fields.map((f) => `${f.key}=${f.dir}`).join(" ")}`);
    }
    if (total === 0) fail("the first pull brought in no records");
    const spec = await ok("sync_specs.get", { connector: built.key });
    const specFacts = `${spec.spec.objects.length} objects, ${spec.spec.mapping.reduce((n: number, m: { fields: unknown[] }) => n + m.fields.length, 0)} mapped fields, first pull "${String(spec.spec.plan.firstPull.words).slice(0, 120)}", backfill ${spec.spec.plan.backfill}, handle ${spec.spec.auth.vaultHandle}`;
    if (spec.spec.auth.vaultHandle !== item.handle) fail(`the spec holds ${spec.spec.auth.vaultHandle}`);
    const gets = requests.length;
    say("RESULT", `PASSED. connector ${built.key} v${built.version} live; connection ${conn.state} holding ${conn.handles.join(",")}; ${specFacts}`);
    for (const l of lines2) say("RESULT", l);
    say("RESULT", `${questions} questions answered; ${gets} GET requests to ${HOST}, none other (paths: ${[...new Set(requests.map((r) => r.path.replace(/[0-9a-zA-Z]{20,}/g, ":id")))].join(", ")}); a write was never attempted`);
    d.sink.flush();
    const logs = JSON.stringify(new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT msg, attrs FROM logs").all());
    if (logs.includes(TOKEN) || logs.includes(KEY)) fail("a secret is in the host logs");
    save();
    if (/sk-ant|pit-[0-9a-f-]{12,}/i.test(fs.readFileSync(path.join(OUT, note("transcript") + ".md"), "utf8")) || fs.readFileSync(path.join(OUT, note("transcript") + ".md"), "utf8").includes(LOCATION)) throw new Error("the transcript holds a secret");
  } catch (e) {
    say("ERROR", e instanceof Error ? e.message : String(e));
    try { d.sink.flush(); fs.writeFileSync(path.join(OUT, note("host-log") + ".txt"), scrub((new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE msg LIKE '%threw%' OR level >= 40 OR cap LIKE 'sync_specs%' ORDER BY id DESC LIMIT 60").all() as { level: number; place?: string; cap?: string; msg: string; attrs?: string }[]).map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 700)}`).join("\n"))); } catch { /* the log is a help, not the result */ }
    // the raw thread with every tool answer, for finding why a tool failed; it can hold record values, so it stays in the scratchpad and is not part of the transcript
    try { if (threadId) fs.writeFileSync(path.join(OUT, note("messages-private") + ".json"), scrub(JSON.stringify((await ok("chat.messages.list", { threadId })).messages, null, 1))); } catch { /* best effort */ }
    save();
    process.exitCode = 1;
  } finally {
    // a turn still running when the run ends renews its lease on a closed database: stop it first, and leave the process rather than wait for its timers
    try { if (threadId) await ok("threads.cancel", { threadId }); } catch { /* not running */ }
    try { await d.stop(); } catch { /* closing */ }
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
  }
}
await main();
