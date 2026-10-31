// The person's private assistant answers a chat, in a Personal and a team Space, on a booted daemon with the model vendor stand-in. The order is the real one: the person claims first (the assistant
// is made then, before any AI account), connects an OpenAI key after, and talks to the assistant. It failed before the assistant was upgraded from Guest: it could not read the key or post.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { vendor } from "../../fixtures/model-vendor.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

function boot(dir: string, kind: "personal" | "team"): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_assist", "--space-name", "Space", "--space-kind", kind], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "onb-assist", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => KEY, signRs256: async () => "" },
  });
}

type Reply = { status: number; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(d: Daemon, token: string | null, cap: string, input: unknown): Promise<Reply> {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
async function waitFor<T>(f: () => Promise<T | null>, ms = 40_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await f(); if (v !== null) return v; if (Date.now() > end) throw new Error("waitFor: it never happened"); await new Promise<void>((r) => setTimeout(r, 200)); }
}


async function assistantAnswers(kind: "personal" | "team"): Promise<void> {
  const v = await vendor();
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((u: unknown, i?: RequestInit) => { const url = String((u as { url?: string })?.url ?? u); return realFetch(url.startsWith("https://api.openai.com") ? url.replace("https://api.openai.com", v.base) : (u as string), i); }) as typeof fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-assist-turn-"));
  const d = await boot(dir, kind);
  try {
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Mac", deviceClass: "desktop" };
    assert.equal((await call(d, null, "identity.claim_owner", { code, spaceId: "spc_assist", username: "dana", displayName: "Dana Reyes", password: PASSWORD, ...device, keys: KEYS })).status, 200);
    const token = (await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session.token as string;
    const me = (await call(d, token, "identity.whoami", {})).data.principal.id as string;
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);
    // the assistant is made the moment the account exists: before any AI account, as in every real claim
    const assistant = await waitFor(async () => {
      await d.hooks?.pump?.();
      const l = (await call(d, token, "agents.list", { section: "personal", limit: 100 })).data.agents as Array<{ agentId: string; ownerId: string; role?: string }>;
      return l.find((a) => a.ownerId === me && a.role === "assistant") ?? null;
    });
    // then the person connects an AI key and lets the Space use it
    const provider = await call(d, token, "providers.add", { idempotencyKey: "as-provider", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    assert.equal(provider.status, 200, JSON.stringify(provider.data));
    assert.equal((await call(d, token, "providers.set_space_use", { idempotencyKey: "as-use", providerId: provider.data.provider.id, allow: true })).status, 200);
    v.script.push({ text: "Hi Dana." });
    const started = await call(d, token, "chat.start", { kind: "chat", agentIds: [assistant.agentId], title: "Hello", idempotencyKey: "as-chat" });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const threadId = started.data.thread.threadId as string;
    assert.equal((await call(d, token, "engine.pool.status", {})).status, 200);   // the first engine call builds and binds the runtime, so the bridge has an engine for the message
    const posted = await call(d, token, "chat.post", { threadId, body: "hello", mentions: [{ kind: "agent", id: assistant.agentId }], idempotencyKey: "as-post" });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    const reply = await waitFor(async () => {
      await d.hooks?.pump?.();
      const r = await call(d, token, "chat.messages.list", { threadId });
      return (r.data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined)?.find((x) => x.author?.kind === "agent" && (x.body ?? "").includes("Hi Dana.")) ?? null;
    }, 20_000);
    assert.ok(reply, "the assistant's reply is in the thread");
    assert.equal(v.requests.length, 1, "the turn reached the model vendor once, on the person's own key");
  } finally { globalThis.fetch = realFetch; v.close(); await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test("the person's private assistant answers a plain chat in a Personal Space (account first, AI key second)", async () => { await assistantAnswers("personal"); });
test("the person's private assistant answers a plain chat in a team Space (account first, AI key second)", async () => { await assistantAnswers("team"); });
