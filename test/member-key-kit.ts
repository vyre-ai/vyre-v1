// Shared by the member-key live tests (owner ruling 3 Nov, R62 amended): a Team Space server with the real Vault, members who join with real key bundles, the Space's key door as Caddy hands it on,
// a model stand-in that says whose account a turn ran on, and a scan of the data directory for a needle in the clear.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { DriverEvent, EngineSession, OpenSession } from "../agent/src/turn-engine/types.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import { makeBundle } from "../client/src/crypto/keys.ts";
import { hostLog, waitFor } from "./memory-live-kit.ts";

export const SUB = "sk-ant-oat01-MEMBERownSUBtoken0123456789abcdefXYZ"; // secret-scan: fake
export const SPACE_KEY = "ocg-space-FAKEkey-0123456789abcdefGHIJ"; // secret-scan: fake
export const PASSWORD = "correct horse battery staple 9";

/** An OpenAI-compatible model list for the Space AI key check; the turns themselves run on the stand-in below. */
export async function vendor(): Promise<{ base: string; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (String(req.headers["authorization"]) !== `Bearer ${SPACE_KEY}`) { res.writeHead(401); res.end("{}"); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "glm-test" }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

type Reply = { status: number; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
export async function api(d: Daemon, token: string | null, cap: string, input: unknown): Promise<Reply> {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
}
let n = 0;
export async function ok(d: Daemon, token: string, cap: string, input: Record<string, unknown> = {}): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(d, token, cap, { idempotencyKey: `mo-${++n}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
}
/** The Space's key door as Caddy hands it on: https, from a proxy on this machine. */
export const door = (d: Daemon, token: string, op: "unlock" | "lock" | "status" | "forget" | "remember", key?: Uint8Array, proto = "https") =>
  fetch(`${d.url}/vault/key/${op}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-proto": proto, "x-forwarded-for": "203.0.113.7" }, ...(key ? { body: JSON.stringify({ key: Buffer.from(key).toString("base64") }) } : {}) });

/** A member as the invite page makes them: a real bundle under their password; the person key their client unwrapped is returned for the door. */
export async function join(d: Daemon, username: string, email?: string): Promise<{ personId: string; token: string; personKey: Uint8Array }> {
  const roles = (await ok(d, d.token, "access.roles.list")).roles as { id: string; name: string }[];
  const inv = await ok(d, d.token, "members.invites.create", { role: roles.find((r) => r.name === "Member")!.id, ...(email ? { email } : {}) });
  const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
  const made = await makeBundle(PASSWORD, "recovery-code-for-the-test", { spaceId: "spc_member_key" });
  const { personKey, ...rest } = made;
  const keys = { personKeyByPassword: rest.personKeyByPassword, personKeyByRecovery: rest.personKeyByRecovery, publicKey: rest.publicKey, privateKeyWrapped: rest.privateKeyWrapped, spaceKeys: rest.spaceKeys };
  const r = await fetch(`${d.url}/v1/members/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username, displayName: username, password: PASSWORD, deviceName: `${username}'s PC`, deviceClass: "desktop", keys }) });
  assert.equal(r.status, 200, await r.clone().text());
  const out = ((await r.json()) as { data: { personId: string; token: string } }).data;
  return { ...out, personKey: Uint8Array.from(personKey) };
}

export function filesHolding(dir: string, needle: Buffer): string[] {
  const hits: string[] = [];
  const walk = (p: string): void => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) walk(f); else if (e.isFile() && fs.readFileSync(f).includes(needle)) hits.push(path.relative(dir, f)); } };
  walk(dir);
  return hits;
}

/** The model stand-in: it answers with whose account the turn ran on, and on what. */
export const standIn: OpenSession = async (spec) => {
  const a = spec.account;
  return { warm: true, async *send(): AsyncGenerator<DriverEvent> { yield { type: "text", text: `ran for ${a?.payer ?? "-"} on ${a?.spaceKey ? "the space key" : `${a?.kind ?? "-"} ${a?.ref ?? "-"}`}` }; yield { type: "done" }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} } as EngineSession;
};

/** A new chat with the agent, one message, and the agent's first reply. */
export async function ask(d: Daemon, agentId: string, who: { token: string }, body: string): Promise<{ threadId: string; reply: string }> {
  const threadId = (await ok(d, who.token, "chat.start", { kind: "chat", agentIds: [agentId] })).thread.threadId as string;
  await ok(d, who.token, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }] });
  const reply = await waitFor(async () => {
    await d.hooks?.pump?.();
    const ms = (await api(d, who.token, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined;
    return ms?.find((m) => m.author?.kind === "agent" && (m.body ?? "") !== "")?.body ?? null;
  }, 40_000, () => hostLog(d));
  return { threadId, reply };
}

/**
 * A member connects a Claude sign-in (the existing test path: the flow, then the item) into their own Mine. Answers its account ref. By default it also lets the Space run it (automations and memory
 * upkeep need that); `spaceUse: false` leaves the switch as the app leaves it, off.
 */
export async function connectClaude(d: Daemon, token: string, name: string, opts: { spaceUse?: boolean } = {}): Promise<string> {
  const folder = await ok(d, token, "vault.folders.create", { name: "Accounts", scope: "mine" });
  const flow = await ok(d, token, "providers.subscription_start", { providerKey: "claude-code" });
  await ok(d, token, "vault.item.put", { folderId: folder.folder.id, name, kind: "ai_subscription", fields: [{ key: "setup_token", value: SUB, secret: true }] });
  const provider = (await ok(d, token, "providers.subscription_complete", { flowId: flow.flowId })).provider as { id: string; scope: string; state: string };
  assert.deepEqual([provider.scope, provider.state], ["mine", "ok"]);
  if (opts.spaceUse !== false) await ok(d, token, "providers.set_space_use", { providerId: provider.id, allow: true });
  const mine = ((await ok(d, token, "engine.accounts.list")).accounts as Array<{ ref: string; mine: boolean; kind: string }>).find((a) => a.mine && a.kind === "subscription");
  assert.ok(mine, "the sign-in is one of their accounts");
  return mine.ref;
}
