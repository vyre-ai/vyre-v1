// A newly invited team member's first hour on a Vyre Server Space (release gate, test/member-first-hour*.live.test.ts), the way the owner's team met it on 3 Nov: a server-role daemon at its own
// address behind Caddy (https://mla.firm.test), the real identity and the real Vault, Google sign-in through the stand-in OpenID provider (fixtures/suite/idp.ts), a stand-in Google for mail,
// calendar and Drive behind the module egress and the seam fetch, and a Space AI key from a fake provider. Every call a person makes goes the way the app makes it: the client's capability caller
// (client/src/gateway createCapCaller, the route table, GET or POST) at the Space's https address, which the edge hands to the daemon as Caddy does (x-forwarded-proto https). Each person's answers
// are kept, so a walk can say that no screen showed a Space id and that no call was refused unless the refusal was meant and said in plain words.
import assert from "node:assert/strict";
import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { DriverEvent, EngineSession, OpenSession, ToolResult, TurnInput } from "../../agent/src/turn-engine/types.ts";
import { makeBundle, openBundle, wipe } from "../../client/src/crypto/keys.ts";
import { CapError, createCapCaller } from "../../client/src/gateway/index.ts";
import { holdKeyOnOwnNode } from "../../client/src/gateway/local-key.ts";
import { SPACE_ID, spaceLabel } from "../../apps/app/src/shell/spaces/space-label.ts";
import { saveSso } from "../../apps/app/src/console/pages/sso-save.ts";
import { PLACE_QUERIES, WARM_ORDER } from "../../apps/app/src/shell/session/prefetch.ts";
import { resolvePointers } from "../../apps/app/src/shell/session/remote-hooks.ts";
import { screens } from "../../generated/screens.ts";
import { createIdp } from "../../fixtures/suite/idp.ts";
import type { Answer } from "../../fixtures/suite/world.ts";
import { fakePlatform } from "../../host/src/platform/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";
import { SPACE_KEY, SUB, vendor } from "../member-key-kit.ts";

export { SPACE_KEY, SUB };

export const ADDRESS = "https://mla.firm.test";
export const SPACE_NAME = "My Legal Academy";
export const DOMAIN = "firm.test";
const ISSUER = "https://accounts.google.com";
const SSO_CLIENT = "mla-app-client";
const SSO_SECRET = "mla-client-secret-123"; // secret-scan: fake
const SA_EMAIL = "vyre-space@mla-prod.iam.gserviceaccount.com";
const SCOPE = "https://www.googleapis.com/auth/";
const caddyProbe: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const b64url = (s: string | Buffer): string => Buffer.from(s).toString("base64url");
type Any = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

// ---- the stand-in Google: what each person has in Gmail, Calendar and Drive, behind a token endpoint that checks the service account's signature

