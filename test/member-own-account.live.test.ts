// A member's own AI account on a Team Space server (owner ruling 3 Nov, R62 amended), on a booted server-role daemon. Two members join from an invitation with real key bundles. Signing in hands the
// person key to the Space over its https door (POST /vault/key/unlock), bound to that session; the member connects a Claude sign-in (a fake one: the provider's flow is the existing test path) into
// their own Mine, and their chat turn runs on it. The other member cannot list or use it and runs on the Space AI key. Signing out drops the key: the next turn runs on the Space AI key and the chat
// says why in one line. The key never reaches a file of the data directory or a log line.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { DriverEvent, EngineSession, OpenSession, SessionSpec } from "../agent/src/turn-engine/types.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import { makeBundle, wipe } from "../client/src/crypto/keys.ts";
import { boot, hostLog, seededDir, waitFor } from "./memory-live-kit.ts";
import { LOCKED_SPACE_KEY_LINE } from "../modules/engine/locked-account.ts";

const SUB = "sk-ant-oat01-MEMBERownSUBtoken0123456789abcdefXYZ"; // secret-scan: fake
const SPACE_KEY = "ocg-space-FAKEkey-0123456789abcdefGHIJ"; // secret-scan: fake
const PASSWORD = "correct horse battery staple 9";

