// A walk of hooks with helpers (lane l-hooks): the lead starts a real helper, a chat hook stops the helper's tool call, and an unrelated chat's helper is not stopped. (Header of the main walk follows.)
// A walk of hooks as a real person, on a booted daemon with the model vendor stand-in (lane l-hooks). Dana asks her assistant (an API model) to keep a rule in this chat; the assistant adds a check hook for
// itself, tries to set a Space rule (refused: an agent cannot loosen or set a Space hook), and in a LATER turn a call is stopped by the hook, the reason reaches the model, a quiet line says so in the chat,
// and hooks.runs.list shows it. Then the Space admin (Dana) sets a Space check that blocks, and it wins over the chat hook. Fakes only: the vendor is a local server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEY = "sk-test-fixture-0123456789abcdef"; // secret-scan: fake
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

type Step = { text?: string; call?: { name: string; args: unknown } };
/** The OpenAI endpoint, with tool calls, answering each request from the queue of whoever asked: the lead's turn, a helper's turn, or a hook's check. Two turns run at once, so they cannot share one list. */
async function vendor() {
  const queues = { lead: [] as Step[], helper: [] as Step[], check: [] as Step[] };
  const requests: Array<{ who: "lead" | "helper" | "check"; body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      // a hook's check carries its own system text; a helper's conversation opens with its brief as "(earlier reply) HELPERBRIEF-..." (the lead's never does); anything else is the lead's
      const who = body.includes("You check one rule") ? "check" : body.includes("(earlier reply) HELPERBRIEF") ? "helper" : "lead";
      requests.push({ who, body });
      const next = queues[who].shift() ?? { text: who === "check" ? "ALLOW" : "ok" };
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (o: unknown): void => { res.write(`data: ${JSON.stringify(o)}\n\n`); };
      if (next.call) {
        chunk({ id: "1", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${requests.length}`, type: "function", function: { name: next.call.name, arguments: JSON.stringify(next.call.args) } }] } }] });
        chunk({ id: "1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } });
      } else {
        chunk({ id: "1", choices: [{ index: 0, delta: { role: "assistant", content: next.text ?? "" } }] });
        chunk({ id: "1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } });
      }
      res.write("data: [DONE]\n\n"); res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { queues, requests, base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => { server.close(); server.closeAllConnections(); } };
}

function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_hooks", "--space-name", "Space", "--space-kind", "team"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "onb-hooks", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\n" } } }),
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
async function waitFor<T>(d: Daemon, f: () => Promise<T | null>, ms = 45_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { await d.hooks?.pump?.(); const v = await f(); if (v !== null) return v; if (Date.now() > end) throw new Error("waitFor: it never happened"); await new Promise<void>((r) => setTimeout(r, 200)); }
}

test("walk: a chat's hook stops a helper the lead started, the stop reaches the helper's chat and the parent, and a helper in an unrelated chat is not stopped", async () => {
  const v = await vendor();
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((u: unknown, i?: RequestInit) => { const url = String((u as { url?: string })?.url ?? u); return realFetch(url.startsWith("https://api.openai.com") ? url.replace("https://api.openai.com", v.base) : (u as string), i); }) as typeof fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-hooks-helper-"));
  const d = await boot(dir);
  try {
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Mac", deviceClass: "desktop" };
    assert.equal((await call(d, null, "identity.claim_owner", { code, spaceId: "spc_hooks", username: "dana", displayName: "Dana Reyes", password: PASSWORD, ...device, keys: KEYS })).status, 200);
    const token = (await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session.token as string;
    const me = (await call(d, token, "identity.whoami", {})).data.principal.id as string;
    await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    const assistant = await waitFor(d, async () => {
      const l = (await call(d, token, "agents.list", { section: "personal", limit: 100 })).data.agents as Array<{ agentId: string; ownerId: string; role?: string }>;
      return l.find((a) => a.ownerId === me && a.role === "assistant") ?? null;
    });
    const provider = await call(d, token, "providers.add", { idempotencyKey: "hh-provider", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    assert.equal((await call(d, token, "providers.set_space_use", { idempotencyKey: "hh-use", providerId: provider.data.provider.id, allow: true })).status, 200);
    const chat = async (title: string, key: string): Promise<string> => (await call(d, token, "chat.start", { kind: "chat", agentIds: [assistant.agentId], title, idempotencyKey: key })).data.thread.threadId as string;
    const run = async (threadId: string, key: string, tag: string) => {
      v.queues.lead.push({ call: { name: "tool_search", args: { query: "start a helper sub task" } } }, { call: { name: "sub_task_model", args: { threadId, title: `Look around ${tag}`, instruction: `HELPERBRIEF-${tag}: read the file tree and report` } } }, { text: `Helper started ${tag}.` });
      v.queues.helper.push({ call: { name: "tool_search", args: { query: "file tree" } } }, { call: { name: "files_tree", args: {} } }, { text: `Helper finished ${tag}.` });
      assert.equal((await call(d, token, "chat.post", { threadId, body: `LEADASK ${tag}: start a helper to look at the files`, mentions: [{ kind: "agent", id: assistant.agentId }], idempotencyKey: key })).status, 200);
      await waitFor(d, async () => (((await call(d, token, "chat.messages.list", { threadId })).data.messages ?? []) as Array<{ body?: string }>).find((m) => (m.body ?? "").includes(`Helper started ${tag}.`)) ?? null);
      const helperId = await waitFor(d, async () => ((await call(d, token, "chat.helpers.list", { threadId })).data.helpers as Array<{ threadId: string }> | undefined)?.[0]?.threadId ?? null);
      return helperId;
    };
    const lines = async (threadId: string): Promise<string[]> => (((await call(d, token, "chat.messages.list", { threadId })).data.messages ?? []) as Array<{ kind?: string; body?: string }>).filter((m) => m.kind === "quiet").map((m) => m.body ?? "");

    // chat A: a chat hook that checks the file tree; its helper is stopped
    const a = await chat("Chat A", "hh-a");
    assert.equal((await call(d, token, "hooks.set", { scope: "chat", threadId: a, event: "tool.before", matcher: "files_tree", kind: "check", instruction: "The folder is off limits in this chat", summary: "before the file tree is read, check the folder is allowed" })).status, 200);
    v.queues.check.push({ text: "BLOCK: this folder is off limits in this chat" });
    const helperA = await run(a, "hh-a-post", "A");
    const stopA = await waitFor(d, async () => ((await lines(helperA)).find((l) => /^A hook stopped this: this folder is off limits/.test(l)) ?? null));
    assert.ok(stopA, "the stop reaches the helper's own chat");
    const parentLine = await waitFor(d, async () => ((await lines(a)).find((l) => /^A hook stopped a helper: this folder is off limits/.test(l)) ?? null));
    assert.ok(parentLine, "and the chat the helper works for");
    assert.ok(v.requests.some((r) => r.who === "helper" && /A hook stopped this: this folder is off limits/.test(r.body)), "the reason went back to the helper as its tool result");

    // chat B: no hook; its helper reads the tree and is not stopped, and no check ran for it
    const checksBefore = v.requests.filter((r) => r.who === "check").length;
    const b = await chat("Chat B", "hh-b");
    const helperB = await run(b, "hh-b-post", "B");
    await waitFor(d, async () => (((await call(d, token, "chat.messages.list", { threadId: helperB })).data.messages ?? []) as Array<{ body?: string }>).find((m) => (m.body ?? "").includes("Helper finished B.")) ?? null);
    assert.equal(v.requests.filter((r) => r.who === "check").length, checksBefore, "no check ran for the unrelated chat's helper");
    assert.deepEqual((await lines(helperB)).filter((l) => /hook stopped/i.test(l)), [], "nothing stopped it");
  } finally { globalThis.fetch = realFetch; v.close(); await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
