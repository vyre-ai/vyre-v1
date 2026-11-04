// @heavy docker
// Hooks on the REAL CLI engines (lane l-hooks): a booted daemon runs a chat turn on Claude Code and on Codex, in the platform's sandbox, with the hooks config Vyre generates for each. Proves, per engine:
//   a note a hook leaves reaches the model as context; a chat hook set by the agent itself stops a Vyre tool, and the reason reaches the chat and hooks.runs.list; a Space block wins over it;
//   and with the hooks layer down (the endpoint the hooks ask is gone) the same call goes on.
// Hooks here are command hooks (they run in the sandbox, no second model call), so a turn costs one short model reply. The model is the engine's cheapest (haiku for Claude Code; HOOKS_CODEX_MODEL for Codex,
// else its default). Runs only with VYRE_HEAVY_DOCKER=1 and the engine's sign-in in the environment: CLAUDE_CODE_OAUTH_TOKEN for Claude Code; for Codex OPENAI_API_KEY (the Codex provider's "with an API
// key" connection, needs l-models wip/l-codexkey) or else CODEX_AUTH_JSON (the text of a ChatGPT-signed-in ~/.codex/auth.json, wrapped as the Vault holds sign-in files). A missing one skips that engine and
// says so. The values are never printed.
// The engines are found in HOOKS_CLI_DIR (default /root/cli/bin). Grok has no account here: its hook files are generated and unit-tested but unproven on a real run.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import { bindHooksPort } from "../agent/src/tools/hooks.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const CLI_DIR = process.env["HOOKS_CLI_DIR"] ?? "/root/cli/bin";
const HEAVY = process.env["VYRE_HEAVY_DOCKER"] === "1";

interface Engine { id: "claude_code" | "codex"; bin: string; env: string; /** Another variable that also signs the engine in */ alt?: string; model: string | undefined }
const ENGINES: Engine[] = [
  { id: "claude_code", bin: "claude", env: "CLAUDE_CODE_OAUTH_TOKEN", model: "haiku" },
  { id: "codex", bin: "codex", env: "OPENAI_API_KEY", alt: "CODEX_AUTH_JSON", model: process.env["HOOKS_CODEX_MODEL"] },
];