/** An OpenAI-compatible model list for the Space AI key check; the turns themselves run on the stand-in below. */
async function vendor(): Promise<{ base: string; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (String(req.headers["authorization"]) !== `Bearer ${SPACE_KEY}`) { res.writeHead(401); res.end("{}"); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "glm-test" }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

type Reply = { status: number; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
async function api(d: Daemon, token: string | null, cap: string, input: unknown): Promise<Reply> {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
}
let n = 0;
async function ok(d: Daemon, token: string, cap: string, input: Record<string, unknown> = {}): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(d, token, cap, { idempotencyKey: `mo-${++n}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
}
/** The Space's key door as Caddy hands it on: https, from a proxy on this machine. */
const door = (d: Daemon, token: string, op: "unlock" | "lock" | "status", key?: Uint8Array, proto = "https") =>
  fetch(`${d.url}/vault/key/${op}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-proto": proto, "x-forwarded-for": "203.0.113.7" }, ...(key ? { body: JSON.stringify({ key: Buffer.from(key).toString("base64") }) } : {}) });

/** A member as the invite page makes them: a real bundle under their password; the person key their client unwrapped is returned for the door. */
async function join(d: Daemon, username: string): Promise<{ personId: string; token: string; personKey: Uint8Array }> {
  const roles = (await ok(d, d.token, "access.roles.list")).roles as { id: string; name: string }[];
  const inv = await ok(d, d.token, "members.invites.create", { role: roles.find((r) => r.name === "Member")!.id });
  const code = decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!);
  const made = await makeBundle(PASSWORD, "recovery-code-for-the-test", { spaceId: "spc_member_key" });
  const { personKey, ...rest } = made;
  const keys = { personKeyByPassword: rest.personKeyByPassword, personKeyByRecovery: rest.personKeyByRecovery, publicKey: rest.publicKey, privateKeyWrapped: rest.privateKeyWrapped, spaceKeys: rest.spaceKeys };
  const r = await fetch(`${d.url}/v1/members/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username, displayName: username, password: PASSWORD, deviceName: `${username}'s PC`, deviceClass: "desktop", keys }) });
  assert.equal(r.status, 200, await r.clone().text());
  const out = ((await r.json()) as { data: { personId: string; token: string } }).data;
  return { ...out, personKey: Uint8Array.from(personKey) };
}

function filesHolding(dir: string, needle: Buffer): string[] {
  const hits: string[] = [];
  const walk = (p: string): void => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) walk(f); else if (e.isFile() && fs.readFileSync(f).includes(needle)) hits.push(path.relative(dir, f)); } };
  walk(dir);
  return hits;
}

test("Team server: a member's sign-in opens their own Mine; their Claude runs their turns; nobody else's; sign-out falls back to the Space AI key with a line", async () => {
  const specs: SessionSpec[] = [];
  const standIn: OpenSession = async (spec) => {
    specs.push(spec);
    const a = spec.account;
    return { warm: true, async *send(): AsyncGenerator<DriverEvent> { yield { type: "text", text: `ran for ${a?.payer ?? "-"} on ${a?.spaceKey ? "the space key" : `${a?.kind ?? "-"} ${a?.ref ?? "-"}`}` }; yield { type: "done" }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} } as EngineSession;
  };
  const stub = await vendor();
  const dir = seededDir();
  // a Space server (role space): no person's own computer
  // the real Vault (the kit's default is a stand-in that answers every handle), so her Mine items really open with her key
  const d = await boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  try {
    // the owner sets the Space AI key every member falls back to, and an agent
    assert.equal((await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) })).status, 204);
    const ep = await ok(d, d.token, "providers.custom_add", { name: "Stub Go", baseUrl: stub.base, apiKey: SPACE_KEY, scope: "mine" });
    await ok(d, d.token, "providers.space_key.set", { providerKey: ep.endpoint.key, apiKey: SPACE_KEY });
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;

    const rubab = await join(d, "rubab");
    const sara = await join(d, "sara");

    // plain http from another machine is refused; the https door takes the key for her own session
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey, "http")).status, 403);
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey)).status, 204);
    assert.deepEqual(await (await door(d, rubab.token, "status")).json(), { held: true });
    assert.deepEqual(await (await door(d, sara.token, "status")).json(), { held: false }, "Sara's answer is her own");

    // Rubab connects her Claude (a fake sign-in) into her own Mine, from anywhere: no "opens on the computer your Space runs on"
    const folder = await ok(d, rubab.token, "vault.folders.create", { name: "Accounts", scope: "mine" });
    const flow = await ok(d, rubab.token, "providers.subscription_start", { providerKey: "claude-code" });
    await ok(d, rubab.token, "vault.item.put", { folderId: folder.folder.id, name: "Rubab_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: SUB, secret: true }] });
    const provider = (await ok(d, rubab.token, "providers.subscription_complete", { flowId: flow.flowId })).provider as { id: string; scope: string; state: string };
    assert.deepEqual([provider.scope, provider.state], ["mine", "ok"]);
    await ok(d, rubab.token, "providers.set_space_use", { providerId: provider.id, allow: true });
    const mine = ((await ok(d, rubab.token, "engine.accounts.list")).accounts as Array<{ ref: string; mine: boolean; kind: string }>).find((a) => a.mine && a.kind === "subscription");
    assert.ok(mine, "her Claude is one of her accounts");

    const ask = async (who: { personId: string; token: string }, body: string): Promise<{ threadId: string; reply: string }> => {
      const threadId = (await ok(d, who.token, "chat.start", { kind: "chat", agentIds: [agentId] })).thread.threadId as string;
      await ok(d, who.token, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }] });
      const reply = await waitFor(async () => {
        await d.hooks?.pump?.();
        const ms = (await api(d, who.token, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined;
        return ms?.find((m) => m.author?.kind === "agent" && (m.body ?? "") !== "")?.body ?? null;
      }, 40_000, () => hostLog(d));
      return { threadId, reply };
    };

    // her turn runs on her own Claude
    const first = await ask(rubab, "hello from rubab");
    assert.equal(first.reply, `ran for ${rubab.personId} on subscription ${mine.ref}`);
    // and the server can open it for her own turn: the fill an engine makes acting for her
    const filled = await api(d, rubab.token, "vault.use", { item: mine.ref.slice(1) });
    assert.equal(filled.status, 200, JSON.stringify(filled.data));

    // Sara: not listed, not usable by name, and her turn runs on the Space AI key
    const saraAccounts = (await ok(d, sara.token, "engine.accounts.list")).accounts as Array<{ ref: string; spaceKey?: boolean }>;
    assert.ok(!saraAccounts.some((a) => a.ref === mine.ref), "Rubab's Claude is not among Sara's accounts");
    const steal = await api(d, sara.token, "vault.use", { item: mine.ref.slice(1) });
    assert.ok([403, 404].includes(steal.status), `Sara cannot use Rubab's Claude: ${steal.status} ${JSON.stringify(steal.data)}`);
    assert.equal((await ask(sara, "hello from sara")).reply, `ran for ${sara.personId} on the space key`);

    // a second session of Rubab's (a browser that never handed the key over), then she signs out of the first: the key goes with it
    const browser = (await api(d, null, "identity.sign_in", { username: "rubab", password: PASSWORD, deviceName: "Chrome", deviceClass: "web" })).data.session.token as string;
    await ok(d, rubab.token, "identity.sign_out", {});
    assert.deepEqual(await (await door(d, browser, "status")).json(), { held: false }, "signed out: the server no longer holds her key");
    const after = await ask({ personId: rubab.personId, token: browser }, "hello again from rubab");
    assert.equal(after.reply, `ran for ${rubab.personId} on the space key`, "her turn fell back to the Space AI key");
    const lines = ((await ok(d, browser, "chat.messages.list", { threadId: after.threadId })).messages as Array<{ blocks?: Array<{ type?: string; data?: { text?: string } }> }>)
      .flatMap((m) => m.blocks ?? []).filter((b) => b.type === "turn_status").map((b) => b.data?.text);
    assert.ok(lines.includes(LOCKED_SPACE_KEY_LINE), `the chat says why: ${JSON.stringify(lines)}`);

    // signing in again on that browser hands it over and her own account answers again
    assert.equal((await door(d, browser, "unlock", rubab.personKey)).status, 204);
    assert.equal((await ask({ personId: rubab.personId, token: browser }, "and again")).reply, `ran for ${rubab.personId} on subscription ${mine.ref}`);

    // nothing of hers in the clear on disk or in the logs
    d.sink.flush();
    for (const needle of [Buffer.from(rubab.personKey), Buffer.from(Buffer.from(rubab.personKey).toString("base64")), Buffer.from(SUB)]) assert.deepEqual(filesHolding(dir, needle), [], "not in any file in the clear");
    assert.ok(!hostLog(d).includes(SUB));
    wipe(rubab.personKey); wipe(sara.personKey);
  } finally {
    await d.stop();
    await stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
