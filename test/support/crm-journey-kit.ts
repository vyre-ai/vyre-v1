// The pieces the CRM-to-Records journeys share (test/crm.journeys.live.test.ts): a daemon started in this process the way a person's computer or a Team server runs it, the app's
// production export on one origin (when CI has built it), a fake CRM behind the connector network seam (a real HTTP server, the Link header and webhooks included), and screenshots at every step
// in light and dark, desktop and phone. Nothing in the daemon is faked except the outside app (the fake CRM). The agent's part is proven by test/crm-to-records.test.ts and the real run.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../../host/src/platform/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";
import { scriptedModel } from "./live.ts";
import type { RunTool } from "./live.ts";
import { makeUse } from "./bench.ts";
import { fillSpec } from "./agent-standin.ts";
import type { Know } from "./agent-standin.ts";
import type { DriverEvent } from "../../agent/src/turn-engine/types.ts";
import { makeBundle, wipe } from "../../client/src/crypto/keys.ts";
import { KEY_A, KEY_B } from "../../modules/connectors/fixtures/crm.ts";
import { startFakeCrm } from "./fake-crm-server.ts";
import type { FakeCrm } from "./fake-crm-server.ts";
import { edge } from "../../apps/app/tests/real-app-harness.test.ts";
import type { Edge } from "../../apps/app/tests/real-app-harness.test.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const KEY_TEXT = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake

export interface ModelState { know: Know | null; plan: { spec: Record<string, unknown>; summary: string } | null; asked: string[]; tools: string[] }
export interface Space { kind: "personal" | "team"; model: ModelState; /** What the Vault hands out for a handle: a test changes it to revoke a key. */ keys: Record<string, string>; d: Daemon; dir: string; web: Edge | null; crm: FakeCrm; stop(): Promise<void> }

export async function startSpace(o: { kind: "personal" | "team"; name: string; address?: string }): Promise<Space> {
  const dist = process.env["VYRE_APP_DIST"] ?? "";
  if (!dist && process.env["VYRE_REQUIRE_CHROME"] === "1") throw new Error("VYRE_REQUIRE_CHROME=1 and VYRE_APP_DIST is not set: the journeys need the app");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vyre-crm-journey-${o.kind}-`));
  const crm = await startFakeCrm();
  const model: ModelState = { know: null, plan: null, asked: [], tools: [] };
  const keys: Record<string, string> = { Ledger: KEY_A, Orbit: KEY_B };
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", `spc_crm_${o.kind}`, "--space-name", o.name, "--space-kind", o.kind, ...(o.address ? ["--address", o.address] : [])], {}, "1.2.3"), codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: `crm-${o.kind}`, free: 80e9, commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    } }),
    fetch: caddyFetch,
    connectorNetwork: { resolve: async () => ["93.184.216.34"], request: async (url, req) => { const r = await crm.fetch(url.toString(), { method: req.method, headers: req.headers, ...(req.body !== undefined ? { body: req.body } : {}) }); return { status: r.status, text: await r.text(), ...(r.link ? { link: r.link } : {}) }; } },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    engineOpenSession: crmModel(model),
    vault: { secret: async (handle: string) => keys[Object.keys(keys).find((k) => handle.includes(k)) ?? ""] ?? KEY_TEXT, signRs256: async () => "" },
  });
  // the browser part needs the app's export (CI builds it); the rest of a journey runs without it
  const web = dist ? await edge(dist, d.url) : null;
  return { kind: o.kind, model, keys, d, dir, web, crm, stop: async () => { web?.close(); await d.stop(); await crm.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

/** A capability over HTTP as the owner (the same door the CLI and the Console use). */
export async function api(s: Space, cap: string, input: Record<string, unknown> = {}, token = s.d.token): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${s.d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ idempotencyKey: `j-${cap}-${Math.random().toString(36).slice(2)}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
export async function ok(s: Space, cap: string, input: Record<string, unknown> = {}, token?: string): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(s, cap, input, token);
  if (r.status !== 200) throw new Error(`${cap}: ${JSON.stringify(r.data).slice(0, 300)}\n${hostErrors(s.d).slice(0, 1500)}`);
  return r.data;
}

// ---- screenshots

export interface Shots { dir: string; n: number; take(page: Pg, name: string): Promise<void> }
interface Pg { screenshot(o: { path: string }): Promise<unknown>; setViewportSize(s: { width: number; height: number }): Promise<void>; emulateMedia(o: { colorScheme: "light" | "dark" }): Promise<void>; waitForTimeout(ms: number): Promise<void> }

