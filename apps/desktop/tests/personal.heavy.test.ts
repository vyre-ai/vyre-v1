// @heavy: the BUILT Mac app's Personal Space and session import, end to end (the desktop job, VYRE_SHELL_APP and VYRE_PERSONAL_PROOF=1, macOS only).
// The app is started on a throwaway HOME that holds fixture Claude Code and Codex homes, and a PATH like the one a Finder launch gets (/usr/bin:/bin:/usr/sbin:/sbin). With VYRE_SHELL_PROOF_URL set,
// the shell's page runs the same commands the Settings screens call, over the real IPC (lib.rs PROOF): ensure_personal_space, discover_session_sources, read_session_source. This file is the
// loopback collector for what came back, then it does what the UI does with it over HTTP:
//   1. the packaged sidecar the app started for Personal (personal=true, roles space,device) is claimed with the setup link, and spaces.get says kind personal;
//   2. discovery listed the fixture sessions through the IPC, and the same payload the UI builds imports into the archive (sessions.import, sessions.list, sessions.get);
//   3. a chat turn runs: the model vendor stand-in is the fake `claude` CLI placed in ~/.local/bin, found on the app's PATH and started by the packaged sidecar under Seatbelt;
//   4. the app quits and starts again, and the claim, the import and the chat are still there.
// Not covered: a turn on an API-key account. The API drivers have no address override for a hosted provider (a Local model account is the only one with an address), so there is nowhere to point
// a vendor stand-in at; an API-key account on a CLI engine is refused by account resolution (the account's driver is the API driver).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { routes } from "../../../generated/routes.ts";

const APP = process.env["VYRE_SHELL_APP"];
const ON = process.platform === "darwin" && APP !== undefined && process.env["VYRE_PERSONAL_PROOF"] === "1";
const skip: string | false = ON ? false : "needs the built Mac app (VYRE_SHELL_APP) and VYRE_PERSONAL_PROOF=1";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = path.join(REPO, "apps/desktop/tests/fixtures/session-import");
const FAKE_CLI = path.join(REPO, "host/tests/fixtures/fake-cli-driver/fake-cli.mjs");

const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const TOKEN = "sk-ant-oat01-PERSONALPROOF0123456789abcdefXYZ"; // secret-scan: fake

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-personal-proof-")));
const data = path.join(home, "Library", "Application Support", "ai.vyre.desktop", "personal");

type Reply = { status: number; body: { data?: any; error?: { code?: string; message?: string } } };   // eslint-disable-line @typescript-eslint/no-explicit-any
// apps/desktop may not import apps/app (same layer); the UI's own payload builder is loaded by path (this file is listed in rules.dynamicOk in scripts/boundaries.json).
const { confirmedSessionInput } = await import(pathToFileURL(path.join(REPO, "apps/app/src/places/settings/session-import-model.ts")).href) as { confirmedSessionInput(p: unknown, now: number): unknown };
const routeOf = (cap: string): string => { const r = routes.find((x) => x.cap === cap); if (!r) throw new Error(`no route for ${cap}`); return r.path; };

