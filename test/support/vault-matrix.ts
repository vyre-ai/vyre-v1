// The Vault matrix (lane l-vaultmatrix, owner 3 Nov: "Saving things to vault and vault working ... from any space ... on any server. It just needs to work.").
// Every combination of six axes is a cell (cells() below makes them all): where the Space runs, who, where they are signed in from, what Spaces they have, the item's scope, and where the turn runs.
// Each cell saves an item, uses it in a chat turn, in an automation and in a connection, shares it, and checks that nobody else can use it and that it never shows in another Space. A cell either
// works, or is truly impossible and is refused once in plain words that say what to do instead (IMPOSSIBLE below holds those words, and the server must answer with exactly them).
// Real daemons: Team Space servers with the real Vault and identity (people sign in with passwords, Google, or an outside agent with the setup grant, and hand their key over at the Space's door
// the way the app does), a Personal Space, and a person's own computer linked to the Space (lane l-runson). Only the providers are stand-ins: the API drivers and connectors reach a fake provider
// that answers with a short hash of the key it was sent, and the CLI engine is the fake claude, which does the same with the key it was started with. So a green cell means the right value
// arrived at the provider, not just that a call said ok.
// Cells that send the same calls to the same Space share one run (the run key is the cell's server-side shape); the table still lists every cell.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { createIdp } from "../../fixtures/suite/idp.ts";
import { fakePlatform } from "../../host/src/platform/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";
import { makeBundle } from "../../client/src/crypto/keys.ts";
import { issueSessionToken } from "../../host/src/daemon/session.ts";
import { runComputeNode } from "../../host/src/compute/node.ts";
import type { NodeLauncher, NodeProc } from "../../host/src/compute/node.ts";
import { defaultSandbox } from "../../modules/engine/sandbox-default.ts";
import { spawnCli } from "../../modules/engine/session.ts";
import { AUTOMATION_ROLE_LINE, CHAT_ROLE_LINE, OUTSIDE_AGENT_ROLE_LINE, PERSON_LACKS_ROLE_LINE, CONNECTION_KEY_LINE, CONNECTION_ROLE_LINE, SPACE_KEY_ROLE_LINE, VAULT_ROLE_LINE } from "../../lib/vault-lines.ts";
import { Client, signIn as mcpSignIn } from "./outside-client.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

// ---- the axes and the cells

export const SPACES = ["personal", "team", "personal_second"] as const;
export const WHO = ["owner", "admin", "member", "member_sso", "guest"] as const;
export const FROM = ["desktop", "web", "phone", "mcp"] as const;
export const HAS = ["no_personal", "personal", "two_teams"] as const;
export const SCOPE = ["mine", "group", "space", "space_ai_key"] as const;
export const RUNS = ["server", "own_computer", "owner_server"] as const;
export const ACTIONS = ["save", "chat", "automation", "connection", "share"] as const;

export type SpaceKind = typeof SPACES[number]; export type Who = typeof WHO[number]; export type From = typeof FROM[number];
export type Has = typeof HAS[number]; export type Scope = typeof SCOPE[number]; export type Runs = typeof RUNS[number]; export type Action = typeof ACTIONS[number];
export interface Cell { space: SpaceKind; who: Who; from: From; has: Has; scope: Scope; runs: Runs }

export function cells(): Cell[] {
  const out: Cell[] = [];
  for (const space of SPACES) for (const who of WHO) for (const from of FROM) for (const has of HAS) for (const scope of SCOPE) for (const runs of RUNS) out.push({ space, who, from, has, scope, runs });
  return out;
}
export const label = (c: Cell): string => `${c.space}/${c.who}/${c.from}/${c.has}/${c.scope}/${c.runs}`;

/** What a cell must do: work, or be refused with exactly these words. */
export type Expect = { ok: true } | { line: string } | { na: string };
export const OK: Expect = { ok: true };

/** The plain words of every truly impossible combination: what happened and what to do instead. The server answers with exactly these. */
export const IMPOSSIBLE = {
  personalShare: "Sharing with other people needs a Team Space. Create or join one to share this.",
  guestVault: VAULT_ROLE_LINE,
  spaceKeyRole: SPACE_KEY_ROLE_LINE,
  connectionRole: CONNECTION_ROLE_LINE,
  connectionKey: CONNECTION_KEY_LINE,
  chatRole: CHAT_ROLE_LINE,
  automationRole: AUTOMATION_ROLE_LINE,
  personalSpaceKey: "Needs a Team Space. Create or join one to use this.",
  agentPersonRole: PERSON_LACKS_ROLE_LINE,
  agentRole: OUTSIDE_AGENT_ROLE_LINE,
  // Sharing with Everyone is an admin's (owner D22, l-team1): a member or guest shares with the people who need it, or a group
  everyoneRole: "Only an admin shares with everyone in the Space. Ask an admin, or share it with the people who need it.",
} as const;

/** A cell that cannot exist at all: there is nobody to ask (a Personal Space has one person), or the axes contradict each other. */
export function absent(c: Cell): string | null {
  if (c.space !== "team" && c.who !== "owner") return "A Personal Space has one person: its owner.";
  if (c.space !== "team" && c.has === "no_personal") return "This Space is their Personal Space.";
  return null;
}

/** What each action of a cell must come to. */
export function expected(c: Cell): Record<Action, Expect> {
  const all = (e: Expect): Record<Action, Expect> => ({ save: e, chat: e, automation: e, connection: e, share: e });
  if (c.space !== "team") {
    if (c.scope === "group" || c.scope === "space") return { ...all(OK), share: { line: IMPOSSIBLE.personalShare }, connection: OK };
    // a Personal Space has no Space AI key: the person's own accounts pay for their turns
    if (c.scope === "space_ai_key") return all({ line: IMPOSSIBLE.personalSpaceKey });
    return all(OK);
  }
  const manager = c.who === "owner" || c.who === "admin";
  const out = all(OK);
  // a guest keeps nothing in the Vault: their own Mine is refused in plain words; what others share with them they use
  // a guest connects no outside agent: their agent never gets in, said once (the Allow screen shows the same words)
  if (c.who === "guest" && c.from === "mcp") return all({ line: IMPOSSIBLE.agentRole });
  if (c.who === "guest" && c.scope === "mine") return all({ line: IMPOSSIBLE.guestVault });
  // the Space AI key is set by an owner or admin; once set it covers everyone
  if (!manager && c.scope === "space_ai_key" && c.who !== "guest") out.save = { line: IMPOSSIBLE.spaceKeyRole };
  // a key for the whole Space is shared with Everyone, which only an owner or admin does (owner D22, l-team1)
  if (!manager && c.scope === "space") out.share = { line: IMPOSSIBLE.everyoneRole };
  // apps are connected by owners and admins (a member's own connections come with Vault, Connections: lane l-connections)
  // (their outside agent is told the same in its own words: the person it acts for cannot either)
  if (!manager) out.connection = { line: c.from === "mcp" ? IMPOSSIBLE.agentPersonRole : IMPOSSIBLE.connectionRole };
  // a guest starts no chats and runs no automations: what is shared with them is used where an owner or admin puts them
  if (c.who === "guest") { out.chat = { line: IMPOSSIBLE.chatRole }; out.automation = { line: IMPOSSIBLE.automationRole }; }
  // the Space AI key pays for AI turns and goes nowhere else: no connection takes it
  if (c.scope === "space_ai_key") out.connection = { na: "the Space AI key pays for AI turns only" };
  return out;
}