const sa = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const SA_KEY_JSON = JSON.stringify({ type: "service_account", project_id: "mla-prod", client_id: "104857384729183746501", client_email: SA_EMAIL, private_key: sa.privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
const saPublic = createPublicKey(sa.publicKey.export({ type: "spki", format: "pem" }));

export interface DriveFile { id: string; name: string; mimeType: string; modifiedTime: string; parents: string[]; markdown?: string }
export interface Google {
  mail: Record<string, { id: string; subject: string; from: string; at: number }[]>;
  events: Record<string, Record<string, unknown>[]>;
  files: Record<string, DriveFile[]>;
  asked: { sub: string; url: string }[];
}

function google(): Google & { api(req: { method: string; url: string; headers: Record<string, string> }): Answer; seam(req: { url: string; body: unknown; headers: Record<string, string> }): Answer } {
  const g: Google = { mail: {}, events: {}, files: {}, asked: [] };
  const who = (headers: Record<string, string>): string | null => /^Bearer at\|([^|]+)\|/.exec(headers["authorization"] ?? "")?.[1] ?? null;
  return {
    ...g,
    api({ url, headers }) {
      const sub = who(headers);
      if (!sub) return { status: 401, json: { error: { code: 401, errors: [{ reason: "authError" }] } } };
      g.asked.push({ sub, url });
      const u = new URL(url);
      const msgs = g.mail[sub] ?? [];
      if (u.hostname === "gmail.googleapis.com") {
        if (u.pathname.endsWith("/profile")) return { json: { emailAddress: sub, historyId: "500" } };
        if (u.pathname.endsWith("/messages")) return { json: { messages: msgs.map((m) => ({ id: m.id, threadId: `t-${m.id}` })) } };
        const m = /\/messages\/([^/]+)$/.exec(u.pathname);
        const msg = m && msgs.find((x) => x.id === m[1]);
        if (msg) {
          return { json: {
            id: msg.id, threadId: `t-${msg.id}`, labelIds: ["INBOX", "UNREAD"], historyId: "400", internalDate: String(msg.at), snippet: msg.subject,
            payload: { mimeType: "text/plain", headers: [{ name: "From", value: msg.from }, { name: "To", value: sub }, { name: "Subject", value: msg.subject }, { name: "Message-ID", value: `<${msg.id}@client.test>` }], body: { data: b64url("Hello, can we talk?") } },
          } };
        }
        if (u.pathname.endsWith("/history")) return { json: { history: [], historyId: "600" } };
        return undefined;
      }
      if (u.hostname === "www.googleapis.com" && u.pathname.includes("/calendar/v3/calendars/")) return { json: { items: g.events[sub] ?? [], nextSyncToken: "sync-1" } };
      if (u.hostname === "www.googleapis.com" && /\/drive\/v3\/files\/[^/]+$/.test(u.pathname)) {
        const f = (g.files[sub] ?? []).find((x) => u.pathname.endsWith(`/files/${x.id}`));
        return f ? { json: f } : undefined;
      }
      if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/drive/v3/files")) {
        const parent = /'([^']+)' in parents/.exec(u.searchParams.get("q") ?? "")?.[1];
        return { json: { files: (g.files[sub] ?? []).filter((f) => !parent || f.parents.includes(parent)).map(({ markdown: _m, ...f }) => f) } };
      }
      if (u.hostname === "www.googleapis.com" && u.pathname.includes("/drive/v3/changes")) return { json: { changes: [], newStartPageToken: "2" } };
      if (u.hostname === "admin.googleapis.com") return { json: { users: [] } };
      if (u.hostname === "meet.googleapis.com") return { json: {} };
      return undefined;
    },
    seam({ url, body, headers }) {
      const sub = who(headers);
      const exported = /\/drive\/v3\/files\/([^/?]+)\/export\?mimeType=([^&]+)/.exec(url);
      if (exported) {
        const f = (g.files[sub ?? ""] ?? []).find((x) => x.id === exported[1]);
        return f?.markdown !== undefined && decodeURIComponent(exported[2]!) === "text/markdown" ? { text: f.markdown } : { status: 400, json: { error: { code: 400, message: "Export only supports these formats." } } };
      }
      if (url.startsWith("https://www.googleapis.com/drive/v3/files/") && url.includes("alt=media")) {
        const f = (g.files[sub ?? ""] ?? []).find((x) => url.includes(`/files/${x.id}?`));
        return f ? { text: `Contents of ${f.name}` } : undefined;
      }
      if (url !== "https://oauth2.googleapis.com/token") return undefined;
      const form = new URLSearchParams(String(body));
      const [h, p, sig] = (form.get("assertion") ?? "").split(".");
      if (!h || !p || !sig || !createVerify("RSA-SHA256").update(`${h}.${p}`).verify(saPublic, Buffer.from(sig, "base64url"))) return { status: 400, json: { error: "invalid_grant", error_description: "Invalid JWT Signature." } };
      const c = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as { sub?: string; scope: string; iss: string };
      c.sub ??= SA_EMAIL;   // the key checked as itself, acting for nobody
      if (c.iss !== SA_EMAIL || !(c.sub.endsWith(`@${DOMAIN}`) || c.sub === SA_EMAIL)) return { status: 400, json: { error: "invalid_grant" } };
      return { json: { access_token: `at|${c.sub}|${c.scope.split(" ")[0]!.slice(SCOPE.length)}`, expires_in: 3600 } };
    },
  };
}

// ---- the model: says which account a turn ran on; asks for a key when told to set up Fathom, and uses it by its handle when told to carry on