function setup(): void {
  const claude = path.join(home, ".claude");
  fs.mkdirSync(claude, { recursive: true });
  for (const d of ["projects", "projects-archive"]) fs.cpSync(path.join(FIXTURES, "claude", d), path.join(claude, d), { recursive: true });
  fs.cpSync(path.join(FIXTURES, "claude", "Library"), path.join(home, "Library"), { recursive: true });
  fs.cpSync(path.join(FIXTURES, "codex"), path.join(home, ".codex"), { recursive: true });
  // Codex keeps its thread index in ~/.codex/state_5.sqlite (a `threads` table whose rollout_path names the transcript); the shell lists a Codex session from that index, never by scanning the folder.
  // The fixture is the rollout file only, so the index is made here, the way Codex writes a row.
  const index = new DatabaseSync(path.join(home, ".codex", "state_5.sqlite"));
  index.exec("CREATE TABLE threads(id TEXT, rollout_path TEXT, cwd TEXT, created_at INTEGER, updated_at INTEGER, git_branch TEXT, git_origin_url TEXT)");
  index.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?)").run("11111111-1111-4111-8111-111111111111", "sessions/2026/10/25/rollout-11111111-1111-4111-8111-111111111111.jsonl", "/workspace/vyre", 1761382800, 1761382802, "main", null);
  index.close();
  // The model vendor stand-in: `claude` on the PATH the sidecar builds for a Finder launch. The packaged Node (the sidecar binary beside the app's executable) runs the fake.
  const share = path.join(home, ".local", "share", "vyre-proof");
  const bin = path.join(home, ".local", "bin");
  fs.mkdirSync(share, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.copyFileSync(FAKE_CLI, path.join(share, "fake-cli.mjs"));
  const sidecar = path.join(path.dirname(APP as string), "vyred");
  assert.ok(fs.existsSync(sidecar), `the packaged sidecar is beside the app executable: ${sidecar}`);
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\nexec "${sidecar}" "${path.join(share, "fake-cli.mjs")}" claude "$@"\n`, { mode: 0o755 });
}

function launch(proofUrl: string | null): { app: ChildProcess; out: () => string } {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  delete env["VYRE_ADMIN_TOKEN"];
  if (proofUrl) env["VYRE_SHELL_PROOF_URL"] = proofUrl;
  const app = spawn(APP as string, [], { env });
  let out = "";
  app.stdout?.on("data", (c: Buffer) => { out += c.toString("utf8"); });
  app.stderr?.on("data", (c: Buffer) => { out += c.toString("utf8"); });
  return { app, out: () => out };
}

async function until<T>(what: string, f: () => T | Promise<T> | undefined | false | null, ms = 60_000, out: () => string = () => ""): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error(`not seen in ${ms / 1000} s: ${what}\n${out().slice(-2500)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

function collector(): Promise<{ url: string; got: Promise<any>; close(): void }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  let resolve!: (v: unknown) => void;
  const got = new Promise<unknown>((r) => { resolve = r; });
  const server = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString("utf8"); });
    req.on("end", () => { res.writeHead(204).end(); try { resolve(JSON.parse(body)); } catch { resolve({ errors: [`collector got ${body.slice(0, 200)}`] }); } });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, got, close: () => server.close() })));
}