// ---- the fake provider

export const FAKE_CLI = fileURLToPath(new URL("../../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
/** A key as the fake provider reports it: a short hash, never the key. */
export const sha12 = (v: string): string => crypto.createHash("sha256").update(v).digest("hex").slice(0, 12);
export const PASSWORD = "matrix horse battery staple 7";

/** What reached the fake provider: the address and the hash of the key it carried. */
export interface Seen { url: string; key: string }
export interface Provider { seen: Seen[]; apiFetch: typeof fetch; network: { resolve(host: string): Promise<string[]>; request(url: URL, req: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; text: string }> } }

export function fakeProvider(): Provider {
  const seen: Seen[] = [];
  const keyOf = (h: Record<string, string>): string => (h["authorization"] ?? h["x-api-key"] ?? "").replace(/^(Bearer|Basic) /i, "");
  const sse = (text: string): Response => {
    const chunk = (d: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", content: text }) + chunk({}, "stop") + `data: ${JSON.stringify({ id: "c1", choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  const apiFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((v, k) => { headers[k] = v; });
    const key = keyOf(headers);
    seen.push({ url, key: key === "" ? "none" : sha12(key) });
    if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "matrix-model" }] }), { headers: { "content-type": "application/json" } });
    if (url.endsWith("/chat/completions")) return sse(`key=${key === "" ? "none" : sha12(key)} ran-on=space`);
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const network: Provider["network"] = {
    resolve: async () => ["93.184.216.34"],
    request: async (url, req) => { const lower = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)])); const key = keyOf(lower); seen.push({ url: url.toString(), key: key === "" ? "none" : sha12(key) }); return { status: 200, text: '{"ok":true,"results":[]}' }; },
  };
  return { seen, apiFetch, network };
}

// ---- daemons

export function seeded(prefix: string): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const platformOf = (dir: string, host: string) => fakePlatform({ os: "linux", hostname: host, free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } });
const INTERVALS = { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 };

export const ISSUER = "https://accounts.google.com";
export const SSO_CLIENT = "matrix-app-client";
export const SSO_SECRET = "matrix-client-secret-123";
export const SSO_DOMAIN = "firm.test";

/** A Space with the real Vault and identity. Team: a server. Personal: the person's own computer. */
export async function bootSpace(kind: "team" | "personal", p: Provider, idp?: ReturnType<typeof createIdp>): Promise<{ d: Daemon; dir: string }> {
  const dir = seeded(`vyre-vm-${kind}-`);
  const idpFetch = idp ? async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) => {
    const a = await idp.api({ method: init?.method ?? "GET", url, headers: init?.headers ?? {}, body: init?.body });
    const body = a?.text ?? (a?.json === undefined ? "" : JSON.stringify(a.json));
    return { status: a?.status ?? (a === undefined ? 404 : 200), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer, headers: { get: () => null as string | null } };
  } : undefined;
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", kind], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: platformOf(dir, `vm-${kind}`), fetch: caddyFetch, intervals: INTERVALS,
    engineCli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)], apiFetch: p.apiFetch } as never,
    computeStreamSecure: () => true, computeStreamRecheckMs: 200,
    connectorNetwork: p.network as never,
    documentNetwork: { fetch: p.apiFetch, lookup: async () => ["93.184.216.34"] },
    providerFetch: p.apiFetch,
    ...(idpFetch ? { seams: { fetch: idpFetch } } : {}),
  } as Parameters<typeof startDaemon>[0]);
  return { d, dir };
}

export interface Reply { status: number; data: Json; code?: string; message?: string }
export async function api(d: Daemon, token: string | null, cap: string, input: unknown): Promise<Reply> {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const b = (await r.json().catch(() => ({}))) as { data?: unknown; error?: { code?: string; message?: string } };
  return { status: r.status, data: b.data ?? b, ...(b.error?.code ? { code: b.error.code } : {}), ...(b.error?.message ? { message: b.error.message } : {}) };
}
let idem = 0;
export const key = (p: string): string => `${p}-${++idem}`;
export async function ok(d: Daemon, token: string, cap: string, input: Record<string, unknown> = {}): Promise<Json> {
  const r = await api(d, token, cap, { idempotencyKey: key("vm"), ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data).slice(0, 400)}`);
  return r.data;
}

/** The Space's key door as the app reaches it: https through the proxy on the server, or this computer's own door. */
export const door = (d: Daemon, token: string, op: "unlock" | "lock" | "status", k?: Uint8Array, local = false): Promise<Response> =>
  fetch(`${d.url}/${local ? "local/" : ""}vault/key/${op}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(local ? {} : { "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.7" }) }, ...(k ? { body: JSON.stringify({ key: Buffer.from(k).toString("base64") }) } : {}) });

export function hostLog(d: Daemon): string {
  d.sink.flush();
  return "";
}

export async function waitFor<T>(f: () => Promise<T | null>, ms = 20_000, why = ""): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v !== null) return v;
    if (Date.now() > end) throw new Error(`waitFor: it never happened ${why}`);
    await new Promise<void>((r) => setTimeout(r, 100));
  }
}

// ---- people and their sessions


const FAST = { memoryKiB: 8, iterations: 1, parallelism: 1 };
export interface Person { id: string; username: string; personKey: Uint8Array; tokens: Partial<Record<From, string>> }
const CLASS: Record<Exclude<From, "mcp">, string> = { desktop: "desktop", web: "web", phone: "phone" };

/** A seeded person gets a real key bundle (the seed's is opaque), the way their client made it at join. */
export async function seededPerson(d: Daemon, id: string): Promise<Person> {
  const made = await makeBundle(PASSWORD, "recovery-code-matrix", { argon: FAST, spaceId: d.space ?? "spc_core" });
  const { personKey, ...rest } = made;
  const keys = { personKeyByPassword: rest.personKeyByPassword, personKeyByRecovery: rest.personKeyByRecovery, publicKey: rest.publicKey, privateKeyWrapped: rest.privateKeyWrapped, spaceKeys: rest.spaceKeys };
  const username = id.replace(/^usr_/, "");
  d.db!.run(`INSERT INTO identity_accounts (person_id, username, name, verifier, totp_secret, totp_last_step, github_id, github_login, keys_json, recovery_hash, fails, locked_until, epoch, created_at) VALUES (?, ?, ?, ?, NULL, 0, NULL, NULL, ?, NULL, 0, 0, 0, ?)
    ON CONFLICT(person_id) DO UPDATE SET keys_json = excluded.keys_json`, id, username, username, "argon2id$8$1$x$x", JSON.stringify(keys), Date.now());
  return { id, username, personKey: Uint8Array.from(personKey), tokens: {} };
}