type Reply = { status: number; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(d: Daemon, token: string | null, cap: string, input: unknown): Promise<Reply> {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
async function waitFor<T>(d: Daemon, f: () => Promise<T | null>, ms: number, why: () => string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { await d.hooks?.pump?.(); const v = await f(); if (v !== null) return v; if (Date.now() > end) throw new Error(`waitFor: it never happened; ${why()}`); await new Promise<void>((r) => setTimeout(r, 300)); }
}

for (const eng of ENGINES) {
  // Codex: an OpenAI API key (the provider "Codex, with an API key", l-models wip/l-codexkey), or else a ChatGPT-signed-in auth.json
  const authJson = eng.id === "codex" && !process.env[eng.env] ? process.env[eng.alt!] : undefined;
  const key = process.env[eng.env] ?? authJson;
  const skip: string | false = !HEAVY ? "needs VYRE_HEAVY_DOCKER=1 (the CLI runs in the real sandbox)" : !key ? `skipped: ${eng.env}${eng.alt ? ` (or ${eng.alt})` : ""} is not set, so the real ${eng.bin} cannot sign in` : !fs.existsSync(path.join(CLI_DIR, eng.bin)) ? `skipped: ${path.join(CLI_DIR, eng.bin)} is not installed` : false;

  test(`hooks on the real ${eng.bin}: a note reaches the model, an agent's own chat hook stops a Vyre tool, a Space block wins, and with the hooks layer down the call goes on`, { skip, timeout: 600_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vyre-hooks-${eng.bin}-`));
    const d = await startDaemon({
      config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_hookscli", "--space-name", "Space", "--space-kind", "team"], {}, "1.2.3"),
      codeRoot: CODE_ROOT,
      platform: fakePlatform({ os: "linux", hostname: "hooks-cli", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" } } }),
      fetch: caddyFetch,
      intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
      vault: { secret: async () => key!, signRs256: async () => "" },
      engineCli: { command: { [eng.bin]: [path.join(CLI_DIR, eng.bin)] }, programRead: [path.dirname(CLI_DIR)] },
    });
    const log: string[] = [];
    const why = (): string => `${log.join(" | ")}`.replaceAll(key!, "[key]").slice(-1500);
    try {
      const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
      const device = { deviceName: "Mac", deviceClass: "desktop" };
      assert.equal((await call(d, null, "identity.claim_owner", { code, spaceId: "spc_hookscli", username: "dana", displayName: "Dana Reyes", password: PASSWORD, ...device, keys: KEYS })).status, 200);
      const token = (await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session.token as string;
      await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
      // the engine's account, the way a person connects it
      if (eng.id === "claude_code") {
        const folder = await call(d, token, "vault.folders.create", { idempotencyKey: "hc-folder", name: "Accounts", scope: "mine" });
        const flow = await call(d, token, "providers.subscription_start", { idempotencyKey: "hc-flow", providerKey: "claude-code" });
        assert.equal((await call(d, token, "vault.item.put", { idempotencyKey: "hc-item", folderId: folder.data.folder.id, name: "Dana_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: key!, secret: true }] })).status, 200);
        const p = await call(d, token, "providers.subscription_complete", { flowId: flow.data.flowId });
        assert.equal((await call(d, token, "providers.set_space_use", { idempotencyKey: "hc-use", providerId: p.data.provider.id, allow: true })).status, 200);
      } else {
        if (!authJson) {
          const p = await call(d, token, "providers.add", { idempotencyKey: "hc-provider", providerKey: "codex", connection: "api_key", apiKey: key!, scope: "mine" });
          assert.equal(p.status, 200, JSON.stringify(p.data).replaceAll(key!, "[key]"));
          assert.equal((await call(d, token, "providers.set_space_use", { idempotencyKey: "hc-use", providerId: p.data.provider.id, allow: true })).status, 200);
        } else {
        const folder = await call(d, token, "vault.folders.create", { idempotencyKey: "hc-folder", name: "Accounts", scope: "mine" });
        const flow = await call(d, token, "providers.subscription_start", { idempotencyKey: "hc-flow", providerKey: "codex" });
        assert.equal((await call(d, token, "vault.item.put", { idempotencyKey: "hc-item", folderId: folder.data.folder.id, name: "Dana_Codex", kind: "ai_subscription", fields: [{ key: "credentials", value: JSON.stringify({ ".codex/auth.json": key! }), secret: true }] })).status, 200);
        const p = await call(d, token, "providers.subscription_complete", { flowId: flow.data.flowId });
        assert.equal(p.status, 200, JSON.stringify(p.data).replaceAll(key!, "[key]"));
        assert.equal((await call(d, token, "providers.set_space_use", { idempotencyKey: "hc-use", providerId: p.data.provider.id, allow: true })).status, 200);
        }
      }
      const made = await call(d, token, "agents.create", { name: "Intake", role: "You answer in as few words as you can.", idempotencyKey: "hc-agent", ...(eng.model ? { model: eng.model } : {}) });
      assert.equal(made.status, 200, JSON.stringify(made.data));
      const agentId = made.data.agent.agentId as string;
      const started = await call(d, token, "chat.start", { kind: "chat", agentIds: [agentId], title: "Rules", idempotencyKey: "hc-chat" });
      const threadId = started.data.thread.threadId as string;
      const messages = async (): Promise<Array<{ kind?: string; body?: string; author?: { kind?: string } }>> => (await call(d, token, "chat.messages.list", { threadId })).data.messages ?? [];
      const say = async (body: string, k: string): Promise<void> => { assert.equal((await call(d, token, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: k })).status, 200); };
      const agentSaid = (needle: RegExp, n: number) => waitFor(d, async () => {
        const m = (await messages()).filter((x) => x.author?.kind === "agent" && x.kind !== "quiet" && (x.body ?? "") !== "");
        return m.length >= n && needle.test(m.map((x) => x.body).join("\n")) ? m : null;
      }, 240_000, why);

      // 1. a note: a person command hook on prompt.submit writes a line to stdout; it reaches the model as context
      const noteHook = await call(d, token, "hooks.set", { scope: "person", event: "prompt.submit", kind: "command", command: "echo 'The house word is PINEAPPLE.'", summary: "before each message, note the house word" });
      assert.equal(noteHook.status, 200, JSON.stringify(noteHook.data));
      await say("What is the house word? Answer with that one word only.", "hc-1");
      await agentSaid(/PINEAPPLE/i, 1);
      await call(d, token, "hooks.remove", { id: noteHook.data.hook.id });

      // 2. a chat hook the agent could set for itself (made here as the person: the agent's own path is walked on the API engine; this proves the same hook on this engine) stops a Vyre tool
      const stopHook = await call(d, token, "hooks.set", { scope: "chat", threadId, event: "tool.before", matcher: "files_tree", kind: "command", command: "echo 'This folder is off limits in this chat.' >&2; exit 2", summary: "before the file tree is read, stop it" });
      assert.equal(stopHook.status, 200, JSON.stringify(stopHook.data));
      await say("Call the files_tree tool once, then tell me in one sentence what happened. If it was stopped, quote the reason.", "hc-2");
      await agentSaid(/off limits/i, 2);
      assert.ok((await messages()).some((m) => m.kind === "quiet" && /^A hook stopped this: This folder is off limits in this chat/.test(m.body ?? "")), "the chat shows A hook stopped this: <reason>");
      const runs = (await call(d, token, "hooks.runs.list", { threadId })).data.runs as Array<{ hookId: string; outcome: string }>;
      assert.ok(runs.some((r) => r.hookId === stopHook.data.hook.id && r.outcome === "blocked"), "hooks.runs.list shows the block");

      // 3. a Space hook set by the admin blocks the same call first, and its reason is the one the chat shows
      const space = await call(d, token, "hooks.set", { scope: "space", event: "tool.before", matcher: "files_tree", kind: "command", command: "echo 'The Space does not allow this.' >&2; exit 2", summary: "before the file tree is read, Space rule" });
      assert.equal(space.status, 200, JSON.stringify(space.data));
      await say("Call the files_tree tool once more and quote the reason if it is stopped.", "hc-3");
      await agentSaid(/Space does not allow/i, 3);
      const after = (await call(d, token, "hooks.runs.list", { threadId, limit: 20 })).data.runs as Array<{ hookId: string; outcome: string }>;
      const blocksBySpace = after.filter((r) => r.hookId === space.data.hook.id && r.outcome === "blocked").length;
      assert.ok(blocksBySpace >= 1, "the Space hook blocked");

      // 4. the hooks layer down: the endpoint the hooks ask is gone, and the same call goes on
      bindHooksPort(null);
      await say("Call the files_tree tool once more and tell me, in one sentence, that it worked.", "hc-4");
      await waitFor(d, async () => {
        const t = (await messages()).filter((x) => x.author?.kind === "agent" && x.kind !== "quiet");
        return t.length >= 4 ? t : null;
      }, 240_000, why);
      const last = (await messages()).filter((x) => x.author?.kind === "agent" && x.kind !== "quiet").at(-1)?.body ?? "";
      assert.ok(!/stopped|off limits|does not allow/i.test(last), `the call went on: ${last.slice(0, 200)}`);
    } finally { await d.stop().catch(() => undefined); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