async function post(url: string, token: string | null, cap: string, body: unknown = {}): Promise<Reply> {
  const r = await fetch(`${url}${routeOf(cap)}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : {} };
}
/** The Personal daemon's own error log (its logs.db under the data dir), newest first: a 500 answers only a trace id, and the handler's stack is here. Empty when the file cannot be read. */
function daemonLogTail(): string {
  try {
    const db = new DatabaseSync(path.join(data, "logs.db"), { readOnly: true });
    const rows = db.prepare("SELECT level, cap, msg, attrs FROM logs WHERE level >= 40 ORDER BY id DESC LIMIT 5").all() as { level: number; cap: string | null; msg: string; attrs: string | null }[];
    db.close();
    return rows.length ? `\ndaemon log (errors, newest first):\n${rows.map((r) => `  ${r.level} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 900)}`).join("\n")}` : "";
  } catch { return ""; }
}
const ok = (r: Reply, what: string): any => { assert.equal(r.status, 200, `${what}: ${r.status} ${JSON.stringify(r.body.error ?? r.body).slice(0, 400)}${r.status === 200 ? "" : daemonLogTail()}`); return r.body.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any

/** What the sidecar left behind, for a failure message: the app's own output (the sidecar's stderr is in it) and the tail of every file the Personal daemon wrote under its logs folder. */
function diagnostics(appOut: string): string {
  const parts = [`app output (tail):\n${appOut.slice(-3500)}`];
  try {
    const walk = (dir: string, depth = 0): string[] => (depth > 3 ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), depth + 1) : [path.join(dir, e.name)])));
    const files = fs.existsSync(data) ? walk(data).filter((f) => !/\.(db|sqlite|wal|shm)(-\w+)?$/.test(f)) : [];
    parts.push(`personal data dir ${data}:\n${files.map((f) => `${path.relative(data, f)} ${fs.statSync(f).size}`).join("\n") || "(missing)"}`);
    for (const f of files.filter((x) => /(logs\/|vyred\.json)/.test(x) && !/claim-link/.test(x)).slice(0, 6)) parts.push(`--- ${path.relative(data, f)}\n${fs.readFileSync(f, "utf8").slice(-1500)}`);
  } catch (e) { parts.push(`(could not read the data dir: ${String(e)})`); }
  return parts.join("\n");
}

function quit(app: ChildProcess): Promise<void> {
  const exited = new Promise<void>((r) => app.once("exit", () => r()));
  const q = spawnSync("osascript", ["-e", 'tell application id "ai.vyre.desktop" to quit'], { encoding: "utf8" });
  assert.equal(q.status, 0, `normal quit failed: ${q.stderr}`);
  return Promise.race([exited, new Promise<void>((_, bad) => setTimeout(() => { app.kill("SIGKILL"); bad(new Error("the app did not exit after a normal quit")); }, 15_000))]);
}

const state: { url: string; token: string; chatThread: string; sources: any[]; imported: string[] } = { url: "", token: "", chatThread: "", sources: [], imported: [] };   // eslint-disable-line @typescript-eslint/no-explicit-any

async function signIn(): Promise<string> {
  const r = ok(await post(state.url, null, "identity.sign_in", { username: "proof", password: PASSWORD, deviceName: "Proof Mac", deviceClass: "desktop" }), "sign_in");
  return r.session.token as string;
}

test("the built app starts Personal, claims over HTTP, imports fixture sessions found over the IPC, and runs a chat turn on the sandboxed CLI; then it restarts and all of it is still there", { skip, timeout: 420_000 }, async () => {
  setup();
  const c = await collector();
  const first = launch(c.url);
  try {
    const proof = await Promise.race([c.got, new Promise((_, bad) => setTimeout(() => bad(new Error(`the page never reported over the IPC:\n${first.out().slice(-2500)}`)), 90_000))]) as any;   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(proof.errors, [], `every command the page called over the IPC answered\n${proof.errors.length ? diagnostics(first.out()) : ""}`);

    // ---- 1. Personal, started by the app as the UI starts it, claimed over HTTP
    const p = proof.personal;
    assert.match(p.address, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(p.spaceId, /^spc_/);
    assert.ok(p.claimUrl, "a fresh Personal Space hands the page its setup link");
    state.url = p.address;
    const info = JSON.parse(fs.readFileSync(path.join(data, "vyred.json"), "utf8")) as { space: string };
    assert.equal(info.space, p.spaceId);
    const health = await (await fetch(`${state.url}/healthz`)).json() as { roles: string[] };
    assert.deepEqual([...health.roles].sort(), ["device", "space"], "launched with role space,device");
    const code = decodeURIComponent(new URL(p.claimUrl).pathname.split("/").pop() ?? "");
    ok(await post(state.url, null, "identity.claim_owner", { code, spaceId: p.spaceId, username: "proof", displayName: "Proof", password: PASSWORD, deviceName: "Proof Mac", deviceClass: "desktop", keys: KEYS }), "claim_owner");
    state.token = await signIn();
    assert.equal(ok(await post(state.url, state.token, "spaces.get"), "spaces.get").space.kind, "personal");

    // ---- 2. session import: discovery and reads came over the real IPC; the payload is the one the UI builds
    state.sources = proof.sources;
    const keys = (proof.sources as { sessionKey: string }[]).map((s) => s.sessionKey).sort();
    assert.deepEqual(keys, [
      "claude:22222222-2222-4222-8222-222222222222", "claude:44444444-4444-4444-8444-444444444444", "codex:11111111-1111-4111-8111-111111111111",
    ].sort(), "the shell found the fixture Claude Code and Codex sessions under the app's HOME (a Claude subagent transcript is not a session of its own: it travels with its parent)");
    const parentRead = (proof.reads as { source: { sessionKey: string }; documents: { namespace: string }[] }[]).find((r) => r.source.sessionKey === "claude:22222222-2222-4222-8222-222222222222");
    assert.ok(parentRead?.documents.some((d) => d.namespace === "subagent:33333333-3333-4333-8333-333333333333"), "the parent's read carries its subagent transcript");
    assert.ok(proof.sources.every((s: Record<string, unknown>) => !("transcriptPath" in s)), "the native transcript path never reaches the page");
    const { desktopSessionImporter } = await import("../../../client/src/session-import/desktop.ts");
    const reads = new Map<string, unknown>((proof.reads as { source: { sessionKey: string } }[]).map((r) => [r.source.sessionKey, r]));
    const importer = desktopSessionImporter({ __TAURI__: { core: { invoke: async (cmd: string, args?: Record<string, unknown>) => (cmd === "discover_session_sources" ? proof.sources : reads.get(String(args?.["sessionKey"])) ) } } } as never);
    assert.ok(importer);
    const found = await importer.discover();
    const codex = found.find((s) => s.provider === "codex");
    assert.ok(codex);
    for (const source of [codex, found.find((s) => s.sessionKey === "claude:22222222-2222-4222-8222-222222222222")!]) {
      const session = await importer.preview(source);
      const done = ok(await post(state.url, state.token, "sessions.import", confirmedSessionInput({ source, session, at: Date.now() - 1000 }, Date.now())), `sessions.import ${source.sessionKey}`);
      assert.equal(done.imported, 1);
      state.imported.push(done.sessions[0].conversationId as string);
    }
    const listed = ok(await post(state.url, state.token, "sessions.list"), "sessions.list").sessions as { conversationId: string }[];
    for (const id of state.imported) assert.ok(listed.some((s) => s.conversationId === id), "the import landed in the archive");
    const read = ok(await post(state.url, state.token, "sessions.get", { conversationId: state.imported[0] }), "sessions.get");
    assert.ok(JSON.stringify(read.messages).includes("Plan the release"), "the archive holds the Codex transcript text");

    // ---- 3. a chat turn: the packaged sidecar runs `claude` (the stand-in) under Seatbelt
    const adminToken = fs.readFileSync(path.join(data, "admin.token"), "utf8").trim();
    const unlock = await fetch(`${state.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204, `vault key unlock: ${unlock.status} ${await unlock.text()}`);
    const folder = ok(await post(state.url, state.token, "vault.folders.create", { idempotencyKey: "pp-folder", name: "Accounts", scope: "mine" }), "vault.folders.create").folder.id as string;
    const flow = ok(await post(state.url, state.token, "providers.subscription_start", { idempotencyKey: "pp-flow", providerKey: "claude-code" }), "subscription_start").flowId as string;
    ok(await post(state.url, state.token, "vault.item.put", { idempotencyKey: "pp-item", folderId: folder, name: "Proof_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: TOKEN, secret: true }] }), "vault.item.put");
    const provider = ok(await post(state.url, state.token, "providers.subscription_complete", { flowId: flow }), "subscription_complete").provider as { id: string };
    ok(await post(state.url, state.token, "providers.set_space_use", { idempotencyKey: "pp-use", providerId: provider.id, allow: true }), "set_space_use");
    const agent = ok(await post(state.url, state.token, "agents.create", { idempotencyKey: "pp-agent", name: "Mailer", role: "Writes the weekly note" }), "agents.create").agent.agentId as string;
    state.chatThread = ok(await post(state.url, state.token, "chat.start", { idempotencyKey: "pp-chat", kind: "chat", agentIds: [agent] }), "chat.start").thread.threadId as string;
    ok(await post(state.url, state.token, "engine.pool.status"), "engine.pool.status");
    ok(await post(state.url, state.token, "chat.post", { idempotencyKey: "pp-hello", threadId: state.chatThread, body: "hello", mentions: [{ kind: "agent", id: agent }] }), "chat.post");
    await until("the agent's reply from the sandboxed CLI", async () => {
      const msgs = ok(await post(state.url, state.token, "chat.messages.list", { threadId: state.chatThread }), "chat.messages.list").messages as { author?: { kind?: string }; body?: string }[];
      return msgs.some((m) => m.author?.kind === "agent" && (m.body ?? "").includes("Hello from the fake engine."));
    }, 60_000, first.out);
    const turns = ok(await post(state.url, state.token, "engine.turns.list", { threadId: state.chatThread }), "engine.turns.list").turns as { state: string; tokensIn: number; tokensOut: number }[];
    assert.ok(turns.some((t) => t.state === "completed" && t.tokensIn > 0 && t.tokensOut > 0), `a completed turn holds the usage: ${JSON.stringify(turns)}`);
  } finally {
    c.close();
    if (first.app.exitCode === null) await quit(first.app).catch(() => first.app.kill("SIGKILL"));
  }
  // the sidecar the app started goes with it
  await until("the Personal sidecar to stop with the app", () => !fs.existsSync(path.join(data, "vyred.json")), 20_000);

  // ---- 4. restart: the app starts the existing profile by itself, and the data is still there
  const second = launch(null);
  try {
    const url = await until("the Personal sidecar to come back", () => {
      try { return (JSON.parse(fs.readFileSync(path.join(data, "vyred.json"), "utf8")) as { url?: string }).url; } catch { return undefined; }
    }, 60_000, second.out) as string;
    await until("healthz", async () => { try { return (await fetch(`${url}/healthz`)).status === 200; } catch { return false; } }, 30_000, second.out);
    state.url = url;
    state.token = await signIn();
    assert.equal(ok(await post(state.url, state.token, "spaces.get"), "spaces.get after restart").space.kind, "personal");
    const listed = ok(await post(state.url, state.token, "sessions.list"), "sessions.list after restart").sessions as { conversationId: string }[];
    for (const id of state.imported) assert.ok(listed.some((s) => s.conversationId === id), "the imported sessions survived the restart");
    const msgs = ok(await post(state.url, state.token, "chat.messages.list", { threadId: state.chatThread }), "chat.messages.list after restart").messages as { body?: string }[];
    assert.ok(msgs.some((m) => (m.body ?? "").includes("Hello from the fake engine.")), "the chat survived the restart");
  } finally {
    if (second.app.exitCode === null) await quit(second.app).catch(() => second.app.kill("SIGKILL"));
    fs.rmSync(home, { recursive: true, force: true });
  }
});