const accountWords = (a: { payer?: string; spaceKey?: boolean; kind?: string; ref?: string } | undefined): string => `ran for ${a?.payer ?? "-"} on ${a?.spaceKey ? "the space key" : `${a?.kind ?? "-"} ${a?.ref ?? "-"}`}`;
let asks = 0;
export const model: OpenSession = async (spec) => {
  const waiting = new Map<string, (r: ToolResult) => void>();
  let n = 0;
  async function* run(name: string, input: unknown): AsyncGenerator<DriverEvent, ToolResult> {
    const id = `call_${++n}`;
    const answer = new Promise<ToolResult>((resolve) => waiting.set(id, resolve));
    yield { type: "tool_call", id, name, input };
    return answer;
  }
  return {
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      const body = String(input.trigger?.body ?? "");
      if (/set up fathom/i.test(body)) {
        const r = yield* run("vault_request", { name: "Fathom", fields: ["api_key"], reason: "To read your meetings.", idempotencyKey: `hour-fathom-${++asks}` });
        yield { type: "text", text: r.ok ? "I asked for the Fathom key." : `FAILED ${JSON.stringify(r.content).slice(0, 300)}` };
      } else if (/Carry on/.test(body)) {
        const found = yield* run("tool_search", { query: "vault use" });
        // as a model would: the handle the person's line names (another item may hold the name), else the name it asked for
        const r = found.ok ? yield* run("vault_use", { item: /as (#[A-Za-z0-9_]+)/.exec(body)?.[1] ?? "Fathom", purpose: "Read the meetings" }) : found;
        const c = (r.content as { data?: { handle?: string; itemId?: string } } | null)?.data;
        yield { type: "text", text: r.ok ? `USED ${c?.handle ?? JSON.stringify(r.content)} ${c?.itemId ?? ""}` : `FAILED ${JSON.stringify(r.content).slice(0, 300)}` };
      } else {
        yield { type: "text", text: accountWords(spec.account as Parameters<typeof accountWords>[0]) };
      }
      yield { type: "done" };
    },
    sendToolResult(id: string, r: ToolResult) { waiting.get(id)?.(r); waiting.delete(id); },
    inject() {}, async cancel() {}, async close() {},
  } as EngineSession;
};

// ---- people

export interface Answered { cap: string; status: number; body: unknown }
export interface Person {
  label: string;
  username: string;
  email: string;
  password: string;
  personId: string;
  token: string | null;
  /** every answer this person's app got, in order */
  seen: Answered[];
  /** a call that must answer */
  call(cap: string, input?: Record<string, unknown>): Promise<Any>;
  /** a call that may be refused: its answer or its error */
  attempt(cap: string, input?: Record<string, unknown>): Promise<{ ok: true; data: Any } | { ok: false; error: CapError }>;
  /** a call that is meant to be refused, in plain words; recorded so the refusal sweep accepts it */
  refused(cap: string, input: Record<string, unknown>, code: RegExp, why: string): Promise<CapError>;
}

interface Intended { actor: string; cap: string; code: string; why: string }

export interface Hour {
  d: Daemon;
  dir: string;
  g: Google;
  owner: Person;
  agentId: string;
  /** the edge: the Space's https address as Caddy hands it to the daemon */
  edge(seen?: Answered[]): typeof fetch;
  person(label: string, username: string, email: string, password: string): Person;
  intended: Intended[];
  stop(): Promise<void>;
}

/** Plain words: a sentence for a person, never a capability name, a code or an id. */
export function plainWords(message: string): boolean {
  return message.trim().length > 8 && !/\b[a-z_]+\.[a-z_]+(\.[a-z_]+)*\b/.test(message.replace(/\b[a-z0-9-]+\.(test|com|run|io)\b/g, "")) && !/\b(spc|usr|agt|vit|vfd|thr|chn)_[a-z0-9]/i.test(message);
}

export async function bootHour(prefix: string): Promise<Hour> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `vyre-hour-${prefix}-`)));
  const idp = createIdp({ issuer: ISSUER, clientId: SSO_CLIENT, secret: SSO_SECRET });
  const gg = google();
  const reply = (a: Answer) => {
    const status = a?.status ?? (a === undefined ? 404 : 200);
    const body = a?.text ?? (a?.json === undefined ? (a === undefined ? JSON.stringify({ error: { code: 404, errors: [{ reason: "notFound" }] } }) : "") : JSON.stringify(a.json));
    return { status, ok: status < 400, text: async () => body, json: async () => JSON.parse(body) as unknown, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer, headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? (a?.json !== undefined ? "application/json" : "text/plain") : null) } };
  };
  // the fake provider behind the Space AI key: a model list on this machine (member-key-kit vendor), reached as any provider is
  const models = await vendor();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_7d1e0c2b9a4f5e6d8c3b2a19", "--address", ADDRESS], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: `${prefix}-server`, free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyProbe,
    http: (async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => (url.startsWith(models.base) ? fetch(url, init as RequestInit) : reply(gg.api({ method: init?.method ?? "GET", url, headers: init?.headers ?? {} })))) as never,
    seams: {
      fetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) => {
        const r = { method: init?.method ?? "GET", url, headers: init?.headers ?? {}, body: init?.body };
        return reply((await idp.api(r)) ?? gg.seam(r));
      },
    } as never,
    engineOpenSession: model,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });

  const edge = (seen?: Answered[]): typeof fetch => (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    assert.ok(url.startsWith(ADDRESS), `the app only reaches the Space at its address: ${url}`);
    // Caddy keeps the Host the browser sent and says the request came in over https (fetch cannot set Host, so this is node:http)
    const target = new URL(d.url + url.slice(ADDRESS.length));
    const headers = { ...(init?.headers as Record<string, string> | undefined), host: new URL(ADDRESS).host, "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.7" };
    const r = await new Promise<Response>((resolve, reject) => {
      const req = http.request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: init?.method ?? "GET", headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) for (const x of Array.isArray(v) ? v : [v]) h.append(k, x);
          const status = res.statusCode ?? 500;
          resolve(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), { status, headers: h }));
        });
      });
      req.on("error", reject);
      if (init?.body !== undefined && init.body !== null) req.write(init.body as string);
      req.end();
    });
    if (seen && url.includes("/v1/")) {
      let body: unknown = null;
      try { body = await r.clone().json(); } catch { /* not JSON */ }
      seen.push({ cap: new URL(url).pathname.replace(/^\/v1\//, "").replaceAll("/", "."), status: r.status, body });
    }
    return r;
  }) as typeof fetch;

  const intended: Intended[] = [];
  const person = (label: string, username: string, email: string, password: string): Person => {
    const seen: Answered[] = [];
    const p: Person = {
      label, username, email, password, personId: "", token: null, seen,
      async call(cap, input = {}) {
        try { return await caller(cap, input); } catch (e) {
          // a failure on our side says what the server logged for it
          let logs = "";
          if (e instanceof CapError && e.status >= 500 && e.traceId) { d.sink.flush(); logs = ` | log: ${JSON.stringify(d.sink.trace(e.traceId).logs.map((l: { msg: string; attrs?: unknown }) => [l.msg, l.attrs]))}`.slice(0, 1500); }
          throw new Error(`${label} ${cap}: ${e instanceof CapError ? `${e.status} ${e.code} ${e.message} ${JSON.stringify(e.details ?? {})}` : String(e)}${logs}`);
        }
      },
      async attempt(cap, input = {}) {
        try { return { ok: true, data: await caller(cap, input) }; } catch (e) { if (e instanceof CapError) return { ok: false, error: e }; throw e; }
      },
      async refused(cap, input, code, why) {
        const r = await p.attempt(cap, input);
        assert.equal(r.ok, false, `${label} ${cap} is refused: ${why}`);
        const err = (r as { error: CapError }).error;
        assert.match(err.code, code, `${label} ${cap}: ${err.code} ${err.message} ${JSON.stringify(err.details ?? {})}`);
        assert.ok(plainWords(err.message), `${label} ${cap} says why in plain words: "${err.message}"`);
        intended.push({ actor: p.personId, cap, code: err.code, why });
        return err;
      },
    };
    const caller = createCapCaller({ baseUrl: ADDRESS, token: () => p.token, fetch: edge(seen) });
    return p;
  };

  const stop = async (): Promise<void> => {
    await Promise.race([d.stop(), new Promise<void>((r) => setTimeout(r, 15_000).unref())]);
    const { closeDefaultSandbox } = await import("../../modules/engine/runtime.ts");
    await closeDefaultSandbox().catch(() => undefined);
    await models.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try {
  // the owner claims the fresh Space from the server's one-time link, on the Mac app, and hands their key to the Space's door
  const owner = person("owner", "irfad", `irfad@${DOMAIN}`, "owner horse battery staple 9");
  const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
  const spaceId = new URLSearchParams(new URL(d.claim!.url).hash.slice(1)).get("s") ?? d.space!;
  const made = await makeBundle(owner.password, "owner-recovery-code-for-the-test", { spaceId });
  try {
    const { personKey: _k, personKeyByRecovery: _r, spaceKeys, ...wrapped } = made;
    const claimed = await owner.call("identity.claim_owner", { code, spaceId, username: owner.username, displayName: "Irfad", password: owner.password, deviceName: "Vyre desktop", deviceClass: "desktop", keys: { ...wrapped, spaceKeys } });
    owner.token = claimed.session.token as string;
    owner.personId = (await owner.call("identity.whoami")).principal.id as string;
    assert.ok(await holdKeyOnOwnNode(ADDRESS, owner.token, made.personKey, edge()), "the owner's key is at the Space's door");
  } finally { wipe(made.personKey); }

  // the owner's setup: the Space's name, the Space AI key, Google sign-in, and an agent for the team
  await owner.call("spaces.update", { name: SPACE_NAME, logoFileId: null });   // as onboarding names it (KitPickCard)
  const ep = await owner.call("providers.custom_add", { name: "Provider Go", baseUrl: models.base, apiKey: SPACE_KEY, scope: "mine" });
  await owner.call("providers.space_key.set", { providerKey: ep.endpoint.key, apiKey: SPACE_KEY });
  // Google sign-in the way Console saves it (sso-save.ts): the secret into a Restricted Vault folder, only its handle into members.sso.set
  const saved = await saveSso((cap, input) => owner.call(cap, input as Record<string, unknown>), { key: "google", clientId: SSO_CLIENT, secret: SSO_SECRET, domain: DOMAIN, tenant: "", enabled: true }, undefined);
  assert.deepEqual(saved, { ok: true, message: "Google sign-in saved" });
  const agentId = (await owner.call("agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;
  hourIdp.set(d, idp);
  return { d, dir, g: gg, owner, agentId, edge, person, intended, stop };
  } catch (e) { await stop(); throw e; }
}
const hourIdp = new WeakMap<Daemon, ReturnType<typeof createIdp>>();

// ---- the owner invites by email; people join and sign in again the way the app does

export async function invite(h: Hour, email: string): Promise<string> {
  const roles = (await h.owner.call("access.roles.list")).roles as { id: string; name: string }[];
  const inv = await h.owner.call("members.invites.create", { role: roles.find((r) => r.name === "Member")!.id, email });
  assert.ok(String(inv.link).startsWith(`${ADDRESS}/`), `the invite link is at the Space's own address: ${inv.link}`);
  return decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
}

/** Google's side of a sign-in: the start address (a join offer or a return address), the person approving at Google, and the callback with the browser's cookie. */
async function google302(h: Hour, start: string, who: Person): Promise<Response> {
  const go = await h.edge()(`${ADDRESS}${start}`);
  assert.equal(go.status, 302, `the start address sends the browser to Google: ${go.status} ${await go.text()}`);
  const to = new URL(go.headers.get("location")!);
  assert.equal(to.origin, ISSUER);
  const cookie = go.headers.get("set-cookie")!.split(";")[0]!;
  const code = hourIdp.get(h.d)!.approve(to.toString(), { sub: `google-${who.username}`, email: who.email, email_verified: true, hd: DOMAIN });
  const back = new URL(to.searchParams.get("redirect_uri")!);
  assert.equal(back.origin, ADDRESS, "Google returns to the Space's own address");
  return h.edge()(`${ADDRESS}${back.pathname}?state=${encodeURIComponent(to.searchParams.get("state")!)}&code=${encodeURIComponent(code)}`, { headers: { cookie } });
}

/** The join page: the preview, a key bundle made on this device, members.accept, the Space checked, the key handed to the door. Google, when given, proves the invited address first. */
export async function join(h: Hour, p: Person, code: string, how: { device: "web" | "desktop"; google?: boolean }): Promise<{ preview: Any }> {
  const preview = await p.call("members.invites.preview", { code });
  let sso: string | undefined;
  if (how.google) {
    const started = await p.call("identity.sso_join_start", { code, provider: "google" });
    const done = await google302(h, started.start as string, p);
    const said = await done.text();
    assert.equal(done.status, 200, said);
    assert.match(said, /Go back to your invitation/);
    sso = "google";
  }
  const made = await makeBundle(p.password, `${p.username}-recovery-code`, { spaceId: preview.spaceId });
  try {
    const { personKey: _k, personKeyByRecovery: _r, spaceKeys, ...wrapped } = made;
    const out = await p.call("members.accept", { code, username: p.username, displayName: p.label, password: p.password, deviceName: how.device === "web" ? "Chrome on Windows" : "Vyre desktop", deviceClass: how.device, keys: { ...wrapped, spaceKeys }, ...(sso ? { ssoProvider: sso } : {}) });
    p.token = out.token as string;
    p.personId = out.personId as string;
    assert.equal((await p.call("spaces.get")).space.id, preview.spaceId, "the Space the invite named is the one joined");
    assert.ok(await holdKeyOnOwnNode(ADDRESS, p.token, made.personKey, h.edge()), "joining hands the key to the Space's door over https");
  } finally { wipe(made.personKey); }
  await openShell(p);
  return { preview };
}

export async function signOut(p: Person): Promise<void> {
  await p.call("identity.sign_out", {});
  p.token = null;
}

/** The sign-in page with a password, as SessionGate does it: identity.sign_in, spaces.get, then the key opened on this device with the password and handed to the door. */
export async function signInPassword(h: Hour, p: Person): Promise<void> {
  await p.call("identity.sign_in_options");
  const out = await p.call("identity.sign_in", { username: p.username, password: p.password, deviceName: "Chrome on Windows", deviceClass: "web" });
  assert.equal(out.status, "ok");
  p.token = out.session.token as string;
  await p.call("spaces.get");
  const opened = await openBundle(p.password, { ...out.keys, personKeyByRecovery: out.keys.personKeyByRecovery ?? "" });
  try { assert.ok(await holdKeyOnOwnNode(ADDRESS, p.token, opened.personKey, h.edge())); } finally { wipe(opened.personKey); wipe(opened.privateKey); }
  await openShell(p);
}

/** The sign-in page's Google button: the start address with this page as the return, Google, the callback's fragment, identity.sso_sign_in. Nothing is typed and no key is handed over. */
export async function signInGoogle(h: Hour, p: Person): Promise<void> {
  const options = await p.call("identity.sign_in_options");
  assert.ok((options.sso as { key: string }[]).some((s) => s.key === "google"), "the sign-in page offers Google");
  const back = await google302(h, `/auth/sso/google/start?return=${encodeURIComponent(`${ADDRESS}/chat`)}`, p);
  assert.equal(back.status, 302, back.status === 302 ? "" : await back.text());
  const fragment = new URLSearchParams(new URL(back.headers.get("location")!).hash.slice(1));
  assert.ok(fragment.get("sso_code"), `Google signed them in: ${back.headers.get("location")}`);
  const out = await p.call("identity.sso_sign_in", { provider: fragment.get("sso_provider"), code: fragment.get("sso_code"), state: "-", deviceName: "Vyre desktop", deviceClass: "desktop" });
  assert.equal(out.status, "ok");
  p.token = out.session.token as string;
  await p.call("spaces.get");
  await openShell(p);
}

/** One screen query as the app's screen hooks make it: the generated screen's capability, its input pointers resolved against the screen state. A refusal is left to the sweep; any other failure fails. */
export async function screen(p: Person, screenId: string, query: string, state: Record<string, unknown> = {}): Promise<Any> {
  const q = screens.find((x) => x.id === screenId)?.queries[query];
  assert.ok(q, `the app has the screen query ${screenId} ${query}`);
  const r = await p.attempt(q.cap, resolvePointers(q.input, state) as Record<string, unknown>);
  if (!r.ok) assert.match(r.error.code, /^permission\./, `${p.label}'s ${screenId} ${query} (${q.cap}) failed: ${r.error.status} ${r.error.code} ${r.error.message}`);
  return r.ok ? r.data : null;
}

/** What the shell reads when a session opens (session.ts), then every place's first list as the idle warm-up reads it (prefetch.ts). */
export async function openShell(p: Person): Promise<void> {
  for (const cap of ["identity.whoami", "spaces.get", "spaces.switcher", "settings.kit.get", "connections.list", "access.principals.list", "access.groups.list", "agents.list"]) {
    const r = await p.attempt(cap, {});
    if (!r.ok) assert.match(r.error.code, /^permission\./, `${p.label}'s shell read ${cap} failed: ${r.error.status} ${r.error.code} ${r.error.message}`);
  }
  for (const place of WARM_ORDER) for (const w of PLACE_QUERIES[place] ?? []) await screen(p, w.screen, w.query, w.state ?? {});
}

/** What the Space's door says about this session's key. */
export async function keyStatus(h: Hour, p: Person): Promise<{ held: boolean; remembered: boolean; forgotten: boolean }> {
  const r = await h.edge()(`${ADDRESS}/vault/key/status`, { method: "POST", headers: { authorization: `Bearer ${p.token}` } });
  assert.equal(r.status, 200);
  return (await r.json()) as { held: boolean; remembered: boolean; forgotten: boolean };
}

/** Steps 1 to 3 for a walk that starts after them: two people invited by email, Aina joins by password in Chrome, Bilal with Google in the Windows app, and both sign in again later. */
export async function twoMembers(h: Hour): Promise<{ a: Person; b: Person }> {
  const a = h.person("Aina", "aina", `aina@${DOMAIN}`, "aina horse battery staple 9");
  const b = h.person("Bilal", "bilal", `bilal@${DOMAIN}`, "bilal horse battery staple 9");
  const [ca, cb] = [await invite(h, a.email), await invite(h, b.email)];
  await join(h, a, ca, { device: "web" });
  await join(h, b, cb, { device: "desktop", google: true });
  await signOut(a); await signOut(b);
  await signInPassword(h, a);
  await signInGoogle(h, b);
  return { a, b };
}

// ---- chats

export async function messages(h: Hour, p: Person, threadId: string): Promise<Array<{ author?: { kind?: string; id?: string }; body?: string; threadSeq?: number; blocks?: Array<{ type: string; data: Any }> }>> {
  await h.d.hooks?.pump?.();
  return (await p.call("chat.messages.list", { threadId })).messages;
}

export async function waitFor<T>(f: () => Promise<T | null | undefined>, ms = 20_000, why = ""): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v !== null && v !== undefined) return v;
    if (Date.now() > end) throw new Error(`it never happened: ${why}`);
    await new Promise<void>((r) => setTimeout(r, 100));
  }
}

