// A booted daemon for the personal mail tests: a fresh Space (Personal or Team) whose owner has claimed it, any number of members who joined by invite, each with their own bearer token,
// and fake Google and Microsoft under it (test/support/fake-mail-providers.ts). Nothing inside the daemon is faked: the Vault, the Space seal, the mail, google and microsoft modules, the
// gateway and the host seams are the real ones. The live test calls the capabilities as each person; the browser journey puts the real app in front of the same daemon.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenSession } from "../../agent/src/turn-engine/types.ts";
import { fakePlatform } from "../../host/src/platform/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";
import { fakeMailProviders } from "./fake-mail-providers.ts";
import type { FakeMailProviders } from "./fake-mail-providers.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const DEVICE = { deviceName: "Test browser", deviceClass: "desktop" };

export interface Reply { status: number; data: any; error?: { code?: string; message?: string } }   // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Person {
  id: string;
  username: string;
  token: string;
  /** a capability call as this person; never throws */
  call(cap: string, input?: unknown): Promise<Reply>;
  /** the same, and the answer must be a 200 */
  ok(cap: string, input?: Record<string, unknown>): Promise<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface MailWorld {
  /** the running daemon; a new one after restart() */
  readonly d: Daemon;
  dir: string;
  fake: FakeMailProviders;
  kind: "personal" | "team";
  /** the address people reach the Space at: what a sign-in comes back to */
  address: string;
  owner: Person;
  /** a member who joined by invite (Team only) */
  join(username: string): Promise<Person>;
  /** the time the daemon and the fake providers go by; advance it to let time pass while the app is closed */
  clock: { t: number };
  /** quit and open again on the same data directory: nothing runs in between, and what was scheduled is still there */
  restart(): Promise<void>;
  stop(): Promise<void>;
}

export interface WorldOptions {
  kind: "personal" | "team";
  /** where the Space says people reach it (default http://space.test); the browser journey gives the edge's address */
  address?: string;
  engineOpenSession?: OpenSession;
  /** the clock the fake providers stamp mail with */
  now?: () => number;
}