/** One step, four pictures: desktop light and dark, phone light and dark. The page is put back where it was. */
export function shots(dir: string, journey: string): Shots {
  const out = path.join(dir, journey);
  fs.mkdirSync(out, { recursive: true });
  const s: Shots = { dir: out, n: 0, async take(page, name) {
    s.n++;
    const label = `${String(s.n).padStart(2, "0")}-${name}`;
    for (const [vp, w, h] of [["desktop", 1280, 800], ["phone", 390, 780]] as const) for (const mode of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(out, `${label}-${vp}-${mode}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(250);
  } };
  return s;
}

export function hostErrors(d: Daemon): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs WHERE level >= 40 AND msg NOT LIKE '%grants on an agent%' AND msg NOT LIKE '%neighbour%' ORDER BY id DESC LIMIT 20").all() as { level: number; place?: string; cap?: string; msg: string; attrs?: string }[];
  return rows.map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 200)}`).join("\n");
}

/** The Vault, unlocked as the owner does in Settings, with the CRM's key in a Shared folder so the Space can use it. Returns the handle a spec names. */
export async function vaultKey(s: Space, app: "Ledger" | "Orbit"): Promise<string> { return (await vaultItemOf(s, app)).handle; }
export async function vaultItemOf(s: Space, app: "Ledger" | "Orbit", label = ""): Promise<{ id: string; handle: string; name: string }> {
  const unlock = await fetch(`${s.d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  if (unlock.status !== 204 && unlock.status !== 409) throw new Error(`unlock ${unlock.status}`);
  const folder = (await ok(s, "vault.folders.create", { name: `${app}${label} keys`, scope: "shared" })).folder.id as string;
  return (await ok(s, "vault.item.put", { folderId: folder, name: `${app}${label} Key`, kind: "api_key", fields: [{ key: "api_key", value: s.keys[app], secret: true }] })).item as { id: string; handle: string; name: string };
}

/** Waits until a check holds; the message names what never happened. */
export async function until(what: string, check: () => Promise<boolean>, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return; await sleep(150); }
  throw new Error(`never happened: ${what}`);
}

/** A spec with the Vault handle the key really has. */
export function withHandle(spec: Record<string, unknown>, handle: string): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(spec)) as { auth: { vaultHandle: string } };
  out.auth.vaultHandle = handle;
  return out as unknown as Record<string, unknown>;
}

// ---- the agent: the crm-sync-builder skill as a script, using the same tools the real agent has

/** fillSpec is written against the module handlers (async calls); the scripted model must yield each tool call. This drives the one with the other: every sample the filler asks for becomes a tool call. */
async function* driven<T>(fn: (sample: (input: unknown) => Promise<any>) => Promise<T>, call: (input: unknown) => AsyncGenerator<DriverEvent, any>): AsyncGenerator<DriverEvent, T> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const asks: { input: unknown; resolve: (v: unknown) => void }[] = [];
  let wake: (() => void) | undefined;
  const sample = (input: unknown): Promise<any> => new Promise((resolve) => { asks.push({ input, resolve }); wake?.(); });   // eslint-disable-line @typescript-eslint/no-explicit-any
  const done = fn(sample).then((v) => ({ v }));
  for (;;) {
    const ask = asks.shift();
    if (ask) { ask.resolve(yield* call(ask.input)); continue; }
    const next = await Promise.race([done, new Promise<null>((r) => { wake = () => r(null); })]);
    if (next && "v" in next) return next.v;
  }
}

export function crmModel(state: ModelState) {
  return scriptedModel(async function* (input, run: RunTool) {
    yield* script(input, run);
  });
  async function* script(input: any, run: RunTool): AsyncGenerator<DriverEvent, void> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const counter = { calls: 0, log: state.tools };
    const base = makeUse(run, counter);
    const use: typeof base = (name, input) => { counter.calls = 0; return base(name, input); };   // the budget is for benchmarks; this script reads many pages
    const said = String((input as { trigger?: { body?: string } }).trigger?.body ?? "");
    if (state.plan) {
      // the person tapped Looks good: apply what was proposed
      const out = yield* use("sync_specs_apply", { spec: state.plan.spec, idempotencyKey: `apply-${Math.random().toString(36).slice(2)}` });
      state.plan = null;
      const types = (out.data?.types ?? []) as { type: string }[];
      yield { type: "text", text: types.length ? `Done. ${types.map((t) => t.type).join(", ")} are in Records and filling in. Live by ${out.data?.live}.` : `That failed: ${JSON.stringify(out).slice(0, 300)}` };
      return;
    }
    if (!state.know || !/records/i.test(said)) { yield { type: "text", text: "Tell me which app to bring into Records." }; return; }
    const know = state.know;
    const spec = yield* driven((sample) => fillSpec({ "sync_specs.sample": (_c: unknown, i: unknown) => sample(i) } as never, {} as never, know), async function* (i: unknown) { return (yield* use("sync_specs_sample", i)).data; });
    const v = yield* use("sync_specs_preview", { spec });
    if (v.data?.ok !== true) { yield { type: "text", text: `The spec has problems: ${JSON.stringify(v.data?.problems ?? v).slice(0, 300)}` }; return; }
    state.plan = { spec, summary: String(v.data.summary) };
    state.asked.push(state.plan.summary);
    yield* use("ask_question", {
      threadId: (input as { threadId?: string }).threadId, prompt: `${v.data.summary} Go?`, mode: "single",
      options: [{ key: "go", label: "Looks good" }, { key: "dir", label: "Change direction" }, { key: "fields", label: "Show me fields" }],
    });
  }
}

/** The person's Claude account: Vault unlocked, a subscription connected and allowed for the Space. */
export async function connectAi(s: Space): Promise<void> {
  const unlock = await fetch(`${s.d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
  if (unlock.status !== 204 && unlock.status !== 409) throw new Error(`unlock ${unlock.status}`);
  const folder = (await ok(s, "vault.folders.create", { name: "Accounts", scope: "mine" })).folder.id as string;
  const flow = await ok(s, "providers.subscription_start", { providerKey: "claude-code" });
  await ok(s, "vault.item.put", { folderId: folder, name: "Claude setup", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY_TEXT, secret: true }] });
  const provider = (await ok(s, "providers.subscription_complete", { flowId: flow.flowId })).provider;
  await ok(s, "providers.set_space_use", { providerId: provider.id, allow: true });
  await ok(s, "engine.pool.status");
}

/** The assistant, with the two permissions an admin adds for this work, and Use access to the CRM key. Returns the agent id. */
export async function trustAssistant(s: Space, vaultItemId: string, existing?: string): Promise<string> {
  const agentId = existing ?? await createAssistant(s);
  // a Team Space shares the item with the agent by name; a Personal one has no sharing, the person's own agents use their items
  if (s.kind === "team") await ok(s, "vault.share", { resource: { type: "vault_item", id: vaultItemId }, subject: { kind: "agent", id: agentId }, level: "use" });
  return agentId;
}
async function createAssistant(s: Space): Promise<string> {
  const agentId = (await ok(s, "agents.create", { name: "Assistant", role: "You are the person's assistant." })).agent.agentId as string;
  const roles = (await ok(s, "access.roles.list", {})).roles as { id: string; builtIn: boolean; permissions: string[] }[];
  const member = roles.find((r) => r.builtIn && /member/i.test((r as { name?: string }).name ?? "")) ?? roles.find((r) => r.builtIn && !/owner|admin/i.test((r as { name?: string }).name ?? ""));
  if (!member) throw new Error("no member role to clone");
  const role = (await ok(s, "access.roles.create", { name: `CRM sync builder ${Math.random().toString(36).slice(2, 6)}`, cloneFrom: member.id, assignableToAgents: true })).role as { id: string; permissions: string[] };
  const wanted = [...new Set([...role.permissions, "connectors.manage", "schema.manage"])];
  const preview = await ok(s, "access.roles.preview", { roleId: role.id, permissions: wanted });
  await ok(s, "access.roles.apply", { roleId: role.id, permissions: wanted, previewHash: preview.previewHash });
  await ok(s, "access.roles.assign", { subject: { kind: "agent", id: agentId }, roleId: role.id });
  return agentId;
}

/** The person asks in chat to bring the CRM in; the agent proposes; the person taps Looks good. Returns the thread id. */
export async function bringInByChat(s: Space, agentId: string, know: Know, item: { id: string; handle: string; name: string }, tap?: (threadId: string) => Promise<void>): Promise<string> {
  s.model.know = know;
  // a person in a chat with the assistant, set to Auto (new chats ask before a change; this one is about what the assistant does)
  const threadId = (await ok(s, "chat.start", { kind: "chat", agentIds: [agentId] })).thread.threadId as string;
  await ok(s, "threads.set_mode", { threadId, mode: "auto" });
  await ok(s, "chat.post", { threadId, body: `Bring my CRM into Records. Its key is in the Vault as ${item.handle}.`, mentions: [{ kind: "agent", id: agentId }] });
  type Block = { type?: string; id?: string; blockId?: string; state?: string; data?: { answer?: unknown; options?: { key: string; label: string }[] } };
  const find = async (): Promise<{ id: string; go: string } | null> => {
    const msgs = (await ok(s, "chat.messages.list", { threadId })).messages as { blocks?: Block[] }[];
    for (const m of msgs) for (const b of m.blocks ?? []) if (b.type === "question" && (b.blockId ?? b.id) && b.state !== "done" && b.data?.answer === undefined) { const go = b.data?.options?.find((o) => /looks good/i.test(o.label)); if (go) return { id: (b.blockId ?? b.id)!, go: go.key }; }
    return null;
  };
  const q = await untilValue("the agent proposes and asks", find, 60_000).catch(async (e: Error) => {
    const msgs = (await ok(s, "chat.messages.list", { threadId })).messages as { kind: string; body: string; blocks?: unknown[] }[];
    throw new Error(`${e.message}; tools ${s.model.tools.join(",")}; messages ${JSON.stringify(msgs.map((m) => ({ k: m.kind, b: String(m.body).slice(0, 200), bl: JSON.stringify(m.blocks).slice(0, 300) })))}`);
  });
  // the tap: through the question card in the browser when there is one, else the capability the card calls
  if (tap) await tap(threadId); else await ok(s, "chat.answer_block", { threadId, blockId: q.id, answer: { keys: [q.go] } });
  return threadId;
}

export async function untilValue<T>(what: string, check: () => Promise<T | null>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await check(); if (v) return v; await sleep(200); }
  throw new Error(`never happened: ${what}`);
}

/** Everything the chat setup needs in one call: the person's AI, the key in the Vault, the assistant with its permissions, and the ask in chat. */
export async function chatSetup(s: Space, know: (handle: string) => Know, app: "Ledger" | "Orbit" = "Ledger", tap?: (threadId: string) => Promise<void>): Promise<{ agentId: string; item: { id: string; handle: string; name: string }; threadId: string }> {
  await connectAi(s);
  const item = await vaultItemOf(s, app);
  const agentId = await trustAssistant(s, item.id);
  const threadId = await bringInByChat(s, agentId, know(item.handle), item, tap);
  return { agentId, item, threadId };
}

/** A person invited to the Space, as the Console's invite makes them. Returns their id and the token their browser holds. */
export const MEMBER_PASSWORD = "correct horse battery staple 9";
export async function joinMember(s: Space, username: string, displayName: string): Promise<{ personId: string; token: string; username: string }> {
  const roles = (await ok(s, "access.roles.list", {})).roles as { id: string; name: string }[];
  const member = roles.find((r) => r.name === "Member")!;
  const inv = await ok(s, "members.invites.create", { role: member.id });
  const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
  // real key bundles, as the apps make them, so the person can sign in through the sign-in screen
  const made = await makeBundle(MEMBER_PASSWORD, "recovery-code-for-the-test", { spaceId: `spc_crm_${s.kind}` });
  const { personKey, ...rest } = made;
  wipe(personKey);
  const keys = { personKeyByPassword: rest.personKeyByPassword, personKeyByRecovery: rest.personKeyByRecovery, publicKey: rest.publicKey, privateKeyWrapped: rest.privateKeyWrapped, spaceKeys: rest.spaceKeys };
  const r = await fetch(`${s.d.url}/v1/members/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username, displayName, password: MEMBER_PASSWORD, deviceName: `${displayName}'s laptop`, deviceClass: "desktop", keys }) });
  if (r.status !== 200) throw new Error(`accept ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return { ...((await r.json()) as { data: { personId: string; token: string } }).data, username };
}

/** An admin gives the assistant the right to manage these record types, so it can choose who they are open to. */
export async function giveManage(s: Space, agentId: string, types: string[]): Promise<void> {
  for (const id of types) await ok(s, "access.share", { resource: { type: "record_type", id }, subject: { kind: "agent", id: agentId }, level: "manage" });
}
export async function agentSaid(s: Space, threadId: string): Promise<string> {
  return ((await ok(s, "chat.messages.list", { threadId })).messages as { kind: string; body: string }[]).filter((m) => m.kind === "agent").map((m) => m.body).join("\n");
}