/** A new chat with the agent, one message, and the agent's reply. */
export async function ask(h: Hour, p: Person, body: string, agentId = h.agentId): Promise<{ threadId: string; reply: string }> {
  const threadId = (await p.call("chat.start", { kind: "chat", agentIds: [agentId] })).thread.threadId as string;
  return { threadId, reply: await say(h, p, threadId, body, agentId) };
}

/** One more message in a chat, and the agent's next reply. */
export async function say(h: Hour, p: Person, threadId: string, body: string, agentId = h.agentId): Promise<string> {
  const before = (await messages(h, p, threadId)).length;
  await p.call("chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }] });
  return waitFor(async () => (await messages(h, p, threadId)).slice(before).find((m) => m.author?.kind === "agent" && (m.body ?? "") !== "")?.body ?? null, 20_000, `${p.label}'s reply to "${body}"`);
}

/** A member connects their own Claude sign-in into their own Mine (the app's Connect sheet: an Accounts folder, the flow, the item) and lets the Space run it. Answers its account ref. */
export async function connectClaude(p: Person, name: string): Promise<string> {
  const folder = await p.call("vault.folders.create", { name: "Accounts", scope: "mine" });
  const flow = await p.call("providers.subscription_start", { providerKey: "claude-code" });
  await p.call("vault.item.put", { folderId: folder.folder.id, name, kind: "ai_subscription", fields: [{ key: "setup_token", value: SUB, secret: true }] });
  const provider = (await p.call("providers.subscription_complete", { flowId: flow.flowId })).provider as { id: string; scope: string; state: string };
  assert.deepEqual([provider.scope, provider.state], ["mine", "ok"], `${p.label}'s sign-in is their own and works`);
  await p.call("providers.set_space_use", { providerId: provider.id, allow: true });
  const mine = ((await p.call("engine.accounts.list")).accounts as Array<{ ref: string; mine: boolean; kind: string }>).find((a) => a.mine && a.kind === "subscription");
  assert.ok(mine, `${p.label}'s sign-in is one of their accounts`);
  return mine.ref;
}

// ---- what the walk checks at its end

/** Every Space label the app would show this person: the sign-in page, the switcher tile, the Space profile, and anything named in an answer they got. Never an spc_ id. */
export async function spaceLabels(p: Person): Promise<void> {
  const shown = [
    ["sign-in page", (await p.call("identity.sign_in_options")).name],
    ["switcher", (await p.call("spaces.switcher")).name],
    ["Space profile", (await p.call("spaces.get")).space.name],
  ] as const;
  for (const [where, name] of shown) {
    assert.equal(name, SPACE_NAME, `${p.label}'s ${where} names the Space`);
    assert.equal(spaceLabel(name, ADDRESS), SPACE_NAME);
  }
  const ids: string[] = [];
  const walk = (v: unknown, at: string): void => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    if (v === null || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" && /^(spaceName|spaceLabel|spaceTitle)$/.test(k) && (SPACE_ID.test(x) || x.trim() === "")) ids.push(`${at}.${k}=${x}`);
      else walk(x, `${at}.${k}`);
    }
  };
  for (const s of p.seen) walk(s.body, s.cap);
  assert.deepEqual(ids, [], `${p.label} was never shown a Space id where the Space's name goes`);
}