const person = (daemon: () => Daemon, id: string, username: string, token: string): Person => {
  const call = async (cap: string, input: unknown = {}): Promise<Reply> => {
    const r = await fetch(`${daemon().url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
    const body = (await r.json()) as { data?: unknown; error?: { code?: string; message?: string } };
    return { status: r.status, data: body.data ?? body, ...(body.error ? { error: body.error } : {}) };
  };
  let n = 0;
  return {
    id, username, token, call,
    async ok(cap, input = {}) {
      const r = await call(cap, { idempotencyKey: `${username}-${cap}-${++n}-${Date.now()}`, ...input });
      assert.equal(r.status, 200, `${username} ${cap}: ${JSON.stringify(r.data)}`);
      return r.data;
    },
  };
};

export async function bootMailWorld(o: WorldOptions): Promise<MailWorld> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vyre-pmail-${o.kind}-`));
  const clock = { t: Date.now() };
  const fake = fakeMailProviders(() => clock.t);
  const address = o.address ?? "http://space.test";
  const start = (): Promise<Daemon> => startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_pmail", "--space-name", o.kind === "personal" ? "Personal" : "Fresh Co", "--space-kind", o.kind, "--address", address], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    now: () => clock.t,
    platform: fakePlatform({
      os: "linux", hostname: "pmail-world", free: 80e9,
      commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    http: fake.http,
    seams: { fetch: fake.tokenFetch },
    ...(o.engineOpenSession ? { engineOpenSession: o.engineOpenSession } : {}),
  });
  let d = await start();
  const post = async (cap: string, input: unknown, token?: string): Promise<{ status: number; body: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
    return { status: r.status, body: await r.json() };
  };
  assert.ok(d.claim, "a fresh Space prints a claim link");
  const code = decodeURIComponent(new URL(d.claim.url).pathname.split("/").pop() ?? "");
  const claimed = await post("identity.claim_owner", { code, spaceId: "spc_pmail", username: "olivia", displayName: "Olivia", password: PASSWORD, ...DEVICE, keys: KEYS });
  if (claimed.status !== 200) {
    d.sink.flush();
    const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, cap, msg, attrs FROM logs WHERE level >= 40 ORDER BY id DESC LIMIT 5").all();
    await d.stop();
    assert.fail(`${JSON.stringify(claimed.body)} ${JSON.stringify(rows)}`);
  }
  const signed = await post("identity.sign_in", { username: "olivia", password: PASSWORD, ...DEVICE });
  const token = signed.body.data.session.token as string;
  const me = await post("identity.whoami", {}, token);
  const owner = person(() => d, me.body.data.principal.id as string, "olivia", token);
  let invites = 0;
  return {
    get d() { return d; }, dir, fake, kind: o.kind, address, owner, clock,
    async join(username) {
      assert.equal(o.kind, "team", "only a Team Space has members");
      const roles = (await owner.ok("access.roles.list")).roles as { id: string; name: string }[];
      const role = roles.find((r) => /member/i.test(r.name)) ?? roles[0]!;
      const invite = await owner.ok("members.invites.create", { role: role.id, idempotencyKey: `pmail-invite-${++invites}` });
      const joined = await post("members.accept", { code: decodeURIComponent(new URL(invite.link).pathname.split("/").pop() ?? ""), username, displayName: username, password: PASSWORD, ...DEVICE, keys: KEYS });
      assert.equal(joined.status, 200, JSON.stringify(joined.body));
      return person(() => d, joined.body.data.personId as string, username, joined.body.data.token as string);
    },
    async restart() { await d.stop(); d = await start(); },
    async stop() { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

/** The owner unlocks the Vault the way the app does once signed in, so Shared items can be filed and Mine items opened. */
export async function unlockVault(w: MailWorld): Promise<void> {
  const r = await fetch(`${w.d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${w.owner.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  assert.equal(r.status, 204, `unlock: ${r.status}`);
}
export async function lockVault(w: MailWorld): Promise<void> {
  const r = await fetch(`${w.d.url}/local/vault/key/lock`, { method: "POST", headers: { authorization: `Bearer ${w.owner.token}` } });
  assert.ok(r.status === 204 || r.status === 200, `lock: ${r.status}`);
}

/** An admin files the OAuth app in the Vault as a Shared item and names it to the module, as Settings does. */
export async function setSignInApp(w: MailWorld, provider: "google" | "microsoft", client: { id: string; secret: string; tenant?: string }): Promise<string> {
  const name = provider === "google" ? "Google_Sign_In" : "Microsoft_Sign_In";
  const folders = (await w.owner.ok("vault.folders.list", { scope: "shared" })).folders as { id: string; name: string }[];
  const folderId = folders.find((f) => f.name === "Apps")?.id ?? (await w.owner.ok("vault.folders.create", { name: "Apps", scope: "shared" })).folder.id as string;
  const item = await w.owner.ok("vault.item.put", {
    folderId, name, kind: "other",
    fields: [{ key: "client_id", value: client.id, secret: false }, { key: "client_secret", value: client.secret, secret: true }, ...(client.tenant ? [{ key: "tenant", value: client.tenant, secret: false }] : [])],
  });
  await w.owner.ok(provider === "google" ? "google.user.app_set" : "ms.user.app_set", { vaultItem: item.item.handle });
  return item.item.handle as string;
}

/** Everything the data directory holds, to look for a plaintext in. */
export function everything(dir: string): Buffer[] {
  const out: Buffer[] = [];
  const walk = (p: string): void => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f); else if (e.isFile() && fs.statSync(f).size < 200 * 1024 * 1024) out.push(fs.readFileSync(f));
    }
  };
  walk(dir);
  return out;
}

/** The sign-in the browser makes at Google or Microsoft: the person starts it, approves, and the provider sends them back with a code. Done here as the person's own call. */
export async function signInAs(w: MailWorld, who: Person, provider: "google" | "microsoft", email: string): Promise<{ accountId: string; email: string; mailboxId?: string }> {
  const prefix = provider === "google" ? "google.user" : "ms.user";
  const start = await who.ok(`${prefix}.start`, { loginHint: email });
  return who.ok(`${prefix}.complete`, { state: start.state, code: w.fake.codeFor(email) });
}

const CLAUDE_KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake

export async function until<T>(f: () => Promise<T | null>, why: string, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v !== null) return v;
    if (Date.now() > end) throw new Error(`never happened: ${why}`);
    await new Promise<void>((r) => setTimeout(r, 150));
  }
}

/** The admin files an AI account in a Shared folder, so every member's assistant can answer on it (each turn still runs for whoever asked, with that person's reach). */
export async function connectClaude(w: MailWorld): Promise<string> {
  const folder = await w.owner.ok("vault.folders.create", { name: "Team AI", scope: "shared" });
  const added = await w.owner.ok("providers.add", { providerKey: "anthropic", connection: "api_key", apiKey: CLAUDE_KEY, name: "Team Claude", scope: "shared", folderId: folder.folder.id });
  return added.provider.handle as string;
}

/** An assistant of this person, pinned to the Space's AI account so its turns are paid for. */
export async function makeAgent(who: Person, name: string, account: string): Promise<string> {
  const agentId = (await who.ok("agents.create", { name, role: `You help ${who.username} with their mail.` })).agent.agentId as string;
  await who.ok("agents.update", { agentId, patch: { accountPolicy: "key", accountKey: account } });
  return agentId;
}

/** A person's agent, and a chat where they ask it something; the answer is the agent's reply (the model stand-in turns `TOOL name {json}` into a tool call made as the asker). */
export async function ask(w: MailWorld, who: Person, agentId: string, body: string): Promise<string> {
  const started = await who.ok("chat.start", { kind: "chat", agentIds: [agentId] });
  const threadId = started.thread.threadId as string;
  await who.ok("chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }] });
  return until(async () => {
    await w.d.hooks?.pump?.();
    const r = await who.call("chat.messages.list", { threadId });
    const m = (r.data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined)?.find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "");
    return m?.body ?? null;
  }, "the agent's reply", 40_000);
}
