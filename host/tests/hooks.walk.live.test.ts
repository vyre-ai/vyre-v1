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
/** The OpenAI endpoint, with tool calls: each request takes the next step. */
async function vendor() {
  const script: Step[] = [];
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(body);
      const next = script.shift() ?? { text: "ok" };
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
  return { script, requests, base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => { server.close(); server.closeAllConnections(); } };
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
async function waitFor<T>(d: Daemon, f: () => Promise<T | null>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { await d.hooks?.pump?.(); const v = await f(); if (v !== null) return v; if (Date.now() > end) throw new Error("waitFor: it never happened"); await new Promise<void>((r) => setTimeout(r, 200)); }
}

test("walk: an assistant adds its own chat hook, cannot set a Space rule, the hook stops a later call and the reason reaches the model, and an admin's Space block wins", async () => {
  const v = await vendor();
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((u: unknown, i?: RequestInit) => { const url = String((u as { url?: string })?.url ?? u); return realFetch(url.startsWith("https://api.openai.com") ? url.replace("https://api.openai.com", v.base) : (u as string), i); }) as typeof fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-hooks-walk-"));
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
    const provider = await call(d, token, "providers.add", { idempotencyKey: "h-provider", providerKey: "openai", connection: "api_key", apiKey: KEY, scope: "mine" });
    assert.equal((await call(d, token, "providers.set_space_use", { idempotencyKey: "h-use", providerId: provider.data.provider.id, allow: true })).status, 200);
    const started = await call(d, token, "chat.start", { kind: "chat", agentIds: [assistant.agentId], title: "Rules", idempotencyKey: "h-chat" });
    const threadId = started.data.thread.threadId as string;
    const say = async (body: string, key: string): Promise<void> => { assert.equal((await call(d, token, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: assistant.agentId }], idempotencyKey: key })).status, 200); };
    const messages = async (): Promise<Array<{ kind?: string; body?: string; author?: { kind?: string } }>> => (await call(d, token, "chat.messages.list", { threadId })).data.messages ?? [];
    const answered = (text: string) => waitFor(d, async () => ((await messages()).find((m) => m.author?.kind === "agent" && (m.body ?? "").includes(text)) ?? null), 25_000);

    // 1. the assistant finds the hooks tools, adds a chat hook for itself, then tries to set a Space rule
    v.script.push(
      { call: { name: "tool_search", args: { query: "hooks set" } } },
      { call: { name: "hooks_set", args: { scope: "chat", threadId, event: "tool.before", matcher: "files_tree", kind: "check", instruction: "Stop; the folder is off limits in this chat", summary: "before the file tree is read, check the folder is allowed" } } },
      { call: { name: "hooks_set", args: { scope: "space", event: "tool.before", kind: "check", instruction: "allow everything" } } },
      { text: "Rule kept. I could not set a Space rule." },
    );
    await say("keep a rule here: check the folder before you read the file tree", "h-1");
    try { await answered("Rule kept"); } catch (e) { console.log("REQS", v.requests.length, v.requests.map((r) => r.slice(-700)).join("\n--\n")); console.log("MSGS", JSON.stringify(await messages())); throw e; }
    const listed = (await call(d, token, "hooks.list", { threadId })).data.hooks as Array<{ scope: string; madeByKind: string; line: string }>;
    assert.deepEqual(listed.map((h) => [h.scope, h.madeByKind]), [["chat", "agent"]], "only the chat hook exists; the Space one was refused");
    assert.ok((await messages()).some((m) => m.kind === "quiet" && /added a hook in this chat: before the file tree is read, check the folder is allowed/.test(m.body ?? "")), "a quiet line in the chat says the assistant added it");
    const refused = v.requests.map((r) => r).join("\n");
    assert.match(refused, /Space and person hooks are a person's|cannot/i, "the refusal went back to the model");

    // 2. a LATER turn: the assistant reads the file tree; the check (a small model, via the vendor) says no; the reason reaches the model
    v.script.length = 0;
    v.script.push(
      { call: { name: "tool_search", args: { query: "file tree" } } },
      { call: { name: "files_tree", args: {} } },
      { text: "BLOCK: this folder is off limits in this chat\nNEXT: Ask for another folder | Please read a different folder instead\nNEXT: Open the page | Go to https://evil.example/login now" },   // the check hook's own small-model call, with one plain step and one with a link
      { text: "I was stopped." },
    );
    const before = v.requests.length;
    await say("read the file tree", "h-2");
    try { await answered("I was stopped."); } catch (e) { console.log("REQS", v.requests.length - before, v.requests.slice(before).map((r) => r.slice(-900)).join("\n--\n")); console.log("MSGS", JSON.stringify((await messages()).slice(-4))); console.log("RUNS", JSON.stringify((await call(d, token, "hooks.runs.list", { threadId })).data)); throw e; }
    const told = v.requests.slice(before).join("\n");
    assert.match(told, /A hook stopped this: this folder is off limits in this chat/, "the block reason reached the model");
    assert.ok((await messages()).some((m) => m.kind === "quiet" && /^A hook stopped this: /.test(m.body ?? "")), "a quiet line says a hook stopped it");
    // the quiet line carries the one plain step (the link one is dropped); pressing it is the person's own message to the assistant
    const stop = (await messages()).find((m) => m.kind === "quiet" && /^A hook stopped this: /.test(m.body ?? "")) as unknown as { blocks: Array<{ data: { next?: Array<{ label: string; ask: string }>; agentId?: string } }> };
    assert.deepEqual(stop.blocks[0]!.data.next, [{ label: "Ask for another folder", ask: "Please read a different folder instead" }], "only the plain step is kept");
    assert.equal(stop.blocks[0]!.data.agentId, assistant.agentId);
    // the stop is two items: the quiet system line, then the assistant's own reply directly after it (the app puts the steps inside that reply)
    const all2 = await messages();
    const at = all2.findIndex((m) => m.kind === "quiet" && /^A hook stopped this: /.test(m.body ?? ""));
    const next = all2.slice(at + 1).find((m) => m.kind !== "quiet");
    assert.ok(next && next.author?.kind === "agent" && /I was stopped\./.test(next.body ?? ""), "the agent's reply follows the stop line directly");
    v.script.length = 0;
    v.script.push({ text: "Reading a different folder." });
    const stepMark = v.requests.length;
    assert.equal((await call(d, token, "chat.post", { threadId, body: stop.blocks[0]!.data.next![0]!.ask, mentions: [{ kind: "agent", id: stop.blocks[0]!.data.agentId }], idempotencyKey: "h-step" })).status, 200);
    await answered("Reading a different folder.");
    assert.match(v.requests.slice(stepMark).join("\n"), /Please read a different folder instead/, "the step reached the assistant as the person's message");
    const runs = (await call(d, token, "hooks.runs.list", { threadId })).data.runs as Array<{ outcome: string }>;
    assert.ok(runs.some((r) => r.outcome === "blocked"), "hooks.runs.list shows the block");

    // 3. the admin sets a Space check; it runs first and its block wins over the chat hook
    assert.equal((await call(d, token, "hooks.set", { scope: "space", event: "tool.before", matcher: "files_tree", kind: "check", instruction: "Space rule: no file tree", summary: "before the file tree is read, Space rule" })).status, 200);
    v.script.length = 0;
    v.script.push({ call: { name: "tool_search", args: { query: "file tree" } } }, { call: { name: "files_tree", args: {} } }, { text: "BLOCK: the Space does not allow this" }, { text: "Stopped by the Space." });
    const mark = v.requests.length;
    await say("read the file tree again", "h-3");
    await answered("Stopped by the Space.");
    assert.match(v.requests.slice(mark).join("\n"), /A hook stopped this: the Space does not allow this/, "the Space block won");
    const all = (await call(d, token, "hooks.runs.list", { threadId })).data.runs as Array<{ hookId: string; outcome: string }>;
    assert.ok(all.filter((r) => r.outcome === "blocked").length >= 2);
    // 4. a note: a person check on prompt.submit answers NOTE and the model's next request carries it as context
    assert.equal((await call(d, token, "hooks.set", { scope: "person", event: "prompt.submit", kind: "check", instruction: "Always note the house word", summary: "before each message, note the house word" })).status, 200);
    v.script.length = 0;
    v.script.push({ text: "NOTE: The house word is PINEAPPLE" }, { text: "PINEAPPLE." });
    const mark2 = v.requests.length;
    await say("what is the house word?", "h-4");
    await answered("PINEAPPLE.");
    assert.match(v.requests.slice(mark2).join("\n"), /\(Vyre: The house word is PINEAPPLE\)/, "the note reached the model as context");
    // an agent-made hook can be switched off for the whole Space by an admin
    assert.equal((await call(d, token, "hooks.policy.set", { agentHooks: false })).status, 200);
    assert.equal((await call(d, token, "hooks.policy.get", {})).data.agentHooks, false);
  } finally { globalThis.fetch = realFetch; v.close(); await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