/** Refusals the members met: from the log sink (an invoke row's result, by actor or on behalf of), and from what their app was answered. Each must be one the walk meant, said in plain words. */
export function unexpectedRefusals(h: Hour, people: Person[]): string[] {
  h.d.sink.flush();
  const ids = people.map((p) => p.personId);
  const rows = h.d.sink.db.prepare(`SELECT cap, actor, on_behalf, result, attrs FROM logs WHERE msg = 'invoke' AND result LIKE 'permission.%' AND (actor IN (${ids.map(() => "?").join(",")}) OR on_behalf IN (${ids.map(() => "?").join(",")}))`).all(...ids, ...ids) as Array<{ cap: string; actor: string | null; on_behalf: string | null; result: string; attrs: string }>;
  const meant = (actor: string | null, cap: string, code: string): boolean => h.intended.some((i) => i.actor === actor && i.cap === cap && i.code === code);
  const out = rows.filter((r) => !meant(r.actor ?? r.on_behalf, r.cap, r.result)).map((r) => `log: ${r.cap} ${r.result} for ${people.find((p) => p.personId === (r.actor ?? r.on_behalf))?.label ?? r.actor ?? r.on_behalf}`);
  for (const p of people) {
    for (const s of p.seen) {
      const e = (s.body as { error?: { code?: string; message?: string } } | null)?.error;
      if (s.status === 403 || /^permission\./.test(e?.code ?? "")) {
        if (!meant(p.personId, s.cap, e?.code ?? "")) out.push(`app: ${p.label} ${s.cap} ${s.status} ${e?.code ?? ""} "${e?.message ?? ""}"`);
      }
    }
  }
  return [...new Set(out)];
}

