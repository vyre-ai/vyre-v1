// @heavy docker
// The live Assistant of the onboarding screen, on a booted daemon with the model vendor stand-in (the fake CLI of host/tests/fixtures/fake-cli-driver, run in the platform sandbox): a
// person claims a fresh Personal Space, connects an AI account the way the screen does, opens their onboarding Ask thread with their own private assistant (about the onboarding screen,
// carrying the screen context and the focus skill), and gets a reply in that thread. Runs only with VYRE_HEAVY_DOCKER=1 (the same heavy lane as chat.live).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { onboardingScreen } from "../../apps/app/src/onboarding/screen-context.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the CLI runs in the real sandbox)";
const FAKE_CLI = fileURLToPath(new URL("./fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_onbassist", "--space-name", "Personal", "--space-kind", "personal"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "onb-assist", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async () => KEY, signRs256: async () => "" },
    engineCli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] },
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

test("onboarding live Assistant: with an AI account the person's private assistant answers in their onboarding Ask thread", { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-onb-assist-"));
  const d = await boot(dir);
  try {
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Mac", deviceClass: "desktop" };
    assert.equal((await call(d, null, "identity.claim_owner", { code, spaceId: "spc_onbassist", username: "dana", displayName: "Dana Reyes", password: PASSWORD, ...device, keys: KEYS })).status, 200);
    const token = (await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session.token as string;
    const me = (await call(d, token, "identity.whoami", {})).data.principal.id as string;
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    assert.equal(unlock.status, 204);

    // the assistant exists before any AI account; the screen finds it by role, as the Console does
    await d.hooks?.pump?.();
    const assistant = await waitFor(async () => {
      await d.hooks?.pump?.();
      const l = (await call(d, token, "agents.list", { section: "personal", limit: 100 })).data.agents as Array<{ agentId: string; ownerId: string; role?: string }>;
      return l.find((a) => a.ownerId === me && a.role === "assistant") ?? null;
    });

    // connect an AI account the way the Connect AI card does (Claude subscription sign-in), and let the Space run it
    const folder = await call(d, token, "vault.folders.create", { idempotencyKey: "onb-folder", name: "Accounts", scope: "mine" });
    const flow = await call(d, token, "providers.subscription_start", { idempotencyKey: "onb-flow", providerKey: "claude-code" });
    assert.equal((await call(d, token, "vault.item.put", { idempotencyKey: "onb-item", folderId: folder.data.folder.id, name: "Dana_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] })).status, 200);
    const provider = await call(d, token, "providers.subscription_complete", { flowId: flow.data.flowId });
    assert.equal(provider.status, 200, JSON.stringify(provider.data));
    assert.equal((await call(d, token, "providers.set_space_use", { idempotencyKey: "onb-use", providerId: provider.data.provider.id, allow: true })).status, 200);

    // the onboarding Ask thread (one per person and flow), then a message that carries the screen context and the focus skill
    const started = await call(d, token, "chat.start", { kind: "ask", agentIds: [assistant.agentId], scopeType: "onboarding", scopeId: "personal", title: "Setting up", idempotencyKey: "onb-ask" });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const again = await call(d, token, "chat.start", { kind: "ask", agentIds: [assistant.agentId], scopeType: "onboarding", scopeId: "personal", title: "Setting up", idempotencyKey: "onb-ask" });
    assert.equal(again.data.thread.threadId, started.data.thread.threadId, "one thread per person and flow");
    const threadId = started.data.thread.threadId as string;
    const screen = onboardingScreen("personal", "interview", { ai: "done" });
    assert.equal((await call(d, token, "engine.pool.status", {})).status, 200);
    const posted = await call(d, token, "chat.post", { threadId, body: "hello", screen, idempotencyKey: "onb-post" });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    const reply = await waitFor(async () => {
      await d.hooks?.pump?.();
      const r = await call(d, token, "chat.messages.list", { threadId });
      return (r.data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined)?.find((x) => x.author?.kind === "agent" && (x.body ?? "").includes("Hello from the fake engine.")) ?? null;
    });
    assert.ok(reply, "the assistant's reply is in the onboarding thread");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