/** A device session as signing in makes one (desktop, browser or phone), then the key handed over at the door the app uses for this Space. */
export async function signInFrom(d: Daemon, p: Person, from: Exclude<From, "mcp">, local = false): Promise<string> {
  const now = Date.now(), device = `dev_${p.username}_${from}`, session = `ses_${p.username}_${from}`;
  d.db!.run(`INSERT OR IGNORE INTO devices_device (id, person, name, class, epoch, lastSeenAt, location, revokedAt, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, 0, ?, NULL, NULL, 0, ?, NULL)`, device, p.id, `${p.username} ${from}`, CLASS[from], now, now);
  d.db!.run(`INSERT OR IGNORE INTO devices_session (id, person, kind, principal_kind, device_id, started_at, last_seen_at, location, revoked_at) VALUES (?, ?, 'device', 'person', ?, ?, ?, NULL, NULL)`, session, p.id, device, now, now);
  const token = issueSessionToken(d.db! as never, session);
  const r = await door(d, token, "unlock", p.personKey, local);
  assert.equal(r.status, 204, `${p.username} ${from}: the key door said ${r.status} ${await r.text()}`);
  p.tokens[from] = token;
  return token;
}

/** A person who joins with an invite, the way the invite page does it: a real bundle under their password; the key their client unwrapped goes to the Space's door. */
export async function joinAs(d: Daemon, owner: string, username: string, role: string, email?: string, handOver = true): Promise<Person> {
  const roles = (await ok(d, owner, "access.roles.list")).roles as { id: string; name: string }[];
  const inv = await ok(d, owner, "members.invites.create", { role: roles.find((r) => r.name === role)!.id, ...(email ? { email } : {}) });
  const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
  const made = await makeBundle(PASSWORD, "recovery-code-matrix", { argon: FAST, spaceId: d.space ?? "spc_core" });
  const { personKey, ...rest } = made;
  const keys = { personKeyByPassword: rest.personKeyByPassword, personKeyByRecovery: rest.personKeyByRecovery, publicKey: rest.publicKey, privateKeyWrapped: rest.privateKeyWrapped, spaceKeys: rest.spaceKeys };
  const r = await fetch(`${d.url}/v1/members/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username, displayName: username, password: PASSWORD, deviceName: `${username}'s PC`, deviceClass: "desktop", keys }) });
  assert.equal(r.status, 200, await r.clone().text());
  const out = ((await r.json()) as { data: { personId: string; token: string } }).data;
  const p: Person = { id: out.personId, username, personKey: Uint8Array.from(personKey), tokens: {} };
  // the new member's session is good once the Space has folded the join in
  if (handOver) await waitFor(async () => { await d.hooks?.pump?.(); return (await door(d, out.token, "unlock", p.personKey)).status === 204 ? true : null; }, 10_000, `${username}'s key at the door`);
  return p;
}

/** Password sign-in from a device class, and the key handed over (the app does both on every sign-in). */
export async function passwordSignIn(d: Daemon, p: Person, from: Exclude<From, "mcp">): Promise<string> {
  const r = await api(d, null, "identity.sign_in", { username: p.username, password: PASSWORD, deviceName: `${p.username} ${from}`, deviceClass: CLASS[from] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const token = r.data.session.token as string;
  // this rig runs the module hooks by hand (its timers are an hour): the join is folded into access before the door is asked
  await waitFor(async () => { await d.hooks?.pump?.(); return (await door(d, token, "unlock", p.personKey)).status === 204 ? true : null; }, 10_000, `${p.username}'s key at the door`);
  p.tokens[from] = token;
  return token;
}

/** Google sign-in on the server (no password typed): the Space opens the key it keeps sealed for this person. */
export async function googleSignIn(d: Daemon, idp: ReturnType<typeof createIdp>, p: Person, email: string, from: Exclude<From, "mcp">): Promise<string> {
  const start = await fetch(`${d.url}/auth/sso/google/start?return=${encodeURIComponent(`${d.url}/app`)}`, { redirect: "manual" });
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get("location")!);
  const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
  const back = await fetch(`${d.url}/auth/sso/google/callback?state=${encodeURIComponent(to.searchParams.get("state")!)}&code=${encodeURIComponent(idp.approve(to.toString(), { sub: `${p.username}-google-id`, email, email_verified: true, hd: SSO_DOMAIN }))}`, { redirect: "manual", headers: { cookie } });
  assert.equal(back.status, 302);
  const fragment = new URLSearchParams(new URL(back.headers.get("location")!).hash.slice(1));
  const signed = await api(d, null, "identity.sso_sign_in", { provider: "google", code: fragment.get("sso_code"), state: "-", deviceName: `${p.username} ${from}`, deviceClass: CLASS[from] });
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  p.tokens[from] = signed.data.session.token as string;
  return p.tokens[from]!;
}

/** An outside agent (Claude Code over MCP) the person let act for them, including setup. */
export async function outsideAgent(d: Daemon, personToken: string, setup = true): Promise<{ c: Client; agentId: string; setup: boolean }> {
  const s = { d, call: async (cap: string, token: string, body: unknown) => { const r = await api(d, token, cap, body); return { status: r.status, body: { data: r.data, ...(r.code ? { error: { code: r.code, message: r.message } } : {}) } }; } };
  const c = new Client(`${d.url}/mcp`, {}, "Matrix (Claude Code)");
  const { agentId } = await mcpSignIn(s as never, c, personToken, { setup });
  await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1" } });
  return { c, agentId, setup };
}
/** One tool call through use_tool: { isError, text } (text is the result as the agent reads it). */
export async function tool(c: Client, name: string, args: unknown): Promise<{ isError: boolean; text: string; data: Json }> {
  const res = (await c.tool("use_tool", { name, arguments: args })).json;
  const result = res.result ?? { isError: true, content: [{ type: "text", text: JSON.stringify(res.error ?? res) }] };
  const text = (result.content ?? []).map((x: { text?: string }) => x.text ?? "").join("\n");
  return { isError: result.isError === true, text, data: result.structuredContent?.data ?? result.structuredContent ?? null };
}

// ---- a Team Space with everyone in it


/** Acme, an API-key connector a person connects their own account to, made and published in this Space the way an agent does it (init, define, publish); it is a personal connector (each person
 * connects their own account), so a person's own Mine key may go into it. One ping action; its key is named by Vault handle. */
export async function publishAcme(d: Daemon): Promise<void> {
  await ok(d, d.token, "connectors.init", { key: "acmeme", mode: "api", title: "Acme", source: false });
  await ok(d, d.token, "connectors.define", { key: "acmeme", domains: ["api.acme.test"], auth: { type: "api_key", secret: "Acme_Key", header: "X-Api-Key" }, secrets: [{ name: "Acme_Key", description: "API key for Acme" }], actions: [{ name: "ping", url: "https://api.acme.test/v1/ping", output: "/ok" }] });
  await ok(d, d.token, "connectors.publish", { key: "acmeme" });
  // the connectors module keeps its tables in the Space database
  const db = new DatabaseSync(path.join(d.paths.root, "space.db"));
  try {
    const row = db.prepare("SELECT def FROM cn_connectors WHERE key = 'acmeme'").get() as { def: string };
    db.prepare("UPDATE cn_connectors SET scope = 'person', def = ? WHERE key = 'acmeme'").run(JSON.stringify({ ...JSON.parse(row.def), scope: "person", health: "ping" }));
  } finally { db.close(); }
}

/** The person's own computer: the Vyre app's device daemon, linked to the Team Space with their desktop session (lane l-runson). Its engines are the fake claude, told it runs on the device, in this
 * computer's own sandbox. The Space fills the key the turn needs into the engine it starts here. */
export async function bootComputer(space: Daemon, personId: string, token: string): Promise<{ d: Daemon; stop(): Promise<void> }> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-vm-mac-")));
  const sandbox = await defaultSandbox({ dataDir: dir, programRead: [path.dirname(FAKE_CLI)] });
  const launcher: NodeLauncher = {
    async spawn(spec) {
      const proc = await spawnCli(sandbox.plan, { argv: spec.argv, env: { ...spec.env, FAKE_WHERE: "device" }, ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}) }, [process.execPath, FAKE_CLI, ...spec.argv]);
      return proc as unknown as NodeProc;
    },
  };
  const d = await startDaemon({
    config: loadConfig(["--role", "device", "--data-dir", dir, "--port", "0"], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: platformOf(dir, "vm-mac"), fetch: caddyFetch, intervals: INTERVALS,
    deviceLink: { launcher, engines: ["claude_code"], name: "Their Mac", retryMs: 100 },
  } as Parameters<typeof startDaemon>[0]);
  const r = await fetch(`${d.url}/local/chrome/spaces`, { method: "POST", headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, body: JSON.stringify({ id: space.space ?? "spc_core", name: "Core", address: space.url, token }) });
  assert.equal(r.status, 204, `link: ${r.status}`);
  await waitFor(async () => (space.nodeRelay.devices(personId).some((l) => l.engines.length > 0) ? true : null), 15_000, "the computer links");
  return { d, stop: async () => { await d.stop(); await sandbox.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

/** The owner's own server, joined to the Space as a computer of theirs (`vyred --role compute --join`): it runs the owner's turns and nobody else's, with the key filled in by the Space over its
 * private link. It runs in this process (runComputeNode), its engine the fake claude in its own sandbox, told it runs on the owner's server. */
export async function bootOwnerServer(space: Daemon, ownerToken: string): Promise<{ nodeId: string; stop(): Promise<void> }> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-vm-srv-")));
  const sandbox = await defaultSandbox({ dataDir: dir, programRead: [path.dirname(FAKE_CLI)] });
  const launcher: NodeLauncher = {
    async spawn(spec) {
      const proc = await spawnCli(sandbox.plan, { argv: spec.argv, env: { ...spec.env, FAKE_WHERE: "ownerserver" }, ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}) }, [process.execPath, FAKE_CLI, ...spec.argv]);
      return proc as unknown as NodeProc;
    },
  };
  const abort = new AbortController();
  const made = await ok(space, ownerToken, "network.my_computer_code", { nickname: "Olivia's server" });
  const running = runComputeNode({
    server: space.url, join: made.code as string, dataDir: dir, name: "olivia-server", signal: abort.signal, now: Date.now, pollMs: 100,
    fetch: (url, init) => fetch(url, init) as never,
    sleep: (ms, signal) => new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("stopped")); }, { once: true }); }),
    log: () => undefined, facts: () => ({ os: "linux", arch: "x64", docker: false, version: "t" }), cliLauncher: launcher,
  });
  const waiting = await waitFor(async () => ((await api(space, ownerToken, "network.my_computers", {})).data?.computers as Array<{ enrollment: string; serverId: string }> | undefined)?.find((c) => c.enrollment === "pending") ?? null, 15_000, "the server asks to join");
  await ok(space, ownerToken, "network.my_computer_approve", { serverId: waiting.serverId });
  await waitFor(async () => (space.nodeRelay.connected(waiting.serverId) ? true : null), 15_000, "the server's live socket");
  return { nodeId: waiting.serverId, stop: async () => { abort.abort(); await running.catch(() => undefined); await sandbox.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

/** A Personal Space on the person's own computer, its owner signed in from the app (this computer's own door), a browser and a phone (the Space's door over https). */
export async function personalRig(o: { froms?: readonly Exclude<From, "mcp">[] } = {}): Promise<Rig> {
  const froms = o.froms ?? (["desktop", "web", "phone"] as const);
  const p = fakeProvider();
  const { d, dir } = await bootSpace("personal", p);
  let owner: Person;
  try {
    await publishAcme(d);
    owner = await seededPerson(d, "usr_olivia");
    for (const f of froms) await signInFrom(d, owner, f, f === "desktop");
  } catch (e) { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); throw e; }
  return { kind: "personal", d, dir, p, people: { owner }, endpoint: "opencode-go", stop: async () => { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

export interface Rig {
  kind: "team" | "personal"; d: Daemon; dir: string; p: Provider;
  people: Partial<Record<Who, Person>>;
  /** in the group with every `who`; and someone who is in neither the group nor anything else shared */
  peer?: Person; outsider?: Person; group?: string; everyone?: string;
  /** the custom endpoint the Space AI key is set on */
  endpoint?: string;
  /** the token setup calls are made with (the daemon's own admin token when absent) */
  admin?: string;
  /** the person's own computer, linked to this Space (lane l-runson) */
  computer?: { d: Daemon; stop(): Promise<void> };
  /** the owner's own server, joined to this Space */
  server?: { nodeId: string; stop(): Promise<void> };
  stop(): Promise<void>;
}

export async function teamRig(o: { froms?: readonly Exclude<From, "mcp">[] } = {}): Promise<Rig> {
  const froms = o.froms ?? (["desktop", "web", "phone"] as const);
  const idp = createIdp({ issuer: ISSUER, clientId: SSO_CLIENT, secret: SSO_SECRET });
  const p = fakeProvider();
  const { d, dir } = await bootSpace("team", p, idp);
  try { return await fillTeam(d, dir, p, idp, froms); } catch (e) { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); throw e; }
}

async function fillTeam(d: Daemon, dir: string, p: Provider, idp: ReturnType<typeof createIdp>, froms: readonly Exclude<From, "mcp">[]): Promise<Rig> {
  const admin = d.token;
  await publishAcme(d);
  const people: Rig["people"] = {};
  people.owner = await seededPerson(d, "usr_olivia");
  people.admin = await seededPerson(d, "usr_adam");
  people.member = await seededPerson(d, "usr_noah");
  const peer = await seededPerson(d, "usr_sana");
  const outsider = await seededPerson(d, "usr_tess");
  for (const who of ["owner", "admin", "member"] as const) for (const f of froms) await signInFrom(d, people[who]!, f);
  for (const f of froms) { await signInFrom(d, peer, f); await signInFrom(d, outsider, f); }
  // Google sign-in for the firm, with its client secret in the Vault
  const cc = await ok(d, admin, "vault.folders.create", { name: "Company connections", scope: "shared" });
  await ok(d, admin, "vault.item.put", { folderId: cc.folder.id, name: "Sso_Secret", kind: "other", fields: [{ key: "key", value: SSO_SECRET, secret: true }] });
  await ok(d, admin, "members.sso.set", { provider: { key: "google", title: "Google", issuer: ISSUER, clientId: SSO_CLIENT, clientSecretHandle: "#Sso_Secret", enabled: true, domainHint: SSO_DOMAIN } });
  // a member who joined once with her password (her client handed the key over then) and from then on signs in with Google
  people.member_sso = await joinAs(d, admin, "rubab", "Member", `rubab@${SSO_DOMAIN}`);
  for (const f of froms) await googleSignIn(d, idp, people.member_sso, `rubab@${SSO_DOMAIN}`, f);
  people.guest = await joinAs(d, admin, "gwen", "Guest");
  for (const f of froms) await passwordSignIn(d, people.guest, f);
  const members = [...Object.values(people), peer].map((x) => ({ kind: "person", id: x!.id }));
  const group = (await ok(d, admin, "access.groups.create", { name: "Matrix group", members, managers: [{ kind: "person", id: people.owner.id }] })).group.id as string;
  return {
    kind: "team", d, dir, p, people, peer, outsider, group, everyone: "grp_everyone", endpoint: "opencode-go",
    stop: async () => { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

// ---- what a cell does

/** What one action came to: ok, or refused with a code and the words a person reads. `got` is what reached the provider (the key's hash), when anything did. */
export interface Outcome { ok: boolean; code?: string; line?: string; got?: string; where?: string }
export const outcome = (r: Reply): Outcome => (r.status === 200 ? { ok: true } : { ok: false, ...(r.code ? { code: r.code } : {}), ...(r.message ? { line: r.message } : {}) });
const fromTool = (t: { isError: boolean; text: string }): Outcome => {
  if (!t.isError) return { ok: true };
  let line = t.text;
  try { const j = JSON.parse(t.text) as { error?: { message?: string; code?: string }; message?: string; code?: string }; line = j.error?.message ?? j.message ?? t.text; return { ok: false, line, ...(j.error?.code ?? j.code ? { code: j.error?.code ?? j.code } : {}) }; } catch { return { ok: false, line }; }
};

/** The item a cell saved: a key used by connections and automations, and an AI key the chat turn runs on. */
export interface Saved { handle: string; itemId: string; value: string; ai: { handle: string; itemId: string; value: string } }

/** How the cell reaches the Space: a person's session, or their outside agent. */
export type Actor = { token: string; mcp?: { c: Client; agentId: string; setup: boolean } };

const folderOf = async (d: Daemon, a: Actor, scope: "mine" | "shared", name: string): Promise<{ id?: string; o: Outcome }> => {
  const listed = await api(d, a.token, "vault.folders.list", { scope });
  const have = (listed.data?.folders as Array<{ id: string; name: string; owner: string; yourLevel: string }> | undefined)?.find((f) => f.name === name);
  if (have) return { id: have.id, o: { ok: true } };
  if (a.mcp?.setup) { const t = await tool(a.mcp.c, "vault_folders_create", { name, scope, idempotencyKey: key("f") }); return { ...(t.data?.folder?.id ? { id: t.data.folder.id as string } : {}), o: fromTool(t) }; }
  const r = await api(d, a.token, "vault.folders.create", { name, scope, idempotencyKey: key("f") });
  return { ...(r.data?.folder?.id ? { id: r.data.folder.id as string } : {}), o: outcome(r) };
};

/** Save: a key, then an AI key, in the scope the cell names. Mine goes to the person's Mine; a group or the Space is a Shared folder shared to them; the Space AI key is set in one step. */
export async function save(rig: Rig, a: Actor, tag: string, scope: Scope, people: { group?: string; everyone?: string }): Promise<{ o: Outcome; saved?: Saved; shared?: Outcome }> {
  const d = rig.d;
  const value = `vm-${tag}-${crypto.randomBytes(6).toString("hex")}`, aiValue = `vm-ai-${tag}-${crypto.randomBytes(6).toString("hex")}`;
  const call = async (cap: string, toolName: string, input: Record<string, unknown>): Promise<{ o: Outcome; data: Json }> => {
    if (a.mcp) { const t = await tool(a.mcp.c, toolName, { idempotencyKey: key("t"), ...input }); return { o: fromTool(t), data: t.data }; }
    const r = await api(d, a.token, cap, { idempotencyKey: key("c"), ...input });
    return { o: outcome(r), data: r.data };
  };
  if (scope === "space_ai_key") {
    // an outside agent with no setup grant leaves this to its person, whose own role decides
    const r = a.mcp && !a.mcp.setup ? { o: outcome(await api(d, a.token, "providers.space_key.set", { idempotencyKey: key("c"), providerKey: rig.endpoint, apiKey: aiValue })) } : await call("providers.space_key.set", "providers_space_key_set", { providerKey: rig.endpoint, apiKey: aiValue });
    if (!r.o.ok) return { o: r.o };
    const row = ((await api(d, rig.people.owner?.tokens.desktop ?? a.token, "providers.list", {})).data.providers as Array<{ itemId: string; handle: string; spaceKey?: boolean }>).find((x) => x.spaceKey);
    return { o: { ok: true }, saved: { handle: row!.handle, itemId: row!.itemId, value: aiValue, ai: { handle: row!.handle, itemId: row!.itemId, value: aiValue } } };
  }
  const f = await folderOf(d, a, scope === "mine" ? "mine" : "shared", scope === "mine" ? "Mine" : `Shared by ${tag.split("-")[0]}`);
  if (!f.id) return { o: f.o };
  let item: { id: string; handle: string };
  if (a.mcp && !a.mcp.setup) {
    // an outside agent with no setup grant never holds a value: it asks for the key by name, and the person pastes it in their own app (one press in Needs you)
    const asked = await tool(a.mcp.c, "vault_item_put", { name: `Key_${tag.replace(/[^A-Za-z0-9]/g, "_")}`, fieldKeys: ["api_key"], folderId: f.id, idempotencyKey: key("t") });
    const requestId = (asked.data as { requestId?: string } | null)?.requestId;
    if (!requestId) return { o: fromTool(asked) };
    const done = await api(d, a.token, "vault.requests.fulfil", { requestId, folderId: f.id, fields: [{ key: "api_key", value }] });
    if (done.status !== 200) return { o: outcome(done) };
    item = (await api(d, a.token, "vault.item.get", { itemId: done.data.request.itemId })).data.item as { id: string; handle: string };
  } else {
    const put = await call("vault.item.put", "vault_item_put", { folderId: f.id, name: `Key ${tag}`, kind: "api_key", fields: [{ key: "api_key", value, secret: true }] });
    if (!put.o.ok) return { o: put.o };
    item = put.data.item as { id: string; handle: string };
  }
  // an AI key is added by the person in the app when their outside agent has no setup grant (the agent is told so in plain words)
  const aiCall = a.mcp && !a.mcp.setup ? async (cap: string, _t: string, input: Record<string, unknown>) => { const r = await api(d, a.token, cap, { idempotencyKey: key("c"), ...input }); return { o: outcome(r), data: r.data }; } : call;
  const ai = await aiCall("providers.add", "providers_add", { providerKey: "openrouter", connection: "api_key", apiKey: aiValue, scope: scope === "mine" ? "mine" : "shared", ...(scope === "mine" ? {} : { folderId: f.id }) });
  if (!ai.o.ok) return { o: ai.o };
  const prov = ai.data.provider as { handle: string; itemId: string };
  const saved = { handle: item.handle, itemId: item.id, value, ai: { handle: prov.handle, itemId: prov.itemId, value: aiValue } };
  if (scope !== "mine") {
    // a Personal Space has nobody to share with: the share is refused in plain words, the item is kept
    const subject = rig.kind === "personal" ? { kind: "person", id: "usr_noah" } : { kind: "group", id: scope === "group" ? people.group : people.everyone };
    for (const id of [item.id, prov.itemId]) {
      const s = await aiCall("vault.share", "vault_share", { resource: { type: "vault_item", id }, subject, level: "use" });
      if (!s.o.ok) return { o: { ok: true }, saved, shared: s.o };
    }
  }
  return { o: { ok: true }, saved, shared: { ok: true } };
}

/** A Claude sign-in of the person's own (a subscription, Mine for ever), the way the app saves one: the flow, the item, the link. The turn's CLI engine starts with it. */
export async function saveClaude(rig: Rig, token: string, tag: string): Promise<{ o: Outcome; saved?: Saved }> {
  const d = rig.d;
  const value = `sk-ant-oat01-vm${crypto.randomBytes(12).toString("hex")}`;
  const f = await folderOf(d, { token }, "mine", "Accounts");
  if (!f.id) return { o: f.o };
  const flow = await api(d, token, "providers.subscription_start", { providerKey: "claude-code", idempotencyKey: key("ss") });
  if (flow.status !== 200) return { o: outcome(flow) };
  const put = await api(d, token, "vault.item.put", { folderId: f.id, name: `Claude ${tag}`, kind: "ai_subscription", fields: [{ key: "setup_token", value, secret: true }], idempotencyKey: key("sp") });
  if (put.status !== 200) return { o: outcome(put) };
  const done = await api(d, token, "providers.subscription_complete", { flowId: flow.data.flowId });
  if (done.status !== 200) return { o: outcome(done) };
  const prov = done.data.provider as { handle: string; itemId: string };
  return { o: { ok: true }, saved: { handle: put.data.item.handle, itemId: put.data.item.id, value, ai: { handle: prov.handle, itemId: prov.itemId, value } } };
}

const agents = new Map<string, string>();
/** The agent made for a key on one computer of a Space is the same agent on its other computers. */
export function sameAgent(from: Rig, to: Rig, handle: string): void { const id = agents.get(`${from.d.url}${handle}`); if (id) agents.set(`${to.d.url}${handle}`, id); }
/** An agent whose turns run on this AI key (made once per key by the Space's owner). */
export async function agentOn(rig: Rig, handle: string): Promise<string> {
  const have = agents.get(`${rig.d.url}${handle}`);
  if (have) return have;
  const made = await ok(rig.d, rig.admin ?? rig.d.token, "agents.create", { name: `On ${handle.replace(/^#/, "").slice(0, 30)}`, role: "You answer." });
  const id = made.agent.agentId as string;
  await ok(rig.d, rig.admin ?? rig.d.token, "agents.update", { agentId: id, patch: { accountPolicy: "key", accountKey: handle } });
  agents.set(`${rig.d.url}${handle}`, id);
  return id;
}

/** A chat turn by this person on an agent that runs on the AI key: the reply names the hash of the key that reached the provider, or the turn's own failure line. */
export async function chatUse(rig: Rig, token: string, handle: string, pin?: { serverId: string }): Promise<Outcome> {
  const d = rig.d;
  const agentId = await agentOn(rig, handle);
  const th = await api(d, token, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: key("cs") });
  if (th.status !== 200) return outcome(th);
  const threadId = th.data.thread.threadId as string;
  // the person pins this chat to their own server (Runs on, in the chat's menu)
  if (pin) { const set = await api(d, token, "engine.placement.set", { threadId, target: "server", serverId: pin.serverId }); if (set.status !== 200) return outcome(set); }
  const post = await api(d, token, "chat.post", { threadId, body: "keycheck", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: key("cp") });
  if (post.status !== 200) return outcome(post);
  return waitFor(async () => {
    await d.hooks?.pump?.();
    const ms = (await api(d, token, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string; blocks?: Array<{ type: string; data?: { state?: string; text?: string; code?: string; message?: string } }> }> | undefined;
    const said = ms?.find((m) => m.author?.kind === "agent" && /key=/.test(m.body ?? ""))?.body;
    if (said) return { ok: true, got: /key=(\w+)/.exec(said)![1]!, line: said, where: /ran-on=(\w+)/.exec(said)?.[1] ?? "space" };
    const failed = ms?.flatMap((m) => m.blocks ?? []).find((b) => b.type === "turn_status" && /fail|error|stopp/i.test(String(b.data?.state ?? "")));
    if (failed) return { ok: false, line: String(failed.data?.text ?? failed.data?.message ?? JSON.stringify(failed.data)), code: String(failed.data?.code ?? "") };
    return null;
  }, 50_000, `chat on ${handle}`);
}

/** An automation's HTTP request step, run as this person, with the key as its bearer: the step reaches the provider with the key filled in. */
export async function automationUse(rig: Rig, a: Actor, handle: string): Promise<Outcome> {
  const before = rig.p.seen.length;
  const input = { method: "GET", url: "https://api.hubapi.com/crm/v3/objects/contacts", auth: { kind: "bearer", handle } };
  const o = a.mcp ? fromTool(await tool(a.mcp.c, "automations_http_read", input)) : outcome(await api(rig.d, a.token, "automations.http_read", input));
  const got = rig.p.seen.slice(before).find((s) => s.url.includes("hubapi"))?.key;
  return { ...o, ...(got ? { got } : {}) };
}

/** A connection of this person's own to an app (Acme, an API-key connector published in the Space) that keeps its key in the Vault, made and checked: the check reaches the app with the key filled in. */
export async function connectionUse(rig: Rig, a: Actor, handle: string, tag: string): Promise<Outcome> {
  const before = rig.p.seen.length;
  const call = async (cap: string, toolName: string, input: Record<string, unknown>): Promise<{ o: Outcome; data: Json }> => {
    if (a.mcp) { const t = await tool(a.mcp.c, toolName, { idempotencyKey: key("t"), ...input }); return { o: fromTool(t), data: t.data }; }
    const r = await api(rig.d, a.token, cap, { idempotencyKey: key("c"), ...input });
    return { o: outcome(r), data: r.data };
  };
  const made = await call("connections.create", "connections_create", { connector: "acmeme", title: `Acme ${tag}`, ownerKind: "person", secrets: { Acme_Key: handle } });
  if (!made.o.ok) return made.o;
  const tested = await call("connections.test", "connections_test", { connectionId: made.data.connection.connectionId });
  if (!tested.o.ok) return tested.o;
  const got = rig.p.seen.slice(before).find((s) => s.url.includes("acme"))?.key;
  return tested.data.state === "healthy" ? { ok: true, ...(got ? { got } : {}) } : { ok: false, line: String(tested.data.detail ?? tested.data.state), ...(got ? { got } : {}) };
}

/** Whether this person can use the item by name (the same decision a turn of theirs meets). */
export async function canUse(rig: Rig, token: string, handle: string): Promise<boolean> {
  return (await api(rig.d, token, "vault.use", { item: handle })).status === 200;
}

/** An automation's AI step, run as this person on this AI key (engine.step_turn, as a Run does it): the provider is reached with the key. */
export async function stepUse(rig: Rig, token: string, handle: string): Promise<Outcome> {
  const r = await api(rig.d, token, "engine.step_turn", { prompt: "keycheck", keyId: handle, runId: `run_${crypto.randomBytes(5).toString("hex")}`, stepId: "s1", idempotencyKey: key("st") });
  if (r.status !== 200) return outcome(r);
  const got = /key=(\w+)/.exec(String(r.data.text ?? ""))?.[1];
  return got ? { ok: true, got } : { ok: false, line: String(r.data.text ?? "") };
}

// ---- running cells

/** What one run of a cell came to, action by action. */
export type Result = Record<Action, Outcome>;
const runs = new Map<string, Promise<Result>>();

/** The run key: the calls a cell sends to its Space. Two cells with the same key share one run. */
export const runKey = (c: Cell): string => `${c.space}/${c.who}/${c.from}/${c.scope}/${c.runs}`;

const okWith = (want: string, o: Outcome): Outcome => (o.ok && o.got !== want ? { ok: false, line: `the provider got ${o.got ?? "nothing"}, not this item's key` } : o);

/** One cell: save as the person (or their outside agent), use it in a chat, an automation and a connection, and check who else can use it. */
export async function runCell(rig: Rig, c: Cell): Promise<Result> {
  const k = `${rig.d.url}|${runKey(c)}`;
  const have = runs.get(k);
  if (have) return have;
  const run = (async (): Promise<Result> => {
    const p = rig.people[c.who]!, owner = rig.people.owner!;
    const token = p.tokens[c.from === "mcp" ? "desktop" : c.from]!;
    const tag = `${c.who}-${c.from}-${c.scope}-${c.runs}`;
    const res: Partial<Result> = {};
    let a: Actor = { token };
    if (c.from === "mcp") {
      // only an owner or admin may give an outside agent the setup grant; anyone else's agent asks them for what it may not do
      try { a = { token, mcp: await outsideAgent(rig.d, token, c.who === "owner" || c.who === "admin") }; }
      catch (e) { const m = String((e as Error).message); const no: Outcome = { ok: false, line: /"message":"([^"]+)"/.exec(m)?.[1] ?? m }; return { save: no, chat: no, automation: no, connection: no, share: no }; }
      // the outside agent works while the person's app is closed: their key is not on the Space
      for (const t of Object.values(p.tokens)) await door(rig.d, t!, "lock", undefined, rig.kind === "personal" && t === p.tokens.desktop);
    }
    // a guest's group and Space items come from someone who may share; a member's Space AI key is the owner's
    const saver: Actor = (c.who === "guest" && c.scope !== "mine") ? { token: owner.tokens.desktop! } : a;
    const s = await save(rig, saver, tag, c.scope, { group: rig.group!, everyone: rig.everyone! });
    res.save = s.o;
    let saved = s.saved;
    if (!saved && c.scope === "space_ai_key" && rig.kind === "team") saved = (await save(rig, { token: owner.tokens.desktop! }, `owner-for-${tag}`, "space_ai_key", {})).saved;
    // the person signs in again (one password, at sign-in): their key is back on the Space and nothing else is asked
    if (c.from === "mcp") for (const f of ["desktop", "web", "phone"] as const) if (p.tokens[f]) assert.equal((await door(rig.d, p.tokens[f]!, "unlock", p.personKey, rig.kind === "personal" && f === "desktop")).status, 204);
    if (!saved) { const no = res.save!; return { save: no, chat: no, automation: no, connection: no, share: no }; }
    // on their own computer: a Mine sign-in runs the engine there; the Space fills it in, nothing is asked on the computer
    // on the owner's own server: the owner's Mine sign-in runs the engine there; anyone else's turn never does
    const onComputer = rig.computer !== undefined && c.runs === "own_computer" && c.scope === "mine";
    // the owner's own server runs the owner's turns (in a Personal Space they pin the chat to it: Automatic prefers the computer the Space is on); anyone else's turn stays on the Space
    const onServer = rig.server !== undefined && c.runs === "owner_server" && c.scope === "mine" && c.who === "owner";
    const claude = onComputer || onServer ? (await saveClaude(rig, token, tag)).saved : undefined;
    const chat = await chatUse(rig, token, (claude ?? saved).ai.handle, onServer && rig.kind === "personal" ? { serverId: rig.server!.nodeId } : undefined);
    res.chat = okWith(sha12((claude ?? saved).ai.value), chat);
    const where = onComputer ? "device" : onServer ? "ownerserver" : rig.server !== undefined && c.runs === "owner_server" && rig.kind === "team" ? "space" : null;
    if (res.chat.ok && where !== null && chat.where !== where) res.chat = { ok: false, line: `the turn ran on ${chat.where ?? "the server"}, not on ${where}` };
    const step = okWith(sha12(saved.ai.value), await stepUse(rig, token, saved.ai.handle));
    const httpStep = c.scope === "space_ai_key" ? null : okWith(sha12(saved.value), await automationUse(rig, { token }, saved.handle));
    res.automation = !step.ok ? step : httpStep && !httpStep.ok ? httpStep : { ok: true };
    res.connection = c.scope === "space_ai_key" ? { ok: true } : okWith(sha12(saved.value), await connectionUse(rig, a.mcp ? a : { token }, saved.handle, tag));
    if (rig.kind === "personal") { res.share = s.shared ?? { ok: true }; return res as Result; }
    // who else: the group's other member, someone outside it, and an admin who does not own a Mine item
    const handle = c.scope === "space_ai_key" ? saved.ai.handle : saved.handle;
    const peer = await canUse(rig, rig.peer!.tokens.desktop!, handle), outsider = await canUse(rig, rig.outsider!.tokens.desktop!, handle);
    const want = c.scope === "mine" ? [false, false] : c.scope === "group" ? [true, false] : c.scope === "space" ? [true, true] : [false, false];
    const listedByAdmin = c.scope === "mine" && c.who !== "admin" ? ((await api(rig.d, rig.people.admin!.tokens.desktop!, "vault.items.list", {})).data.items as Array<{ id: string }>).some((i) => i.id === saved!.itemId) : false;
    res.share = !s.shared?.ok && c.scope !== "mine" && c.scope !== "space_ai_key" ? s.shared! : peer === want[0] && outsider === want[1] && !listedByAdmin ? { ok: true } : { ok: false, line: `peer ${peer}, outsider ${outsider}, listed for an admin ${listedByAdmin}; wanted ${want.join(", ")}` };
    return res as Result;
  })();
  runs.set(k, run);
  return run;
}

/** Whether an outcome meets what the cell expects; the reason when it does not. */
export function meets(e: Expect, o: Outcome): string | null {
  if ("na" in e) return null;
  if ("ok" in e) return o.ok ? null : `expected it to work: ${o.code ?? ""} ${o.line ?? ""}`.trim();
  if (o.ok) return `expected "${e.line}", but it went through`;
  return o.line === e.line ? null : `expected "${e.line}", got ${o.code ?? ""} "${o.line ?? ""}"`;
}

/** The red and green table of a slice, one line per run key, one column per action, and every cell it stands for. */
export function table(rows: Array<{ key: string; cells: number; marks: Record<Action, string> }>): string {
  const head = `| run (space/who/from/scope/runs) | cells | ${ACTIONS.join(" | ")} |`;
  return [head, `|${"---|".repeat(ACTIONS.length + 2)}`, ...rows.map((r) => `| ${r.key} | ${r.cells} | ${ACTIONS.map((a) => r.marks[a]).join(" | ")} |`)].join("\n");
}

// ---- a slice of the matrix as one test file

import test from "node:test";

/** Every Team Space cell for one person and one place the turn runs, on one Team Space: each run once, every cell checked against what it must do, and the table printed. */
export function teamSlice(o: { who: Who; runs: Runs; froms?: readonly From[] }): void {
  const froms = o.froms ?? FROM;
  const mine = cells().filter((c) => c.space === "team" && c.who === o.who && c.runs === o.runs && froms.includes(c.from));
  test(`Vault matrix, Team Space, ${o.who} from ${froms.join(" and ")}, turn on the ${o.runs.replace("_", " ")}: ${mine.length} cells`, { timeout: 120_000 }, async () => {
    // everyone is signed in on the desktop app as well: the others in a cell (the group's peer, an outsider, an admin) are checked from there
    const rig = await teamRig({ froms: [...new Set<Exclude<From, "mcp">>(["desktop", ...(froms.filter((f) => f !== "mcp") as Exclude<From, "mcp">[])])] });
    if (o.runs === "own_computer") { const p = rig.people[o.who]!; rig.computer = await bootComputer(rig.d, p.id, p.tokens.desktop!); }
    if (o.runs === "owner_server") rig.server = await bootOwnerServer(rig.d, rig.people.owner!.tokens.desktop!);
    const failures: string[] = [];
    const rows = new Map<string, { key: string; cells: number; marks: Record<Action, string> }>();
    try {
      for (const c of mine) {
        const r = await runCell(rig, c);
        const want = expected(c);
        const row = rows.get(runKey(c)) ?? { key: runKey(c), cells: 0, marks: {} as Record<Action, string> };
        row.cells += 1;
        for (const a of ACTIONS) {
          const why = meets(want[a], r[a]);
          row.marks[a] = why === null ? ("ok" in want[a] ? "green" : "na" in want[a] ? "n/a" : "green (plain no)") : "RED";
          if (why !== null) failures.push(`${label(c)} ${a}: ${why}`);
        }
        rows.set(runKey(c), row);
      }
    } finally {
      process.stdout.write(`${table([...rows.values()])}\n`);
      await rig.computer?.stop();
      await rig.server?.stop();
      await rig.stop();
    }
    const distinct = [...new Set(failures)];
    assert.equal(distinct.length, 0, `${distinct.length} red:\n${distinct.slice(0, 40).join("\n")}`);
  });
}

/** Every Personal Space cell of its owner signed in from these places: the Space is their own computer, so the turn runs there. */
export function personalSlice(o: { froms: readonly From[]; server?: boolean }): void {
  const mine = cells().filter((c) => c.space === "personal" && absent(c) === null && o.froms.includes(c.from) && (c.runs === "owner_server") === (o.server === true));
  test(`Vault matrix, Personal Space, its owner from ${o.froms.join(" and ")}${o.server ? ", with a server of theirs added" : ""}: ${mine.length} cells`, { timeout: 120_000 }, async () => {
    const rig = await personalRig({ froms: (["desktop", ...o.froms.filter((f) => f !== "mcp" && f !== "desktop")] as Exclude<From, "mcp">[]) });
    if (o.server) rig.server = await bootOwnerServer(rig.d, rig.people.owner!.tokens.desktop!);
    const failures: string[] = [];
    const rows = new Map<string, { key: string; cells: number; marks: Record<Action, string> }>();
    try {
      for (const c of mine) {
        // on a Personal Space the server is the person's own computer: both are one run
        const r = await runCell(rig, { ...c, runs: c.runs === "owner_server" ? "owner_server" : "server" });
        const want = expected(c);
        const row = rows.get(runKey(c)) ?? { key: runKey(c), cells: 0, marks: {} as Record<Action, string> };
        row.cells += 1;
        for (const a of ACTIONS) {
          const why = meets(want[a], r[a]);
          row.marks[a] = why === null ? ("ok" in want[a] ? "green" : "na" in want[a] ? "n/a" : "green (plain no)") : "RED";
          if (why !== null) failures.push(`${label(c)} ${a}: ${why}`);
        }
        rows.set(runKey(c), row);
      }
    } finally {
      process.stdout.write(`${table([...rows.values()])}\n`);
      await rig.server?.stop();
      await rig.stop();
    }
    const distinct = [...new Set(failures)];
    assert.equal(distinct.length, 0, `${distinct.length} red:\n${distinct.slice(0, 40).join("\n")}`);
  });
}