// ---- the same person's own Personal Space, on their own computer (loopback: the app hands the key to /local/vault/key)

export interface Personal { d: Daemon; me: Person; stop(): Promise<void> }

export async function bootPersonal(prefix: string, who: { label: string; username: string; email: string; password: string }): Promise<Personal> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `vyre-hour-${prefix}-`)));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_3c9b1a7e5d2f4c6b8a0e1d27", "--space-kind", "personal"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: `${prefix}-laptop`, free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyProbe,
    engineOpenSession: model,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const stop = async (): Promise<void> => {
    await Promise.race([d.stop(), new Promise<void>((r) => setTimeout(r, 15_000).unref())]);
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try {
    const seen: Answered[] = [];
    const me: Person = {
      ...who, personId: "", token: null, seen,
      async call(cap, input = {}) { try { return await caller(cap, input); } catch (e) { throw new Error(`${who.label} (Personal) ${cap}: ${e instanceof CapError ? `${e.status} ${e.code} ${e.message} ${JSON.stringify(e.details ?? {})}` : String(e)}`); } },
      async attempt(cap, input = {}) { try { return { ok: true, data: await caller(cap, input) }; } catch (e) { if (e instanceof CapError) return { ok: false, error: e }; throw e; } },
      async refused() { throw new Error("not used in the Personal Space"); },
    };
    const caller = createCapCaller({ baseUrl: d.url, token: () => me.token });
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const spaceId = new URLSearchParams(new URL(d.claim!.url).hash.slice(1)).get("s") ?? d.space!;
    const made = await makeBundle(who.password, `${who.username}-personal-recovery`, { spaceId });
    try {
      const { personKey: _k, personKeyByRecovery: _r, spaceKeys, ...wrapped } = made;
      me.token = (await me.call("identity.claim_owner", { code, spaceId, username: who.username, displayName: who.label, password: who.password, deviceName: "Vyre desktop", deviceClass: "desktop", keys: { ...wrapped, spaceKeys } })).session.token as string;
      me.personId = (await me.call("identity.whoami")).principal.id as string;
      assert.ok(await holdKeyOnOwnNode(d.url, me.token, made.personKey), "the key goes to this computer's own daemon");
    } finally { wipe(made.personKey); }
    return { d, me, stop };
  } catch (e) { await stop(); throw e; }
}

/** The key request card (keyrequest.tsx): read the request and whether this person decides it, pick the folder the card picks, and Add the key. Answers the fulfilled request. */
export async function addTheKey(p: Person, requestId: string, value: string): Promise<{ canDecide: boolean; request: Any }> {
  await p.call("vault.requests.get", { requestId });
  const toDecide = (await p.call("vault.requests.list", { mine: false })) as { requests?: { id: string }[] };
  const canDecide = (toDecide.requests ?? []).some((r) => r.id === requestId);
  if (!canDecide) return { canDecide, request: null };
  const req = (await p.call("vault.requests.get", { requestId })).request as { folderId?: string; fields: string[] };
  let folderId = req.folderId;
  if (!folderId) {
    const folders = ((await p.call("vault.folders.list", {})) as { folders: { id: string; scope: string }[] }).folders;
    folderId = (folders.find((f) => f.scope === "shared") ?? folders.find((f) => f.scope === "mine"))?.id
      ?? ((await p.call("vault.folders.create", { name: "Mine", scope: "mine", idempotencyKey: `kr-${requestId}-folder` })) as { folder: { id: string } }).folder.id;
  }
  const done = await p.call("vault.requests.fulfil", { requestId, folderId, fields: req.fields.map((k) => ({ key: k, value })) });
  return { canDecide, request: done.request };
}
